package com.restaurant.pos

import com.getcapacitor.BridgeActivity
import com.restaurant.pos.plugins.BluetoothPrinterPlugin
import com.restaurant.pos.plugins.UsbPrinterPlugin
import com.restaurant.pos.plugins.TcpPrinterPlugin

/**
 * MainActivity — entry point for the Restaurant POS Android app.
 *
 * Registers custom Capacitor plugins that expose hardware APIs to the WebView:
 *  - BluetoothPrinterPlugin  → window.Capacitor.Plugins.BluetoothPrinter
 *  - UsbPrinterPlugin        → window.Capacitor.Plugins.UsbPrinter
 *  - TcpPrinterPlugin        → window.Capacitor.Plugins.TcpPrinter
 *
 * After registering, open Android Studio → Build → Generate Signed APK.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        // Register custom plugins BEFORE super.onCreate() so they are available
        // immediately when the WebView loads the JS bridge.
        registerPlugin(BluetoothPrinterPlugin::class.java)
        registerPlugin(UsbPrinterPlugin::class.java)
        registerPlugin(TcpPrinterPlugin::class.java)

        super.onCreate(savedInstanceState)
    }
}
