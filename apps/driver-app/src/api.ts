import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:8080/api';

export interface DriverSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string; roles: string[] };
}

let session: DriverSession | null = null;
let onSignedOut: (() => void) | null = null;

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

async function save(s: DriverSession | null) {
  session = s;
  if (s) await SecureStore.setItemAsync('session', JSON.stringify(s));
  else await SecureStore.deleteItemAsync('session');
}

export async function restore(): Promise<DriverSession | null> {
  const raw = await SecureStore.getItemAsync('session');
  session = raw ? (JSON.parse(raw) as DriverSession) : null;
  return session;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[]; reasons?: string[]; errors?: { path: string; message: string }[] };
    if (body.reasons?.length) return body.reasons.join('\n');
    if (body.errors?.length) return body.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    return Array.isArray(body.message) ? body.message.join('\n') : body.message ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      await save((await res.json()) as DriverSession);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  if (res.status === 401) {
    await save(null);
    onSignedOut?.();
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function login(email: string, password: string): Promise<DriverSession> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'Invalid email or password' : await errorMessage(res));
  const s = (await res.json()) as DriverSession;
  if (!s.user.roles.includes('DRIVER')) throw new ApiError(403, 'This app is for drivers. Use the web console instead.');
  await save(s);
  return s;
}

export async function signOut(): Promise<void> {
  if (session) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
  }
  await save(null);
}

/** Uploads a photo (camera/gallery URI) and returns the file id. */
export async function uploadPhoto(uri: string): Promise<string> {
  const body = new FormData();
  const name = uri.split('/').pop() ?? 'photo.jpg';
  // React Native's FormData accepts { uri, name, type } file parts.
  body.append('file', { uri, name, type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' } as unknown as Blob);
  const res = await api<{ id: string }>('/files', { method: 'POST', body });
  return res.id;
}

// ---- types ----------------------------------------------------------------

export interface Trip {
  id: string;
  tripNo: string;
  status: 'PLANNED' | 'ASSIGNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  originName: string;
  destinationName: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  purpose: string | null;
  cargoDescription: string | null;
  gpsDistanceKm: string | null;
  vehicle: { id: string; plateNumber: string; make: string; model: string } | null;
}

export interface Me {
  driver: {
    id: string;
    fullName: string;
    employeeNo: string;
    licenses: { number: string; licenseClass: string; expiresAt: string | null }[];
    assignments: { vehicle: { id: string; plateNumber: string; make: string; model: string } }[];
  };
  onDuty: { id: string; startedAt: string } | null;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  severity: string;
  readAt: string | null;
  createdAt: string;
}

export interface RepairRequest {
  id: string;
  description: string;
  severity: string;
  status: string;
  createdAt: string;
  vehicle?: { plateNumber: string };
  workOrder?: { woNo: string; status: string } | null;
}
