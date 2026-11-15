# FMS driver app (Expo / React Native)

Screens: sign-in, **Trips** (assigned / history, start & complete with optional odometer), **duty** on/off, **Fuel** (with receipt photo), **Report** a problem (with photo), **Alerts** (notifications). Push notifications via Expo (FCM/APNs).

```bash
npm install
```

```bash
npx expo start
```

Configuration comes from the environment (`app.config.ts`): copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` (default `http://10.0.2.2:8080/api`, the Docker test stack seen from an Android emulator; for a phone on the same Wi-Fi use your computer's LAN IP) and `EAS_PROJECT_ID`.

## Who can sign in

- **Drivers** (role `DRIVER`): trips, delivery stops with proof of delivery, duty, inspections, fuel, problem reports, incidents.
- **Fleet managers / company admins**: manager mode — fleet summary, approvals with attachments, alerts. A user with both roles can switch.

## Offline

Every action is stored in a SQLite outbox on the phone and sent in order with an `Idempotency-Key` as soon as there is a connection (on reconnect, when the app comes to the foreground and every 30 s). Photos are kept in app storage until uploaded. Trips, stops, the profile and approvals are cached for viewing offline. The bar under the header shows what is waiting; rejected actions can be retried or discarded there. Signing in needs a connection; signing out warns before discarding unsent actions.

## Builds

Production builds use [EAS](https://docs.expo.dev/build/introduction/):

```bash
npx eas build --platform android --profile production
```

Set `EAS_PROJECT_ID` (needed for push tokens) and `EXPO_PUBLIC_API_URL` per build profile (EAS environment variables). Push requires `PUSH_ENABLED=true` on the API (and `EXPO_ACCESS_TOKEN` if the Expo project enforces access tokens).

## Checks (also in CI)

```bash
npx tsc --noEmit
```

```bash
CI=1 npx expo export --platform android --output-dir /tmp/driver-export
```

Phase 2 adds inspections, proof of delivery and an offline queue (SQLite outbox with idempotency keys).
