package com.ycpr.scorebug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.widget.Toast

/**
 * Flips the overlay on/off. Sent by the "Score Bug On/Off" shortcut app
 * (../toggle), which is what the remote's customizable button launches —
 * Google TV can only map that button to an app, not to an action.
 */
class ToggleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!Settings.canDrawOverlays(context)) {
            Toast.makeText(context, "Score Bug: overlay permission not granted", Toast.LENGTH_LONG).show()
            return
        }
        if (OverlayService.running) {
            Prefs.setEnabled(context, false)
            context.stopService(Intent(context, OverlayService::class.java))
            Toast.makeText(context, "Score bug off", Toast.LENGTH_SHORT).show()
        } else {
            Prefs.setEnabled(context, true)
            OverlayService.start(context)
            Toast.makeText(context, "Score bug on", Toast.LENGTH_SHORT).show()
        }
    }
}
