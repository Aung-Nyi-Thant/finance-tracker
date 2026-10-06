import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useTransactions } from '../../store/TransactionsContext';
import { useTheme } from '../../theme/colors';

export default function TabsLayout() {
  const t = useTheme();
  const { pending } = useTransactions();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textTertiary,
        tabBarStyle: {
          backgroundColor: t.isDark ? 'rgba(10,15,30,0.55)' : 'rgba(255,255,255,0.6)',
          borderTopColor: t.border,
        },
        tabBarBackground: () => <BlurView intensity={55} tint={t.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />,
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        sceneStyle: { backgroundColor: t.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Inbox',
          tabBarBadge: pending.length > 0 ? pending.length : undefined,
          tabBarBadgeStyle: { backgroundColor: t.accent, color: t.accentText, fontWeight: '700' },
          tabBarIcon: ({ color, size }) => <Ionicons name="file-tray-full" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
