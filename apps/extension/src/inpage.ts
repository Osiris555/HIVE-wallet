// HIVE Wallet — Inpage Provider
// Injected into every page. Exposes window.hive with a MetaMask-style API.

(function () {
  if ((window as unknown as Record<string, unknown>)['hive']) return; // already injected

  let reqCounter = 0;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // ── Listen for responses from content script ───────────────
  window.addEventListener('hive_inpage_response', (e) => {
    const event = e as CustomEvent<{ requestId: string; response: { result?: unknown; error?: string; pending?: boolean } }>;
    const { requestId, response } = event.detail;
    const p = pending.get(requestId);
    if (!p) return;
    if (response.pending) {
      // Request queued — the background will send a hive_response when resolved
      // Keep promise in map, resolved by the second event
      return;
    }
    pending.delete(requestId);
    if (response.error) {
      p.reject(new Error(response.error));
    } else {
      p.resolve(response.result);
    }
  });

  // ── Core request function ──────────────────────────────────
  function request(method: string, params?: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = String(++reqCounter);
      pending.set(requestId, { resolve, reject });
      window.dispatchEvent(
        new CustomEvent('hive_inpage_request', { detail: { method, params, requestId } }),
      );
    });
  }

  // ── Event emitter (minimal) ────────────────────────────────
  const listeners: Record<string, Array<(data: unknown) => void>> = {};

  function on(event: string, cb: (data: unknown) => void) {
    (listeners[event] ??= []).push(cb);
  }

  function removeListener(event: string, cb: (data: unknown) => void) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(f => f !== cb);
    }
  }

  function emit(event: string, data: unknown) {
    (listeners[event] ?? []).forEach(cb => cb(data));
  }

  // ── Public provider API ────────────────────────────────────
  const provider = {
    isHive: true,
    /** Returns currently connected accounts ([] if not connected). */
    accounts(): Promise<string[]> {
      return request('hive_accounts') as Promise<string[]>;
    },
    /** Prompts the user to connect. Returns [address] on approval. */
    requestAccounts(): Promise<string[]> {
      return request('hive_requestAccounts') as Promise<string[]>;
    },
    /** Returns the Honey Network chain id ('0x01'). */
    chainId(): Promise<string> {
      return request('hive_chainId') as Promise<string>;
    },
    /**
     * Sign an arbitrary message with ML-DSA-65.
     * Returns { signature: hexString, address: string }.
     */
    sign(message: string): Promise<{ signature: string; address: string }> {
      return request('hive_sign', [message]) as Promise<{ signature: string; address: string }>;
    },
    /** Returns HNY balance of connected address as a string. */
    getBalance(): Promise<string> {
      return request('hive_getBalance') as Promise<string>;
    },
    /**
     * Request user authorization for a transaction.
     * Opens the extension popup with Chrysalis ceremony.
     * Returns { txId, success } on approval, rejects on cancel.
     */
    requestTransaction(txData: unknown): Promise<{ txId: string; success: boolean }> {
      return request('hive_requestTx', [txData]) as Promise<{ txId: string; success: boolean }>;
    },
    on,
    removeListener,
    _emit: emit, // internal — used by content script to surface events
  };

  (window as unknown as Record<string, unknown>)['hive'] = provider;

  // Announce to dApps
  window.dispatchEvent(new Event('hive#initialized'));
})();
