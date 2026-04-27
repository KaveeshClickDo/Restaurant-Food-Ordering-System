package com.restaurant.pos.plugins

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
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
 *   Capacitor.Plugins.UsbPrinter.print({ bytes: number[], deviceId?: number })
 *     → void (throws on failure)
 *
 * Permissions required in AndroidManifest.xml:
 *   <uses-feature android:name="android.hardware.usb.host" />
 *   USB permission is requested at runtime via UsbManager.requestPermission().
 *
 * Note: USB Host is not available on all Android devices (phones often lack it).
 * It is available on all dedicated POS hardware (Sunmi, PAX, Imin) and most tablets.
 */
@CapacitorPlugin(name = "UsbPrinter")
class UsbPrinterPlugin : Plugin() {

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
     * Write ESC/POS bytes to the USB printer.
     * Selects the first available USB device if deviceId is not specified.
     * Uses bulk transfer to the first OUT endpoint on interface 0.
     */
    @PluginMethod
    fun print(call: PluginCall) {
        val requestedId = if (call.hasOption("deviceId")) call.getInt("deviceId") else null
        val bytesArray  = call.getArray("bytes")

        if (bytesArray == null || bytesArray.length() == 0) {
            call.reject("bytes array is required and must not be empty")
            return
        }

        val byteList = mutableListOf<Byte>()
        for (i in 0 until bytesArray.length()) {
            byteList.add(bytesArray.getInt(i).toByte())
        }
        val data = byteList.toByteArray()

        CoroutineScope(Dispatchers.IO).launch {
            val manager    = getUsbManager()
            val deviceList = manager.deviceList

            if (deviceList.isEmpty()) {
                call.reject("No USB devices connected")
                return@launch
            }

            // Find device by ID, or use first available
            val device = if (requestedId != null) {
                deviceList.values.firstOrNull { it.deviceId == requestedId }
                    ?: run { call.reject("USB device $requestedId not found"); return@launch }
            } else {
                deviceList.values.first()
            }

            if (!manager.hasPermission(device)) {
                call.reject(
                    "USB permission not granted for ${device.deviceName}. " +
                    "Grant permission via the Android USB permission dialog."
                )
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
                    .firstOrNull { it.direction == UsbConstants.USB_DIR_OUT && it.type == UsbConstants.USB_ENDPOINT_XFER_BULK }
                    ?: run {
                        call.reject(
                            "No bulk OUT endpoint found. This device may not be an ESC/POS printer, " +
                            "or may use a different USB interface."
                        )
                        return@launch
                    }

                val transferred = connection.bulkTransfer(endpoint, data, data.size, 5_000)
                if (transferred < 0) {
                    call.reject("USB bulk transfer failed (returned $transferred). Is the printer ready?")
                } else {
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
