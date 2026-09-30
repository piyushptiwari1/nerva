package ai.bytical.nerva.widgets

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.util.Calendar

object WidgetAlarms {
    private const val CHANNEL = "nerva-focus-alerts"
    private fun manager(context: Context) = context.getSystemService(AlarmManager::class.java)
    private fun prefs(context: Context) = context.getSharedPreferences("nerva.widget.alarms", Context.MODE_PRIVATE)
    fun exactAllowed(context: Context) = Build.VERSION.SDK_INT < 31 || manager(context).canScheduleExactAlarms()
    fun notificationsAllowed(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun alarm(context: Context, id: String): PendingIntent {
        val intent = Intent(context, WidgetAlarmReceiver::class.java).setAction("ai.bytical.nerva.TIMER_ALARM")
            .setData(Uri.parse("nerva-timer://$id"))
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun signature(timer: JSONObject) = "${timer.optLong("started_at_ms")}:${timer.optLong("paused_total_ms")}"

    fun sync(context: Context, snapshot: JSONObject, force: Boolean = false) {
        val preferences = prefs(context)
        val previous = runCatching { JSONObject(preferences.getString("scheduled", "{}")!!) }.getOrDefault(JSONObject())
        val timers = snapshot.getJSONArray("timers").objects().associateBy { it.getString("id") }
        val now = System.currentTimeMillis()
        val next = JSONObject()
        previous.keys().forEach { id ->
            val scheduled = previous.getJSONObject(id)
            val timer = timers[id]
            if (scheduled.getLong("deadline") <= now && timer != null && signature(timer) == scheduled.getString("signature") && timer.getString("status") in listOf("running", "completed")) {
                val token = "${scheduled.getString("signature")}:${scheduled.getLong("deadline")}"
                if (preferences.getString("delivered.$id", "") != token) {
                    notify(context, timer)
                    preferences.edit().putString("delivered.$id", token).commit()
                }
            }
        }
        timers.forEach { (id, timer) ->
            if (timer.getString("status") != "running") return@forEach
            val phase = timer.getInt("phase_index")
            val elapsedAtBoundary = timer.getJSONArray("phases").objects().take(phase + 1).sumOf { it.getLong("duration_ms") }
            val deadline = timer.getLong("started_at_ms") + timer.getLong("paused_total_ms") + elapsedAtBoundary
            if (deadline <= now) return@forEach
            val record = JSONObject().put("deadline", deadline).put("signature", signature(timer)).put("exact", exactAllowed(context))
            next.put(id, record)
            if (force || previous.optJSONObject(id)?.toString() != record.toString()) {
                val operation = alarm(context, id)
                try {
                    if (exactAllowed(context)) manager(context).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline, operation)
                    else manager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline, operation)
                } catch (_: SecurityException) {
                    manager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline, operation)
                }
            }
        }
        previous.keys().forEach { id -> if (!next.has(id)) manager(context).cancel(alarm(context, id)) }
        preferences.edit().putString("scheduled", next.toString()).commit()
        val midnight = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1); set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        manager(context).set(AlarmManager.RTC, midnight.timeInMillis, alarm(context, "day-refresh"))
    }

    private fun notify(context: Context, timer: JSONObject) {
        if (!notificationsAllowed(context)) return
        if (Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Focus and break alerts", NotificationManager.IMPORTANCE_HIGH))
        }
        val completed = timer.getString("status") == "completed"
        val title = if (completed) "Session complete" else if (timer.getString("phase_kind") == "break") "Break time" else "Back to focus"
        val builder = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title).setContentText(timer.getString("name")).setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        if (!completed) builder.addAction(android.R.drawable.ic_media_pause, "Pause", WidgetUi.action(context, -1,
            JSONObject().put("action", "timer").put("id", timer.getString("id")).put("operation", "pause"), "pause-${timer.getString("id")}"))
        try { NotificationManagerCompat.from(context).notify(timer.getString("id"), 1, builder.build()) }
        catch (_: SecurityException) { }
    }
}

class WidgetAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!java.io.File(context.applicationInfo.dataDir, "nerva.db").exists()) return
        val pending = goAsync()
        WidgetWorker.run(context, { pending.finish() }) {
            WidgetAlarms.sync(context, WidgetBridge.snapshot(context), force = intent.action != "ai.bytical.nerva.TIMER_ALARM")
            WidgetUi.changed(context)
        }
    }
}