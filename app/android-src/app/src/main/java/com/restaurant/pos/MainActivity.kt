package com.restaurant.pos

import android.os.Bundle
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.BridgeActivity
import com.restaurant.pos.plugins.BluetoothPrinterPlugin
import com.restaurant.pos.plugins.UsbPrinterPlugin
import com.restaurant.pos.plugins.TcpPrinterPlugin
import com.restaurant.pos.sync.MenuSyncWorker
import com.restaurant.pos.sync.OutboxSyncWorker
import java.util.concurrent.TimeUnit

/**
 * MainActivity — entry point for the Restaurant POS Android app.
 *
 * Registers custom Capacitor plugins that expose hardware APIs to the WebView:
 *  - BluetoothPrinterPlugin  → window.Capacitor.Plugins.BluetoothPrinter
 *  - UsbPrinterPlugin        → window.Capacitor.Plugins.UsbPrinter
 *  - TcpPrinterPlugin        → window.Capacitor.Plugins.TcpPrinter
 *
 * Also schedules WorkManager periodic tasks for background sync:
 *  - OutboxSyncWorker: drains pending offline sales every 15 minutes
 *  - MenuSyncWorker:   refreshes menu from Supabase every 30 minutes
 *
 * After registering, open Android Studio → Build → Generate Signed APK.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins BEFORE super.onCreate() so they are available
        // immediately when the WebView loads the JS bridge.
        registerPlugin(BluetoothPrinterPlugin::class.java)
        registerPlugin(UsbPrinterPlugin::class.java)
        registerPlugin(TcpPrinterPlugin::class.java)

        super.onCreate(savedInstanceState)
        scheduleBackgroundSync()
    }

    private fun scheduleBackgroundSync() {
        val networkOnly = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val wm = WorkManager.getInstance(this)

        // Drain offline sale outbox every 15 minutes when network is available.
        wm.enqueueUniquePeriodicWork(
            "outbox_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<OutboxSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkOnly)
                .build(),
        )

        // Pull latest menu from Supabase every 30 minutes.
        wm.enqueueUniquePeriodicWork(
            "menu_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<MenuSyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(networkOnly)
                .build(),
        )
    }
}
