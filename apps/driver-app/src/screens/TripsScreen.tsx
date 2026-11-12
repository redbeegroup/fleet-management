import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, Trip } from '../api';
import { Badge, Button, Card, Chips, Field, s, when } from '../ui';

const tone = { ASSIGNED: 'info', ONGOING: 'warn', COMPLETED: 'ok', CANCELLED: 'danger', PLANNED: 'muted' } as const;

export function TripsScreen() {
  const [scope, setScope] = useState<'active' | 'recent'>('active');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [odo, setOdo] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTrips(await api<Trip[]>(`/me/trips?scope=${scope}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(t: Trip, action: 'start' | 'complete') {
    setActing(t.id);
    try {
      const km = odo[t.id] ? Number(odo[t.id]) : undefined;
      await api(`/me/trips/${t.id}/${action}`, { method: 'POST', body: JSON.stringify(km !== undefined ? { odometerKm: km } : {}) });
      setOdo((o) => ({ ...o, [t.id]: '' }));
      await load();
    } catch (e) {
      Alert.alert(action === 'start' ? 'Cannot start trip' : 'Cannot complete trip', (e as Error).message);
    } finally {
      setActing(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Chips
        value={scope}
        onChange={setScope}
        options={[
          { value: 'active', label: 'My trips' },
          { value: 'recent', label: 'History' },
        ]}
      />
      {error && <Text style={s.error}>{error}</Text>}
      {!loading && trips.length === 0 && <Text style={s.muted}>{scope === 'active' ? 'No trips assigned to you right now.' : 'No finished trips yet.'}</Text>}
      {trips.map((t) => (
        <Card key={t.id}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={s.h2}>{t.tripNo}</Text>
            <Badge text={t.status.toLowerCase()} tone={tone[t.status]} />
          </View>
          <Text style={{ fontSize: 16 }}>
            {t.originName} → {t.destinationName}
          </Text>
          <Text style={s.muted}>
            Planned {when(t.plannedStart)} – {when(t.plannedEnd)}
          </Text>
          {t.vehicle && (
            <Text>
              Vehicle: <Text style={{ fontWeight: '700' }}>{t.vehicle.plateNumber}</Text> {t.vehicle.make} {t.vehicle.model}
            </Text>
          )}
          {t.cargoDescription && <Text style={s.muted}>Cargo: {t.cargoDescription}</Text>}
          {t.actualStart && <Text style={s.muted}>Started {when(t.actualStart)}</Text>}
          {t.actualEnd && (
            <Text style={s.muted}>
              Finished {when(t.actualEnd)}
              {t.gpsDistanceKm ? ` · ${Number(t.gpsDistanceKm)} km` : ''}
            </Text>
          )}
          {(t.status === 'ASSIGNED' || t.status === 'ONGOING') && (
            <>
              <Field
                label={`Odometer at ${t.status === 'ASSIGNED' ? 'start' : 'end'} (optional)`}
                keyboardType="numeric"
                value={odo[t.id] ?? ''}
                onChangeText={(v) => setOdo((o) => ({ ...o, [t.id]: v.replace(/[^\d.]/g, '') }))}
                placeholder={t.status === 'ASSIGNED' ? 'Uses vehicle odometer if empty' : 'Uses GPS distance if empty'}
              />
              <Button
                title={t.status === 'ASSIGNED' ? 'Start trip' : 'Complete trip'}
                busy={acting === t.id}
                onPress={() =>
                  t.status === 'ASSIGNED'
                    ? act(t, 'start')
                    : Alert.alert('Complete trip?', `${t.tripNo} to ${t.destinationName}`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Complete', onPress: () => act(t, 'complete') },
                      ])
                }
              />
            </>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
