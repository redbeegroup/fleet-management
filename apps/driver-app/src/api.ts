import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:8080/api';

export interface DriverSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string; roles: string[] };
}

export async function login(email: string, password: string): Promise<DriverSession> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Invalid email or password' : `Login failed (${res.status})`);
  const session = (await res.json()) as DriverSession;
  await SecureStore.setItemAsync('session', JSON.stringify(session));
  return session;
}

export async function restore(): Promise<DriverSession | null> {
  const raw = await SecureStore.getItemAsync('session');
  return raw ? (JSON.parse(raw) as DriverSession) : null;
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync('session');
}
