package com.linkdin.linkdin_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

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
