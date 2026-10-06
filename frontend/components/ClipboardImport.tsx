import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useAutoImport } from '../store/AutoImportContext';
import { cardStyle, useTheme } from '../theme/colors';
import { NeuBadge } from './fx/NeuBadge';
import { SpringPressable } from './fx/SpringPressable';

/** Import an image from the clipboard (e.g. "Copy" on a payment slip in Photos or a banking app). */
export function ClipboardImport() {
  const t = useTheme();
  const { importImage, importing } = useAutoImport();

  async function paste() {
    try {
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) {
        Alert.alert('No image on the clipboard', 'Copy a payment slip or screenshot first, then tap Paste.');
        return;
      }
      await importImage(img.data);
    } catch (err) {
      Alert.alert('Could not paste', (err as Error).message);
    }
  }

  return (
    <View style={[styles.row, cardStyle(t, 24)]}>
      <NeuBadge icon="clipboard" color={t.accent} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.text }]}>Copied a slip?</Text>
        <Text style={[styles.sub, { color: t.textSecondary }]}>Paste it to add it instantly</Text>
      </View>
      <SpringPressable
        onPress={paste}
        disabled={importing > 0}
        pressedScale={0.92}
        style={[styles.paste, { backgroundColor: t.accent, opacity: importing > 0 ? 0.5 : 1, shadowColor: t.accent }]}
      >
        <Text style={{ color: t.accentText, fontWeight: '700', fontSize: 15 }}>Paste</Text>
      </SpringPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 1 },
  paste: { width: 88, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
});
