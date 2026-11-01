package ai.bytical.nerva.assistant

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
import ai.bytical.nerva.MainActivity
import ai.bytical.nerva.widgets.WidgetBridge
import ai.bytical.nerva.widgets.WidgetWorker
import ai.bytical.nerva.widgets.objects
import org.json.JSONObject

/**
 * Exact alarms for reminders created while the app UI is closed (e.g. by
 * Gemini). The running app schedules its own notifications, so these are
 * cleared whenever it refreshes widgets to avoid doubles.
 */
object ReminderAlarms {
    private const val CHANNEL = "nerva-reminders"
    private const val ACTION = "ai.bytical.nerva.REMINDER_ALARM"
    private fun prefs(context: Context) = context.getSharedPreferences("nerva.assistant.reminders", Context.MODE_PRIVATE)
    private fun manager(context: Context) = context.getSystemService(AlarmManager::class.java)

    private fun operation(context: Context, id: String, title: String = ""): PendingIntent {
        val intent = Intent(context, ReminderAlarmReceiver::class.java).setAction(ACTION)
            .setData(Uri.parse("nerva-reminder://$id")).putExtra("title", title)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun schedule(context: Context, id: String, title: String, dueMs: Long) {
        val pending = operation(context, id, title)
        try {
            if (Build.VERSION.SDK_INT < 31 || manager(context).canScheduleExactAlarms()) {
                manager(context).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueMs, pending)
            } else {
                manager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueMs, pending)
            }
        } catch (_: SecurityException) {
            manager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueMs, pending)
        }
        prefs(context).edit().putLong(id, dueMs).commit()
    }

    fun cancelAll(context: Context) {
        val store = prefs(context)
        store.all.keys.forEach { manager(context).cancel(operation(context, it)) }
        store.edit().clear().commit()
    }

    fun fire(context: Context, id: String, fallbackTitle: String) {
        prefs(context).edit().remove(id).commit()
        val stillDue = runCatching {
            (WidgetBridge.execute(context, JSONObject().put("action", "upcoming").put("horizon_ms", 60_000L)) as org.json.JSONArray)
                .objects().firstOrNull { it.getString("id") == id }
        }.getOrNull()
        val title = stillDue?.getString("title") ?: fallbackTitle
        if (stillDue == null && fallbackTitle.isEmpty()) return
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(
            context, id.hashCode(),
            Intent(context, MainActivity::class.java).setData(Uri.parse("nerva://open/focus")),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title).setContentText("Reminder from Nerva").setAutoCancel(true).setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        try { NotificationManagerCompat.from(context).notify("reminder-$id", 2, notification) } catch (_: SecurityException) { }
    }
}

class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.host ?: return
        val title = intent.getStringExtra("title") ?: ""
        val pending = goAsync()
        WidgetWorker.run(context, { pending.finish() }) { ReminderAlarms.fire(context, id, title) }
    }
}
