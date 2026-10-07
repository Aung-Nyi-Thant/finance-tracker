// iOS 27 aborts apps that don't adopt the UIScene lifecycle. This plugin wires the app up to
// Expo's ExpoAppSceneDelegate, which starts React Native once the window scene connects.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

function patchAppDelegate(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;

  const withProtocol = contents.replace(
    /class AppDelegate: ExpoAppDelegate \{/,
    'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
  );
  // React Native is now started by the scene delegate, not by didFinishLaunching.
  const withoutStart = withProtocol.replace(
    /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\n/,
    '    // React Native is started by ExpoAppSceneDelegate once the UIWindowScene connects (required by iOS 27).\n'
  );
  if (withoutStart === withProtocol || withProtocol === contents) {
    throw new Error('withIOSSceneLifecycle: AppDelegate.swift has an unexpected layout; update the plugin.');
  }
  return withoutStart;
}

module.exports = function withIOSSceneLifecycle(config) {
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') {
      throw new Error('withIOSSceneLifecycle only supports a Swift AppDelegate.');
    }
    c.modResults.contents = patchAppDelegate(c.modResults.contents);
    return c;
  });

  return withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return c;
  });
};
