import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, ScrollView, Switch, Text, View } from 'react-native';
import { api, uploadPhoto } from '../api';
import { Button, Chips, Field, s } from '../ui';

export interface MyVehicle {
  id: string;
  plateNumber: string;
}

export function FuelScreen({ vehicles }: { vehicles: MyVehicle[] }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [odometer, setOdometer] = useState('');
  const [litres, setLitres] = useState('');
  const [total, setTotal] = useState('');
  const [station, setStation] = useState('');
  const [fullTank, setFullTank] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera permission is needed to photograph the receipt');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) setPhoto(r.assets[0].uri);
  }

  async function submit() {
    if (!vehicleId || !odometer || !litres || !total) return Alert.alert('Please fill vehicle, odometer, litres and total cost');
    setBusy(true);
    try {
      const receiptFileId = photo ? await uploadPhoto(photo) : null;
      const rec = await api<{ kmPerLitre: string | null; flags: string[] }>('/me/fuel', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId,
          filledAt: new Date().toISOString(),
          odometerKm: Number(odometer),
          litres: Number(litres),
          totalCost: Number(total),
          station: station || null,
          fullTank,
          receiptFileId,
        }),
      });
      Alert.alert(
        'Fuel recorded',
        [rec.kmPerLitre ? `Efficiency since last full tank: ${Number(rec.kmPerLitre)} km/L` : null, rec.flags.length ? `Please check: ${rec.flags.join(', ')}` : null]
          .filter(Boolean)
          .join('\n') || 'Thank you.',
      );
      setOdometer('');
      setLitres('');
      setTotal('');
      setStation('');
      setPhoto(null);
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!vehicles.length) {
    return (
      <View style={s.screen}>
        <Text style={s.muted}>No vehicle is assigned to you, so fuel cannot be recorded from the app.</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Vehicle</Text>
      <Chips value={vehicleId} onChange={setVehicleId} options={vehicles.map((v) => ({ value: v.id, label: v.plateNumber }))} />
      <Field label="Odometer (km)" keyboardType="numeric" value={odometer} onChangeText={setOdometer} />
      <Field label="Litres" keyboardType="decimal-pad" value={litres} onChangeText={setLitres} />
      <Field label="Total cost" keyboardType="numeric" value={total} onChangeText={setTotal} />
      <Field label="Station (optional)" value={station} onChangeText={setStation} />
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.label}>Filled to full</Text>
        <Switch value={fullTank} onValueChange={setFullTank} />
      </View>
      <Button title={photo ? 'Retake receipt photo' : 'Photograph receipt'} kind="secondary" onPress={takePhoto} />
      {photo && <Image source={{ uri: photo }} style={{ height: 160, borderRadius: 8 }} resizeMode="cover" />}
      <Button title="Save fuel record" onPress={submit} busy={busy} />
    </ScrollView>
  );
}
