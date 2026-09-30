package ai.bytical.nerva.widgets

import ai.bytical.nerva.R
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.color.MaterialColors

abstract class WidgetScreenActivity : AppCompatActivity() {
    protected lateinit var content: LinearLayout
    protected lateinit var errorText: TextView
    protected open val compact = false

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(if (compact) R.style.Theme_Nerva_QuickCapture else R.style.Theme_Nerva_WidgetEditor)
        super.onCreate(savedInstanceState)
        if (!compact) enableEdgeToEdge()
    }

    protected fun screen(title: String) {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val close = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            contentDescription = "Close"
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            imageTintList = android.content.res.ColorStateList.valueOf(MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSurface))
            setOnClickListener { onBackPressedDispatcher.onBackPressed() }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(TextView(this).apply { text = title; textSize = 20f; setTypeface(typeface, Typeface.BOLD) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(header)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(20)) }
        content.addView(TextView(this).apply { text = "Nerva by Bytical"; textSize = 12f; setPadding(0, 0, 0, dp(16)) })
        errorText = TextView(this).apply {
            textSize = 14f
            visibility = View.GONE
            setTextColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorError))
        }
        content.addView(errorText)
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(content) }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (compact) {
            window.setLayout(resources.displayMetrics.widthPixels - dp(24), (resources.displayMetrics.heightPixels * 0.78).toInt())
            window.setGravity(Gravity.BOTTOM)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    protected fun label(value: String) {
        content.addView(TextView(this).apply { text = value; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(16), 0, dp(4)) })
    }

    protected fun spinner(values: List<String>): Spinner = Spinner(this).apply {
        adapter = ArrayAdapter(this@WidgetScreenActivity, android.R.layout.simple_spinner_item, values).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        minimumHeight = dp(48)
        content.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))
    }

    protected fun button(value: String, action: () -> Unit): MaterialButton = MaterialButton(this).apply {
        text = value
        isAllCaps = false
        minHeight = dp(48)
        cornerRadius = dp(8)
        setOnClickListener { action() }
        content.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
    }

    protected fun showError(message: String) { errorText.text = message; errorText.visibility = View.VISIBLE }
    protected fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}