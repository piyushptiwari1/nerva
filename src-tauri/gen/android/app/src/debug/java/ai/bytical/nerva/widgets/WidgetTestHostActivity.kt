package ai.bytical.nerva.widgets

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.graphics.Color
import android.os.Bundle
import android.widget.FrameLayout

class WidgetTestHostActivity : Activity() {
    lateinit var container: FrameLayout
    lateinit var widgetView: AppWidgetHostView
        private set
    private lateinit var host: AppWidgetHost

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        val manager = AppWidgetManager.getInstance(this)
        val info = manager.getAppWidgetInfo(widgetId) ?: run { finish(); return }
        host = AppWidgetHost(this, 42001)
        container = FrameLayout(this).apply { setBackgroundColor(Color.rgb(221, 230, 228)) }
        val padding = (12 * resources.displayMetrics.density).toInt()
        container.setPadding(padding, padding, padding, padding)
        widgetView = host.createView(this, widgetId, info)
        container.addView(widgetView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, (340 * resources.displayMetrics.density).toInt()))
        setContentView(container)
    }

    override fun onResume() {
        super.onResume()
        if (::host.isInitialized) host.startListening()
    }

    override fun onPause() {
        if (::host.isInitialized) host.stopListening()
        super.onPause()
    }
}