package com.ycpr.scorebug

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The tile on the Google TV home screen. Opening it starts the overlay
 * and shows its status; there's nothing else to set up here — what the
 * bug shows is controlled from /overlay/control on a laptop or phone.
 *
 * To point it at a different page (another screen id, a preview deploy):
 *   adb shell am start -n com.ycpr.scorebug/.MainActivity --es url "https://.../overlay?screen=den"
 */
class MainActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.getStringExtra("url")?.takeIf { it.startsWith("http") }?.let { Prefs.setUrl(this, it) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1f2041"))
            setPadding(dp(48), dp(32), dp(48), dp(32))
        }
        root.addView(text("YCPR Score Bug", 34f, "#ffc857"))
        status = text("", 18f, "#f4f2ea")
        root.addView(status)

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, 0)
        }
        val start = button("Start overlay") {
            Prefs.setEnabled(this, true)
            OverlayService.start(this)
            render()
        }
        buttons.addView(start)
        buttons.addView(button("Reload page") { OverlayService.start(this, OverlayService.ACTION_RELOAD) })
        buttons.addView(button("Stop overlay") {
            Prefs.setEnabled(this, false)
            stopService(Intent(this, OverlayService::class.java))
            render()
        })
        root.addView(buttons)
        root.addView(text("Control it from ${Prefs.url(this).replace("/overlay", "/overlay/control")}", 15f, "#8babe4"))

        setContentView(root)
        start.requestFocus()

        if (Settings.canDrawOverlays(this) && Prefs.enabled(this)) OverlayService.start(this)
        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        status.text = if (!Settings.canDrawOverlays(this)) {
            "Overlay permission not granted yet. From your laptop run:\n\n" +
                "adb shell appops set com.ycpr.scorebug SYSTEM_ALERT_WINDOW allow\n\nthen reopen this app."
        } else if (Prefs.enabled(this)) {
            "Overlay is on. Press Home and open YouTube TV — the bug stays on top.\n\nShowing: ${Prefs.url(this)}"
        } else {
            "Overlay is off."
        }
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(s: String, size: Float, color: String) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(Color.parseColor(color))
        gravity = Gravity.CENTER
        setPadding(0, dp(8), 0, dp(8))
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isFocusable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(8), 0, dp(8), 0)
        }
    }
}
