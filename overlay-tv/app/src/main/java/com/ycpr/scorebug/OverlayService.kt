package com.ycpr.scorebug

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Keeps a full-screen, see-through, non-focusable, non-touchable WebView
 * on top of whatever app is playing. Everything you see is the web page
 * (/overlay on the site); this service only hosts it. Because the window
 * can't take focus, every remote button still goes to YouTube TV / ESPN /
 * whatever is underneath.
 */
class OverlayService : Service() {

    companion object {
        const val ACTION_RELOAD = "com.ycpr.scorebug.RELOAD"
        const val ACTION_STOP = "com.ycpr.scorebug.STOP"
        private const val CHANNEL_ID = "overlay"
        private const val RETRY_MS = 30_000L
        private const val DAILY_CHECK_MS = 30 * 60_000L

        fun start(context: Context, action: String? = null) {
            val intent = Intent(context, OverlayService::class.java)
            if (action != null) intent.action = action
            context.startForegroundService(intent)
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var webView: WebView? = null
    private var loadedUrl: String? = null
    private var lastFullReload = System.currentTimeMillis()

    private val retry = Runnable { webView?.reload() }

    // Once a day (overnight) reload the page so a new site deploy reaches
    // the TV without anyone touching it.
    private val dailyReload = object : Runnable {
        override fun run() {
            val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
            if (hour == 5 && System.currentTimeMillis() - lastFullReload > 20 * 3600_000L) {
                lastFullReload = System.currentTimeMillis()
                webView?.reload()
            }
            handler.postDelayed(this, DAILY_CHECK_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        handler.postDelayed(dailyReload, DAILY_CHECK_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RELOAD -> webView?.reload()
        }
        if (!Settings.canDrawOverlays(this)) {
            // Permission not granted yet (see the appops command in the
            // README); nothing to draw into.
            stopSelf()
            return START_NOT_STICKY
        }
        if (webView == null) addOverlay()
        val url = Prefs.url(this)
        if (url != loadedUrl) {
            loadedUrl = url
            webView?.loadUrl(url)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        removeOverlay()
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Score overlay", NotificationManager.IMPORTANCE_MIN))
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Score bug is running")
            .setSmallIcon(R.drawable.icon)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, notification)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun addOverlay() {
        val view = WebView(this)
        view.setBackgroundColor(Color.TRANSPARENT)
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.webViewClient = object : WebViewClient() {
            override fun onReceivedError(v: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Wi-Fi drop, site deploy in progress, etc. — try again shortly.
                if (request.isForMainFrame) {
                    handler.removeCallbacks(retry)
                    handler.postDelayed(retry, RETRY_MS)
                }
            }

            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The WebView renderer was killed (low memory). Rebuild the
                // window instead of letting the whole app crash.
                removeOverlay()
                loadedUrl = null
                handler.post {
                    addOverlay()
                    loadedUrl = Prefs.url(this@OverlayService)
                    webView?.loadUrl(loadedUrl!!)
                }
                return true
            }
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        )
        windowManager?.addView(view, params)
        webView = view
    }

    private fun removeOverlay() {
        val view = webView ?: return
        webView = null
        try {
            windowManager?.removeView(view)
        } catch (_: IllegalArgumentException) {
            // already detached
        }
        view.destroy()
    }
}
