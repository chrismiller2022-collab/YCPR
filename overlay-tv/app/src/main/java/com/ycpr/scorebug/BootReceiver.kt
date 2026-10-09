package com.ycpr.scorebug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings

/** Brings the overlay back after the TV restarts or the app is updated. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs.enabled(context) && Settings.canDrawOverlays(context)) {
            OverlayService.start(context)
        }
    }
}
