package com.restaurant.pos.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * OutboxSyncWorker
 *
 * Mirrors the outbox drain logic in posOutbox.ts — runs as a background
 * WorkManager task on Android, draining failed/pending sales to Supabase
 * even when the POS WebView is closed.
 *
 * Schedule (in MainActivity or Application.onCreate):
 *
 *   val constraints = Constraints.Builder()
 *       .setRequiredNetworkType(NetworkType.CONNECTED)
 *       .build()
 *
 *   WorkManager.getInstance(context).enqueueUniquePeriodicWork(
 *       "pos-outbox-sync",
 *       ExistingPeriodicWorkPolicy.KEEP,
 *       PeriodicWorkRequestBuilder<OutboxSyncWorker>(15, TimeUnit.MINUTES)
 *           .setConstraints(constraints)
 *           .build()
 *   )
 *
 * The worker reads the same localStorage key ("pos_outbox") that the WebView
 * writes to, via the Android WebView's evaluateJavascript() bridge.
 * Alternatively, if you migrate to SQLite, read directly from the DB here.
 *
 * Implementation note: Because localStorage is WebView-sandboxed, the worker
 * triggers a JS drain call instead of reading the storage directly.
 */
class OutboxSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val MAX_ATTEMPTS = 5
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

        private val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val serverUrl = inputData.getString("serverUrl")
                ?: return@withContext Result.failure()

            // Read the outbox from SharedPreferences (native mirror of localStorage).
            // The key and schema must match posOutbox.ts exactly.
            val prefs   = applicationContext.getSharedPreferences("pos_native_cache", Context.MODE_PRIVATE)
            val rawJson = prefs.getString("pos_outbox", "[]") ?: "[]"
            val outbox  = JSONArray(rawJson)

            if (outbox.length() == 0) return@withContext Result.success()

            val updated = JSONArray()
            var anyFailed = false

            for (i in 0 until outbox.length()) {
                val entry = outbox.getJSONObject(i)
                val status   = entry.optString("status", "pending")
                val attempts = entry.optInt("attempts", 0)

                if (status == "failed" && attempts >= MAX_ATTEMPTS) {
                    updated.put(entry) // keep permanently failed entries for admin review
                    continue
                }

                val payload = entry.optJSONObject("payload") ?: continue

                val body = payload.toString().toRequestBody(JSON_TYPE)
                val req  = Request.Builder()
                    .url("$serverUrl/api/pos/orders")
                    .post(body)
                    .build()

                try {
                    val response = http.newCall(req).execute()
                    val code     = response.code

                    when {
                        code == 200 || code == 409 -> {
                            // 409 = duplicate (ON CONFLICT DO NOTHING) — treat as success
                        }
                        code in 400..499 -> {
                            // Client error — mark failed, don't retry
                            entry.put("status",    "failed")
                            entry.put("lastError", "HTTP $code")
                            updated.put(entry)
                            anyFailed = true
                        }
                        else -> {
                            // Server error — increment attempts, retry later
                            entry.put("attempts",  attempts + 1)
                            entry.put("status",    if (attempts + 1 >= MAX_ATTEMPTS) "failed" else "pending")
                            entry.put("lastError", "HTTP $code")
                            updated.put(entry)
                            anyFailed = true
                        }
                    }
                } catch (e: Exception) {
                    entry.put("attempts",  attempts + 1)
                    entry.put("status",    if (attempts + 1 >= MAX_ATTEMPTS) "failed" else "pending")
                    entry.put("lastError", e.message ?: "network error")
                    updated.put(entry)
                    anyFailed = true
                }
            }

            // Persist the updated outbox back to SharedPreferences
            prefs.edit().putString("pos_outbox", updated.toString()).apply()

            if (anyFailed) Result.retry() else Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
