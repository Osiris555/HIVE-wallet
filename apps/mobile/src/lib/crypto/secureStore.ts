import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export async function setSecureItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value)
  } else {
    await SecureStore.setItemAsync(key, value)
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key)
  } else {
    return SecureStore.getItemAsync(key)
  }
}
