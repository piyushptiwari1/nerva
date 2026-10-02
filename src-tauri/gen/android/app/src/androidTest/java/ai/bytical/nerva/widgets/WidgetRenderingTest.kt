package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WidgetRenderingTest {
    @Test
    fun reapplyClearsStaleEmptyContentAndUndo() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val widgetId = 900001
        val config = WidgetConfig(theme = "light")
        val snapshot = JSONObject().put("workspaces", JSONArray()).put("tasks", JSONArray())
        val preferences = WidgetConfig.prefs(context)
        instrumentation.runOnMainSync {
            val view = NervaWidgets.views(context, widgetId, WidgetKind.TASKS, snapshot, config)
                .apply(context, FrameLayout(context))
            assertEquals(View.VISIBLE, view.findViewById<View>(R.id.widget_empty).visibility)
            snapshot.put("tasks", JSONArray().put(JSONObject().put("id", "task").put("title", "Review release")
                .put("status", "todo").put("workspace_id", JSONObject.NULL).put("due_ms", JSONObject.NULL)))
            preferences.edit().putString("undo.$widgetId", JSONObject().put("label", "Review release")
                .put("request", JSONObject().put("action", "task_set").put("id", "task").put("done", false)).toString()).commit()
            try {
                NervaWidgets.views(context, widgetId, WidgetKind.TASKS, snapshot, config).reapply(context, view)
                assertEquals(View.GONE, view.findViewById<View>(R.id.widget_empty).visibility)
                assertEquals(View.VISIBLE, view.findViewById<View>(R.id.widget_note).visibility)
                assertEquals("Undo Review release", view.findViewById<View>(R.id.widget_secondary).contentDescription)
                preferences.edit().remove("undo.$widgetId").commit()
                snapshot.put("tasks", JSONArray())
                NervaWidgets.views(context, widgetId, WidgetKind.TASKS, snapshot, config).reapply(context, view)
                assertEquals(View.VISIBLE, view.findViewById<View>(R.id.widget_empty).visibility)
                assertEquals(View.GONE, view.findViewById<View>(R.id.widget_note).visibility)
                assertEquals("No open tasks", view.findViewById<TextView>(R.id.widget_empty).text.toString())
                assertEquals("Refresh widget", view.findViewById<View>(R.id.widget_secondary).contentDescription)
            } finally {
                preferences.edit().remove("undo.$widgetId").commit()
            }
        }
    }
}