package studio.ccez.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Voice bridge: the Rust side calls Tts without passing contexts.
    Tts.init(this)
  }
}
