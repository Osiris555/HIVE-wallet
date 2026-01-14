// FILE: apps/mobile/src/crypto/wallet.ts
// TYPE: TypeScript (React Native / Expo)
// PURPOSE: Wallet creation & import flow for HIVE Wallet (Phase 0)

import { generateMnemonic, validateMnemonic } from './mnemonic';
import { deriveHoneyKey } from './keyDerivation';
import { publicKeyToAddress } from '../chain/address';
import { storePrivateKey } from './secureStorage';
import { useWalletStore } from '../state/walletStore';

// -----------------------------
// Types
// -----------------------------

export interface CreatedWallet {
  mnemonic: string;   // shown ONCE to the user
  address: string;    // safe to display
}

// -----------------------------
// Wallet Creation
// -----------------------------

export async function createNewWallet(): Promise<CreatedWallet> {
  // 1. Generate mnemonic (24 words)
  const mnemonic = generateMnemonic(24);

  // 2. Derive keys from mnemonic
  const { publicKey, privateKey } = deriveHoneyKey(mnemonic);

  // 3. Generate HONEY address from public key
  const address = publicKeyToAddress(publicKey);

  // 4. Store private key securely on device
  await storePrivateKey(address, publicKey, privateKey);

  // 5. Update in-memory wallet state
  useWalletStore.getState().setWallet(address);

  // 6. Return mnemonic + address (mnemonic must be shown to user ONCE)
  return { mnemonic, address };
}

// -----------------------------
// Wallet Import
// -----------------------------

export async function importWallet(mnemonic: string): Promise<string> {
  // 1. Validate mnemonic
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid recovery phrase');
  }

  // 2. Derive keys
  const { publicKey, privateKey } = deriveHoneyKey(mnemonic);

  // 3. Generate address
  const address = publicKeyToAddress(publicKey);

  // 4. Store securely
  await storePrivateKey(address, publicKey, privateKey);

  // 5. Update state
  useWalletStore.getState().setWallet(address);

  return address;
}

// -----------------------------
// SECURITY NOTES
// -----------------------------
// - Mnemonic is NEVER stored
// - Mnemonic is shown ONCE during creation
// - Private key is encrypted & device-bound
// - Losing device requires mnemonic recovery
// - This flow is non-custodial and trustless
