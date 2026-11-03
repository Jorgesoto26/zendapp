module.exports = {
  dependencies: {
    'react-native-sqlite-storage': {
      platforms: {
        android: {
          sourceDir:
            '../node_modules/react-native-sqlite-storage/platforms/android',
        },
        ios: {
          podspecPath:
            '../node_modules/react-native-sqlite-storage/react-native-sqlite-storage.podspec',
        },
      },
    },
  },
  project: {
    ios: {},
    android: {},
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts'],
};
