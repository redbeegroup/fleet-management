const ACCESS = 'fms.accessToken';
const REFRESH = 'fms.refreshToken';
const USER = 'fms.user';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  companyId: string;
  roles: string[];
  permissions: string[];
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { message?: string | string[]; errors?: { path: string; message: string }[] },
  ) {
    super(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `HTTP ${status}`);
  }
}

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export const session = {
  user(): SessionUser | null {
    const raw = storage.get(USER);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  },
  save(pair: TokenPair) {
    storage.set(ACCESS, pair.accessToken);
    storage.set(REFRESH, pair.refreshToken);
    storage.set(USER, JSON.stringify(pair.user));
  },
  clear() {
    [ACCESS, REFRESH, USER].forEach((k) => storage.set(k, null));
  },
  can(permission: string) {
    return session.user()?.permissions.includes(permission) ?? false;
  },
};

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const token = storage.get(REFRESH);
  if (!token) return false;
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      session.save((await res.json()) as TokenPair);
      return true;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = storage.get(ACCESS);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  if (res.status === 401) {
    session.clear();
    window.location.assign('/login');
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const pair = await api<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
  session.save(pair);
  return pair.user;
}

export async function logout(): Promise<void> {
  const refreshToken = storage.get(REFRESH);
  if (refreshToken) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  session.clear();
}
