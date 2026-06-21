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
 * @capacitor-community/sqlite is auto-registered by `npx cap sync android`
 * (it ships as a normal Capacitor plugin discovered from package.json) so it
 * does NOT need a registerPlugin() call here.
 *
 * Background sync workers (OutboxSyncWorker, MenuSyncWorker) are intentionally
 * NOT scheduled in Phase 1. The JS-side drain in pos/page.tsx pushes the
 * outbox whenever the WebView is open AND connectivity is restored — this
 * covers the dominant "cashier reopens the app and reconnects" case. Closed-
 * app background sync is deferred to a later phase per
 * docs/pos-offline/09-decisions.md.
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

        // Enable wide viewport so the WebView respects <meta name="viewport"
        // content="width=NNNN" / initial-scale=N> directives. Android WebView
        // defaults these to false, which means our Capacitor-only viewport
        // (initial-scale=0.6 set in app/src/app/layout.tsx) would be silently
        // ignored — the WebView would always render at device-width regardless,
        // and the cart panel would clip off-screen on phone landscape.
        bridge.webView.settings.useWideViewPort = true
        bridge.webView.settings.loadWithOverviewMode = true
    }
}
