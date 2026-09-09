package studio.ccez.app

import android.content.Intent
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Voice bridge: the Rust side calls Tts without passing contexts.
    Tts.init(this)
    handleProcessText(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // singleTask: a PROCESS_TEXT share while running arrives here.
    setIntent(intent)
    handleProcessText(intent)
  }

  private external fun nativeOnExternalText(text: String?)
  private external fun nativeOnAnnotateTrigger()

  /**
   * Text shared from another app (OS selection menu → this app):
   * forward to Rust, which emits `annotate-external` for the
   * frontend's composer prefill. Never throws: a foreign intent
   * must not crash the app.
   */
  private fun handleProcessText(intent: Intent?) {
    try {
      if (intent?.action != Intent.ACTION_PROCESS_TEXT) return
      val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
      nativeOnExternalText(text)
    } catch (_: Exception) {
    }
  }

  /**
   * In-app text selection: add "Annotate" to the OS floating toolbar.
   * The frontend owns the live web selection, so the item is only a
   * trigger — no text crosses, same as the web row's button.
   */
  override fun onActionModeStarted(mode: ActionMode?) {
    super.onActionModeStarted(mode)
    try {
      if (mode?.type != ActionMode.TYPE_FLOATING) return
      mode.menu?.add(Menu.NONE, ANNOTATE_ITEM_ID, 100, "Annotate")
        ?.setOnMenuItemClickListener {
          nativeOnAnnotateTrigger()
          true
        }
    } catch (_: Exception) {
    }
  }

  companion object {
    private const val ANNOTATE_ITEM_ID = 0xC0E2A1
  }
}
