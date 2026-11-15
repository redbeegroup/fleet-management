import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, Stop, Trip, TripStops, uploadPhoto } from '../api';
import { SignaturePad, Strokes } from '../SignaturePad';
import { Badge, Button, Card, Chips, colors, Field, s } from '../ui';

const TONE = {
  PENDING: 'muted',
  ARRIVED: 'info',
  DELIVERED: 'ok',
  PARTIAL: 'warn',
  FAILED: 'danger',
} as const;
const money = (n: number) => n.toLocaleString('en-US');
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const RETURN_REASONS = ['Damaged', 'Expired', 'Wrong item', 'Unsold', 'Empty containers'];

/** Current position for the proof of delivery; null when denied or unavailable (the stop gets a NO_GPS flag). */
async function position(): Promise<{
  latitude: number;
  longitude: number;
  accuracyM: number | null;
} | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    return pick(p ?? (await Location.getLastKnownPositionAsync({ maxAge: 120_000 })));
  } catch {
    return null;
  }
}
function pick(p: Location.LocationObject | null) {
  return p
    ? {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracyM: p.coords.accuracy != null ? Math.round(p.coords.accuracy) : null,
      }
    : null;
}

/** Stop-by-stop delivery for one trip. */
export function StopsScreen({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  const [data, setData] = useState<TripStops | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'DELIVERED' | 'PARTIAL' | 'FAILED'>('none');
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [strokes, setStrokes] = useState<Strokes>([]);
  const [signedBy, setSignedBy] = useState('');
  const [cash, setCash] = useState('');
  const [ret, setRet] = useState<{
    sku: string;
    qty: string;
    reason: string;
    photo: { id: string; uri: string } | null;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<TripStops>(`/me/trips/${trip.id}/stops`));
    } catch (e) {
      Alert.alert('Could not load stops', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [trip.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const done =
    data?.stops.filter((x) => ['DELIVERED', 'PARTIAL', 'FAILED'].includes(x.status)).length ?? 0;
  const ongoing = data?.status === 'ONGOING';

  function reset() {
    setMode('none');
    setReason('');
    setNotes('');
    setQty({});
    setPhotos([]);
    setStrokes([]);
    setSignedBy('');
    setCash('');
    setRet(null);
  }

  async function takePhoto(): Promise<{ id: string; uri: string } | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission is needed for the proof of delivery');
      return null;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (r.canceled || !r.assets[0]) return null;
    setBusy(true);
    try {
      return { id: await uploadPhoto(r.assets[0].uri), uri: r.assets[0].uri };
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Proof-of-delivery fields for a DELIVERED/PARTIAL stop, or null (with an alert) when something required is missing. */
  function proof(stop: Stop) {
    const rules = data!.podSettings;
    const codExpected = stop.pod.codExpected ?? 0;
    if (rules.requirePhoto && photos.length === 0)
      return (Alert.alert('Take at least one photo of the delivered goods'), null);
    if (strokes.length > 0 && !signedBy.trim())
      return (Alert.alert('Enter the name of the person who signed'), null);
    if (rules.requireSignature && strokes.length === 0)
      return (Alert.alert('The customer must sign'), null);
    if (rules.requireCodEntry && codExpected > 0 && cash === '')
      return (Alert.alert('Enter the cash collected'), null);
    return {
      photoFileIds: photos.map((p) => p.id),
      signature: strokes.length ? { name: signedBy.trim(), strokes } : null,
      codCollected: cash === '' ? null : Number(cash),
    };
  }

  async function saveReturn(stop: Stop) {
    if (!ret) return;
    if (!ret.sku.trim() || !(Number(ret.qty) > 0) || !ret.reason)
      return Alert.alert('Enter item, quantity and reason');
    setBusy(true);
    try {
      await api(`/me/trips/${trip.id}/stops/${stop.id}/returns`, {
        method: 'POST',
        body: JSON.stringify({
          sku: ret.sku.trim(),
          quantity: Number(ret.qty),
          reason: ret.reason,
          photoFileId: ret.photo?.id ?? null,
        }),
      });
      setRet(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save the return', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function post(stop: Stop, path: 'arrive' | 'complete', body?: Record<string, unknown>) {
    setBusy(true);
    try {
      if (path === 'complete') {
        const gps = await position();
        body = {
          ...body,
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
          accuracyM: gps?.accuracyM ?? null,
        };
      }
      await api(`/me/trips/${trip.id}/stops/${stop.id}/${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      reset();
      if (path === 'complete') setOpen(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitPartial(stop: Stop) {
    const deliveredLines = stop.orders.flatMap((o) =>
      o.lines
        .filter(
          (l) => qty[`${o.id}:${l.lineNo}`] !== undefined && qty[`${o.id}:${l.lineNo}`] !== '',
        )
        .map((l) => ({
          orderId: o.id,
          lineNo: l.lineNo,
          quantity: Number(qty[`${o.id}:${l.lineNo}`]),
        })),
    );
    if (!deliveredLines.length)
      return Alert.alert('Enter the delivered quantity for the short lines');
    const pod = proof(stop);
    if (!pod) return;
    void post(stop, 'complete', {
      ...pod,
      outcome: 'PARTIAL',
      reason: reason || null,
      notes: notes || null,
      deliveredLines,
    });
  }

  return (
    <ScrollView
      contentContainerStyle={s.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={{ color: colors.primary }}>‹ Back to trips</Text>
      </Pressable>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.h2}>{trip.tripNo}</Text>
        <Badge
          text={`${done}/${data?.stops.length ?? 0} stops`}
          tone={data && done === data.stops.length ? 'ok' : 'info'}
        />
      </View>
      {data && <Text style={s.muted}>Cash to collect (COD): {money(data.cod)}</Text>}
      {!ongoing && data && <Text style={s.muted}>Start the trip to record deliveries.</Text>}
      {data?.stops.map((st) => {
        const expanded = open === st.id;
        const cod = st.orders.reduce((a, o) => a + (o.codAmount ?? 0), 0);
        const resolved = ['DELIVERED', 'PARTIAL', 'FAILED'].includes(st.status);
        return (
          <Card key={st.id}>
            <Pressable onPress={() => (setOpen(expanded ? null : st.id), reset())}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontWeight: '700', flexShrink: 1, color: colors.text }}>
                  {st.seq}. {st.name}
                </Text>
                <Badge text={st.status.toLowerCase()} tone={TONE[st.status]} />
              </View>
              {st.address && <Text style={s.muted}>{st.address}</Text>}
              {st.plannedArrival && !resolved && (
                <Text style={s.muted}>ETA {time(st.plannedArrival)}</Text>
              )}
              <Text style={s.muted}>
                {st.orders.length} order(s){cod ? ` · COD ${money(cod)}` : ''}
                {st.failureReason ? ` · ${st.failureReason}` : ''}
              </Text>
            </Pressable>
            {expanded && (
              <>
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  {st.contactPhone && (
                    <Button
                      title={`Call ${st.contactName ?? ''}`.trim()}
                      kind="secondary"
                      onPress={() => void Linking.openURL(`tel:${st.contactPhone}`)}
                    />
                  )}
                  {st.latitude != null && st.longitude != null && (
                    <Button
                      title="Navigate"
                      kind="secondary"
                      onPress={() =>
                        void Linking.openURL(
                          `https://www.google.com/maps/dir/?api=1&destination=${st.latitude},${st.longitude}`,
                        )
                      }
                    />
                  )}
                </View>
                {st.orders.map((o) => (
                  <View key={o.id} style={{ marginTop: 6 }}>
                    <Text style={{ fontWeight: '600' }}>{o.externalRef}</Text>
                    {o.notes && <Text style={s.muted}>{o.notes}</Text>}
                    {o.lines.map((l) => (
                      <View key={l.lineNo} style={[s.row, { justifyContent: 'space-between' }]}>
                        <Text style={{ flexShrink: 1 }}>
                          {l.sku} {l.description ?? ''} — {l.quantity} {l.uom}
                          {l.deliveredQty != null && l.deliveredQty !== l.quantity
                            ? ` (delivered ${l.deliveredQty})`
                            : ''}
                        </Text>
                        {mode === 'PARTIAL' && (
                          <TextInput
                            style={[s.input, { width: 80 }]}
                            keyboardType="numeric"
                            placeholder={String(l.quantity)}
                            value={qty[`${o.id}:${l.lineNo}`] ?? ''}
                            onChangeText={(v) =>
                              setQty((q) => ({
                                ...q,
                                [`${o.id}:${l.lineNo}`]: v.replace(/[^\d.]/g, ''),
                              }))
                            }
                            accessibilityLabel={`Delivered ${l.sku}`}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                ))}
                {ongoing && !resolved && (
                  <>
                    {st.status === 'PENDING' && (
                      <Button
                        title="Arrived"
                        kind="secondary"
                        busy={busy}
                        onPress={() => void post(st, 'arrive')}
                      />
                    )}
                    {mode === 'none' && (
                      <View style={[s.row, { flexWrap: 'wrap' }]}>
                        <Button
                          title="Delivered"
                          busy={busy}
                          onPress={() => setMode('DELIVERED')}
                        />
                        <Button
                          title="Partly delivered"
                          kind="secondary"
                          onPress={() => setMode('PARTIAL')}
                        />
                        <Button title="Failed" kind="danger" onPress={() => setMode('FAILED')} />
                      </View>
                    )}
                    {mode !== 'none' && (
                      <>
                        {mode !== 'FAILED' && (
                          <>
                            <Text style={s.label}>
                              Photos{data?.podSettings.requirePhoto ? ' (required)' : ''}
                            </Text>
                            <View style={[s.row, { flexWrap: 'wrap' }]}>
                              {photos.map((p) => (
                                <Pressable
                                  key={p.id}
                                  onLongPress={() =>
                                    setPhotos((x) => x.filter((y) => y.id !== p.id))
                                  }
                                  accessibilityLabel="Photo, long-press to remove"
                                >
                                  <Image
                                    source={{ uri: p.uri }}
                                    style={{ width: 64, height: 64, borderRadius: 6 }}
                                  />
                                </Pressable>
                              ))}
                              {photos.length < 10 && (
                                <Button
                                  title={photos.length ? 'Add photo' : 'Take photo'}
                                  kind="secondary"
                                  busy={busy}
                                  onPress={() =>
                                    void takePhoto().then((p) => p && setPhotos((x) => [...x, p]))
                                  }
                                />
                              )}
                            </View>
                            {(st.pod.codExpected ?? 0) > 0 && (
                              <Field
                                label={`Cash collected (expected ${money(st.pod.codExpected ?? 0)})`}
                                keyboardType="numeric"
                                value={cash}
                                placeholder={String(st.pod.codExpected)}
                                onChangeText={(v) => setCash(v.replace(/[^\d.]/g, ''))}
                              />
                            )}
                            <Text style={s.label}>
                              Signature
                              {data?.podSettings.requireSignature ? ' (required)' : ' (optional)'}
                            </Text>
                            <SignaturePad value={strokes} onChange={setStrokes} />
                            {strokes.length > 0 && (
                              <Field
                                label="Signed by"
                                value={signedBy}
                                onChangeText={setSignedBy}
                              />
                            )}
                          </>
                        )}
                        {mode !== 'DELIVERED' && (
                          <Text style={s.label}>
                            {mode === 'FAILED' ? 'Why could you not deliver?' : 'Reason (optional)'}
                          </Text>
                        )}
                        {mode !== 'DELIVERED' && (
                          <Chips
                            value={reason}
                            onChange={setReason}
                            options={(data?.failureReasons ?? []).map((r) => ({
                              value: r,
                              label: r,
                            }))}
                          />
                        )}
                        <Field label="Notes" value={notes} onChangeText={setNotes} />
                        {mode === 'PARTIAL' && (
                          <Text style={s.muted}>
                            Enter the delivered quantity only for lines that were short.
                          </Text>
                        )}
                        <View style={[s.row, { flexWrap: 'wrap' }]}>
                          <Button
                            title={
                              mode === 'FAILED'
                                ? 'Confirm failed'
                                : mode === 'DELIVERED'
                                  ? 'Confirm delivered'
                                  : 'Confirm partial'
                            }
                            kind={mode === 'FAILED' ? 'danger' : 'primary'}
                            busy={busy}
                            onPress={() =>
                              mode === 'DELIVERED'
                                ? (() => {
                                    const pod = proof(st);
                                    if (pod)
                                      void post(st, 'complete', {
                                        ...pod,
                                        outcome: 'DELIVERED',
                                        notes: notes || null,
                                      });
                                  })()
                                : mode === 'FAILED'
                                  ? reason
                                    ? void post(st, 'complete', {
                                        outcome: 'FAILED',
                                        reason,
                                        notes: notes || null,
                                      })
                                    : Alert.alert('Choose a reason')
                                  : submitPartial(st)
                            }
                          />
                          <Button title="Cancel" kind="secondary" onPress={reset} />
                        </View>
                      </>
                    )}
                  </>
                )}
                {st.returns.length > 0 && (
                  <Text style={s.muted}>
                    Returns collected:{' '}
                    {st.returns.map((r) => `${r.sku} ×${r.quantity} (${r.reason})`).join('; ')}
                  </Text>
                )}
                {ongoing && mode === 'none' && !ret && (
                  <Button
                    title="Collect customer return"
                    kind="secondary"
                    onPress={() => setRet({ sku: '', qty: '', reason: '', photo: null })}
                  />
                )}
                {ongoing && ret && (
                  <>
                    <Text style={s.label}>Customer return / pick-up</Text>
                    <Field
                      label="Item (SKU or name)"
                      value={ret.sku}
                      onChangeText={(v) => setRet({ ...ret, sku: v })}
                    />
                    <Field
                      label="Quantity"
                      keyboardType="numeric"
                      value={ret.qty}
                      onChangeText={(v) => setRet({ ...ret, qty: v.replace(/[^\d.]/g, '') })}
                    />
                    <Chips
                      value={ret.reason}
                      onChange={(v) => setRet({ ...ret, reason: v })}
                      options={RETURN_REASONS.map((r) => ({ value: r, label: r }))}
                    />
                    <View style={[s.row, { flexWrap: 'wrap' }]}>
                      <Button
                        title={ret.photo ? 'Photo added ✓' : 'Add photo'}
                        kind="secondary"
                        busy={busy}
                        onPress={() =>
                          void takePhoto().then(
                            (p) => p && setRet((r) => (r ? { ...r, photo: p } : r)),
                          )
                        }
                      />
                      <Button title="Save return" busy={busy} onPress={() => void saveReturn(st)} />
                      <Button title="Cancel" kind="secondary" onPress={() => setRet(null)} />
                    </View>
                  </>
                )}
              </>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
