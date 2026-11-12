import type { ExpoConfig } from 'expo/config';

/**
 * Environment-driven app config (replaces app.json):
 *   EXPO_PUBLIC_API_URL  FMS API base URL, e.g. https://fms.example.com/api
 *   EAS_PROJECT_ID       Expo project id (needed for push tokens and EAS builds)
 * See .env.example.
 */
const config: ExpoConfig = {
  "name": "FMS Driver",
  "slug": "fms-driver",
  "version": "0.1.0",
  "orientation": "portrait",
  "userInterfaceStyle": "automatic",
  "android": {
    "package": "com.fms.driver",
    "permissions": [
      "CAMERA"
    ]
  },
  "ios": {
    "bundleIdentifier": "com.fms.driver",
    "infoPlist": {
      "NSCameraUsageDescription": "Take photos of fuel receipts and vehicle problems."
    }
  },
  "extra": {
    "apiUrl": process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080/api',
    "eas": {
      "projectId": process.env.EAS_PROJECT_ID || undefined
    }
  },
  "plugins": [
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        "cameraPermission": "Take photos of fuel receipts and vehicle problems."
      }
    ],
    "expo-notifications",
    "expo-asset"
  ]
};

export default config;
