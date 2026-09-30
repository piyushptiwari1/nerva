package ai.bytical.nerva.widgets

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.Spinner
import org.json.JSONObject

class WidgetConfigureActivity : WidgetScreenActivity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private lateinit var kind: WidgetKind
    private lateinit var snapshot: JSONObject
    private lateinit var workspace: Spinner
    private lateinit var source: Spinner
    private lateinit var theme: Spinner
    private lateinit var preview: FrameLayout
    private var workspaces = emptyList<Pair<String, String>>()
    private var sources = emptyList<Pair<String, String>>()
    private var previewRevision = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        kind = WidgetKind.forId(this, widgetId) ?: run { finish(); return }
        screen("${kind.label} widget")
        WidgetWorker.run(this) {
            try {
                val loaded = WidgetBridge.snapshot(this)
                runOnUiThread { if (!isFinishing && !isDestroyed) { snapshot = loaded; form() } }
            } catch (error: Exception) { runOnUiThread { showError(error.message ?: "Could not load widget data") } }
        }
    }

    private fun form() {
        val config = WidgetConfig.load(this, widgetId)
        workspaces = listOf("" to "All workspaces") + snapshot.getJSONArray("workspaces").objects().map { it.getString("id") to it.getString("name") }
        label("Workspace")
        workspace = spinner(workspaces.map { it.second }).apply { contentDescription = "Widget workspace"; setSelection(workspaces.indexOfFirst { it.first == config.workspace }.coerceAtLeast(0)) }
        label(when (kind) { WidgetKind.FOCUS -> "Session"; WidgetKind.HABITS -> "Habits"; WidgetKind.NOTES -> "Pinned note"; else -> "Tasks" })
        source = spinner(emptyList()).apply { contentDescription = "Widget content" }
        label("Appearance")
        theme = spinner(listOf("System", "Light", "Dark")).apply { contentDescription = "Widget appearance"; setSelection(listOf("system", "light", "dark").indexOf(config.theme).coerceAtLeast(0)) }
        preview = FrameLayout(this)
        label("Preview")
        content.addView(preview, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(250)))
        populateSources(config.source)
        val changed = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { updatePreview() }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        source.onItemSelectedListener = changed
        theme.onItemSelectedListener = changed
        workspace.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                populateSources(sources.getOrNull(source.selectedItemPosition)?.first ?: config.source)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        if (kind == WidgetKind.FOCUS) {
            if (Build.VERSION.SDK_INT >= 33 && !WidgetAlarms.notificationsAllowed(this)) {
                button("Enable notifications") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 901) }
            }
            if (Build.VERSION.SDK_INT >= 31 && !WidgetAlarms.exactAllowed(this)) {
                button("Exact timer alerts") { startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))) }
            }
        }
        val save = button("Save widget") { }
        save.setOnClickListener {
            save.isEnabled = false
            val selected = selection()
            WidgetWorker.run(this) {
                try {
                    val sourceId = if (kind == WidgetKind.FOCUS && selected.source.startsWith("new:")) {
                        val timer = WidgetBridge.execute(this, JSONObject().put("action", "timer_create")
                            .put("minutes", selected.source.substringAfter(":").toInt())
                            .put("workspace_id", selected.workspace.ifEmpty { null })) as JSONObject
                        timer.getString("id")
                    } else selected.source
                    selected.copy(source = sourceId).save(this, widgetId)
                    NervaWidgets.refreshAll(this)
                    runOnUiThread {
                        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                        finish()
                    }
                } catch (error: Exception) { runOnUiThread { showError(error.message ?: "Could not save widget"); save.isEnabled = true } }
            }
        }
        updatePreview()
    }

    private fun populateSources(selected: String) {
        val config = WidgetConfig(workspace = workspaces[workspace.selectedItemPosition].first)
        sources = when (kind) {
            WidgetKind.FOCUS -> snapshot.getJSONArray("timers").objects().filter { config.includes(it) }.map { it.getString("id") to it.getString("name") } + listOf("new:25" to "New 25 minute session", "new:50" to "New 50 minute session", "new:90" to "New 90 minute session")
            WidgetKind.HABITS -> listOf("" to "All habits") + snapshot.getJSONArray("habits").objects().map { it.getJSONObject("habit") }.filter { config.includes(it) }.map { it.getString("id") to it.getString("name") }
            WidgetKind.NOTES -> listOf("" to "No note selected") + snapshot.getJSONArray("notes").objects().filter { config.includes(it) }.map { it.getString("id") to it.getString("title") }
            WidgetKind.TASKS -> listOf("" to "Open tasks")
        }
        source.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, sources.map { it.second }).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        source.setSelection(sources.indexOfFirst { it.first == selected }.coerceAtLeast(0))
        updatePreview()
    }

    private fun selection() = WidgetConfig(workspaces[workspace.selectedItemPosition].first, sources.getOrNull(source.selectedItemPosition)?.first.orEmpty(), listOf("system", "light", "dark")[theme.selectedItemPosition.coerceAtLeast(0)])

    private fun updatePreview() {
        if (!::preview.isInitialized || sources.isEmpty()) return
        val revision = ++previewRevision
        val config = selection()
        WidgetWorker.run(this) {
            val views = NervaWidgets.views(this, widgetId, kind, snapshot, config)
            runOnUiThread {
                if (revision != previewRevision || isFinishing || isDestroyed) return@runOnUiThread
                preview.removeAllViews()
                val view = views.apply(this, preview)
                disable(view)
                preview.addView(view)
            }
        }
    }

    private fun disable(view: View) {
        view.isEnabled = false
        view.isClickable = false
        if (view is ViewGroup) for (index in 0 until view.childCount) disable(view.getChildAt(index))
    }
}