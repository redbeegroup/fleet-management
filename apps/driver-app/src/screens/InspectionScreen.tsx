import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { api, ChecklistTemplate, MyInspection, uploadPhoto } from '../api';
import { Badge, Button, Card, Chips, colors, Field, s, when } from '../ui';
import type { MyVehicle } from './FuelScreen';

const KIND: Record<string, string> = { PRE_TRIP: 'Pre-trip', POST_TRIP: 'Post-trip', PERIODIC: 'Periodic' };
const TONE = { PASS: 'ok', DEFECTS: 'warn', FAIL: 'danger' } as const;
type Answer = { ok: boolean; note: string; photo: string | null };

export function InspectionScreen({ vehicles }: { vehicles: MyVehicle[] }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [odometer, setOdometer] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyInspection[]>([]);

  const load = useCallback(async () => {
    setMine((await api<{ items: MyInspection[] }>('/me/inspections').catch(() => ({ items: [] }))).items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!vehicleId) return;
    void api<ChecklistTemplate[]>(`/me/inspection-templates?vehicleId=${vehicleId}`)
      .then((t) => {
        setTemplates(t);
        setTemplateId(t.find((x) => x.kind === 'PRE_TRIP')?.id ?? t[0]?.id ?? '');
        setAnswers({});
      })
      .catch(() => setTemplates([]));
  }, [vehicleId]);

  const template = templates.find((t) => t.id === templateId);
  const get = (key: string): Answer => answers[key] ?? { ok: true, note: '', photo: null };
  const set = (key: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [key]: { ...get(key), ...patch } }));

  async function photo(key: string) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera permission is needed');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) set(key, { photo: r.assets[0].uri });
  }

  async function submit() {
    if (!template) return;
    const missing = template.items.filter((i) => !get(i.key).ok && !get(i.key).note.trim() && !get(i.key).photo);
    if (missing.length) return Alert.alert('Describe each defect', missing.map((i) => i.label).join('\n'));
    setBusy(true);
    try {
      const list = [];
      for (const i of template.items) {
        const a = get(i.key);
        list.push({ key: i.key, ok: a.ok, note: a.ok ? null : a.note.trim() || null, photoFileId: !a.ok && a.photo ? await uploadPhoto(a.photo) : null });
      }
      const res = await api<MyInspection>('/me/inspections', {
        method: 'POST',
        body: JSON.stringify({ vehicleId, templateId, answers: list, odometerKm: odometer ? Number(odometer) : null }),
      });
      Alert.alert(
        res.result === 'FAIL' ? 'Inspection FAILED' : res.result === 'DEFECTS' ? 'Saved with defects' : 'All good',
        res.result === 'FAIL'
          ? 'A critical item failed. Do not drive this vehicle; the fleet team has been notified.'
          : res.result === 'DEFECTS'
            ? 'A repair request was sent to the fleet team.'
            : `${res.inspectionNo} saved.`,
      );
      setAnswers({});
      setOdometer('');
      await load();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
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
          {templates.length > 1 && (
            <>
              <Text style={s.label}>Checklist</Text>
              <Chips value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: `${KIND[t.kind]} · ${t.name}` }))} />
            </>
          )}
          {template?.items.map((i) => {
            const a = get(i.key);
            return (
              <Card key={i.key}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={{ flexShrink: 1, color: colors.text, fontWeight: i.critical ? '700' : '400' }}>
                    {i.label}
                    {i.critical ? ' *' : ''}
                  </Text>
                  <View style={s.row}>
                    <Pressable onPress={() => set(i.key, { ok: true })} style={[s.chip, a.ok && { backgroundColor: colors.ok, borderColor: colors.ok }]} accessibilityState={{ selected: a.ok }}>
                      <Text style={{ color: a.ok ? '#fff' : colors.text }}>OK</Text>
                    </Pressable>
                    <Pressable onPress={() => set(i.key, { ok: false })} style={[s.chip, !a.ok && { backgroundColor: colors.danger, borderColor: colors.danger }]} accessibilityState={{ selected: !a.ok }}>
                      <Text style={{ color: !a.ok ? '#fff' : colors.text }}>Defect</Text>
                    </Pressable>
                  </View>
                </View>
                {!a.ok && (
                  <>
                    <Field label="What is wrong?" value={a.note} onChangeText={(t) => set(i.key, { note: t })} />
                    <Button title={a.photo ? 'Retake photo' : 'Add photo'} kind="secondary" onPress={() => photo(i.key)} />
                    {a.photo && <Image source={{ uri: a.photo }} style={{ height: 120, borderRadius: 8 }} />}
                  </>
                )}
              </Card>
            );
          })}
          {template && (
            <>
              <Text style={s.muted}>* critical — a defect here means the vehicle must not be driven.</Text>
              <Field label="Odometer (km)" keyboardType="numeric" value={odometer} onChangeText={setOdometer} />
              <Button title="Submit inspection" onPress={submit} busy={busy} />
            </>
          )}
        </>
      )}
      <Text style={[s.h2, { marginTop: 12 }]}>My inspections</Text>
      {mine.length === 0 && <Text style={s.muted}>None yet.</Text>}
      {mine.map((m) => (
        <Card key={m.id}>
          <Text style={{ fontWeight: '600' }}>
            {m.inspectionNo} · {KIND[m.kind] ?? m.kind}
          </Text>
          <Text style={s.muted}>
            {m.vehicle.plateNumber} · {when(m.performedAt)}
          </Text>
          <Badge text={m.result === 'PASS' ? 'passed' : m.result === 'FAIL' ? 'failed' : `${m.defects} defect(s)`} tone={TONE[m.result]} />
        </Card>
      ))}
    </ScrollView>
  );
}
