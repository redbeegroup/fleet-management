import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Text } from 'react-native';
import { api, RepairRequest, uploadPhoto } from '../api';
import { Badge, Button, Card, Chips, Field, s, when } from '../ui';
import type { MyVehicle } from './FuelScreen';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export function ReportScreen({ vehicles }: { vehicles: MyVehicle[] }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<RepairRequest[]>([]);

  const load = useCallback(async () => {
    setMine(await api<RepairRequest[]>('/me/repair-requests').catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera permission is needed');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) setPhoto(r.assets[0].uri);
  }

  async function submit() {
    if (!vehicleId || description.trim().length < 5) return Alert.alert('Choose the vehicle and describe the problem (at least 5 characters)');
    setBusy(true);
    try {
      const photoFileId = photo ? await uploadPhoto(photo) : null;
      await api('/me/repair-requests', { method: 'POST', body: JSON.stringify({ vehicleId, description: description.trim(), severity, photoFileId }) });
      Alert.alert('Reported', 'The fleet team has been notified.');
      setDescription('');
      setPhoto(null);
      await load();
    } catch (e) {
      Alert.alert('Could not send', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {vehicles.length === 0 ? (
        <Text style={s.muted}>No vehicle is assigned to you.</Text>
      ) : (
        <>
          <Text style={s.label}>Vehicle</Text>
          <Chips value={vehicleId} onChange={setVehicleId} options={vehicles.map((v) => ({ value: v.id, label: v.plateNumber }))} />
          <Field label="What is wrong?" multiline numberOfLines={4} value={description} onChangeText={setDescription} style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]} />
          <Text style={s.label}>How serious?</Text>
          <Chips value={severity} onChange={setSeverity} options={SEVERITIES.map((v) => ({ value: v, label: v.toLowerCase() }))} />
          <Button title={photo ? 'Retake photo' : 'Add photo'} kind="secondary" onPress={takePhoto} />
          {photo && <Image source={{ uri: photo }} style={{ height: 160, borderRadius: 8 }} />}
          <Button title="Report problem" onPress={submit} busy={busy} />
        </>
      )}
      <Text style={[s.h2, { marginTop: 12 }]}>My reports</Text>
      {mine.length === 0 && <Text style={s.muted}>None yet.</Text>}
      {mine.map((r) => (
        <Card key={r.id}>
          <Text>{r.description}</Text>
          <Text style={s.muted}>
            {r.vehicle?.plateNumber} · {when(r.createdAt)}
          </Text>
          <Badge text={r.workOrder ? `${r.workOrder.woNo} ${r.workOrder.status.toLowerCase()}` : r.status.toLowerCase()} tone={r.status === 'REJECTED' ? 'danger' : r.workOrder ? 'info' : 'muted'} />
        </Card>
      ))}
    </ScrollView>
  );
}
