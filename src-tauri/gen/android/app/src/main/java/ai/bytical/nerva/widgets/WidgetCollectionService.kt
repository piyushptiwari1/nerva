package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale

object WidgetCollections {
    fun rows(kind: WidgetKind, config: WidgetConfig, snapshot: JSONObject): List<WidgetRow> {
        if (!config.workspaceExists(snapshot)) return emptyList()
        if (kind == WidgetKind.TASKS) {
            return snapshot.getJSONArray("tasks").objects().filter { config.includes(it) && it.getString("status") == "todo" }
                .map { task ->
                    val priority = task.optString("priority", "med").replaceFirstChar { it.uppercase() }
                    val due = if (task.isNull("due_ms")) "" else " · ${DateFormat.getDateInstance(DateFormat.SHORT).format(Date(task.getLong("due_ms")))}"
                    WidgetRow(task.getString("title"), "$priority priority$due", JSONObject().put("action", "task_set").put("id", task.getString("id")).put("done", true), android.R.drawable.checkbox_off_background, "Complete ${task.getString("title")}")
                }
        }
        return snapshot.getJSONArray("habits").objects().filter { row ->
            val habit = row.getJSONObject("habit")
            config.includes(habit) && (config.source.isEmpty() || habit.getString("id") == config.source)
        }.map { row ->
            val habit = row.getJSONObject("habit")
            val entry = row.optJSONObject("entry")
            val value = entry?.optDouble("value", 0.0) ?: 0.0
            val target = if (habit.isNull("target")) 1.0 else habit.getDouble("target").coerceAtLeast(1.0)
            val boolean = habit.getString("kind") == "bool"
            val skipped = entry?.optBoolean("skipped") == true
            val done = !skipped && value >= target
            val unit = if (habit.isNull("unit")) "" else " ${habit.getString("unit")}"
            val detail = when {
                skipped -> "Skipped today"
                boolean && done -> "Done today"
                boolean -> "Not recorded today"
                else -> "${number(value)} / ${number(target)}$unit"
            }
            val next: Any = if (boolean && done) JSONObject.NULL else if (boolean) 1 else value + if (habit.getString("kind") == "amount") (target / 4).coerceAtLeast(1.0) else 1.0
            val request = JSONObject().put("action", "habit_set").put("id", habit.getString("id")).put("day", snapshot.getString("day"))
                .put("value", next).put("skipped", false).put("expected_updated_ms", entry?.opt("updated_ms") ?: JSONObject.NULL)
            WidgetRow(habit.getString("name"), detail, request,
                if (boolean) if (done) android.R.drawable.checkbox_on_background else android.R.drawable.checkbox_off_background else android.R.drawable.ic_menu_add,
                if (boolean && done) "Undo ${habit.getString("name")}" else "Log ${habit.getString("name")}")
        }
    }

    private fun number(value: Double): String = if (value == value.toLong().toDouble()) value.toLong().toString() else String.format(Locale.getDefault(), "%.1f", value)
}

class WidgetCollectionService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1))
    private class Factory(val context: Context, val widgetId: Int) : RemoteViewsFactory {
        private var rows = emptyList<WidgetRow>()
        override fun onCreate() {}
        override fun onDestroy() { rows = emptyList() }
        override fun onDataSetChanged() {
            val kind = WidgetKind.forId(context, widgetId) ?: return
            rows = runCatching { WidgetCollections.rows(kind, WidgetConfig.load(context, widgetId), WidgetBridge.snapshot(context)) }.getOrDefault(emptyList())
        }
        override fun getCount() = rows.size
        override fun getViewAt(position: Int): RemoteViews? {
            val row = rows.getOrNull(position) ?: return null
            val palette = WidgetConfig.load(context, widgetId).palette(context)
            return RemoteViews(context.packageName, R.layout.nerva_widget_row).apply {
                setTextViewText(R.id.widget_row_title, row.title)
                setTextViewText(R.id.widget_row_detail, row.detail)
                setTextColor(R.id.widget_row_title, palette.text)
                setTextColor(R.id.widget_row_detail, palette.secondary)
                setImageViewResource(R.id.widget_row_action, row.icon)
                setContentDescription(R.id.widget_row_action, row.actionLabel)
                setOnClickFillInIntent(R.id.widget_row_action, Intent().putExtra("request", row.request.toString()))
            }
        }
        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 1
        override fun getItemId(position: Int) = position.toLong()
        override fun hasStableIds() = false
    }
}