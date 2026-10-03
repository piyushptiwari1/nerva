package ai.bytical.nerva.widgetsmoke

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.os.Bundle
import android.widget.FrameLayout

class HostActivity : Activity() {
    private lateinit var host: AppWidgetHost

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        host = AppWidgetHost(this, HOST_ID)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        val provider = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)
        val container = FrameLayout(this)
        setContentView(container)
        if (provider != null) {
            val view = host.createView(this, widgetId, provider)
            container.addView(view, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (340 * resources.displayMetrics.density).toInt(),
            ))
        }
    }

    override fun onResume() { super.onResume(); host.startListening() }
    override fun onPause() { host.stopListening(); super.onPause() }

    companion object { const val HOST_ID = 42003 }
}