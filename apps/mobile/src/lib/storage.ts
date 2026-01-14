import { Platform } from "react-native";

let AsyncStorage: any = null;

if (Platform.OS !== "web") {
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
}

export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  try {
    if (Platform.OS === "web") {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } else {
      const raw = await AsyncStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }
  } catch {
    return fallback;
  }
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  if (Platform.OS === "web") {
    localStorage.setItem(key, serialized);
  } else {
    await AsyncStorage.setItem(key, serialized);
  }
}
