import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// OAuth must reach a browser, not an installed app claiming the provider URL.
/// Android's native bridge explicitly selects a general-purpose web browser.
/// Never fall back to a WebView or the unrestricted Android URL resolver.
Future<bool> openAuthBrowser(Uri uri) async {
  if (uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
    return false;
  }
  try {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return await const MethodChannel(
            'byline/auth_browser',
          ).invokeMethod<bool>('open', {'url': uri.toString()}) ??
          false;
    }
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } on PlatformException {
    return false;
  } on MissingPluginException {
    return false;
  }
}
