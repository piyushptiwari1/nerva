package ai.bytical.nerva.widgetsmoke

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ReleaseWidgetTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val appId = "ai.bytical.nerva.mobile"

    @Test
    fun releaseAppAndLauncherConfiguration() {
        val launch = context.packageManager.getLaunchIntentForPackage(appId) ?: error("Release APK missing")
        context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        assertTrue("Release app must open", device.wait(Until.hasObject(By.pkg(appId)), 30000))
        assertTrue("Mobile shell must load", device.wait(Until.hasObject(By.textContains("Workspace")), 45000))
        device.waitForIdle()
        assertFalse("Native refresh failed in the release app", device.hasObject(By.textContains("Widget refresh failed")))
        assertFalse("Structured errors must not reach users", device.hasObject(By.textContains("[object Object]")))

        val manager = AppWidgetManager.getInstance(context)
        val providers = manager.installedProviders.filter { it.provider.packageName == appId }
        assertEquals("All four release providers must be registered", 4, providers.size)
        val host = AppWidgetHost(context, HostActivity.HOST_ID)
        val output = File(context.getExternalFilesDir(null), "release-widget-screenshots").apply { mkdirs() }
        for (provider in providers) {
            val name = provider.provider.shortClassName.substringAfterLast('.')
            val widgetId = host.allocateAppWidgetId()
            instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
            try {
                assertTrue("Bind $name", manager.bindAppWidgetIdIfAllowed(widgetId, provider.provider, Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 300)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 340)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 340)
                }))
            } finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }
            try {
                assertNotNull("$name must declare configuration", provider.configure)
                context.startActivity(Intent(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
                    .setComponent(provider.configure).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                val save = device.wait(Until.findObject(By.text("Save widget")), 20000)
                assertNotNull("$name must stay open and show its configuration", save)
                device.takeScreenshot(File(output, "$name-configure.png"))
                save.click()
                assertTrue("$name must finish configuration", device.wait(Until.gone(By.text("Save widget")), 20000))
                context.startActivity(Intent(context, HostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                assertTrue("$name must render in an external host", device.wait(Until.hasObject(By.desc("Configure widget")), 20000))
                assertFalse("$name failed to inflate", device.hasObject(By.textContains("Problem loading widget")))
                device.takeScreenshot(File(output, "$name-host.png"))
            } finally { host.deleteAppWidgetId(widgetId) }
        }
    }
}