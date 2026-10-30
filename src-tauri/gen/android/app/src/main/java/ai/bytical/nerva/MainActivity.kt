package ai.bytical.nerva

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    remember(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    remember(intent)
  }

  // nerva://open/<tab> from a home-screen widget; consumed by WidgetsPlugin.pendingTab.
  private fun remember(intent: Intent?) {
    val data = intent?.data ?: return
    if (data.scheme == "nerva" && data.host == "open") {
      pendingTab = data.pathSegments.firstOrNull()
    }
  }

  companion object {
    @Volatile var pendingTab: String? = null
  }
}
