package com.ycpr.scorebug

import android.content.Context

object Prefs {
    const val DEFAULT_URL = "https://ycpr.vercel.app/overlay"

    private fun prefs(context: Context) = context.getSharedPreferences("scorebug", Context.MODE_PRIVATE)

    fun url(context: Context): String = prefs(context).getString("url", DEFAULT_URL) ?: DEFAULT_URL

    fun setUrl(context: Context, url: String) = prefs(context).edit().putString("url", url).apply()

    /** Whether the overlay should come back on its own after a reboot or app update. */
    fun enabled(context: Context): Boolean = prefs(context).getBoolean("enabled", true)

    fun setEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean("enabled", enabled).apply()
}
