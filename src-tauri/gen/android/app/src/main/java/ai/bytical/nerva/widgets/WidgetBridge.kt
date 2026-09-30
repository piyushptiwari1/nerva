package ai.bytical.nerva.widgets

import android.content.Context
import androidx.annotation.Keep
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Keep
object WidgetBridge {
    init { System.loadLibrary("nerva_lib") }

    @JvmStatic
    private external fun nativeExecute(directory: String, request: String): String

    fun execute(context: Context, request: JSONObject): Any {
        val response = JSONObject(nativeExecute(context.applicationInfo.dataDir, request.toString()))
        check(response.getBoolean("ok")) { response.optString("error", "Widget operation failed") }
        return response.opt("data") ?: JSONObject.NULL
    }

    fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    fun snapshot(context: Context): JSONObject = execute(context,
        JSONObject().put("action", "snapshot").put("day", today())) as JSONObject

    fun note(context: Context, id: String): JSONObject = execute(context,
        JSONObject().put("action", "note_read").put("id", id)) as JSONObject
}