package com.restaurant.pos.plugins

import android.util.Base64
import android.util.Log
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
        val ip   = call.getString("ip")
        val port = call.getInt("port", 9100)!!

        if (ip.isNullOrBlank()) {
            call.reject("ip is required")
            return
        }
        if (port < 1 || port > 65535) {
            call.reject("port must be between 1 and 65535")
            return
        }

        // Preferred input is base64 `data` (reliable binary transfer across the
        // bridge). Fall back to the legacy `bytes` number[] for compatibility.
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
                val list = ByteArray(arr.length())
                for (i in 0 until arr.length()) list[i] = arr.getInt(i).toByte()
                list
            }
        }
        if (data.isEmpty()) { call.reject("nothing to print (empty data)"); return }

        CoroutineScope(Dispatchers.IO).launch {
            var socket: Socket? = null
            try {
                socket = Socket()
                socket.tcpNoDelay = true          // send immediately (no Nagle batching)
                socket.connect(InetSocketAddress(ip, port), 6_000)

                Log.d("TcpPrinter", "connected $ip:$port — writing ${data.size} bytes")
                val stream = socket.getOutputStream()
                stream.write(data)
                stream.flush()

                // The previous code closed the socket immediately after write, which
                // tore it down before the send buffer transmitted → 0 bytes reached
                // the printer. SO_LINGER makes close() block until the data is
                // delivered (≤5s); the brief sleep is belt-and-suspenders so the
                // bytes are on the wire before teardown.
                socket.setSoLinger(true, 5)
                Thread.sleep(150)

                Log.d("TcpPrinter", "wrote ${data.size} bytes OK")
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
