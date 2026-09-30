package ai.bytical.nerva.widgets

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.graphics.Color
import android.os.Bundle
import android.widget.FrameLayout

class WidgetTestHostActivity : Activity() {
    lateinit var container: FrameLayout
    private lateinit var host: AppWidgetHost

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        val manager = AppWidgetManager.getInstance(this)
        val info = manager.getAppWidgetInfo(widgetId) ?: run { finish(); return }
        host = AppWidgetHost(this, 42001)
        host.startListening()
        container = FrameLayout(this).apply { setBackgroundColor(Color.rgb(221, 230, 228)) }
        val padding = (12 * resources.displayMetrics.density).toInt()
        container.setPadding(padding, padding, padding, padding)
        container.addView(host.createView(this, widgetId, info), FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, (340 * resources.displayMetrics.density).toInt()))
        setContentView(container)
    }

    override fun onDestroy() {
        if (::host.isInitialized) host.stopListening()
        super.onDestroy()
    }
}