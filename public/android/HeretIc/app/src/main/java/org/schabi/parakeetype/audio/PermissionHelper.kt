package org.schabi.parakeetype.audio

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat

object PermissionHelper {

    fun hasRecordPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

    fun requestPermissionIntent(context: Context? = null): Intent {
        val uri = if (context != null) {
            Uri.fromParts("package", context.packageName, null)
        } else {
            Uri.parse("package:ai.heretic.app")
        }
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
