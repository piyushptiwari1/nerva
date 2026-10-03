package ai.bytical.nerva.widgets

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.UserManager
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class WidgetAlarmTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val alarms by lazy { context.getSharedPreferences("nerva.widget.alarms", Context.MODE_PRIVATE) }
    private val tests by lazy { context.getSharedPreferences("nerva.widget.tests", Context.MODE_PRIVATE) }

    private fun execute(request: JSONObject) = WidgetBridge.execute(context, request) as JSONObject

    private fun startTimer(): String {
        val timer = execute(JSONObject().put("action", "timer_create").put("minutes", 1))
        val id = timer.getString("id")
        execute(JSONObject().put("action", "timer").put("id", id).put("operation", "start"))
        WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
        return id
    }

    @Test
    fun deniedPermissionsFallBackAndPauseCancels() {
        assertFalse(WidgetAlarms.exactAllowed(context))
        assertFalse(WidgetAlarms.notificationsAllowed(context))
        val id = startTimer()
        val scheduled = JSONObject(alarms.getString("scheduled", "{}")!!)
        assertFalse(scheduled.getJSONObject(id).getBoolean("exact"))
        execute(JSONObject().put("action", "timer").put("id", id).put("operation", "pause"))
        WidgetAlarms.sync(context, WidgetBridge.snapshot(context))
        assertFalse(JSONObject(alarms.getString("scheduled", "{}")!!).has(id))
    }

    @Test
    fun screenOffAlarmDeliversWithoutMainActivity() {
        assertTrue(WidgetAlarms.exactAllowed(context))
        assertTrue(WidgetAlarms.notificationsAllowed(context))
        val id = startTimer()
        awaitDelivery(id)
        assertCompletedNotification(id)
        assertNoActivity()
    }

    @Test
    fun prepareRebootRecovery() {
        assertTrue(WidgetAlarms.exactAllowed(context))
        val id = startTimer()
        assertTrue(tests.edit().putString("rebootTimer", id).commit())
        assertTrue(JSONObject(alarms.getString("scheduled", "{}")!!).has(id))
        assertNoActivity()
    }

    @Test
    fun rebootRecoversAndDeliversWithoutMainActivity() {
        awaitUserUnlocked()
        val id = tests.getString("rebootTimer", null) ?: error("Run prepareRebootRecovery before reboot")
        awaitDelivery(id)
        assertCompletedNotification(id)
        assertNoActivity()
    }

    private fun awaitUserUnlocked() {
        val manager = context.getSystemService(UserManager::class.java)
        if (manager.isUserUnlocked) return
        val unlocked = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) { if (manager.isUserUnlocked) unlocked.countDown() }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(Intent.ACTION_USER_UNLOCKED), ContextCompat.RECEIVER_NOT_EXPORTED)
        try {
            if (manager.isUserUnlocked) unlocked.countDown()
            assertTrue("Credential-encrypted data requires first device unlock", unlocked.await(60, TimeUnit.SECONDS))
        } finally { context.unregisterReceiver(receiver) }
    }

    private fun awaitDelivery(id: String) {
        val delivered = CountDownLatch(1)
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { preferences, key ->
            if (key == "delivered.$id" && preferences.contains(key)) delivered.countDown()
        }
        alarms.registerOnSharedPreferenceChangeListener(listener)
        try {
            if (alarms.contains("delivered.$id")) delivered.countDown()
            assertTrue("The scheduled alarm must be delivered", delivered.await(100, TimeUnit.SECONDS))
        } finally { alarms.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    private fun assertCompletedNotification(id: String) {
        val timer = WidgetBridge.snapshot(context).getJSONArray("timers").objects().first { it.getString("id") == id }
        assertEquals("completed", timer.getString("status"))
        val notifications = context.getSystemService(NotificationManager::class.java).activeNotifications
        val notification = notifications.firstOrNull { it.tag == id }
        assertNotNull("Android must receive the completion notification", notification)
        assertEquals("Session complete", notification!!.notification.extras.getString("android.title"))
    }

    private fun assertNoActivity() {
        instrumentation.runOnMainSync {
            assertTrue(ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).isEmpty())
        }
    }
}