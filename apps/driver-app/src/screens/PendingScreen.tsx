import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { flush, isOnline, items, remove, retry, subscribe } from '../outbox';
import type { OutboxItem } from '../outbox-core';
import { Badge, Button, Card, colors, s } from '../ui';

const time = (ms: number) =>
  new Date(ms).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Thin bar above the content: offline state and actions waiting on the phone. */
export function PendingBar({ onOpen }: { onOpen: () => void }) {
  const [list, setList] = useState<OutboxItem[]>(() => items());
  const [online, setOnline] = useState(isOnline());
  useEffect(
    () =>
      subscribe(() => {
        setList(items());
        setOnline(isOnline());
      }),
    [],
  );
  const failed = list.filter((i) => i.status === 'failed').length;
  const waiting = list.length - failed;
  if (online && !list.length) return null;
  const text = [
    !online && 'Offline',
    waiting > 0 && `${waiting} waiting to send`,
    failed > 0 && `${failed} not sent`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      style={{
        backgroundColor: failed ? '#fde7e5' : '#fff1d6',
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: failed ? colors.danger : colors.warn, fontWeight: '600' }}>
        {text || 'Offline'} ›
      </Text>
    </Pressable>
  );
}

/** Everything saved on the phone, oldest first, with retry / discard for rejected actions. */
export function PendingScreen({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<OutboxItem[]>(() => items());
  const [sending, setSending] = useState(false);
  useEffect(() => subscribe(() => setList(items())), []);
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={{ color: colors.primary }}>‹ Back</Text>
      </Pressable>
      <Text style={s.h2}>Saved on this phone</Text>
      <Text style={s.muted}>
        Actions are sent in order as soon as there is a connection. Nothing is sent twice.
      </Text>
      {!list.length && <Text style={s.muted}>Everything has been sent.</Text>}
      {list.length > 0 && (
        <Button
          title="Send now"
          busy={sending}
          onPress={async () => {
            setSending(true);
            await flush();
            setSending(false);
          }}
        />
      )}
      {list.map((i) => (
        <Card key={i.id}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontWeight: '600', flexShrink: 1, color: colors.text }}>{i.label}</Text>
            <Badge
              text={i.status === 'failed' ? 'not sent' : 'waiting'}
              tone={i.status === 'failed' ? 'danger' : 'warn'}
            />
          </View>
          <Text style={s.muted}>
            Saved {time(i.createdAt)}
            {i.attempts > 0 && i.status === 'pending' ? ` · ${i.attempts} attempt(s)` : ''}
          </Text>
          {i.error && <Text style={s.error}>{i.error}</Text>}
          {i.status === 'failed' && (
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Button title="Try again" kind="secondary" onPress={() => retry(i.id)} />
              <Button
                title="Discard"
                kind="danger"
                onPress={() =>
                  Alert.alert('Discard this action?', `${i.label}\nIt will not be sent.`, [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => remove(i.id) },
                  ])
                }
              />
            </View>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
