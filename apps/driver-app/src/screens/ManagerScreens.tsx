import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { API_URL, Approval, authHeaders, ManagerSummary } from '../api';
import { cachedGet, submit } from '../outbox';
import { Badge, Button, Card, colors, s } from '../ui';

const KIND: Record<Approval['kind'], string> = {
  WORK_ORDER: 'Work order',
  EXPENSE: 'Expense',
  FUEL: 'Fuel',
  VEHICLE_REQUEST: 'Vehicle request',
  CLAIM: 'Insurance claim',
};
const money = (v: string | number | null) => (v == null ? '' : Number(v).toLocaleString('en-US'));
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60
    ? `${m} min ago`
    : m < 1440
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} d ago`;
};
const fact = (v: string) =>
  /^\d{4}-\d{2}-\d{2}T/.test(v)
    ? new Date(v).toLocaleString([], {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : v;

/** Pending approval requests for the signed-in manager, with a detail view to decide. */
export function ApprovalsScreen({
  openId,
  onOpened,
}: {
  openId: string | null;
  onOpened: () => void;
}) {
  const [list, setList] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cachedGet<Approval[]>('/approvals?scope=pending');
      setList(r.data);
      setSavedAt(r.stale ? r.at : null);
    } catch (e) {
      Alert.alert('Could not load approvals', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Opened from a push notification
  useEffect(() => {
    if (openId) {
      setOpen(openId);
      onOpened();
    }
  }, [openId, onOpened]);

  if (open) return <ApprovalDetail id={open} onBack={() => (setOpen(null), void load())} />;
  return (
    <ScrollView
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={s.h2}>Waiting for you</Text>
      {savedAt && (
        <Text style={s.muted}>
          Offline · list saved at{' '}
          {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
      {!loading && !list.length && <Text style={s.muted}>Nothing to approve.</Text>}
      {list.map((a) => (
        <Pressable key={a.id} onPress={() => setOpen(a.id)} accessibilityRole="button">
          <Card>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={{ fontWeight: '700', color: colors.text, flexShrink: 1 }}>
                {a.title}
              </Text>
              {a.amount && (
                <Text style={{ fontWeight: '700', color: colors.text }}>{money(a.amount)}</Text>
              )}
            </View>
            <Text style={s.muted}>
              {KIND[a.kind]} · {ago(a.createdAt)}
              {a.requiredApprovals > 1
                ? ` · ${a.decisions.length}/${a.requiredApprovals} approvals`
                : ''}
            </Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ApprovalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [a, setA] = useState<Approval | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cachedGet<Approval>(`/approvals/${id}`)
      .then((r) => setA(r.data))
      .catch((e: Error) => Alert.alert('Could not open the request', e.message));
  }, [id]);

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !note.trim())
      return Alert.alert('Add a note explaining the rejection');
    setBusy(true);
    try {
      const r = await submit(
        `/approvals/${id}/${decision}`,
        { note: note.trim() || null },
        { label: `${decision === 'approve' ? 'Approve' : 'Reject'} · ${a?.title ?? ''}` },
      );
      Alert.alert(
        r.queued ? 'Saved on the phone' : decision === 'approve' ? 'Approved' : 'Rejected',
        r.queued ? 'No connection. Your decision will be sent automatically.' : '',
      );
      onBack();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={{ color: colors.primary }}>‹ Back</Text>
      </Pressable>
      {!a ? (
        <Text style={s.muted}>Loading…</Text>
      ) : (
        <>
          <Text style={s.h2}>{a.title}</Text>
          <View style={s.row}>
            <Badge text={KIND[a.kind]} tone="info" />
            <Badge
              text={a.status.toLowerCase()}
              tone={a.status === 'PENDING' ? 'warn' : a.status === 'APPROVED' ? 'ok' : 'danger'}
            />
          </View>
          {a.amount && <Text style={[s.title, { marginVertical: 4 }]}>{money(a.amount)}</Text>}
          <Card>
            {(a.details?.facts ?? [])
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <View key={k} style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={s.muted}>{k}</Text>
                  <Text style={{ color: colors.text, flexShrink: 1, textAlign: 'right' }}>
                    {fact(v)}
                  </Text>
                </View>
              ))}
          </Card>
          {(a.details?.fileIds ?? []).map((f) => (
            <Image
              key={f}
              source={{ uri: `${API_URL}/files/${f}`, headers: authHeaders() }}
              style={{ width: '100%', height: 240, borderRadius: 8, backgroundColor: '#eee' }}
              resizeMode="contain"
              accessibilityLabel="Attachment"
            />
          ))}
          {a.decisions.length > 0 && (
            <Text style={s.muted}>
              Decisions so far:{' '}
              {a.decisions
                .map((d) => `${d.decision.toLowerCase()}${d.note ? ` (“${d.note}”)` : ''}`)
                .join(', ')}
            </Text>
          )}
          {a.status === 'PENDING' && (
            <>
              <Text style={s.label}>Note (required to reject)</Text>
              <TextInput
                style={[s.input, { minHeight: 60 }]}
                multiline
                value={note}
                onChangeText={setNote}
                placeholder="Optional for approval"
                placeholderTextColor={colors.muted}
              />
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Button title="Approve" busy={busy} onPress={() => void decide('approve')} />
                <Button
                  title="Reject"
                  kind="danger"
                  busy={busy}
                  onPress={() => void decide('reject')}
                />
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const ALERT_LABEL: Record<string, string> = {
  OFF_ROUTE: 'Off route',
  UNAUTHORISED_MOVEMENT: 'Moving without a trip',
  AFTER_HOURS: 'Outside working hours',
  NO_DRIVER: 'No driver on duty',
  RESTRICTED_AREA: 'Restricted area',
  OVERSPEED: 'Overspeed',
  GPS_OFFLINE: 'GPS offline',
};

/** Fleet at a glance for managers: approvals, vehicles, control alerts (24 h), budgets at risk. */
export function FleetScreen({ onApprovals }: { onApprovals: () => void }) {
  const [d, setD] = useState<ManagerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setD((await cachedGet<ManagerSummary>('/mobile/manager-summary')).data);
    } catch (e) {
      Alert.alert('Could not load', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const tile = (label: string, value: string | number, onPress?: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={!onPress}
      style={{ flexBasis: '47%', flexGrow: 1 }}
    >
      <Card>
        <Text style={s.muted}>{label}</Text>
        <Text style={s.title}>{value}</Text>
      </Card>
    </Pressable>
  );
  return (
    <ScrollView
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {d && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tile('Waiting for approval', d.pendingApprovals, onApprovals)}
            {tile('Trips running', d.tripsOngoing)}
            {tile('Vehicles available', d.vehicles.AVAILABLE ?? 0)}
            {tile('In repair', (d.vehicles.UNDER_REPAIR ?? 0) + (d.vehicles.MAINTENANCE ?? 0))}
          </View>
          <Text style={s.h2}>Alerts · last 24 h</Text>
          {!d.alerts.length && <Text style={s.muted}>No alerts.</Text>}
          {d.alerts.map((e) => (
            <Card key={e.id}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{e.plateNumber}</Text>
                <Badge
                  text={ALERT_LABEL[e.type] ?? e.type}
                  tone={
                    ['UNAUTHORISED_MOVEMENT', 'NO_DRIVER', 'RESTRICTED_AREA'].includes(e.type)
                      ? 'danger'
                      : 'warn'
                  }
                />
              </View>
              <Text style={s.muted}>
                {new Date(e.occurredAt).toLocaleString([], {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {e.endedAt ? ' · ended' : ' · ongoing'}
              </Text>
            </Card>
          ))}
          <Text style={s.h2}>Budgets this month</Text>
          {!d.budgets.length && <Text style={s.muted}>No budget at risk.</Text>}
          {d.budgets.map((b) => (
            <Card key={b.id}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontWeight: '700', color: colors.text, flexShrink: 1 }}>
                  {b.scope} · {b.category.toLowerCase().replace(/_/g, ' ')}
                </Text>
                <Badge
                  text={b.status === 'OVER' ? 'over budget' : 'at risk'}
                  tone={b.status === 'OVER' ? 'danger' : 'warn'}
                />
              </View>
              <Text style={s.muted}>
                {money(b.actual)} of {money(b.budget)} {d.currency} ({b.usedPct} %) · forecast{' '}
                {money(b.forecast)}
              </Text>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
