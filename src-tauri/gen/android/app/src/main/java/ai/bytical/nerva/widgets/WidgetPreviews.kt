package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.os.Build
import android.util.Log
import android.widget.RemoteViews

object WidgetPreviews {
    private fun layout(kind: WidgetKind): Int = when (kind) {
        WidgetKind.FOCUS -> R.layout.widget_preview_focus
        WidgetKind.TASKS -> R.layout.widget_preview_tasks
        WidgetKind.HABITS -> R.layout.widget_preview_habits
        WidgetKind.NOTES -> R.layout.widget_preview_notes
    }

    fun publish(context: Context) {
        if (Build.VERSION.SDK_INT < 35) return
        val manager = AppWidgetManager.getInstance(context)
        val preferences = context.getSharedPreferences("nerva.widget.previews", Context.MODE_PRIVATE)
        val version = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        val now = System.currentTimeMillis()
        WidgetKind.entries.forEach { kind ->
            val key = kind.name
            if (preferences.getLong("version.$key", 0) == version || preferences.getLong("retry.$key", 0) > now) return@forEach
            try {
                if (manager.setWidgetPreview(kind.component(context), AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, RemoteViews(context.packageName, layout(kind)))) {
                    preferences.edit().putLong("version.$key", version).apply()
                } else {
                    preferences.edit().putLong("retry.$key", now + 3_600_000).apply()
                }
            } catch (error: RuntimeException) {
                preferences.edit().putLong("retry.$key", now + 3_600_000).apply()
                Log.w("NervaWidgets", "Generated preview unavailable; using resource preview", error)
            }
        }
    }
}