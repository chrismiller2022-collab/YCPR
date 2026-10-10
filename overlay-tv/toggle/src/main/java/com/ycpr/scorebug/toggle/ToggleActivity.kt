package com.ycpr.scorebug.toggle

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * No screen: tells Score Bug to flip the overlay and closes at once, so
 * whatever was playing comes straight back. Map the remote's
 * customizable button to this app.
 */
class ToggleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sendBroadcast(
            Intent("com.ycpr.scorebug.TOGGLE").setClassName("com.ycpr.scorebug", "com.ycpr.scorebug.ToggleReceiver"),
            "com.ycpr.scorebug.permission.TOGGLE"
        )
        finish()
    }
}
