import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Switch, Text, View } from 'react-native';
import { api, MyIncident, MySafety, uploadPhoto } from '../api';
import { Badge, Button, Card, Chips, colors, Field, s, when } from '../ui';
import type { MyVehicle } from './FuelScreen';

const TYPES = ['COLLISION', 'DAMAGE', 'THEFT', 'INJURY', 'NEAR_MISS', 'OTHER'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const EVENT: Record<string, string> = { OVERSPEED: 'Overspeed', HARSH_BRAKE: 'Harsh braking', HARSH_ACCEL: 'Harsh acceleration', HARSH_CORNER: 'Harsh cornering', IDLE: 'Idling' };
const BAND = { GOOD: 'ok', FAIR: 'warn', POOR: 'danger', INSUFFICIENT_DATA: 'muted' } as const;
const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

export function SafetyScreen({ vehicles }: { vehicles: MyVehicle[] }) {
  const [score, setScore] = useState<MySafety | null>(null);
  const [mine, setMine] = useState<MyIncident[]>([]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [type, setType] = useState<(typeof TYPES)[number]>('COLLISION');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [thirdParty, setThirdParty] = useState('');
  const [injuries, setInjuries] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sc, inc] = await Promise.all([api<MySafety>('/me/safety').catch(() => null), api<{ items: MyIncident[] }>('/me/incidents').catch(() => ({ items: [] }))]);
    setScore(sc);
    setMine(inc.items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function addPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera permission is needed');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) setPhotos((p) => [...p, r.assets[0].uri].slice(0, 6));
  }

  async function submit() {
    if (description.trim().length < 5) return Alert.alert('Describe what happened (at least 5 characters)');
    setBusy(true);
    try {
      const photoFileIds: string[] = [];
      for (const p of photos) photoFileIds.push(await uploadPhoto(p));
      await api('/me/incidents', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: vehicleId || null,
          type,
          severity,
          injuries,
          occurredAt: new Date().toISOString(),
          description: description.trim(),
          location: location.trim() || null,
          thirdParty: thirdParty.trim() || null,
          photoFileIds,
        }),
      });
      Alert.alert('Reported', 'The fleet team has been notified.');
      setDescription('');
      setLocation('');
      setThirdParty('');
      setInjuries(false);
      setPhotos([]);
      await load();
    } catch (e) {
      Alert.alert('Could not send', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>My safety score · 30 days</Text>
      <Card>
        {score ? (
          <>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={{ fontSize: 36, fontWeight: '700', color: colors.text }}>{score.score ?? '—'}</Text>
              <Badge text={score.band === 'INSUFFICIENT_DATA' ? 'not enough driving yet' : label(score.band)} tone={BAND[score.band]} />
            </View>
            <Text style={s.muted}>
              {score.distanceKm} km · {score.overspeed} overspeed · {score.harshBrake} harsh braking · {score.harshAccel} harsh acceleration · {score.harshCorner} harsh cornering
            </Text>
            {score.recentEvents.slice(0, 5).map((e) => (
              <Text key={e.id} style={s.muted}>
                {when(e.occurredAt)} — {EVENT[e.type] ?? e.type}
                {e.speedKmh != null ? ` at ${Math.round(e.speedKmh)} km/h` : ''}
              </Text>
            ))}
          </>
        ) : (
          <Text style={s.muted}>No score yet.</Text>
        )}
      </Card>

      <Text style={[s.h2, { marginTop: 12 }]}>Report an incident</Text>
      {vehicles.length > 0 && (
        <>
          <Text style={s.label}>Vehicle</Text>
          <Chips value={vehicleId} onChange={setVehicleId} options={vehicles.map((v) => ({ value: v.id, label: v.plateNumber }))} />
        </>
      )}
      <Text style={s.label}>What kind?</Text>
      <Chips value={type} onChange={setType} options={TYPES.map((v) => ({ value: v, label: label(v) }))} />
      <Text style={s.label}>How serious?</Text>
      <Chips value={severity} onChange={setSeverity} options={SEVERITIES.map((v) => ({ value: v, label: v.toLowerCase() }))} />
      <Field label="What happened?" multiline numberOfLines={4} value={description} onChangeText={setDescription} style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]} />
      <Field label="Where?" value={location} onChangeText={setLocation} placeholder="Road, township" />
      <Field label="Other vehicles / people involved" value={thirdParty} onChangeText={setThirdParty} placeholder="Plate numbers, names, phone" />
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.label}>Someone was injured</Text>
        <Switch value={injuries} onValueChange={setInjuries} />
      </View>
      <Button title={photos.length ? `Add another photo (${photos.length})` : 'Add photo'} kind="secondary" onPress={addPhoto} />
      {photos.length > 0 && (
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {photos.map((p) => (
            <Image key={p} source={{ uri: p }} style={{ width: 96, height: 96, borderRadius: 8 }} />
          ))}
        </View>
      )}
      <Button title="Send incident report" kind="danger" onPress={submit} busy={busy} />

      <Text style={[s.h2, { marginTop: 12 }]}>My incident reports</Text>
      {mine.length === 0 && <Text style={s.muted}>None.</Text>}
      {mine.map((i) => (
        <Card key={i.id}>
          <Text style={{ fontWeight: '600' }}>
            {i.incidentNo} · {label(i.type)}
          </Text>
          <Text>{i.description}</Text>
          <Text style={s.muted}>
            {i.vehicle?.plateNumber ?? '—'} · {when(i.occurredAt)}
          </Text>
          <Badge text={i.status.toLowerCase()} tone={i.status === 'CLOSED' ? 'ok' : i.status === 'INVESTIGATING' ? 'info' : 'warn'} />
        </Card>
      ))}
    </ScrollView>
  );
}
