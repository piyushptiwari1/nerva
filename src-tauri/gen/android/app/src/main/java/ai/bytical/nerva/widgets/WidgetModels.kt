package ai.bytical.nerva.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

enum class WidgetKind(val label: String, val providerName: String) {
    FOCUS("Focus", "FocusWidgetProvider"), TASKS("Tasks", "TasksWidgetProvider"),
    HABITS("Habits", "HabitsWidgetProvider"), NOTES("Note", "NotesWidgetProvider");

    fun component(context: Context) = ComponentName(context.packageName, "${context.packageName}.widgets.$providerName")

    companion object {
        fun forId(context: Context, widgetId: Int): WidgetKind? {
            val component = AppWidgetManager.getInstance(context).getAppWidgetInfo(widgetId)?.provider ?: return null
            return entries.firstOrNull { component == it.component(context) }
        }
    }
}

data class WidgetConfig(val workspace: String = "", val source: String = "", val theme: String = "system") {
    fun save(context: Context, widgetId: Int) {
        prefs(context).edit().putString("config.$widgetId", JSONObject()
            .put("workspace", workspace).put("source", source).put("theme", theme).toString()).apply()
    }

    fun includes(item: JSONObject): Boolean = workspace.isEmpty() || item.isNull("workspace_id") || item.optString("workspace_id") == workspace
    fun workspaceExists(snapshot: JSONObject): Boolean = workspace.isEmpty() || snapshot.getJSONArray("workspaces").objects().any { it.getString("id") == workspace }

    fun palette(context: Context): WidgetPalette {
        val dark = theme == "dark" || (theme == "system" && context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)
        return if (dark) WidgetPalette(true, Color.rgb(236, 240, 246), Color.rgb(178, 191, 207))
        else WidgetPalette(false, Color.rgb(25, 35, 48), Color.rgb(89, 101, 117))
    }

    companion object {
        fun prefs(context: Context) = context.getSharedPreferences("nerva.widgets", Context.MODE_PRIVATE)
        fun load(context: Context, widgetId: Int): WidgetConfig {
            val value = runCatching { JSONObject(prefs(context).getString("config.$widgetId", "{}")!!) }.getOrDefault(JSONObject())
            return WidgetConfig(value.optString("workspace"), value.optString("source"), value.optString("theme", "system"))
        }
    }
}

data class WidgetPalette(val dark: Boolean, val text: Int, val secondary: Int)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
data class WidgetRow(val title: String, val detail: String, val request: JSONObject, val icon: Int, val actionLabel: String)

object WidgetWorker {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    fun run(context: Context, finished: () -> Unit = {}, block: () -> Unit) {
        executor.execute {
            try { block() }
            catch (error: Exception) { main.post { Toast.makeText(context, error.message ?: "Widget could not update", Toast.LENGTH_LONG).show() } }
            finally { finished() }
        }
    }
}

object WidgetUi {
    fun changed(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        WidgetKind.entries.forEach { kind ->
            val ids = manager.getAppWidgetIds(kind.component(context))
            if (ids.isNotEmpty()) context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .setComponent(kind.component(context)).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
        }
    }

    fun activity(context: Context, widgetId: Int, target: String, mode: String = ""): PendingIntent {
        val intent = Intent().setClassName(context, "${context.packageName}.widgets.$target")
            .setData(Uri.parse("nerva-widget://$widgetId/$target/$mode"))
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("mode", mode)
        return PendingIntent.getActivity(context, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun action(context: Context, widgetId: Int, request: JSONObject, suffix: String): PendingIntent {
        val intent = Intent("ai.bytical.nerva.WIDGET_ACTION").setClassName(context, "${context.packageName}.widgets.WidgetActionReceiver")
            .setData(Uri.parse("nerva-widget://$widgetId/$suffix"))
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("request", request.toString())
        return PendingIntent.getBroadcast(context, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun undo(context: Context, widgetId: Int): JSONObject? {
        val undo = runCatching { JSONObject(WidgetConfig.prefs(context).getString("undo.$widgetId", "")!!) }.getOrNull() ?: return null
        val day = undo.optJSONObject("request")?.optString("day").orEmpty()
        return undo.takeIf { day.isEmpty() || day == WidgetBridge.today() }
    }
}