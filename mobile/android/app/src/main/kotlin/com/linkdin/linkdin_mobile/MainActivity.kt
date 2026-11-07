package com.linkdin.linkdin_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Creates the two notification channels the server sends against.
 *
 * Done here rather than in Dart because on Android O and later a notification
 * naming a channel that does not exist is dropped by the system — silently, with
 * nothing in logcat that says so. The server picks `linkdin_alerts` for problems
 * and `linkdin_updates` for ordinary news (see lib/push.ts), and both have to
 * exist before the first message arrives, including on a cold start where Dart
 * has not run yet.
 *
 * Two channels rather than one so the split is the USER's to make: a draft
 * landing at 09:00 and the scheduler being dead are not the same interruption,
 * and Android's per-channel settings let them be silenced separately without
 * turning off the one that matters.
 *
 * Creating a channel that already exists is a no-op, so this is safe on every
 * launch. Note that importance cannot be lowered afterwards — Android treats it
 * as the user's setting once created.
 */
class MainActivity : FlutterActivity() {
    private var notifications: MethodChannel? = null
    private var pendingTab: String? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "byline/auth_browser")
            .setMethodCallHandler { call, result ->
                if (call.method == "open") {
                    result.success(AuthBrowser.open(this, call.argument<String>("url")))
                } else result.notImplemented()
            }
        notifications = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "byline/notifications").apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    "show" -> {
                        try {
                            result.success(showForegroundNotification(
                                call.argument<String>("title"), call.argument<String>("body"),
                                call.argument<String>("channel"), call.argument<String>("tag"),
                                call.argument<String>("tab"),
                            ))
                        } catch (_: SecurityException) { result.success(false) }
                    }
                    "takePendingTab" -> {
                        result.success(pendingTab ?: intent?.getStringExtra("byline_notification_tab"))
                        pendingTab = null
                        intent?.removeExtra("byline_notification_tab")
                    }
                    "clear" -> {
                        getSystemService(NotificationManager::class.java)?.cancelAll()
                        pendingTab = null
                        intent?.removeExtra("byline_notification_tab")
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingTab = intent.getStringExtra("byline_notification_tab")
        if (pendingTab != null) notifications?.invokeMethod("notificationOpened", null)
    }

    private fun showForegroundNotification(title: String?, body: String?, channel: String?, tag: String?, tab: String?): Boolean {
        if (title == null && body == null) return false
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val manager = getSystemService(NotificationManager::class.java) ?: return false
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return false
        val channelId = if (channel == "linkdin_alerts") channel else "linkdin_updates"
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channelId)?.importance == NotificationManager.IMPORTANCE_NONE) return false
        val destination = tab?.takeIf { it in setOf("queue", "schedule", "compose", "voice", "status") } ?: "queue"
        val notificationTag = tag ?: "byline_update"
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("byline_notification_tab", destination)
        }
        val tap = PendingIntent.getActivity(this, notificationTag.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channelId) else Notification.Builder(this)
        val notification = builder.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title).setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(tap).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPriority(if (channelId == "linkdin_alerts") Notification.PRIORITY_HIGH else Notification.PRIORITY_DEFAULT)
            .build()
        // Match FCM's tag/id so the foreground and background paths replace
        // the same event instead of leaving duplicate rows in the shade.
        manager.notify(notificationTag, 0, notification)
        return true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = getSystemService(NotificationManager::class.java) ?: return

        manager.createNotificationChannel(
            NotificationChannel(
                "linkdin_alerts",
                "Problems",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "The agent has stopped, a post failed to send, or LinkedIn needs reconnecting."
            },
        )

        manager.createNotificationChannel(
            NotificationChannel(
                "linkdin_updates",
                "Drafts and posts",
                // DEFAULT, not HIGH: a draft being ready is worth knowing and is
                // not worth a heads-up banner over whatever you were doing.
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "A draft is ready to read, or a post went out."
            },
        )
    }
}
