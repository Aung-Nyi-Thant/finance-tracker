/** Jest configuration (preset: jest-expo). Run with `npm test`. */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
  testMatch: ['<rootDir>/__tests__/**/*.test.(ts|tsx)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-reanimated|react-native-worklets|react-native-gesture-handler|test-renderer)',
  ],
  collectCoverageFrom: ['components/**/*.{ts,tsx}', 'services/**/*.ts', 'store/**/*.tsx', 'utils/**/*.ts', 'theme/**/*.ts', 'app/**/*.tsx'],
};
