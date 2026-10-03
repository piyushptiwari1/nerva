package ai.bytical.nerva.widgetsmoke

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
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
        assertEquals("Each provider must have a distinct preview", 4, providers.map { it.previewLayout }.toSet().size)
        for (provider in providers) {
            val name = provider.provider.shortClassName.substringAfterLast('.')
            assertTrue("$name needs a preview layout", provider.previewLayout != 0)
            assertTrue("$name needs a fallback image", provider.previewImage != 0)
            assertNotNull("$name fallback must load", provider.loadPreviewImage(context, context.resources.displayMetrics.densityDpi))
            instrumentation.runOnMainSync {
                val preview = RemoteViews(appId, provider.previewLayout).apply(context, FrameLayout(context))
                val density = context.resources.displayMetrics.density
                val width = (300 * density).toInt()
                val height = (320 * density).toInt()
                preview.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                preview.layout(0, 0, width, height)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                preview.draw(Canvas(bitmap))
                File(output, "$name-preview.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
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
                assertTrue("$name must stay open and show its configuration", device.wait(Until.hasObject(By.desc("Widget workspace")), 20000))
                device.takeScreenshot(File(output, "$name-configure.png"))
                if (!device.hasObject(By.text("Save widget"))) UiScrollable(UiSelector().scrollable(true)).scrollTextIntoView("Save widget")
                val save = device.wait(Until.findObject(By.text("Save widget")), 10000)
                assertNotNull("$name must have a reachable save control", save)
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