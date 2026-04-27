package com.restaurant.pos.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * MenuSyncWorker
 *
 * Periodically fetches the latest menu (products + categories) from the server
 * and caches it in SharedPreferences under "pos_menu_cache".
 *
 * On the JS side, POSContext reads this cache key on startup when the network
 * fetch fails — ensuring the menu is available even if the server is unreachable
 * at boot time.
 *
 * Schedule (every 30 minutes when connected):
 *
 *   WorkManager.getInstance(context).enqueueUniquePeriodicWork(
 *       "pos-menu-sync",
 *       ExistingPeriodicWorkPolicy.KEEP,
 *       PeriodicWorkRequestBuilder<MenuSyncWorker>(30, TimeUnit.MINUTES)
 *           .setConstraints(
 *               Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
 *           )
 *           .setInputData(workDataOf("serverUrl" to "https://your-app.vercel.app"))
 *           .build()
 *   )
 */
class MenuSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val serverUrl = inputData.getString("serverUrl")
                ?: return@withContext Result.failure()

            val request  = Request.Builder().url("$serverUrl/api/pos/menu").get().build()
            val response = http.newCall(request).execute()

            if (!response.isSuccessful) return@withContext Result.retry()

            val body = response.body?.string() ?: return@withContext Result.retry()

            // Cache the raw JSON response — the WebView reads this on startup
            applicationContext
                .getSharedPreferences("pos_native_cache", Context.MODE_PRIVATE)
                .edit()
                .putString("pos_menu_cache", body)
                .putLong("pos_menu_cache_ts", System.currentTimeMillis())
                .apply()

            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
