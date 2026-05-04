package com.restaurant.pos.plugins

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

/**
 * BluetoothPrinterPlugin
 *
 * Exposes classic Bluetooth (SPP — Serial Port Profile) printing to the WebView.
 * ESC/POS thermal printers universally support SPP, identified by the well-known
 * serial UUID: 00001101-0000-1000-8000-00805F9B34FB.
 *
 * JS API (via capacitorBridge.ts):
 *   Capacitor.Plugins.BluetoothPrinter.getPairedDevices()
 *     → { devices: [{ name: string, address: string }] }
 *
 *   Capacitor.Plugins.BluetoothPrinter.print({ address: string, bytes: number[] })
 *     → void (throws on failure)
 *
 * Permissions required in AndroidManifest.xml:
 *   Android ≤11: BLUETOOTH, BLUETOOTH_ADMIN, ACCESS_FINE_LOCATION
 *   Android 12+:  BLUETOOTH_CONNECT, BLUETOOTH_SCAN
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH],         alias = "bluetooth"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADMIN],   alias = "bluetoothAdmin"),
        Permission(strings = ["android.permission.BLUETOOTH_CONNECT"],        alias = "bluetoothConnect"),
        Permission(strings = ["android.permission.BLUETOOTH_SCAN"],           alias = "bluetoothScan"),
    ]
)
class BluetoothPrinterPlugin : Plugin() {

    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private fun getAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
    }

    private fun hasBluetoothPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(
                context, android.Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(
                context, android.Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Return all Bluetooth devices currently paired with this Android device.
     * The JS layer filters for printers by name or lets the user choose.
     */
    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAliases(
                arrayOf("bluetoothConnect", "bluetoothScan"),
                call,
                "bluetoothPermissionCallback"
            )
            return
        }

        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth is not available or not enabled on this device")
            return
        }

        val result  = JSObject()
        val devices = JSArray()

        @Suppress("MissingPermission")
        for (device in adapter.bondedDevices) {
            val obj = JSObject()
            obj.put("name",    device.name    ?: "Unknown")
            obj.put("address", device.address ?: "")
            devices.put(obj)
        }

        result.put("devices", devices)
        call.resolve(result)
    }

    @PermissionCallback
    fun bluetoothPermissionCallback(call: PluginCall) {
        if (hasBluetoothPermission()) {
            getPairedDevices(call)
        } else {
            call.reject("Bluetooth permission denied")
        }
    }

    /**
     * Connect to the printer via SPP and write the ESC/POS byte array.
     * The connection is opened, data is written, then immediately closed —
     * matching the stateless model of the network/USB paths.
     */
    @PluginMethod
    fun print(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.reject("address is required")
            return
        }

        val bytesArray = call.getArray("bytes")
        if (bytesArray == null || bytesArray.length() == 0) {
            call.reject("bytes array is required and must not be empty")
            return
        }

        if (!hasBluetoothPermission()) {
            call.reject("Bluetooth permission not granted")
            return
        }

        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth is not enabled")
            return
        }

        // Convert JSArray of ints to ByteArray
        val byteList = mutableListOf<Byte>()
        for (i in 0 until bytesArray.length()) {
            byteList.add(bytesArray.getInt(i).toByte())
        }
        val data = byteList.toByteArray()

        // IO work off the main thread
        CoroutineScope(Dispatchers.IO).launch {
            var socket: BluetoothSocket? = null
            var stream: OutputStream?    = null
            try {
                @Suppress("MissingPermission")
                val device = adapter.getRemoteDevice(address)
                    ?: throw IllegalArgumentException("Device not found: $address")

                socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                adapter.cancelDiscovery() // reduces latency during connect

                // Enforce an 8-second connect timeout. Closing the socket from a
                // daemon thread interrupts the blocking connect() call cleanly.
                val socketRef = socket
                val timeoutThread = Thread {
                    try { Thread.sleep(8_000) } catch (_: InterruptedException) { return@Thread }
                    try { socketRef.close() } catch (_: Exception) {}
                }
                timeoutThread.isDaemon = true
                timeoutThread.start()

                try {
                    socket.connect() // blocks until connected, error, or socket is closed by timeout thread
                } catch (e: IOException) {
                    timeoutThread.interrupt()
                    if (!socket.isConnected) {
                        // Try fallback socket (via reflection) for stubborn devices
                        try { socket.close() } catch (_: Exception) {}
                        @Suppress("MissingPermission")
                        val fallback = device.javaClass
                            .getMethod("createRfcommSocket", Int::class.java)
                            .invoke(device, 1) as BluetoothSocket
                        socket = fallback
                        val fb = socket
                        val fbTimeout = Thread {
                            try { Thread.sleep(8_000) } catch (_: InterruptedException) { return@Thread }
                            try { fb.close() } catch (_: Exception) {}
                        }
                        fbTimeout.isDaemon = true
                        fbTimeout.start()
                        try {
                            fb.connect()
                            fbTimeout.interrupt()
                        } catch (e2: Exception) {
                            fbTimeout.interrupt()
                            throw IOException("Bluetooth connection timed out or refused. Is the printer on and in range?", e2)
                        }
                    } else {
                        throw e
                    }
                }
                timeoutThread.interrupt()

                stream = socket.outputStream
                stream.write(data)
                stream.flush()

                call.resolve()
            } catch (e: Exception) {
                val msg = when {
                    e.message?.contains("timed out", ignoreCase = true) == true ->
                        "Bluetooth connection timed out. Is the printer powered on and in range?"
                    e.message?.contains("Connection refused") == true ->
                        "Printer refused connection. Is it powered on and in Bluetooth mode?"
                    e.message?.contains("Host is down") == true ->
                        "Cannot reach printer. Check it is powered on and in range."
                    else -> "Bluetooth print failed: ${e.message}"
                }
                call.reject(msg, e)
            } finally {
                try { stream?.close() } catch (_: Exception) {}
                try { socket?.close() } catch (_: Exception) {}
            }
        }
    }
}
