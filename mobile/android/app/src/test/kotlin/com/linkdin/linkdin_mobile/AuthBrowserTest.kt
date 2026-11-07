package com.linkdin.linkdin_mobile

import android.app.Activity
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35], manifest = Config.NONE)
class AuthBrowserTest {
    private val url = "https://www.linkedin.com/oauth/v2/authorization?state=keep%2Bstate"
    private fun handler(pkg: String, browser: Boolean, enabled: Boolean = true) = ResolveInfo().apply {
        filter = IntentFilter(Intent.ACTION_VIEW).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            addCategory(Intent.CATEGORY_DEFAULT)
            addDataScheme("http")
            addDataScheme("https")
            if (!browser) addDataAuthority("www.linkedin.com", null)
        }
        activityInfo = ActivityInfo().apply {
            packageName = pkg
            name = "$pkg.Main"
            exported = true
            this.enabled = enabled
            applicationInfo = ApplicationInfo().apply { packageName = pkg }
        }
    }
    private fun activity(vararg handlers: ResolveInfo): Activity {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        shadowOf(activity.packageManager).setResolveInfosForIntent(probe, handlers.toList())
        return activity
    }
    @Test fun providerAppCannotCaptureOAuth() {
        val activity = activity(handler("com.linkedin.android", false), handler("com.android.chrome", true))
        assertTrue(AuthBrowser.open(activity, url))
        val launch = shadowOf(activity).nextStartedActivity
        assertEquals("com.android.chrome", launch.`package`)
        assertEquals(url, launch.dataString)
        assertEquals(Intent.ACTION_VIEW, launch.action)
    }
    @Test fun browserResolverOffersOnlyExplicitBrowserPackages() {
        val activity = activity(handler("com.linkedin.android", false), handler("com.android.chrome", true), handler("org.mozilla.firefox", true))
        assertTrue(AuthBrowser.open(activity, url))
        val launch = shadowOf(activity).nextStartedActivity
        // A resolved browser is also safe; when the resolver has no browser
        // preference every chooser entry must retain its explicit package.
        val choices = if (launch.action == Intent.ACTION_CHOOSER) {
            listOf(launch.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!) +
                launch.getParcelableArrayExtra(Intent.EXTRA_INITIAL_INTENTS)!!.map { it as Intent }
        } else listOf(launch)
        assertTrue(choices.isNotEmpty())
        choices.forEach {
            assertTrue(it.`package` in listOf("com.android.chrome", "org.mozilla.firefox"))
            assertEquals(url, it.dataString)
        }
    }
    @Test fun providerAppWithoutBrowserFailsWithoutLaunching() {
        val activity = activity(handler("com.linkedin.android", false), handler("disabled.browser", true, false))
        assertFalse(AuthBrowser.open(activity, url))
        assertNull(shadowOf(activity).nextStartedActivity)
    }
    @Test fun unsafeUrlsCannotLaunchAnActivity() {
        val activity = activity(handler("com.android.chrome", true))
        listOf(null, "http://linkedin.com", "intent://auth", "https://user:password@linkedin.com").forEach {
            assertFalse(AuthBrowser.open(activity, it))
        }
        assertNull(shadowOf(activity).nextStartedActivity)
    }
}
