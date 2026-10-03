package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WidgetBehaviorTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val preferences = context.getSharedPreferences("nerva.widget.tests", Context.MODE_PRIVATE)

    private fun execute(request: String): JSONObject = WidgetBridge.execute(context, JSONObject(request)) as JSONObject

    @Test
    fun providersActionsPersistenceAndLayouts() {
        val snapshot = WidgetBridge.snapshot(context)
        val workspace = preferences.getString("fixtureWorkspace", null) ?: error("Seed the habit through the app first")
        val habitSource = preferences.getString("fixtureHabit", null)!!
        assertTrue(snapshot.getJSONArray("habits").objects().any { it.getJSONObject("habit").getString("id") == habitSource })
        val task = execute("""{"action":"task_create","title":"Review Android widget release","workspace_id":"$workspace"}""")
        val timer = execute("""{"action":"timer_create","minutes":1,"workspace_id":"$workspace"}""")
        val note = execute("""{"action":"note_save","title":"Launch checklist","body":"Check widgets\nVerify alerts\nReview layout","workspace_id":"$workspace"}""")
        val manager = AppWidgetManager.getInstance(context)
        val host = AppWidgetHost(context, 42001)
        val ids = mutableMapOf<WidgetKind, Int>()
        instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
        try {
            for (kind in WidgetKind.entries) {
                val id = host.allocateAppWidgetId()
                assertTrue("Bind ${kind.label}", manager.bindAppWidgetIdIfAllowed(id, kind.component(context)))
                assertEquals(kind, WidgetKind.forId(context, id))
                ids[kind] = id
                val source = when (kind) {
                    WidgetKind.FOCUS -> timer.getString("id")
                    WidgetKind.HABITS -> habitSource
                    WidgetKind.NOTES -> note.getString("id")
                    WidgetKind.TASKS -> ""
                }
                WidgetConfig(workspace, source, "light").save(context, id)
                manager.updateAppWidgetOptions(id, Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 260)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 260)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 250)
                })
            }
        } finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }

        val taskId = ids.getValue(WidgetKind.TASKS)
        val completed = JSONObject().put("action", "task_set").put("id", task.getString("id")).put("done", true)
        WidgetActionReceiver.perform(context, taskId, completed)
        WidgetActionReceiver.perform(context, taskId, completed)
        assertEquals("done", findTask(task.getString("id")).getString("status"))
        assertNotNull(WidgetUi.undo(context, taskId))
        WidgetActionReceiver.perform(context, taskId, JSONObject().put("action", "undo"))
        assertEquals("todo", findTask(task.getString("id")).getString("status"))

        val habitId = ids.getValue(WidgetKind.HABITS)
        val habit = WidgetCollections.rows(WidgetKind.HABITS, WidgetConfig.load(context, habitId), WidgetBridge.snapshot(context)).single()
        WidgetActionReceiver.perform(context, habitId, habit.request)
        WidgetActionReceiver.perform(context, habitId, habit.request)
        var recorded = WidgetBridge.snapshot(context).getJSONArray("habits").objects().first { it.getJSONObject("habit").getString("id") == habitSource }.getJSONObject("entry")
        assertEquals(1.0, recorded.getDouble("value"), 0.001)
        WidgetActionReceiver.perform(context, habitId, JSONObject().put("action", "undo"))
        assertTrue(WidgetBridge.snapshot(context).getJSONArray("habits").objects().first { it.getJSONObject("habit").getString("id") == habitSource }.isNull("entry"))

        val timerId = timer.getString("id")
        val started = execute("""{"action":"timer","id":"$timerId","operation":"start"}""")
        val repeated = execute("""{"action":"timer","id":"$timerId","operation":"start"}""")
        assertEquals(started.getLong("started_at_ms"), repeated.getLong("started_at_ms"))
        WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
        assertTrue(context.getSharedPreferences("nerva.widget.alarms", Context.MODE_PRIVATE).getString("scheduled", "")!!.contains(timerId))
        execute("""{"action":"timer","id":"$timerId","operation":"pause"}""")
        WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
        assertFalse(context.getSharedPreferences("nerva.widget.alarms", Context.MODE_PRIVATE).getString("scheduled", "")!!.contains(timerId))

        val original = WidgetBridge.note(context, note.getString("id"))
        val save = JSONObject().put("action", "note_save").put("id", note.getString("id")).put("title", "Launch checklist")
            .put("body", "Verified native capture").put("expected_body", original.getString("body")).put("expected_updated_ms", original.getLong("updated_ms"))
        WidgetBridge.execute(context, save)
        try { WidgetBridge.execute(context, save.put("body", "Stale overwrite")); fail("Stale edit must fail") }
        catch (expected: IllegalStateException) { assertTrue(expected.message!!.contains("changed")) }

        NervaWidgets.refreshAll(context)
        val renderedSnapshot = WidgetBridge.snapshot(context)
        for ((kind, id) in ids) {
            assertEquals(WidgetConfig.load(context, id).workspace, workspace)
            for (theme in listOf("light", "dark")) {
                val config = WidgetConfig.load(context, id).copy(theme = theme)
                val minimumHeight = if (kind == WidgetKind.FOCUS) 260 else 180
                for ((width, height) in listOf(172 to minimumHeight, 300 to maxOf(250, minimumHeight))) {
                    for (fontScale in listOf(1f, 1.5f, 2f)) {
                        render(kind, id, config, renderedSnapshot, width, height, fontScale)
                    }
                }
            }
        }
        val other = ids.getValue(WidgetKind.NOTES)
        WidgetConfig("missing-workspace", "", "dark").save(context, other)
        assertEquals(workspace, WidgetConfig.load(context, taskId).workspace)
        assertTrue(WidgetCollections.rows(WidgetKind.TASKS, WidgetConfig("deleted"), renderedSnapshot).isEmpty())
        WidgetConfig(workspace, note.getString("id"), "light").save(context, other)

        instrumentation.runOnMainSync {
            assertTrue("No full app Activity should be running", ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).isEmpty())
        }
        preferences.edit().putString("task", task.getString("id")).putString("timer", timerId).putString("note", note.getString("id"))
            .putInt("taskWidget", taskId).putString("workspace", workspace).commit()
    }

    @Test
    fun coldProcessRecoversAndActsWithoutMainActivity() {
        val taskId = preferences.getString("task", null) ?: error("Run providersActionsPersistenceAndLayouts first")
        val timerId = preferences.getString("timer", null)!!
        val noteId = preferences.getString("note", null)!!
        assertEquals("todo", findTask(taskId).getString("status"))
        assertEquals("Verified native capture", WidgetBridge.note(context, noteId).getString("body"))
        val timer = WidgetBridge.snapshot(context).getJSONArray("timers").objects().first { it.getString("id") == timerId }
        assertEquals("paused", timer.getString("status"))
        WidgetActionReceiver.perform(context, preferences.getInt("taskWidget", -1), JSONObject().put("action", "task_set").put("id", taskId).put("done", true))
        assertEquals("done", findTask(taskId).getString("status"))
        assertEquals("running", execute("""{"action":"timer","id":"$timerId","operation":"resume"}""").getString("status"))
        WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
        instrumentation.runOnMainSync {
            assertTrue(ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).isEmpty())
        }
    }

    private fun findTask(id: String) = WidgetBridge.snapshot(context).getJSONArray("tasks").objects().first { it.getString("id") == id }

    @Test
    fun liveCollectionsRenderAndAcceptTap() {
        val workspace = preferences.getString("workspace", null) ?: error("Run providersActionsPersistenceAndLayouts first")
        val task = execute("""{"action":"task_create","title":"Complete from home screen","workspace_id":"$workspace"}""")
        val widgetId = preferences.getInt("taskWidget", -1)
        WidgetConfig(workspace, "", "light").save(context, widgetId)
        NervaWidgets.refreshAll(context)
        val taskActivity = launchHost(widgetId)
        try {
            awaitText(taskActivity, task.getString("title"), true)
            instrumentation.runOnMainSync {
                assertNull("Widget IDs are isolated from the Activity namespace", taskActivity.findViewById<View>(R.id.widget_secondary))
                assertNotNull("Widget controls resolve inside the host", taskActivity.widgetView.findViewById<View>(R.id.widget_secondary))
            }
            instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
                val file = File(context.getExternalFilesDir(null), "widget-test-screenshots/tasks-live.png")
                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
            clickWhenReady(taskActivity, "Complete task") {
                val title = findText(taskActivity.container, task.getString("title"))
                (title?.parent?.parent as? View)?.findViewById(R.id.widget_row_action)
            }
            awaitControl(taskActivity, R.id.widget_secondary, "Undo ${task.getString("title")}")
            awaitText(taskActivity, task.getString("title"), false)
            assertEquals("done", findTask(task.getString("id")).getString("status"))
            instrumentation.runOnMainSync {
                assertEquals(View.GONE, taskActivity.widgetView.findViewById<View>(R.id.widget_list).visibility)
                assertEquals(View.VISIBLE, taskActivity.widgetView.findViewById<View>(R.id.widget_empty).visibility)
            }
            clickWhenReady(taskActivity, "Undo task completion") {
                taskActivity.widgetView.findViewById<View>(R.id.widget_secondary)?.takeIf {
                    it.contentDescription?.toString() == "Undo ${task.getString("title")}"
                }
            }
            awaitText(taskActivity, task.getString("title"), true)
            assertEquals("todo", findTask(task.getString("id")).getString("status"))
        } finally { instrumentation.runOnMainSync { taskActivity.finish() } }

        val habitId = AppWidgetManager.getInstance(context).getAppWidgetIds(WidgetKind.HABITS.component(context)).last()
        WidgetConfig(workspace, preferences.getString("fixtureHabit", null)!!, "dark").save(context, habitId)
        NervaWidgets.refreshAll(context)
        val habitActivity = launchHost(habitId)
        try {
            awaitText(habitActivity, "Reading pages", true)
            instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
                val file = File(context.getExternalFilesDir(null), "widget-test-screenshots/habits-live.png")
                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
            clickWhenReady(habitActivity, "Log habit") {
                val title = findText(habitActivity.container, "Reading pages")
                (title?.parent?.parent as? View)?.findViewById(R.id.widget_row_action)
            }
            awaitText(habitActivity, "1 / 4", true)
        } finally { instrumentation.runOnMainSync { habitActivity.finish() } }
    }

    private fun launchHost(widgetId: Int): WidgetTestHostActivity = instrumentation.startActivitySync(
        Intent(context, WidgetTestHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
    ) as WidgetTestHostActivity

    private fun findText(root: View, text: String): TextView? {
        if (root.visibility != View.VISIBLE) return null
        if (root is TextView && root.text.toString() == text) return root
        if (root is ViewGroup) for (index in 0 until root.childCount) {
            findText(root.getChildAt(index), text)?.let { return it }
        }
        return null
    }

    private fun clickWhenReady(activity: WidgetTestHostActivity, description: String, locate: () -> View?) {
        val ready = CountDownLatch(1)
        var clicked = false
        lateinit var listener: ViewTreeObserver.OnPreDrawListener
        instrumentation.runOnMainSync {
            fun tryClick() {
                if (ready.count == 0L) return
                val control = locate() ?: return
                if (!control.isShown || !control.isEnabled || !control.isClickable) return
                clicked = control.performClick()
                ready.countDown()
            }
            listener = ViewTreeObserver.OnPreDrawListener {
                tryClick()
                if (ready.count > 0L) activity.container.postInvalidateOnAnimation()
                true
            }
            activity.container.viewTreeObserver.addOnPreDrawListener(listener)
            tryClick()
            activity.container.postInvalidateOnAnimation()
        }
        try {
            assertTrue("$description control should become ready", ready.await(30, TimeUnit.SECONDS))
            assertTrue("$description click must be handled", clicked)
        } finally {
            instrumentation.runOnMainSync { activity.container.viewTreeObserver.removeOnPreDrawListener(listener) }
        }
    }

    private fun awaitText(activity: WidgetTestHostActivity, text: String, present: Boolean) {
        val ready = CountDownLatch(1)
        lateinit var listener: ViewTreeObserver.OnGlobalLayoutListener
        instrumentation.runOnMainSync {
            listener = ViewTreeObserver.OnGlobalLayoutListener {
                if ((findText(activity.container, text) != null) == present) ready.countDown()
            }
            activity.container.viewTreeObserver.addOnGlobalLayoutListener(listener)
            if ((findText(activity.container, text) != null) == present) ready.countDown()
        }
        try { assertTrue("Widget text '$text' presence should be $present", ready.await(30, TimeUnit.SECONDS)) }
        finally { instrumentation.runOnMainSync { activity.container.viewTreeObserver.removeOnGlobalLayoutListener(listener) } }
    }

    private fun awaitControl(activity: WidgetTestHostActivity, id: Int, description: String) {
        val ready = CountDownLatch(1)
        lateinit var listener: ViewTreeObserver.OnPreDrawListener
        instrumentation.runOnMainSync {
            fun checkControl() {
                val control = activity.widgetView.findViewById<View>(id)
                if (control?.visibility == View.VISIBLE && control.contentDescription?.toString() == description) ready.countDown()
            }
            listener = ViewTreeObserver.OnPreDrawListener {
                checkControl()
                if (ready.count > 0) activity.container.postInvalidateOnAnimation()
                true
            }
            activity.container.viewTreeObserver.addOnPreDrawListener(listener)
            checkControl()
            activity.container.postInvalidateOnAnimation()
        }
        try {
            val found = ready.await(30, TimeUnit.SECONDS)
            var actual = ""
            instrumentation.runOnMainSync { actual = "destroyed=${activity.isDestroyed}, control=${activity.widgetView.findViewById<View>(id)}, label=${activity.widgetView.findViewById<View>(id)?.contentDescription}" }
            assertTrue("Widget control '$description' should be ready: $actual", found)
        }
        finally { instrumentation.runOnMainSync { activity.container.viewTreeObserver.removeOnPreDrawListener(listener) } }
    }

    private fun render(kind: WidgetKind, id: Int, config: WidgetConfig, snapshot: JSONObject, widthDp: Int, heightDp: Int, fontScale: Float) {
        val sizedContext = context.createConfigurationContext(Configuration(context.resources.configuration).apply { this.fontScale = fontScale })
        val manager = AppWidgetManager.getInstance(context)
        manager.updateAppWidgetOptions(id, Bundle().apply {
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, widthDp)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, widthDp)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, heightDp)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, heightDp)
        })
        config.save(sizedContext, id)
        val remote = NervaWidgets.views(sizedContext, id, kind, snapshot)
        instrumentation.runOnMainSync {
            val container = FrameLayout(sizedContext)
            val view = remote.apply(sizedContext, container)
            container.addView(view)
            val density = sizedContext.resources.displayMetrics.density
            val width = (widthDp * density).toInt()
            val height = (heightDp * density).toInt()
            container.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            container.layout(0, 0, width, height)
            val bounds = mutableListOf<Rect>()
            for (control in listOf(R.id.widget_primary, R.id.widget_secondary, R.id.widget_configure)) {
                val button = view.findViewById<View>(control)
                if (button.visibility == View.VISIBLE) {
                    assertTrue("48dp target", button.width >= 47 * density && button.height >= 47 * density)
                    assertTrue(button.contentDescription.isNotBlank())
                    val rectangle = Rect()
                    button.getDrawingRect(rectangle)
                    container.offsetDescendantRectToMyCoords(button, rectangle)
                    assertTrue("${kind.label} control clipped at ${widthDp}x${heightDp}, font $fontScale: $rectangle", Rect(0, 0, width, height).contains(rectangle))
                    assertTrue("Widget controls overlap", bounds.none { Rect.intersects(it, rectangle) })
                    bounds.add(rectangle)
                }
            }
            if (kind == WidgetKind.FOCUS) {
                val digits = view.findViewById<TextView>(R.id.widget_remaining)
                if (digits.visibility == View.VISIBLE) {
                    val rectangle = Rect()
                    digits.getDrawingRect(rectangle)
                    container.offsetDescendantRectToMyCoords(digits, rectangle)
                    assertTrue("Countdown overlaps controls at font $fontScale", bounds.none { Rect.intersects(it, rectangle) })
                    assertTrue("Countdown text clipped at font $fontScale", digits.layout.getLineBottom(0) <= digits.height - digits.compoundPaddingTop - digits.compoundPaddingBottom)
                }
                val phase = view.findViewById<TextView>(R.id.widget_phase)
                val rectangle = Rect()
                phase.getDrawingRect(rectangle)
                container.offsetDescendantRectToMyCoords(phase, rectangle)
                assertTrue("Phase overlaps controls at font $fontScale", bounds.none { Rect.intersects(it, rectangle) })
                assertTrue("Phase text clipped at font $fontScale", phase.layout.getLineBottom(phase.lineCount - 1) <= phase.height - phase.compoundPaddingTop - phase.compoundPaddingBottom)
            }
            assertTrue(view.findViewById<TextView>(R.id.widget_title).text.isNotBlank())
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            container.draw(Canvas(bitmap))
            val directory = File(context.getExternalFilesDir(null), "widget-test-screenshots").apply { mkdirs() }
            File(directory, "${kind.name.lowercase()}-${config.theme}-${widthDp}x${heightDp}-$fontScale.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }

}