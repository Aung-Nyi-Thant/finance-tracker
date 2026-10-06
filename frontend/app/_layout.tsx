import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Toast } from '../components/Toast';
import { AutoImportProvider } from '../store/AutoImportContext';
import { SettingsProvider } from '../store/SettingsContext';
import { TransactionsProvider } from '../store/TransactionsContext';
import { useTheme } from '../theme/colors';

export default function RootLayout() {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <TransactionsProvider>
        <SettingsProvider>
        <AutoImportProvider>
          <StatusBar style={t.isDark ? 'light' : 'dark'} />
          <Toast />
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}
          />
        </AutoImportProvider>
        </SettingsProvider>
      </TransactionsProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
