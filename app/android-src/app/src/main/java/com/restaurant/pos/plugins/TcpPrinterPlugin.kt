package com.restaurant.pos.plugins

import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.net.InetSocketAddress
import java.net.Socket

/**
 * TcpPrinterPlugin
 *
 * Sends raw ESC/POS bytes directly from the Android device to a LAN printer
 * via TCP socket — bypassing the /api/print server proxy.
 *
 * This is the key "offline LAN" path:
 *  - Internet is down but the restaurant LAN is up
 *  - The printer is reachable at its local IP (e.g. 192.168.1.100:9100)
 *  - The Next.js server is not accessible
 *
 * JS API:
 *   Capacitor.Plugins.TcpPrinter.print({ ip: string, port: number, bytes: number[] })
 *     → void (throws on failure)
 *
 * The capacitorBridge.ts sendTcpNative() function calls this plugin and falls
 * back to /api/print when not running on Android.
 *
 * No additional permissions required (INTERNET is granted by default).
 */
@CapacitorPlugin(name = "TcpPrinter")
class TcpPrinterPlugin : Plugin() {

    @PluginMethod
    fun print(call: PluginCall) {
        val ip         = call.getString("ip")
        val port       = call.getInt("port", 9100)!!
        val bytesArray = call.getArray("bytes")

        if (ip.isNullOrBlank()) {
            call.reject("ip is required")
            return
        }
        if (bytesArray == null || bytesArray.length() == 0) {
            call.reject("bytes array is required and must not be empty")
            return
        }
        if (port < 1 || port > 65535) {
            call.reject("port must be between 1 and 65535")
            return
        }

        val byteList = mutableListOf<Byte>()
        for (i in 0 until bytesArray.length()) {
            byteList.add(bytesArray.getInt(i).toByte())
        }
        val data = byteList.toByteArray()

        CoroutineScope(Dispatchers.IO).launch {
            var socket: Socket? = null
            try {
                socket = Socket()
                socket.soTimeout = 6_000 // read timeout

                // connect() with explicit timeout to catch unreachable hosts faster
                socket.connect(InetSocketAddress(ip, port), 6_000)

                val stream = socket.getOutputStream()
                stream.write(data)
                stream.flush()

                // Half-close: signal end of data, wait for printer to acknowledge
                socket.shutdownOutput()

                call.resolve()
            } catch (e: java.net.ConnectException) {
                call.reject(
                    "Printer at $ip:$port refused connection. " +
                    "Check it is powered on and not in error state.", e
                )
            } catch (e: java.net.SocketTimeoutException) {
                call.reject(
                    "Connection to $ip:$port timed out. " +
                    "Check the IP address and that the printer is on the same network.", e
                )
            } catch (e: java.net.UnknownHostException) {
                call.reject("Host $ip not found. Use a numeric IP address.", e)
            } catch (e: Exception) {
                call.reject("TCP print error: ${e.message}", e)
            } finally {
                try { socket?.close() } catch (_: Exception) {}
            }
        }
    }
}
