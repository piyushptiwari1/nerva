package ai.bytical.nerva.widgets

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class WidgetIsolationTest {
    @Test
    fun newInstallIsIsolatedFromLegacyData() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val legacy = context.packageManager.getPackageInfo("ai.bytical.nerva", 0)
        val legacyInfo = context.packageManager.getApplicationInfo("ai.bytical.nerva", 0)
        assertEquals("ai.bytical.nerva.mobile", context.packageName)
        assertEquals("0.1.14", legacy.versionName)
        assertNotEquals(legacyInfo.uid, context.applicationInfo.uid)
        assertNotEquals(File(legacyInfo.dataDir).canonicalPath, File(context.applicationInfo.dataDir).canonicalPath)
        assertTrue(File(context.applicationInfo.dataDir, "nerva.db").exists())
        assertFalse("The new app must not read legacy private data", File(legacyInfo.dataDir, "nerva.db").canRead())
    }
}