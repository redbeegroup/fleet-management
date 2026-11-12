import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DriverSession, login, restore, signOut } from './src/api';

/**
 * Driver app — Phase 1 skeleton.
 * Sprint 6: assigned trips, trip start/end with GPS + odometer, push notifications.
 * Phase 2: inspections, fuel receipts, repair requests, proof of delivery, offline queue (SQLite).
 */
export default function App() {
  const [session, setSession] = useState<DriverSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    restore().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  if (loading) return <ActivityIndicator style={styles.center} />;
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      {session ? (
        <TripsScreen session={session} onSignOut={async () => (await signOut(), setSession(null))} />
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
  return (
    <View style={styles.form}>
      <Text style={styles.title}>FMS Driver</Text>
      <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.button}
        onPress={() => login(email, password).then(onLogin, (e: Error) => setError(e.message))}
      >
        <Text style={styles.buttonText}>Sign in</Text>
      </Pressable>
    </View>
  );
}

function TripsScreen({ session, onSignOut }: { session: DriverSession; onSignOut: () => void }) {
  return (
    <View style={styles.form}>
      <Text style={styles.title}>Hello, {session.user.fullName}</Text>
      <Text style={styles.muted}>My trips will appear here once the dispatch module ships (Sprint 4–6).</Text>
      <Pressable style={[styles.button, styles.secondary]} onPress={onSignOut}>
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9' },
  center: { flex: 1 },
  form: { padding: 24, gap: 12, marginTop: 48 },
  title: { fontSize: 24, fontWeight: '700', color: '#1b2430' },
  muted: { color: '#6b7686' },
  input: { backgroundColor: '#fff', borderColor: '#e2e6ec', borderWidth: 1, borderRadius: 8, padding: 12 },
  error: { color: '#b42318' },
  button: { backgroundColor: '#1f5fbf', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1f5fbf' },
  secondaryText: { color: '#1f5fbf', fontWeight: '600' },
});
