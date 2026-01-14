export const FAUCET_AMOUNT = 100;
export const FAUCET_COOLDOWN_MS = 60 * 60 * 1000;
export const FAUCET_MAX_LIFETIME = 1_000_000;
export const FAUCET_MAX_PER_WALLET = 1_000;

export type FaucetRejectReason =
  | "COOLDOWN"
  | "WALLET_CAP"
  | "FAUCET_EMPTY";

export interface FaucetState {
  totalMinted: number;
  walletTotals: Record<string, number>;
  lastClaim: Record<string, number>;
}

const FAUCET_URL = "/faucet-state.json";

/**
 * Fetch shared chain faucet state
 */
async function loadState(): Promise<FaucetState> {
  const res = await fetch(FAUCET_URL, { cache: "no-store" });
  return res.json();
}

/**
 * Commit state back to chain
 * (Later: replace with API / validator RPC)
 */
async function saveState(state: FaucetState) {
  await fetch("/__update_faucet__", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
}

/**
 * Faucet request = validator simulation
 */
export async function requestFaucet(
  wallet: string
): Promise<
  | { ok: true }
  | { ok: false; reason: FaucetRejectReason }
> {
  const state = await loadState();
  const now = Date.now();

  const walletTotal = state.walletTotals[wallet] || 0;
  const last = state.lastClaim[wallet] || 0;

  if (state.totalMinted + FAUCET_AMOUNT > FAUCET_MAX_LIFETIME) {
    return { ok: false, reason: "FAUCET_EMPTY" };
  }

  if (walletTotal + FAUCET_AMOUNT > FAUCET_MAX_PER_WALLET) {
    return { ok: false, reason: "WALLET_CAP" };
  }

  if (now - last < FAUCET_COOLDOWN_MS) {
    return { ok: false, reason: "COOLDOWN" };
  }

  return { ok: true };
}

/**
 * Commit faucet mint
 */
export async function commitFaucet(wallet: string) {
  const state = await loadState();
  const now = Date.now();

  state.totalMinted += FAUCET_AMOUNT;
  state.walletTotals[wallet] =
    (state.walletTotals[wallet] || 0) + FAUCET_AMOUNT;
  state.lastClaim[wallet] = now;

  await saveState(state);
}

/**
 * ADMIN
 */
export async function resetFaucetAll() {
  await saveState({
    totalMinted: 0,
    walletTotals: {},
    lastClaim: {},
  });
}

export async function resetFaucetWallet(wallet: string) {
  const state = await loadState();
  delete state.walletTotals[wallet];
  delete state.lastClaim[wallet];
  await saveState(state);
}

export async function getFaucetState(): Promise<FaucetState> {
  return loadState();
}
