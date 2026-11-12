import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Asks permission, gets an Expo push token and registers it with the FMS API. Never throws. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // simulators cannot receive push
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Fleet alerts', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api('/notifications/devices', { method: 'POST', body: JSON.stringify({ pushToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }) });
    return token;
  } catch {
    return null;
  }
}
