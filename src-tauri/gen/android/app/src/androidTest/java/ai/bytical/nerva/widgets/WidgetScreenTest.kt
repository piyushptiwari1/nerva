package ai.bytical.nerva.widgets

import ai.bytical.nerva.MainActivity
import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WidgetScreenTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val preferences = context.getSharedPreferences("nerva.widget.tests", Context.MODE_PRIVATE)

    @Test
    fun launcherConfigurationSavesEveryWidgetKind() {
        val manager = AppWidgetManager.getInstance(context)
        val host = AppWidgetHost(context, 42002)
        for (kind in WidgetKind.entries) {
            val widgetId = host.allocateAppWidgetId()
            instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
            try { assertTrue(manager.bindAppWidgetIdIfAllowed(widgetId, kind.component(context))) }
            finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }
            val provider = manager.getAppWidgetInfo(widgetId)
            assertNotNull("${kind.label} configuration must be registered", provider.configure)
            val activity = instrumentation.startActivitySync(Intent(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
                .setComponent(provider.configure).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            try {
                interact(activity, "${kind.label} appearance") {
                    val theme = find(activity.window.decorView) { it is Spinner && it.contentDescription == "Widget appearance" } as? Spinner
                    theme?.setSelection(2)
                    theme != null
                }
                interact(activity, "${kind.label} save") {
                    find(activity.window.decorView) { it is TextView && it.text.toString() == "Save widget" && it.isEnabled }
                        ?.performClick() ?: false
                }
                val saved = CountDownLatch(1)
                WidgetWorker.run(context, { saved.countDown() }) { }
                assertTrue("Widget configuration should persist", saved.await(20, TimeUnit.SECONDS))
                assertEquals("dark", WidgetConfig.load(context, widgetId).theme)
                assertNotNull(manager.getAppWidgetInfo(widgetId))
            } finally {
                instrumentation.runOnMainSync { activity.finish() }
                host.deleteAppWidgetId(widgetId)
            }
        }
    }

    @Test
    fun quickCaptureSavesThroughNativeScreens() {
        val taskId = preferences.getInt("taskWidget", -1)
        val taskActivity = launchCapture(taskId, "task")
        try {
            interact(taskActivity, "Task title") {
                val input = find(taskActivity.window.decorView) { it is EditText && it.contentDescription == "Task title" } as? EditText
                input?.setText("Captured from native task sheet")
                input != null
            }
            save(taskActivity)
            assertTrue(WidgetBridge.snapshot(context).getJSONArray("tasks").objects().any { it.getString("title") == "Captured from native task sheet" })
        } finally { instrumentation.runOnMainSync { taskActivity.finish() } }

        val noteWidget = AppWidgetManager.getInstance(context).getAppWidgetIds(WidgetKind.NOTES.component(context)).last()
        val noteActivity = launchCapture(noteWidget, "note")
        try {
            interact(noteActivity, "Note body") {
                val title = find(noteActivity.window.decorView) { it is EditText && it.contentDescription == "Note title" } as? EditText
                val body = find(noteActivity.window.decorView) { it is EditText && it.contentDescription == "Note body" } as? EditText
                if (title == null || body == null) false
                else { title.setText("Native capture check"); body.setText("Saved without opening the full app."); true }
            }
            save(noteActivity)
            val note = WidgetBridge.snapshot(context).getJSONArray("notes").objects().first { it.getString("title") == "Native capture check" }
            assertEquals("Saved without opening the full app.", WidgetBridge.note(context, note.getString("id")).getString("body"))
        } finally { instrumentation.runOnMainSync { noteActivity.finish() } }
    }

    @Test
    fun seedHabitThroughAppCommand() {
        val report = appReport("""async () => {
            const invoke = window.__TAURI_INTERNALS__.invoke;
            const workspace = await invoke('workspace_active');
            const habit = await invoke('habit_create', { args: { name: 'Reading pages', kind: 'count', target: 4, color: '#388569', workspace_id: workspace.id } });
            return { workspace: workspace.id, habit: habit.id };
        }""")
        assertTrue(preferences.edit().putString("fixtureWorkspace", report.getJSONObject("value").getString("workspace"))
            .putString("fixtureHabit", report.getJSONObject("value").getString("habit")).commit())
    }

    @Test
    fun fullAppUsesMobileDatabaseAfterHeadlessWidgetUse() {
        WidgetBridge.snapshot(context)
        val report = appReport("""async () => {
            const invoke = window.__TAURI_INTERNALS__.invoke;
            const [runtime, , widgets] = await Promise.all([
                invoke('get_runtime_info'),
                invoke('android_widgets', { action: 'refresh' }),
                invoke('android_widgets', { action: 'status' })
            ]);
            return { runtime, widgets };
        }""")
        val value = report.getJSONObject("value")
        assertEquals(4, value.getJSONObject("widgets").getJSONObject("counts").length())
        assertFalse(report.toString(), report.getString("text").contains("Widget refresh failed"))
        assertEquals(File(context.applicationInfo.dataDir).canonicalPath, File(value.getJSONObject("runtime").getString("data_dir")).canonicalPath)
        assertTrue(report.getString("text").contains("Focus"))
        assertFalse("Desktop popup controls must not appear on phones", report.getString("text").contains("Pop up"))
    }

    private fun appReport(request: String): JSONObject {
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val ready = CountDownLatch(1)
        val handler = Handler(Looper.getMainLooper())
        var report = JSONObject()
        var closed = false
        val script = """(() => {
            if (window.__TAURI_INTERNALS__ && !window.__nervaTestRequested) {
                window.__nervaTestRequested = true;
                ($request)().then(value => window.__nervaTestValue = value)
                  .catch(error => window.__nervaTestError = JSON.stringify(error));
            }
            return JSON.stringify({ text: document.body.innerText, value: window.__nervaTestValue, error: window.__nervaTestError });
        })()"""
        val inspect = object : Runnable {
            override fun run() {
                if (closed) return
                val webview = find(activity.window.decorView) { it is WebView } as? WebView
                if (webview == null) { handler.postDelayed(this, 100); return }
                webview.evaluateJavascript(script) { response ->
                    val data = runCatching { JSONObject(JSONArray("[$response]").getString(0)) }.getOrDefault(JSONObject())
                    if (data.has("value") && data.optString("text").contains("Workspace")) { report = data; ready.countDown() }
                    else if (data.has("error")) { report = data; ready.countDown() }
                    else if (!closed) handler.postDelayed(this, 100)
                }
            }
        }
        handler.post(inspect)
        try {
            assertTrue("Full app and native IPC must become ready", ready.await(45, TimeUnit.SECONDS))
            assertFalse(report.toString(), report.has("error"))
            return report
        } finally {
            instrumentation.runOnMainSync { closed = true; handler.removeCallbacks(inspect); activity.finish() }
        }
    }

    private fun launchCapture(widgetId: Int, mode: String): WidgetCaptureActivity = instrumentation.startActivitySync(
        Intent(context, WidgetCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("mode", mode)
    ) as WidgetCaptureActivity

    private fun save(activity: Activity) {
        interact(activity, "Save") {
            val button = find(activity.window.decorView) { it is TextView && it.text.toString() == "Save" && it.isClickable && it.isEnabled }
            button?.performClick() ?: false
        }
        val drained = CountDownLatch(1)
        WidgetWorker.run(context, { drained.countDown() }) { }
        assertTrue("Native save should finish", drained.await(20, TimeUnit.SECONDS))
    }

    private fun find(root: View, predicate: (View) -> Boolean): View? {
        if (root.visibility != View.VISIBLE) return null
        if (predicate(root)) return root
        if (root is ViewGroup) for (index in 0 until root.childCount) find(root.getChildAt(index), predicate)?.let { return it }
        return null
    }

    private fun interact(activity: Activity, label: String, action: () -> Boolean) {
        val ready = CountDownLatch(1)
        lateinit var listener: ViewTreeObserver.OnPreDrawListener
        instrumentation.runOnMainSync {
            fun attempt() { if (ready.count > 0L && action()) ready.countDown() }
            listener = ViewTreeObserver.OnPreDrawListener { attempt(); if (ready.count > 0L) activity.window.decorView.postInvalidateOnAnimation(); true }
            activity.window.decorView.viewTreeObserver.addOnPreDrawListener(listener)
            attempt()
            activity.window.decorView.postInvalidateOnAnimation()
        }
        try { assertTrue("Native $label control must work", ready.await(20, TimeUnit.SECONDS)) }
        finally { instrumentation.runOnMainSync { activity.window.decorView.viewTreeObserver.removeOnPreDrawListener(listener) } }
    }
}