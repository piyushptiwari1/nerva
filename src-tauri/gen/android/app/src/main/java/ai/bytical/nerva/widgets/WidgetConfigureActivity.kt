package ai.bytical.nerva.widgets

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
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
        preview = FrameLayout(this).apply { contentDescription = "Widget preview" }
        // Preview at the widget's default tier so what you see is what lands on the home screen.
        content.addView(preview, LinearLayout.LayoutParams(dp(kind.defaultWidthDp.coerceAtMost(340)), dp(kind.defaultHeightDp + 40)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(8) })
        workspaces = listOf("" to "All workspaces") + snapshot.getJSONArray("workspaces").objects().map { it.getString("id") to it.getString("name") }
        label(when (kind) { WidgetKind.FOCUS -> "Which session"; WidgetKind.HABITS -> "Which habits"; WidgetKind.NOTES -> "Which note"; else -> "Which tasks" })
        source = spinner(emptyList()).apply { contentDescription = "Widget content" }
        if (workspaces.size > 2) label("Workspace")
        workspace = spinner(workspaces.map { it.second }).apply {
            contentDescription = "Widget workspace"
            setSelection(workspaces.indexOfFirst { it.first == config.workspace }.coerceAtLeast(0))
            if (workspaces.size <= 2) visibility = View.GONE
        }
        label("Appearance")
        theme = spinner(listOf("System", "Light", "Dark")).apply { visibility = View.GONE }
        val themes = listOf("system" to "Match phone", "light" to "Light", "dark" to "Dark")
        val chips = com.google.android.material.chip.ChipGroup(this).apply { isSingleSelection = true; isSelectionRequired = true }
        themes.forEachIndexed { index, (id, name) ->
            chips.addView(com.google.android.material.chip.Chip(this).apply {
                text = name; isCheckable = true; this.id = View.generateViewId(); minHeight = dp(40)
                isChecked = id == config.theme
                setOnCheckedChangeListener { _, checked -> if (checked) { theme.setSelection(index); updatePreview() } }
            })
        }
        if (themes.none { it.first == config.theme }) (chips.getChildAt(0) as com.google.android.material.chip.Chip).isChecked = true
        content.addView(chips)
        theme.setSelection(themes.indexOfFirst { it.first == config.theme }.coerceAtLeast(0))
        populateSources(config.source)
        val changed = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { updatePreview() }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        source.onItemSelectedListener = changed
        workspace.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                populateSources(sources.getOrNull(source.selectedItemPosition)?.first ?: config.source)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        if (kind == WidgetKind.FOCUS) {
            val needsNotifications = Build.VERSION.SDK_INT >= 33 && !WidgetAlarms.notificationsAllowed(this)
            val needsExact = Build.VERSION.SDK_INT >= 31 && !WidgetAlarms.exactAllowed(this)
            if (needsNotifications || needsExact) {
                label("Alerts")
                content.addView(TextView(this).apply { text = "So the phone can tell you when a phase ends, even with the screen off."; textSize = 13f })
                if (needsNotifications) button("Allow notifications") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 901) }
                if (needsExact) button("Allow exact alarms") { startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))) }
            }
        }
        val save = footerButton("Add to home screen") { }
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
            WidgetKind.FOCUS -> snapshot.getJSONArray("timers").objects().filter { config.includes(it) }.map { it.getString("id") to it.getString("name") } + listOf("new:25" to "New 25-minute session", "new:50" to "New 50-minute session", "new:90" to "New 90-minute session")
            WidgetKind.HABITS -> listOf("" to "All habits") + snapshot.getJSONArray("habits").objects().map { it.getJSONObject("habit") }.filter { config.includes(it) }.map { it.getString("id") to it.getString("name") }
            WidgetKind.NOTES -> listOf("" to "Choose a note…") + snapshot.getJSONArray("notes").objects().filter { config.includes(it) }.map { it.getString("id") to it.getString("title") }
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
            val previewSnapshot = if (kind == WidgetKind.FOCUS && config.source.startsWith("new:")) {
                val minutes = config.source.substringAfter(":").toInt()
                JSONObject(snapshot.toString()).apply {
                    getJSONArray("timers").put(JSONObject().put("id", config.source).put("name", "$minutes minute focus")
                        .put("workspace_id", config.workspace.ifEmpty { null }).put("status", "idle")
                        .put("phase_kind", "focus").put("phase_remaining_ms", minutes * 60_000L).put("phase_duration_ms", minutes * 60_000L))
                }
            } else snapshot
            val views = NervaWidgets.views(this, widgetId, kind, previewSnapshot, config)
            if (kind == WidgetKind.FOCUS && config.source.startsWith("new:")) {
                views.setTextViewText(ai.bytical.nerva.R.id.widget_phase, "Session length")
            }
            runOnUiThread {
                if (revision != previewRevision || isFinishing || isDestroyed) return@runOnUiThread
                try {
                    val view = views.apply(applicationContext, preview)
                    disable(view)
                    preview.removeAllViews()
                    preview.addView(view)
                } catch (error: Exception) {
                    showError(error.message ?: "Could not display the widget preview")
                }
            }
        }
    }

    private fun disable(view: View) {
        view.isEnabled = false
        view.isClickable = false
        if (view is ViewGroup) for (index in 0 until view.childCount) disable(view.getChildAt(index))
    }
}