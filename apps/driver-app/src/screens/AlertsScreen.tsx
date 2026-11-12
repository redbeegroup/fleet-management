import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { api, AppNotification } from '../api';
import { Badge, Button, Card, s, when } from '../ui';

export function AlertsScreen({ onRead }: { onRead: () => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setItems(await api<AppNotification[]>('/notifications').catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {items.some((n) => !n.readAt) && (
        <Button
          title="Mark all read"
          kind="secondary"
          onPress={async () => {
            await api('/notifications/read-all', { method: 'POST' });
            onRead();
            await load();
          }}
        />
      )}
      {!loading && items.length === 0 && <Text style={s.muted}>No notifications.</Text>}
      {items.map((n) => (
        <Card key={n.id}>
          <Badge text={n.severity} tone={n.severity === 'critical' ? 'danger' : n.severity === 'warning' ? 'warn' : 'info'} />
          <Text style={[s.h2, n.readAt ? { opacity: 0.6 } : null]}>{n.title}</Text>
          <Text>{n.body}</Text>
          <Text style={s.muted}>{when(n.createdAt)}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}
