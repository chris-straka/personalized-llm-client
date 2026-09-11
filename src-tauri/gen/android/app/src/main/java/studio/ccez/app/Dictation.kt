package studio.ccez.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Android speech-to-text driver for the Rust bridge (`dictation.rs`).
 *
 * Inline [SpeechRecognizer] + [RecognitionListener] flow (NOT the
 * `ACTION_RECOGNIZE_SPEECH` activity intent): the contract needs partial
 * hypotheses streamed as `dictate-result final=false` while the user is
 * still speaking, plus a programmatic `dictate_stop` that ends the
 * utterance early. The intent flow launches a separate system activity —
 * no partials reach the caller, the result only arrives via
 * `onActivityResult`, and nothing maps to `dictate_stop` — so it cannot
 * implement the shared contract.
 *
 * One utterance per [start]: the recognizer is created fresh each time
 * and destroyed on final/error, so a stale listener can never emit into a
 * newer utterance. Everything engine-side runs on the main thread (the
 * recognizer needs a Looper), so [start] posts there and blocks the Rust
 * invoke thread briefly (same latch pattern as `Tts.voices`) to report
 * synchronous failures — permission, busy, unavailable — as `Err`
 * strings. Async failures after listening started (network lost,
 * silence) report through [nativeOnError], which Rust forwards as the
 * last-resort empty-transcript `final=true`.
 */
object Dictation {
    private lateinit var appContext: Context
    private var activity: Activity? = null
    private val main = Handler(Looper.getMainLooper())

    /** Main thread only. Non-null while one utterance is in flight. */
    private var recognizer: SpeechRecognizer? = null

    private const val REQUEST_RECORD_AUDIO = 4401

    private external fun nativeInit(activity: Activity)
    private external fun nativeOnPartial(transcript: String)
    private external fun nativeOnFinal(transcript: String)
    private external fun nativeOnError(error: String)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        this.activity = activity
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    private fun bestTranscript(results: Bundle?): String {
        return results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull { !it.isNullOrBlank() }
            ?: ""
    }

    private fun errorName(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "audio"
        SpeechRecognizer.ERROR_CLIENT -> "client"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
        SpeechRecognizer.ERROR_NETWORK -> "network"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network-timeout"
        SpeechRecognizer.ERROR_NO_MATCH -> "no-match"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_SERVER -> "server"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language-unavailable"
        else -> "error-$code"
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle) {}

        override fun onPartialResults(partialResults: Bundle) {
            val text = bestTranscript(partialResults)
            if (text.isNotEmpty()) nativeOnPartial(text)
        }

        override fun onResults(results: Bundle) {
            val text = bestTranscript(results)
            tearDown()
            nativeOnFinal(text)
        }

        override fun onError(code: Int) {
            val name = errorName(code)
            tearDown()
            nativeOnError(name)
        }
    }

    private fun tearDown() {
        try {
            recognizer?.cancel()
        } catch (_: Exception) {
        }
        try {
            recognizer?.destroy()
        } catch (_: Exception) {
        }
        recognizer = null
    }

    /**
     * Begin one utterance in [bcp47] ("" = device default). Null means the
     * recognizer is listening; a non-null string is the synchronous
     * failure reason Rust returns as `Err`. When mic permission is
     * missing, requests it from the system and returns "permission" — the
     * user retries after granting; no result plumbing needed since the
     * next start re-checks.
     */
    @JvmStatic
    fun start(bcp47: String): String? {
        if (!::appContext.isInitialized) return "bridge not initialized"
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            return "no recognizer on this device"
        }
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            try {
                val host = activity
                if (host != null) {
                    ActivityCompat.requestPermissions(
                        host,
                        arrayOf(Manifest.permission.RECORD_AUDIO),
                        REQUEST_RECORD_AUDIO
                    )
                }
            } catch (_: Exception) {
            }
            return "mic permission needed — allow the microphone and try again"
        }
        val outcome = AtomicReference<String?>(null)
        val latch = CountDownLatch(1)
        main.post {
            try {
                if (recognizer != null) {
                    outcome.set("already listening")
                    return@post
                }
                val locale = if (bcp47.isBlank()) {
                    Locale.getDefault()
                } else try {
                    Locale.forLanguageTag(bcp47)
                } catch (_: Exception) {
                    Locale.getDefault()
                }
                val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    )
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
                }
                val engine = SpeechRecognizer.createSpeechRecognizer(appContext)
                engine.setRecognitionListener(listener)
                recognizer = engine
                try {
                    engine.startListening(intent)
                } catch (_: SecurityException) {
                    tearDown()
                    outcome.set("mic permission needed — allow the microphone and try again")
                } catch (_: Exception) {
                    tearDown()
                    outcome.set("could not start listening")
                }
            } catch (_: Exception) {
                outcome.set("could not start listening")
            } finally {
                latch.countDown()
            }
        }
        latch.await(4, TimeUnit.SECONDS)
        return outcome.get()
    }

    /**
     * End the in-progress utterance early. The recognizer still delivers
     * what it captured through the listener (final or error); no-op when
     * idle.
     */
    @JvmStatic
    fun stop() {
        main.post {
            try {
                recognizer?.stopListening()
            } catch (_: Exception) {
                // Already finished or gone; the listener already reported.
            }
        }
    }
}
