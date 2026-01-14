// TEMPORARY STUB — Secure storage will be implemented in Phase 2

export async function storePrivateKey(_key: string) {
  console.warn('Secure storage not enabled yet');
}

export async function getPrivateKey(): Promise<string | null> {
  return null;
}

export async function clearPrivateKey() {
  console.warn('Secure storage not enabled yet');
}
