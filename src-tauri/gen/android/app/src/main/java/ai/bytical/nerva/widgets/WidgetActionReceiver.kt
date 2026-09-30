package ai.bytical.nerva.widgets

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        val request = runCatching { JSONObject(intent.getStringExtra("request") ?: return) }.getOrNull() ?: return
        if (WidgetKind.forId(context, widgetId) == null && !(widgetId == -1 && request.optString("action") == "timer")) return
        val pending = goAsync()
        WidgetWorker.run(context, { pending.finish() }) {
            try { perform(context, widgetId, request) }
            finally {
                WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
                WidgetUi.changed(context)
            }
        }
    }

    companion object {
        fun perform(context: Context, widgetId: Int, request: JSONObject) {
            val prefs = WidgetConfig.prefs(context)
            when (request.getString("action")) {
                "refresh" -> return
                "undo" -> {
                    val undo = WidgetUi.undo(context, widgetId) ?: return
                    WidgetBridge.execute(context, undo.getJSONObject("request"))
                    prefs.edit().remove("undo.$widgetId").commit()
                }
                "task_set", "habit_set", "timer" -> {
                    val before = WidgetBridge.snapshot(context)
                    if (request.getString("action") == "habit_set") {
                        check(request.getString("day") == WidgetBridge.today()) { "The day changed. Refresh and try again." }
                    }
                    val result = WidgetBridge.execute(context, request)
                    val undo = when (request.getString("action")) {
                        "task_set" -> {
                            val task = before.getJSONArray("tasks").objects().firstOrNull { it.getString("id") == request.getString("id") }
                            if (task != null && (task.getString("status") == "done") != request.getBoolean("done")) {
                                JSONObject().put("label", task.getString("title")).put("request", JSONObject()
                                    .put("action", "task_set").put("id", task.getString("id")).put("done", task.getString("status") == "done"))
                            } else null
                        }
                        "habit_set" -> {
                            val row = before.getJSONArray("habits").objects().firstOrNull { it.getJSONObject("habit").getString("id") == request.getString("id") }
                            val previous = row?.optJSONObject("entry")
                            val current = result as? JSONObject
                            if (previous?.toString() == current?.toString()) null
                            else JSONObject().put("label", row?.getJSONObject("habit")?.getString("name") ?: "habit log")
                                .put("request", JSONObject().put("action", "habit_set").put("id", request.getString("id"))
                                    .put("day", request.getString("day")).put("value", previous?.opt("value") ?: JSONObject.NULL)
                                    .put("skipped", previous?.optBoolean("skipped") ?: false)
                                    .put("expected_updated_ms", current?.opt("updated_ms") ?: JSONObject.NULL))
                        }
                        else -> null
                    }
                    if (undo != null) prefs.edit().putString("undo.$widgetId", undo.toString()).commit()
                }
                else -> error("Unsupported widget action")
            }
        }
    }
}