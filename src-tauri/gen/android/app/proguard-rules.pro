# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# JNI surface invoked from Rust by exact name (tts_android.rs calls
# Tts.init/speak/stop, secrets_android.rs calls Secrets.init/get/set/
# delete; MainActivity declares nativeOnExternalText). Release
# minification must not rename or strip these, or the bridges break
# only in release builds (debug has minification off).
-keep class studio.ccez.app.Tts {
  public *;
}
-keep class studio.ccez.app.Secrets {
  public *;
}
-keepclasseswithmembernames class studio.ccez.app.MainActivity {
  native <methods>;
}

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile