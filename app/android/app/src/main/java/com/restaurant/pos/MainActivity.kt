package com.restaurant.pos

import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
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
        // content="width=NNNN"> directives. Android WebView defaults these to
        // false, which means our server-side `width=1920` for the POS layout
        // would be silently ignored — the WebView would always render at
        // device-width regardless. With both flags set to true, the page
        // renders at the CSS-pixel canvas we asked for and scales to fit.
        bridge.webView.settings.useWideViewPort = true
        bridge.webView.settings.loadWithOverviewMode = true

        // Immersive full-screen: hide the system status bar (clock/battery/
        // notifications) AND the bottom navigation bar so the POS uses the whole
        // screen — the kiosk look, and it removes the status-bar overlap on
        // Android 15 (which forces edge-to-edge). The bars reappear transiently
        // on an edge swipe, then auto-hide again.
        hideSystemBars()
    }

    // The system can re-show the bars after a dialog, the soft keyboard, or the
    // app regaining focus. Re-hide whenever we get focus back so full-screen is
    // sticky.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        // Let the content draw edge-to-edge behind where the bars were.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        // Swipe from an edge reveals the bars temporarily, then they hide again.
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
}
