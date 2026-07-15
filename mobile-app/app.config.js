// Dynamic Expo config layered on top of app.json. The `development` EAS profile
// sets APP_VARIANT=development (see eas.json), which swaps in the "DEV"-badged
// icon, a distinct name, and a separate bundle id — so a dev client can sit on
// the home screen next to a production install and be told apart at a glance.
const IS_DEV = process.env.APP_VARIANT === 'development';

const ICON = IS_DEV ? './assets/images/icon-dev.png' : './assets/images/icon.png';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Shot Studio Dev' : config.name,
  icon: ICON,
  ios: {
    ...config.ios,
    icon: ICON,
    bundleIdentifier: IS_DEV
      ? 'com.bidah.shot-studio-mobile.dev'
      : config.ios.bundleIdentifier,
  },
});
