// apps/mobile/src/security/appSecurity.ts
// PHASE 0 APP HARDENING & SECURITY LAYER
// Handles PIN, biometrics, auto-lock, and wallet wipe logic

import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { AppState } from 'react-native'

const PIN_KEY = 'HIVE_WALLET_PIN'
const LOCK_TIMEOUT_MS = 60_000 // 1 minute

let lastActiveTime = Date.now()

// -------------------------------
// PIN MANAGEMENT
// -------------------------------

export async function setPin(pin: string): Promise<void> {
  if (pin.length < 6) {
    throw new Error('PIN must be at least 6 digits')
  }
  await SecureStore.setItemAsync(PIN_KEY, pin)
}

export async function verifyPin(input: string): Promise<boolean> {
  const storedPin = await SecureStore.getItemAsync(PIN_KEY)
  return storedPin === input
}

export async function hasPin(): Promise<boolean> {
  const storedPin = await SecureStore.getItemAsync(PIN_KEY)
  return storedPin !== null
}

// -------------------------------
// BIOMETRIC AUTH
// -------------------------------

export async function biometricAvailable(): Promise<boolean> {
  return await LocalAuthentication.hasHardwareAsync()
}

export async function authenticateBiometric(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock HIVE Wallet',
    fallbackLabel: 'Use PIN'
  })

  return result.success
}

// -------------------------------
// AUTO-LOCK & APP STATE
// -------------------------------

export function recordActivity() {
  lastActiveTime = Date.now()
}

export function shouldLock(): boolean {
  return Date.now() - lastActiveTime > LOCK_TIMEOUT_MS
}

export function initializeAutoLock(onLock: () => void) {
  AppState.addEventListener('change', state => {
    if (state !== 'active') {
      onLock()
    }
  })
}

// -------------------------------
// WALLET WIPE (PANIC / TAMPER)
// -------------------------------

export async function wipeWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY)

  // NOTE: Seed + keys wipe logic lives in key management module
  console.warn('Wallet wiped: PIN removed. Keys must also be wiped.')
}
