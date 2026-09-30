package ai.bytical.nerva.widgets

import android.appwidget.AppWidgetManager
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.widget.CheckBox
import android.widget.EditText
import android.widget.Spinner
import androidx.activity.OnBackPressedCallback
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONObject

class WidgetCaptureActivity : WidgetScreenActivity() {
    override val compact = true
    private var widgetId = -1
    private var mode = "note"
    private lateinit var config: WidgetConfig
    private lateinit var titleInput: EditText
    private lateinit var bodyInput: EditText
    private lateinit var saveButton: MaterialButton
    private lateinit var workspace: Spinner
    private lateinit var pin: CheckBox
    private var workspaceIds = emptyList<String>()
    private var original: JSONObject? = null
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
        if (WidgetKind.forId(this, widgetId) == null) { finish(); return }
        config = WidgetConfig.load(this, widgetId)
        mode = intent.getStringExtra("mode") ?: "note"
        if (mode !in listOf("task", "note", "edit")) { finish(); return }
        screen(if (mode == "task") "Add task" else if (mode == "edit") "Edit note" else "New note")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (busy) return
                val dirty = ::titleInput.isInitialized && (titleInput.text.toString() != (original?.optString("title") ?: "") || (::bodyInput.isInitialized && bodyInput.text.toString() != (original?.optString("body") ?: "")))
                if (!dirty) finish()
                else MaterialAlertDialogBuilder(this@WidgetCaptureActivity).setTitle("Discard unsaved changes?")
                    .setNegativeButton("Keep editing", null).setPositiveButton("Discard") { _, _ -> finish() }.show()
            }
        })
        WidgetWorker.run(this) {
            try {
                val snapshot = WidgetBridge.snapshot(this)
                val savedOriginal = savedInstanceState?.getString("original")
                val note = if (savedOriginal != null) JSONObject(savedOriginal) else if (mode == "edit") WidgetBridge.note(this, config.source) else null
                runOnUiThread { if (!isFinishing && !isDestroyed) { original = note; form(snapshot, savedInstanceState) } }
            } catch (error: Exception) { runOnUiThread { showError(error.message ?: "Could not open editor") } }
        }
    }

    private fun form(snapshot: JSONObject, saved: Bundle?) {
        val tooLarge = original?.optString("body").orEmpty().length > 64_000
        if (tooLarge) { showError("This note is too large for quick edit. Your saved note has not been changed."); return }
        val workspaces = snapshot.getJSONArray("workspaces").objects()
        workspaceIds = workspaces.map { it.getString("id") }
        label("Workspace")
        workspace = spinner(workspaces.map { it.getString("name") }).apply {
            contentDescription = "Capture workspace"
            setSelection(workspaceIds.indexOf(saved?.getString("workspace") ?: original?.optString("workspace_id") ?: config.workspace).coerceAtLeast(0))
        }
        label(if (mode == "task") "Task" else "Title")
        titleInput = EditText(this).apply {
            hint = if (mode == "task") "Task title" else "Note title"
            contentDescription = hint
            textSize = 16f
            minHeight = dp(48)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            filters = arrayOf(InputFilter.LengthFilter(512))
            setText(saved?.getString("title") ?: original?.optString("title") ?: "")
            content.addView(this)
        }
        if (mode != "task") {
            label("Note")
            bodyInput = EditText(this).apply {
                contentDescription = "Note body"
                hint = "Write a note..."
                textSize = 16f
                gravity = Gravity.TOP
                minLines = 5
                maxLines = 10
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                filters = arrayOf(InputFilter.LengthFilter(64_000))
                setText(saved?.getString("body") ?: original?.optString("body") ?: "")
                content.addView(this)
            }
            pin = CheckBox(this).apply {
                text = "Show this note in the widget"
                minHeight = dp(48)
                isChecked = saved?.getBoolean("pin") ?: (mode == "edit" || config.source.isEmpty())
                content.addView(this)
            }
        }
        saveButton = button("Save") { save() }
        titleInput.requestFocus()
    }

    private fun save() {
        if (busy) return
        if (titleInput.text.isBlank() && mode == "task") { showError("Enter a task title"); return }
        val request = JSONObject().put("action", if (mode == "task") "task_create" else "note_save")
            .put("title", titleInput.text.toString()).put("workspace_id", workspaceIds.getOrNull(workspace.selectedItemPosition))
        if (mode != "task") request.put("body", bodyInput.text.toString())
        original?.let { request.put("id", it.getString("id")).put("expected_body", it.getString("body")).put("expected_updated_ms", it.getLong("updated_ms")) }
        val shouldPin = mode != "task" && pin.isChecked
        busy = true
        saveButton.isEnabled = false
        WidgetWorker.run(this) {
            try {
                val result = WidgetBridge.execute(this, request) as JSONObject
                if (shouldPin) config.copy(source = result.getString("id"), workspace = request.optString("workspace_id")).save(this, widgetId)
                NervaWidgets.refreshAll(this)
                runOnUiThread { busy = false; finish() }
            } catch (error: Exception) { runOnUiThread { busy = false; saveButton.isEnabled = true; showError(error.message ?: "Could not save") } }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::titleInput.isInitialized) {
            outState.putString("title", titleInput.text.toString())
            outState.putString("workspace", workspaceIds.getOrNull(workspace.selectedItemPosition))
            if (::bodyInput.isInitialized) { outState.putString("body", bodyInput.text.toString()); outState.putBoolean("pin", pin.isChecked) }
            original?.let { outState.putString("original", it.toString()) }
        }
        super.onSaveInstanceState(outState)
    }
}