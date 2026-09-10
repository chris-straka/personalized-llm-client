package studio.ccez.app

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API-key storage for the Rust bridge (`secrets_android.rs`).
 *
 * The `keyring` crate has no Android backend (it falls back to an
 * in-memory mock), so secrets live here instead: one AES/GCM key in
 * the AndroidKeyStore envelopes every value, ciphertext lands in a
 * private SharedPreferences file. No new dependency — raw
 * `javax.crypto` only (minSdk 24 covers KeyGenParameterSpec).
 *
 * [init] runs from `MainActivity.onCreate`, so the Rust side never
 * passes contexts through JNI. Every entry returns null/false on
 * failure instead of throwing: a broken store must read as "no key",
 * never as a crash. Writes use `commit()` (synchronous) so a
 * force-stop right after saving can't lose the key.
 */
object Secrets {
    private lateinit var appContext: Context

    private external fun nativeInit(activity: Activity)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    private const val PREFS = "ccez_secrets"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "ccez-secrets-v1"
    private const val GCM_TAG_BITS = 128
    private const val IV_BYTES = 12

    private fun prefs() =
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey? = try {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            ?: run {
                val gen = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    ANDROID_KEYSTORE
                )
                gen.init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
                gen.generateKey()
            }
    } catch (_: Exception) {
        null
    }

    /** Stored secret, or null when missing or unreadable. */
    @JvmStatic
    fun get(service: String, account: String): String? {
        if (!::appContext.isInitialized) return null
        return try {
            val raw = prefs().getString("$service/$account", null) ?: return null
            val blob = Base64.decode(raw, Base64.NO_WRAP)
            if (blob.size <= IV_BYTES) return null
            val secret = key() ?: return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secret,
                GCMParameterSpec(GCM_TAG_BITS, blob, 0, IV_BYTES)
            )
            String(
                cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES),
                Charsets.UTF_8
            )
        } catch (_: Exception) {
            null
        }
    }

    /** True when the secret is durably stored. */
    @JvmStatic
    fun set(service: String, account: String, secret: String): Boolean {
        if (!::appContext.isInitialized) return false
        return try {
            val k = key() ?: return false
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, k)
            val iv = cipher.iv
            val cipherText = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
            val blob = iv + cipherText
            prefs().edit()
                .putString("$service/$account", Base64.encodeToString(blob, Base64.NO_WRAP))
                .commit()
        } catch (_: Exception) {
            false
        }
    }

    /** True always: a missing entry is not an error. */
    @JvmStatic
    fun delete(service: String, account: String): Boolean {
        if (!::appContext.isInitialized) return false
        return try {
            prefs().edit().remove("$service/$account").commit()
        } catch (_: Exception) {
            false
        }
    }
}
