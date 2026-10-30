package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale

abstract class NervaWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        WidgetWorker.run(context, { pending.finish() }) { NervaWidgets.refreshAll(context) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        onUpdate(context, manager, intArrayOf(id))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val editor = WidgetConfig.prefs(context).edit()
        ids.forEach { editor.remove("config.$it").remove("undo.$it") }
        editor.apply()
    }

    override fun onRestored(context: Context, oldIds: IntArray, newIds: IntArray) {
        val prefs = WidgetConfig.prefs(context)
        val editor = prefs.edit()
        oldIds.zip(newIds).forEach { (oldId, newId) ->
            prefs.getString("config.$oldId", null)?.let { editor.putString("config.$newId", it) }
            editor.remove("config.$oldId").remove("undo.$oldId")
        }
        editor.apply()
    }
}

class FocusWidgetProvider : NervaWidgetProvider()
class TasksWidgetProvider : NervaWidgetProvider()
class HabitsWidgetProvider : NervaWidgetProvider()
class NotesWidgetProvider : NervaWidgetProvider()

object NervaWidgets {
    fun refreshAll(context: Context) {
        WidgetPreviews.publish(context)
        val snapshot = WidgetBridge.snapshot(context)
        WidgetAlarms.sync(context, snapshot)
        val manager = AppWidgetManager.getInstance(context)
        WidgetKind.entries.forEach { kind ->
            manager.getAppWidgetIds(kind.component(context)).forEach { widgetId ->
                manager.updateAppWidget(widgetId, views(context, widgetId, kind, snapshot))
                manager.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
            }
        }
    }

