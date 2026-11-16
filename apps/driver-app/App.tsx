import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  api,
  DriverSession,
  isDriver,
  isManager,
  login,
  requestPasswordReset,
  ssoExchange,
  ssoOptions,
  ssoStartUrl,
  Me,
  restore,
  setSignedOutHandler,
  signOut,
  Trip,
} from './src/api';
import { cachedGet, clearAll, items as outboxItems, startOutbox, submit } from './src/outbox';
import { registerForPush } from './src/push';
import { ApprovalsScreen, FleetScreen } from './src/screens/ManagerScreens';
import { PendingBar, PendingScreen } from './src/screens/PendingScreen';
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
      {session ? (
        <Shell
          session={session}
          onSignOut={() => {
            const n = outboxItems().length;
            const out = async () => {
              await signOut();
              clearAll();
              setSession(null);
            };
            if (!n) return void out();
            Alert.alert(
              'Sign out?',
              `${n} action(s) on this phone have not been sent yet and will be lost.`,
              [
                { text: 'Stay signed in', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void out() },
              ],
            );
          }}
        />
      ) : (
        <LoginScreen onLogin={setSession} />
      )}
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (s: DriverSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [group, setGroup] = useState({ microsoft: false, google: false });
  const [sso, setSso] = useState<'microsoft' | 'google' | null>(null);
  useEffect(() => {
    ssoOptions().then((o) => setGroup({ microsoft: o.microsoft, google: o.google }), () => undefined);
  }, []);
  const PROVIDER = { microsoft: 'Microsoft', google: 'Google' } as const;
  async function signInWith(provider: 'microsoft' | 'google') {
    setError(null);
    setBusy(true);
    try {
      const url = ssoStartUrl(sso && email.trim() ? { email } : { provider });
      const r = await WebBrowser.openAuthSessionAsync(url, 'fmsdriver://sso');
      if (r.type !== 'success') return;
      // React Native's URL has no full searchParams support: parse the query by hand.
      const q = Object.fromEntries(
        (r.url.split('?')[1] ?? '').split('&').filter(Boolean).map((kv) => {
          const [k, v = ''] = kv.split('=');
          return [decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' '))];
        }),
      );
      if (q.error) return setError(q.error);
      onLogin(await ssoExchange(q.code ?? ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={[s.screen, { marginTop: 48 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>FMS Driver</Text>
      <Field
        label="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        onEndEditing={() =>
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
            ? ssoOptions(email).then((o) => setSso(o.sso?.provider ?? null), () => undefined)
            : setSso(null)
        }
      />
      {sso && (
        <Button title={`Continue with ${PROVIDER[sso]}`} busy={busy} onPress={() => signInWith(sso)} />
      )}
      <Field
        label="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={s.error}>{error}</Text>}
      {info && <Text style={s.muted}>{info}</Text>}
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
      <Pressable
        accessibilityRole="button"
        style={{ alignSelf: 'center', padding: 8 }}
        onPress={async () => {
          if (!email.trim()) return setError('Enter your e-mail first');
          setError(null);
          try {
            await requestPasswordReset(email.trim());
            setInfo(
              'If this e-mail belongs to an account, a reset link has been sent. Open it on this phone, then sign in here.',
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Text style={{ color: colors.primary }}>Forgot your password?</Text>
      </Pressable>
      {!sso && group.microsoft && (
        <Button title="Sign in with Microsoft" busy={busy} onPress={() => signInWith('microsoft')} />
      )}
      {!sso && group.google && (
        <Button title="Sign in with Google" busy={busy} onPress={() => signInWith('google')} />
      )}
    </ScrollView>
  );
}

/** Drivers get the driver app, managers the approvals app; someone who is both can switch. */
function Shell({ session, onSignOut }: { session: DriverSession; onSignOut: () => void }) {
  const both = isDriver(session) && isManager(session);
  const [mode, setMode] = useState<'driver' | 'manager'>(isDriver(session) ? 'driver' : 'manager');
  const switcher = both ? () => setMode((m) => (m === 'driver' ? 'manager' : 'driver')) : undefined;
  useEffect(() => {
    startOutbox();
    void registerForPush().catch(() => undefined);
  }, []);
  return mode === 'driver' ? (
    <Main session={session} onSignOut={onSignOut} onSwitch={switcher} />
  ) : (
    <ManagerMain session={session} onSignOut={onSignOut} onSwitch={switcher} />
  );
}

type ManagerTab = 'fleet' | 'approvals' | 'alerts';

function ManagerMain({
  session,
  onSignOut,
  onSwitch,
}: {
  session: DriverSession;
  onSignOut: () => void;
  onSwitch?: () => void;
}) {
  const [tab, setTab] = useState<ManagerTab>('fleet');
  const [openApproval, setOpenApproval] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const opened = useCallback(() => setOpenApproval(null), []);

  // Tapping an "approval requested" push opens that request.
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const id = r?.notification.request.content.data?.approvalId as string | undefined;
      if (id) {
        setShowPending(false);
        setTab('approvals');
        setOpenApproval(id);
      }
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);

  const tabs: { key: ManagerTab; label: string }[] = [
    { key: 'fleet', label: 'Fleet' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'alerts', label: 'Alerts' },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={[s.row, { padding: 16, paddingBottom: 8, justifyContent: 'space-between' }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.h2}>{session.user.fullName}</Text>
          <Text style={s.muted}>Fleet manager</Text>
        </View>
        <View style={s.row}>
          {onSwitch && <Button title="Driver mode" kind="secondary" onPress={onSwitch} />}
          <Pressable onPress={onSignOut} accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: colors.muted }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <PendingBar onOpen={() => setShowPending(true)} />
      <View style={{ flex: 1 }}>
        {showPending ? (
          <PendingScreen onBack={() => setShowPending(false)} />
        ) : tab === 'fleet' ? (
          <FleetScreen onApprovals={() => setTab('approvals')} />
        ) : tab === 'approvals' ? (
          <ApprovalsScreen openId={openApproval} onOpened={opened} />
        ) : (
          <AlertsScreen onRead={() => undefined} />
        )}
      </View>
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderColor: colors.border,
          backgroundColor: '#fff',
        }}
      >
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => (setShowPending(false), setTab(t.key))}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text
              style={{
                color: tab === t.key ? colors.primary : colors.muted,
                fontWeight: tab === t.key ? '700' : '500',
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type Tab = 'trips' | 'check' | 'fuel' | 'report' | 'safety' | 'alerts';

function Main({
  session,
  onSignOut,
  onSwitch,
}: {
  session: DriverSession;
  onSignOut: () => void;
  onSwitch?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('trips');
  const [me, setMe] = useState<Me | null>(null);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [unread, setUnread] = useState(0);
  const [dutyBusy, setDutyBusy] = useState(false);
  const [showPending, setShowPending] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const [profile, trips, count] = await Promise.all([
        cachedGet<Me>('/me/driver').then((r) => r.data),
        cachedGet<Trip[]>('/me/trips?scope=active').then((r) => r.data),
        api<{ count: number }>('/notifications/unread-count').catch(() => ({ count: 0 })),
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
  }, [loadMe]);

  async function toggleDuty() {
    setDutyBusy(true);
    try {
      const going = !me?.onDuty;
      const r = await submit(
        going ? '/me/duty/start' : '/me/duty/end',
        { occurredAt: new Date().toISOString() },
        { label: going ? 'On duty' : 'Off duty' },
      );
      if (r.queued)
        setMe(
          (m) =>
            m && {
              ...m,
              onDuty: going ? { id: 'pending', startedAt: new Date().toISOString() } : null,
            },
        );
      else await loadMe();
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
          <Text style={s.muted}>
            {me?.onDuty
              ? `On duty since ${new Date(me.onDuty.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : 'Off duty'}
          </Text>
        </View>
        <View style={[s.row]}>
          {onSwitch && <Button title="Manager" kind="secondary" onPress={onSwitch} />}
          <Button
            title={me?.onDuty ? 'Go off duty' : 'Go on duty'}
            kind={me?.onDuty ? 'secondary' : 'primary'}
            busy={dutyBusy}
            onPress={toggleDuty}
          />
          <Pressable onPress={onSignOut} accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: colors.muted }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <PendingBar onOpen={() => setShowPending(true)} />
      {showPending ? (
        <View style={{ flex: 1 }}>
          <PendingScreen onBack={() => setShowPending(false)} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {tab === 'trips' && <TripsScreen />}
          {tab === 'check' && <InspectionScreen vehicles={vehicles} />}
          {tab === 'fuel' && <FuelScreen vehicles={vehicles} />}
          {tab === 'report' && <ReportScreen vehicles={vehicles} />}
          {tab === 'safety' && <SafetyScreen vehicles={vehicles} />}
          {tab === 'alerts' && <AlertsScreen onRead={() => setUnread(0)} />}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderColor: colors.border,
          backgroundColor: '#fff',
        }}
      >
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text
              style={{
                color: tab === t.key ? colors.primary : colors.muted,
                fontWeight: tab === t.key ? '700' : '500',
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
