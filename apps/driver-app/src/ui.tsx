import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

export const colors = {
  bg: '#f4f6f9',
  card: '#ffffff',
  text: '#1b2430',
  muted: '#6b7686',
  border: '#e2e6ec',
  primary: '#1f5fbf',
  danger: '#b42318',
  ok: '#1d7a46',
  warn: '#9a5b00',
};

export function Button({ title, onPress, kind = 'primary', busy, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [s.button, { backgroundColor: bg, opacity: pressed || disabled ? 0.6 : 1 }, kind === 'secondary' && s.secondary]}
    >
      {busy ? <ActivityIndicator color={kind === 'secondary' ? colors.primary : '#fff'} /> : <Text style={[s.buttonText, kind === 'secondary' && { color: colors.primary }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={s.input} {...rest} />
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'ok' | 'warn' | 'danger' | 'info' }) {
  const map = { muted: ['#e2e6ec', colors.muted], ok: ['#e3f4ea', colors.ok], warn: ['#fff1d6', colors.warn], danger: ['#fde7e5', colors.danger], info: ['#e5eefb', colors.primary] };
  const [bg, fg] = map[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, value === o.value && s.chipOn]} accessibilityState={{ selected: value === o.value }}>
          <Text style={{ color: value === o.value ? '#fff' : colors.text }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const s = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  input: { backgroundColor: '#fff', borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text },
  button: { padding: 14, borderRadius: 8, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  secondary: { borderWidth: 1, borderColor: colors.primary },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
