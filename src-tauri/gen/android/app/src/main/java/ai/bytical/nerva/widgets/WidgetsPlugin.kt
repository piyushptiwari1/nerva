package ai.bytical.nerva.widgets

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.annotation.Keep
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale

@Keep
@InvokeArg
class WidgetPluginArgs { var kind: String = "focus" }

@Keep
@TauriPlugin
class WidgetsPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun refresh(invoke: Invoke) {
        WidgetWorker.run(activity) {
            try { NervaWidgets.refreshAll(activity); invoke.resolve() }
            catch (error: Exception) { invoke.reject(error.message ?: "Could not refresh widgets") }
        }
    }

    @Command
    fun status(invoke: Invoke) {
        val manager = AppWidgetManager.getInstance(activity)
        val counts = JSObject()
        WidgetKind.entries.forEach { counts.put(it.name.lowercase(Locale.US), manager.getAppWidgetIds(it.component(activity)).size) }
        val result = JSObject()
        result.put("exactAlarms", WidgetAlarms.exactAllowed(activity))
        result.put("notifications", WidgetAlarms.notificationsAllowed(activity))
        result.put("canPin", Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported)
        result.put("counts", counts)
        invoke.resolve(result)
    }

    @Command
    fun pin(invoke: Invoke) {
        val args = invoke.parseArgs(WidgetPluginArgs::class.java)
        val kind = WidgetKind.entries.firstOrNull { it.name.equals(args.kind, ignoreCase = true) }
            ?: run { invoke.reject("Unknown widget type"); return }
        activity.runOnUiThread {
            val manager = AppWidgetManager.getInstance(activity)
            if (Build.VERSION.SDK_INT < 26 || !manager.isRequestPinAppWidgetSupported) {
                invoke.reject("Add Nerva from your launcher's widget picker on this device")
                return@runOnUiThread
            }
            val configure = PendingIntent.getActivity(activity, 700 + kind.ordinal,
                Intent(activity, WidgetConfigureActivity::class.java).setAction("configure-${kind.name}"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            val requested = manager.requestPinAppWidget(kind.component(activity), null, configure)
            invoke.resolve(JSObject().put("requested", requested) as JSObject)
        }
    }

    @Command
    fun alarmSettings(invoke: Invoke) {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 31) activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}")))
            invoke.resolve()
        }
    }
}