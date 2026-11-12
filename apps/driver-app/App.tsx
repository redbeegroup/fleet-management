import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { api, DriverSession, login, Me, restore, setSignedOutHandler, signOut, Trip } from './src/api';
import { registerForPush } from './src/push';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { FuelScreen, MyVehicle } from './src/screens/FuelScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SafetyScreen } from './src/screens/SafetyScreen';
import { InspectionScreen } from './src/screens/InspectionScreen';
import { TripsScreen } from './src/screens/TripsScreen';
import { Button, colors, Field, s } from './src/ui';

/**
 * FMS driver app: assigned trips (start / complete), on/off duty, fuel receipts,
 * problem reports with photos, and notifications (push via Expo).
 * Phase 2: inspections, proof of delivery, offline queue.
 */
export default function App() {
  const [session, setSession] = useState<DriverSession | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setSignedOutHandler(() => setSession(null));
    restore().then((s) => {
      setSession(s);
      setBooting(false);
    });
  }, []);

  if (booting) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      {session ? <Main session={session} onSignOut={async () => (await signOut(), setSession(null))} /> : <LoginScreen onLogin={setSession} />}
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (s: DriverSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView contentContainerStyle={[s.screen, { marginTop: 48 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>FMS Driver</Text>
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
      <Field label="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
      {error && <Text style={s.error}>{error}</Text>}
      <Button
        title="Sign in"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            onLogin(await login(email, password));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </ScrollView>
  );
}

type Tab = 'trips' | 'check' | 'fuel' | 'report' | 'safety' | 'alerts';

function Main({ session, onSignOut }: { session: DriverSession; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('trips');
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [unread, setUnread] = useState(0);
  const [dutyBusy, setDutyBusy] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const [profile, trips, count] = await Promise.all([
        api<Me>('/me/driver'),
        api<Trip[]>('/me/trips?scope=active'),
        api<{ count: number }>('/notifications/unread-count'),
      ]);
      setMe(profile);
      setUnread(count.count);
      const vs = new Map<string, MyVehicle>();
      profile.driver.assignments.forEach((a) => vs.set(a.vehicle.id, a.vehicle));
      trips.forEach((t) => t.vehicle && vs.set(t.vehicle.id, t.vehicle));
      setVehicles([...vs.values()]);
    } catch (e) {
      Alert.alert('Could not load your profile', (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void registerForPush();
  }, [loadMe]);

  async function toggleDuty() {
    setDutyBusy(true);
    try {
      await api(me?.onDuty ? '/me/duty/end' : '/me/duty/start', { method: 'POST' });
      await loadMe();
    } catch (e) {
      Alert.alert('Duty', (e as Error).message);
    } finally {
      setDutyBusy(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'trips', label: 'Trips' },
    { key: 'check', label: 'Check' },
    { key: 'fuel', label: 'Fuel' },
    { key: 'report', label: 'Repair' },
    { key: 'safety', label: 'Safety' },
    { key: 'alerts', label: unread ? `Alerts (${unread})` : 'Alerts' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.row, { padding: 16, paddingBottom: 8, justifyContent: 'space-between' }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.h2}>{session.user.fullName}</Text>
          <Text style={s.muted}>{me?.onDuty ? `On duty since ${new Date(me.onDuty.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Off duty'}</Text>
        </View>
        <View style={[s.row]}>
          <Button title={me?.onDuty ? 'Go off duty' : 'Go on duty'} kind={me?.onDuty ? 'secondary' : 'primary'} busy={dutyBusy} onPress={toggleDuty} />
          <Pressable onPress={onSignOut} accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: colors.muted }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'trips' && <TripsScreen />}
        {tab === 'check' && <InspectionScreen vehicles={vehicles} />}
        {tab === 'fuel' && <FuelScreen vehicles={vehicles} />}
        {tab === 'report' && <ReportScreen vehicles={vehicles} />}
        {tab === 'safety' && <SafetyScreen vehicles={vehicles} />}
        {tab === 'alerts' && <AlertsScreen onRead={() => setUnread(0)} />}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border, backgroundColor: '#fff' }}>
        {tabs.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: tab === t.key ? colors.primary : colors.muted, fontWeight: tab === t.key ? '700' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
