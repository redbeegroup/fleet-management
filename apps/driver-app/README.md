# FMS driver app (Expo / React Native)

Screens: sign-in, **Trips** (assigned / history, start & complete with optional odometer), **duty** on/off, **Fuel** (with receipt photo), **Report** a problem (with photo), **Alerts** (notifications). Push notifications via Expo (FCM/APNs).

```bash
npm install
```

```bash
npx expo start
```

The API base URL is `expo.extra.apiUrl` in `app.json` (default `http://10.0.2.2:8080/api`, i.e. the Docker test stack seen from an Android emulator). For a phone on the LAN use the host's IP.

## Builds

Production builds use [EAS](https://docs.expo.dev/build/introduction/):

```bash
npx eas build --platform android --profile production
```

Set `expo.extra.eas.projectId` (needed for push tokens) and `expo.extra.apiUrl` per environment. Push requires `PUSH_ENABLED=true` on the API (and `EXPO_ACCESS_TOKEN` if the Expo project enforces access tokens).

## Checks (also in CI)

```bash
npx tsc --noEmit
```

```bash
CI=1 npx expo export --platform android --output-dir /tmp/driver-export
```

Phase 2 adds inspections, proof of delivery and an offline queue (SQLite outbox with idempotency keys).
