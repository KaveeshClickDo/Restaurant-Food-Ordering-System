package com.restaurant.pos.plugins

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * UsbPrinterPlugin
 *
 * Sends raw ESC/POS bytes to a USB thermal printer using the Android USB Host API.
 * No driver installation required — uses Android's built-in USB Host support.
 *
 * JS API:
 *   Capacitor.Plugins.UsbPrinter.getDevices()
 *     → { devices: [{ name: string, deviceId: number }] }
 *
 *   Capacitor.Plugins.UsbPrinter.print({ data: string (base64), deviceId?: number })
 *     → void (throws on failure)
 *
 * Permission flow: USB access needs a per-device runtime permission. If it isn't
 * already granted, print() pops the system "Allow app to access the USB device?"
 * dialog via UsbManager.requestPermission(), waits for the result on a broadcast
 * receiver, then prints on grant. (Previously it only CHECKED permission and gave
 * up — so USB never worked.)
 *
 * Manifest: <uses-feature android:name="android.hardware.usb.host" />
 * Note: USB Host is not available on all Android devices (some phones lack it);
 * it's available on dedicated POS hardware and most tablets, via a USB-OTG cable.
 */
@CapacitorPlugin(name = "UsbPrinter")
class UsbPrinterPlugin : Plugin() {

    companion object {
        private const val ACTION_USB_PERMISSION = "com.restaurant.pos.USB_PERMISSION"
    }

    private fun getUsbManager(): UsbManager =
        context.getSystemService(Context.USB_SERVICE) as UsbManager

    /**
     * Return all USB devices currently connected to the Android device.
     * The user's JS code picks the printer by name or deviceId.
     */
    @PluginMethod
    fun getDevices(call: PluginCall) {
        val manager  = getUsbManager()
        val result   = JSObject()
        val devices  = JSArray()

        for ((_, device) in manager.deviceList) {
            val obj = JSObject()
            obj.put("name",     device.deviceName ?: "USB Device")
            obj.put("deviceId", device.deviceId)
            devices.put(obj)
        }

        result.put("devices", devices)
        call.resolve(result)
    }

    /**
     * Decode the payload, pick the device, ensure permission, then write.
     */
    @PluginMethod
    fun print(call: PluginCall) {
        val requestedId = if (call.hasOption("deviceId")) call.getInt("deviceId") else null

        // Preferred input is base64 `data` (reliable across the bridge); fall back
        // to the legacy `bytes` number[].
        val data: ByteArray = run {
            val b64 = call.getString("data")
            if (!b64.isNullOrEmpty()) {
                try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) {
                    call.reject("invalid base64 data", e); return
                }
            } else {
                val arr = call.getArray("bytes")
                if (arr == null || arr.length() == 0) {
                    call.reject("data (base64) or bytes array is required"); return
                }
                val out = ByteArray(arr.length())
                for (i in 0 until arr.length()) out[i] = arr.getInt(i).toByte()
                out
            }
        }
        if (data.isEmpty()) { call.reject("nothing to print (empty data)"); return }

        val manager    = getUsbManager()
        val deviceList = manager.deviceList
        if (deviceList.isEmpty()) {
            call.reject("No USB devices connected. Plug the printer in via a USB-OTG cable.")
            return
        }

        val device = if (requestedId != null) {
            deviceList.values.firstOrNull { it.deviceId == requestedId }
                ?: run { call.reject("USB device $requestedId not found"); return }
        } else {
            deviceList.values.first()
        }

        if (manager.hasPermission(device)) {
            writeToDevice(device, data, call)
        } else {
            // Show the system permission dialog, then print on grant.
            requestUsbPermission(device) { granted ->
                if (granted) {
                    writeToDevice(device, data, call)
                } else {
                    call.reject("USB permission denied. Tap “OK/Allow” on the dialog, then print again.")
                }
            }
        }
    }

    /**
     * Pop the system "Allow app to access the USB device?" dialog and deliver the
     * user's choice to [onResult]. Registers a one-shot receiver for the result.
     */
    private fun requestUsbPermission(device: UsbDevice, onResult: (Boolean) -> Unit) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE // USB system fills in EXTRA_DEVICE/EXTRA_PERMISSION_GRANTED
        } else {
            0
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
            flags,
        )

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != ACTION_USB_PERMISSION) return
                try { context.unregisterReceiver(this) } catch (_: Exception) {}
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                Log.d("UsbPrinter", "USB permission ${if (granted) "granted" else "denied"}")
                onResult(granted)
            }
        }

        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }

        Log.d("UsbPrinter", "requesting USB permission for ${device.deviceName}")
        getUsbManager().requestPermission(device, pendingIntent)
    }

    /**
     * Open the device, claim interface 0, find the bulk-OUT endpoint, and write the
     * ESC/POS bytes. Runs off the main thread.
     */
    private fun writeToDevice(device: UsbDevice, data: ByteArray, call: PluginCall) {
        CoroutineScope(Dispatchers.IO).launch {
            val manager = getUsbManager()

            // Permission can be revoked between request and open — re-check.
            if (!manager.hasPermission(device)) {
                call.reject("USB permission not granted for ${device.deviceName}")
                return@launch
            }

            val connection = manager.openDevice(device)
                ?: run { call.reject("Could not open USB device — check it is not in use"); return@launch }

            try {
                val iface = device.getInterface(0)
                connection.claimInterface(iface, true)

                // Find bulk OUT endpoint (direction = host→device)
                val endpoint = (0 until iface.endpointCount)
                    .map { iface.getEndpoint(it) }
                    .firstOrNull {
                        it.direction == UsbConstants.USB_DIR_OUT &&
                        it.type == UsbConstants.USB_ENDPOINT_XFER_BULK
                    }
                    ?: run {
                        call.reject(
                            "No bulk OUT endpoint found. This device may not be an ESC/POS printer, " +
                            "or may use a different USB interface."
                        )
                        return@launch
                    }

                Log.d("UsbPrinter", "writing ${data.size} bytes to ${device.deviceName}")
                val transferred = connection.bulkTransfer(endpoint, data, data.size, 5_000)
                if (transferred < 0) {
                    call.reject("USB bulk transfer failed (returned $transferred). Is the printer ready?")
                } else {
                    Log.d("UsbPrinter", "wrote $transferred bytes OK")
                    call.resolve()
                }
            } catch (e: Exception) {
                call.reject("USB print error: ${e.message}", e)
            } finally {
                connection.close()
            }
        }
    }
}
