package com.linkdin.linkdin_mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/** Resolve a generic web URL first, then pin OAuth to an actual browser package.
 * Resolving the LinkedIn URL itself lets its verified app link steal consent.
 * No credentials are read, logged, or passed to a WebView by this bridge.
 */
object AuthBrowser {
    @Suppress("DEPRECATION")
    fun open(activity: Activity, value: String?): Boolean {
        val uri = value?.let { Uri.parse(it) } ?: return false
        if (uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.userInfo != null) return false

        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val pm = activity.packageManager
        // Inspect public intent filters: a browser handles arbitrary HTTP(S)
        // hosts, whereas a provider app declares specific domain authorities.
        val browsers = pm.queryIntentActivities(probe, PackageManager.GET_RESOLVED_FILTER or PackageManager.MATCH_ALL)
            .filter {
                val filter = it.filter
                filter != null && filter.hasAction(Intent.ACTION_VIEW) &&
                    filter.hasCategory(Intent.CATEGORY_BROWSABLE) &&
                    filter.hasDataScheme("http") && filter.hasDataScheme("https") &&
                    filter.countDataAuthorities() == 0 &&
                    it.activityInfo.exported && it.activityInfo.enabled
            }
            .map { it.activityInfo.packageName }.distinct()
        if (browsers.isEmpty()) return false
        val preferred = pm.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName?.takeIf { it in browsers }
        fun target(pkg: String) = Intent(Intent.ACTION_VIEW, uri)
            .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(pkg)
        val launch = if (preferred != null || browsers.size == 1) {
            target(preferred ?: browsers.first())
        } else {
            // Every choice is explicitly package-scoped; LinkedIn cannot appear.
            Intent.createChooser(target(browsers.first()), "Choose a browser to sign in")
                .putExtra(Intent.EXTRA_INITIAL_INTENTS, browsers.drop(1).map(::target).toTypedArray())
        }
        return try {
            activity.startActivity(launch)
            true
        } catch (_: ActivityNotFoundException) { false }
          catch (_: SecurityException) { false }
    }
}