    fun views(context: Context, widgetId: Int, kind: WidgetKind, snapshot: JSONObject, preview: WidgetConfig? = null): RemoteViews {
        val config = preview ?: WidgetConfig.load(context, widgetId)
        val palette = config.palette(context)
        val views = RemoteViews(context.packageName, R.layout.nerva_widget)
        listOf(R.id.widget_timer, R.id.widget_list, R.id.widget_note, R.id.widget_empty, R.id.widget_undo, R.id.widget_action).forEach {
            views.setViewVisibility(it, View.GONE)
        }
        views.setInt(android.R.id.background, "setBackgroundResource", if (palette.dark) R.drawable.widget_surface_dark else R.drawable.widget_surface_light)
        listOf(R.id.widget_title, R.id.widget_countdown, R.id.widget_remaining, R.id.widget_note).forEach { views.setTextColor(it, palette.text) }
        listOf(R.id.widget_subtitle, R.id.widget_phase, R.id.widget_empty).forEach { views.setTextColor(it, palette.secondary) }
        views.setImageViewResource(R.id.widget_kind_icon, kind.icon)
        views.setTextViewText(R.id.widget_title, kind.label)
        val workspace = snapshot.getJSONArray("workspaces").objects().firstOrNull { it.getString("id") == config.workspace }
        views.setTextViewText(R.id.widget_subtitle, workspace?.getString("name") ?: "All workspaces")

        // Size tiers from the host's cell geometry (dp). Previews render the default tier.
        val options = if (preview != null) null else AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
        val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)?.takeIf { it > 0 } ?: kind.defaultWidthDp
        val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)?.takeIf { it > 0 } ?: kind.defaultHeightDp
        val largeText = context.resources.configuration.fontScale > 1.3f
        val tier = when {
            height < 150 || width < 200 -> Tier.SMALL
            height < 260 -> Tier.MEDIUM
            else -> Tier.LARGE
        }
        views.setViewVisibility(R.id.widget_subtitle, if (tier == Tier.SMALL || largeText) View.GONE else View.VISIBLE)
        views.setOnClickPendingIntent(R.id.widget_configure, WidgetUi.activity(context, widgetId, "WidgetConfigureActivity"))
        views.setOnClickPendingIntent(R.id.widget_open, WidgetUi.open(context, widgetId, kind))
        if (!config.workspaceExists(snapshot)) {
            empty(views, "Workspace no longer available")
            return views
        }
        when (kind) {
            WidgetKind.FOCUS -> {
                val timer = snapshot.getJSONArray("timers").objects().firstOrNull { it.getString("id") == config.source && config.includes(it) }
                if (timer == null) { empty(views, "Tap ⚙ to choose a session"); return views }
                views.setTextViewText(R.id.widget_title, timer.getString("name"))
                views.setViewVisibility(R.id.widget_timer, View.VISIBLE)
                val running = timer.getString("status") == "running"
                val remaining = timer.getLong("phase_remaining_ms").coerceAtLeast(0)
                views.setViewVisibility(R.id.widget_countdown, if (running) View.VISIBLE else View.GONE)
                views.setViewVisibility(R.id.widget_remaining, if (running) View.GONE else View.VISIBLE)
                views.setChronometer(R.id.widget_countdown, SystemClock.elapsedRealtime() + remaining, null, running)
                views.setChronometerCountDown(R.id.widget_countdown, true)
                views.setTextViewText(R.id.widget_remaining, duration(remaining))
                val digits = if (tier == Tier.SMALL) 34f else if (tier == Tier.MEDIUM) 40f else 48f
                views.setTextViewTextSize(R.id.widget_countdown, TypedValue.COMPLEX_UNIT_SP, digits)
                views.setTextViewTextSize(R.id.widget_remaining, TypedValue.COMPLEX_UNIT_SP, digits)
                val status = timer.getString("status")
                val phase = if (timer.getString("phase_kind") == "break") "Break" else "Focus"
                val finish = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(snapshot.getLong("generated_ms") + remaining))
                val description = when (status) {
                    "completed" -> "Done"
                    "paused" -> "$phase · paused"
                    "idle" -> "$phase · ready"
                    else -> "$phase · until $finish"
                }
                val alertState = when {
                    !WidgetAlarms.notificationsAllowed(context) -> " · alerts off"
                    !WidgetAlarms.exactAllowed(context) -> " · approx. alerts"
                    else -> ""
                }
                views.setTextViewText(R.id.widget_phase, description + alertState)
                views.setViewVisibility(R.id.widget_phase, if (tier == Tier.SMALL && largeText) View.GONE else View.VISIBLE)
                views.setProgressBar(R.id.widget_progress, 100, (100 * (1.0 - remaining.toDouble() / timer.optLong("phase_duration_ms", 1).coerceAtLeast(1))).toInt().coerceIn(0, 100), false)
                views.setViewVisibility(R.id.widget_progress, if (tier == Tier.SMALL) View.GONE else View.VISIBLE)
                val operation = when (status) { "running" -> "pause"; "paused" -> "resume"; "completed", "cancelled" -> "restart"; else -> "start" }
                views.setImageViewResource(R.id.widget_primary, if (running) R.drawable.widget_ic_pause else R.drawable.widget_ic_play)
                views.setContentDescription(R.id.widget_primary, "$operation ${timer.getString("name")}")
                views.setOnClickPendingIntent(R.id.widget_primary, WidgetUi.action(context, widgetId, JSONObject().put("action", "timer").put("id", config.source).put("operation", operation), "timer-$operation"))
            }
            WidgetKind.TASKS, WidgetKind.HABITS -> {
                val rows = WidgetCollections.rows(kind, config, snapshot)
                if (rows.isEmpty()) empty(views, if (kind == WidgetKind.TASKS) "All clear — nothing to do" else "No habits here yet")
                else if (preview != null) {
                    views.setViewVisibility(R.id.widget_note, View.VISIBLE)
                    views.setTextViewText(R.id.widget_note, rows.take(3).joinToString("\n\n") { "${it.title}\n${it.detail}" })
                } else {
                    views.setViewVisibility(R.id.widget_list, View.VISIBLE)
                    val adapter = Intent(context, WidgetCollectionService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                        .setData(Uri.parse("nerva-widget://$widgetId/list"))
                    views.setRemoteAdapter(R.id.widget_list, adapter)
                    val template = Intent(context, WidgetActionReceiver::class.java).setAction("ai.bytical.nerva.WIDGET_ACTION")
                        .setData(Uri.parse("nerva-widget://$widgetId/row")).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getBroadcast(context, widgetId, template, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
                }
                if (kind == WidgetKind.TASKS) {
                    views.setImageViewResource(R.id.widget_action, R.drawable.widget_ic_add)
                    views.setContentDescription(R.id.widget_action, "Add task")
                    views.setOnClickPendingIntent(R.id.widget_action, WidgetUi.activity(context, widgetId, "WidgetCaptureActivity", "task"))
                    views.setViewVisibility(R.id.widget_action, View.VISIBLE)
                }
                val undo = WidgetUi.undo(context, widgetId)
                if (undo != null) {
                    views.setTextViewText(R.id.widget_undo, "Undo")
                    views.setContentDescription(R.id.widget_undo, "Undo ${undo.optString("label", "last change")}")
                    views.setOnClickPendingIntent(R.id.widget_undo, WidgetUi.action(context, widgetId, JSONObject().put("action", "undo"), "undo"))
                    views.setViewVisibility(R.id.widget_undo, View.VISIBLE)
                }
            }
            WidgetKind.NOTES -> {
                val note = if (config.source.isNotEmpty()) runCatching { WidgetBridge.note(context, config.source) }.getOrNull() else null
                views.setImageViewResource(R.id.widget_action, if (note == null) R.drawable.widget_ic_add else R.drawable.widget_ic_edit)
                views.setContentDescription(R.id.widget_action, if (note == null) "New note" else "Edit note")
                views.setOnClickPendingIntent(R.id.widget_action, WidgetUi.activity(context, widgetId, "WidgetCaptureActivity", if (note == null) "note" else "edit"))
                views.setViewVisibility(R.id.widget_action, View.VISIBLE)
                if (note == null) empty(views, "Tap ⚙ to pick a note, or + to write one")
                else {
                    views.setTextViewText(R.id.widget_title, note.getString("title"))
                    views.setViewVisibility(R.id.widget_note, View.VISIBLE)
                    views.setInt(R.id.widget_note, "setMaxLines", ((height - 70) / 22).coerceIn(2, 40))
                    views.setTextViewText(R.id.widget_note, note.getString("body").take(6000).ifEmpty { "Empty note" })
                    // Tapping the body edits it — the natural gesture for a note.
                    views.setOnClickPendingIntent(R.id.widget_note, WidgetUi.activity(context, widgetId, "WidgetCaptureActivity", "edit"))
                }
            }
        }
        return views
    }

    private enum class Tier { SMALL, MEDIUM, LARGE }

    private fun empty(views: RemoteViews, message: String) {
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.widget_empty, message)
    }

    private fun duration(milliseconds: Long): String {
        val seconds = (milliseconds + 999) / 1000
        return String.format(Locale.getDefault(), "%d:%02d", seconds / 60, seconds % 60)
    }
}