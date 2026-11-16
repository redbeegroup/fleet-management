import * as Location from 'expo-location';

/** Current phone position (proof of delivery, fuel fills); null when denied or unavailable (the stop gets a NO_GPS flag). */
export async function position(): Promise<{
  latitude: number;
  longitude: number;
  accuracyM: number | null;
} | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    return pick(p ?? (await Location.getLastKnownPositionAsync({ maxAge: 120_000 })));
  } catch {
    return null;
  }
}
function pick(p: Location.LocationObject | null) {
  return p
    ? {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracyM: p.coords.accuracy != null ? Math.round(p.coords.accuracy) : null,
      }
    : null;
}
