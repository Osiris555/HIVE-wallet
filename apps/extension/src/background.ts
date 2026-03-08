// HIVE Wallet — Background Service Worker (MV3)
// Wallet state, all tx ops, profile management, network switching.

import {
  mnemonicToMasterSeed, deriveHiveKeypair,
  encryptSeed, decryptSeed, signMessage, bytesToHex,
} from './shared/crypto';
import {
  getExtState, setExtState,
  getEncryptedSeed, setEncryptedSeed,
  getSessionSeed, setSessionSeed, clearSessionSeed,
  getSessionPassword, setSessionPassword, clearSessionPassword,
  getProfiles, setProfiles, getActiveProfileId, setActiveProfileId,
  getCustomNetworks, setCustomNetworks, getActiveNetworkId, setActiveNetworkId,
  clearAll, seedToB64, b64ToSeed,
} from './shared/storage';
import type {
  ExtState, WalletProfile, NetworkConfig,
  PendingRequest, PopupMessage, ContentToBackground, BackgroundToContent,
} from './shared/types';

// ── Preset networks ───────────────────────────────────────────
export const PRESET_NETWORKS: NetworkConfig[] = [
  {
    id: 'hny-devnet', name: 'Honey Network Testnet', shortName: 'HNY-DEV',
    rpcUrl: 'http://localhost:3000', currencySymbol: 'HNY',
    isTestnet: true, type: 'hive', isPreset: true,
  },
  {
    id: 'base-mainnet', name: 'Base Mainnet', shortName: 'BASE',
    rpcUrl: 'https://mainnet.base.org', chainId: '8453', currencySymbol: 'ETH',
    blockExplorer: 'https://basescan.org', isTestnet: false, type: 'evm', isPreset: true,
  },
  {
    id: 'base-sepolia', name: 'Base Sepolia', shortName: 'BASE-SEP',
    rpcUrl: 'https://sepolia.base.org', chainId: '84532', currencySymbol: 'ETH',
    blockExplorer: 'https://sepolia.basescan.org', isTestnet: true, type: 'evm', isPreset: true,
  },
];

// ── In-memory pending request queue ──────────────────────────
let pendingRequests: PendingRequest[] = [];
let nextReqId = 1;

// ── Utilities ────────────────────────────────────────────────
function broadcastToPopup(msg: BackgroundToContent) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
async function getUnlockedSeed(): Promise<Uint8Array | null> {
  const b64 = await getSessionSeed();
  return b64 ? b64ToSeed(b64) : null;
}

// ── Active HIVE API URL ───────────────────────────────────────
async function getHiveApi(): Promise<string> {
  const netId   = await getActiveNetworkId();
  const customs = await getCustomNetworks();
  const all     = [...PRESET_NETWORKS, ...customs];
  const net     = all.find(n => n.id === netId && n.type === 'hive');
  return net?.rpcUrl ?? 'http://localhost:3000';
}

// ── Server helpers ────────────────────────────────────────────
async function callServer<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const base = await getHiveApi();
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${base}${path}`, opts);
  const json = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json;
}

// ── Signing helpers ───────────────────────────────────────────
async function signTx(seed: Uint8Array, index: number, message: string) {
  const kp = deriveHiveKeypair(seed, index);
  const mldsaPubKeyHex = bytesToHex(kp.publicKey);
  const signatureHex   = signMessage(kp.secretKey, message);
  const attestMessage  = `chrysalis_attest:${message}`;
  const chrysalisAttestation = {
    message: attestMessage,
    signatureHex: signMessage(kp.secretKey, attestMessage),
    mldsaPubKeyHex,
  };
  return { signatureHex, mldsaPubKeyHex, address: kp.address, chrysalisAttestation };
}

// ── Chrysalis registration ────────────────────────────────────
async function registerChrysalis(seed: Uint8Array, address: string, index: number): Promise<boolean> {
  try {
    const kp = deriveHiveKeypair(seed, index);
    const mldsaPubKeyHex = bytesToHex(kp.publicKey);
    const message = `chrysalis_register:${address}`;
    await callServer('/chrysalis/register', 'POST', {
      wallet: address, mldsaPubKeyHex, kemPubKeyHex: mldsaPubKeyHex,
      signatureHex: signMessage(kp.secretKey, message),
    });
    const state = await getExtState();
    if (state) { state.chrysalisRegistered = true; await setExtState(state); }
    // Update profile
    const profiles  = await getProfiles();
    const activeId  = await getActiveProfileId();
    const profile   = profiles.find(p => p.id === activeId);
    if (profile) { profile.chrysalisRegistered = true; await setProfiles(profiles); }
    return true;
  } catch { return false; }
}

// ── Profile helpers ───────────────────────────────────────────
async function buildProfile(
  name: string, mnemonic: string, password: string, existingCount: number,
): Promise<WalletProfile> {
  const masterSeed = mnemonicToMasterSeed(mnemonic);
  const { address } = deriveHiveKeypair(masterSeed, 0);
  const encryptedSeed     = await encryptSeed(password, masterSeed);
  const encryptedMnemonic = await encryptSeed(password, new TextEncoder().encode(mnemonic));
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    name: name || `Wallet ${existingCount + 1}`,
    address, walletIndex: 0, hdAddresses: [address],
    encryptedSeed, encryptedMnemonic, chrysalisRegistered: false,
  };
}

async function activateProfile(profile: WalletProfile, password: string): Promise<ExtState> {
  const seed = await decryptSeed(password, profile.encryptedSeed);
  await setSessionSeed(seedToB64(seed));
  await setEncryptedSeed(profile.encryptedSeed);
  await setActiveProfileId(profile.id);
  const existing = await getExtState();
  const state: ExtState = {
    status: 'unlocked',
    address: profile.hdAddresses[profile.walletIndex] || profile.address,
    walletIndex: profile.walletIndex,
    connectedOrigins: existing?.connectedOrigins ?? [],
    chrysalisRegistered: profile.chrysalisRegistered,
    profileId: profile.id,
    networkId: existing?.networkId ?? 'hny-devnet',
  };
  await setExtState(state);
  return state;
}

// ── Message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((rawMsg: unknown, sender, sendResponse) => {
  handleMessage(rawMsg as PopupMessage | ContentToBackground, sendResponse, sender);
  return true;
});

async function handleMessage(
  msg: PopupMessage | ContentToBackground,
  respond: (r: unknown) => void,
  sender?: chrome.runtime.MessageSender,
) {
  const m = msg as Record<string, unknown>;
  switch (m['type'] as string) {

    // ── Setup new wallet ────────────────────────────────────
    case 'setup': {
      const { mnemonic, password } = m as { mnemonic: string; password: string };
      const profiles = await getProfiles();
      const profile  = await buildProfile('Main Wallet', mnemonic.trim(), password, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      const state = await activateProfile(profile, password);
      await setSessionPassword(password);
      // Auto-register Chrysalis
      const seed = await getUnlockedSeed();
      if (seed) registerChrysalis(seed, profile.address, 0).then(ok => {
        if (ok) broadcastToPopup({ type: 'state_update', state: { ...state, chrysalisRegistered: true } });
      });
      respond({ ok: true, address: profile.address });
      broadcastToPopup({ type: 'state_update', state });
      break;
    }

    // ── Unlock ──────────────────────────────────────────────
    case 'unlock': {
      const { password } = m as { password: string };
      // Try active profile first, fall back to legacy seed
      const profiles  = await getProfiles();
      const activeId  = await getActiveProfileId();
      const profile   = profiles.find(p => p.id === activeId) ?? profiles[0];
      const blob      = profile?.encryptedSeed ?? await getEncryptedSeed();
      if (!blob) { respond({ ok: false, error: 'No wallet found' }); break; }
      try {
        const seed = await decryptSeed(password, blob);
        await setSessionSeed(seedToB64(seed));
        await setSessionPassword(password);
        const state = await getExtState();
        if (state) { state.status = 'unlocked'; await setExtState(state); }
        // Re-register Chrysalis if needed
        if (state && !state.chrysalisRegistered) {
          registerChrysalis(seed, state.address, state.walletIndex).then(ok => {
            if (ok) broadcastToPopup({ type: 'state_update', state: { ...state!, chrysalisRegistered: true, status: 'unlocked' } });
          });
        }
        respond({ ok: true });
        broadcastToPopup({ type: 'state_update', state: state! });
      } catch {
        respond({ ok: false, error: 'Wrong password' });
      }
      break;
    }

    // ── Lock ─────────────────────────────────────────────────
    case 'lock': {
      await clearSessionSeed();
      await clearSessionPassword();
      const state = await getExtState();
      if (state) { state.status = 'locked'; await setExtState(state); }
      respond({ ok: true });
      broadcastToPopup({ type: 'state_update', state: state! });
      break;
    }

    // ── Get pending requests (race-condition fix) ─────────────
    case 'get_pending_requests': {
      respond({ requests: pendingRequests });
      break;
    }

    // ── Get state ────────────────────────────────────────────
    case 'get_state': {
      const state    = await getExtState();
      const hasWallet = !!(await getEncryptedSeed()) || (await getProfiles()).length > 0;
      if (!state) { respond({ status: hasWallet ? 'locked' : 'setup_required' }); break; }
      const sessionOk = !!(await getSessionSeed());
      if (!sessionOk && state.status === 'unlocked') {
        state.status = 'locked'; await setExtState(state);
      }
      respond(state);
      break;
    }

    // ── Fetch wallet data ─────────────────────────────────────
    case 'fetch_wallet_data': {
      const state = await getExtState();
      if (!state?.address) { respond({ error: 'No wallet' }); break; }
      const addr = state.address;
      type RawBalResp = { success?: boolean; balances?: Record<string, number>; tokens?: Record<string, { price?: number }> };
      type RawTx = { id: string; type: string; from: string; to: string; amount: number; timestamp: number; token?: string };
      const [balsRes, nftsRes, txsRes, chrysRes] = await Promise.allSettled([
        callServer<RawBalResp>(`/tokens/balances/${addr}`),
        callServer<{ nfts: unknown[] }>(`/nft/wallet/${addr}`),
        callServer<RawTx[]>(`/transactions/${addr}`),
        callServer<{ registered: boolean }>(`/chrysalis/status/${addr}`),
      ]);
      const chrysalisRegistered = chrysRes.status === 'fulfilled' ? chrysRes.value.registered : state.chrysalisRegistered ?? false;
      if (chrysRes.status === 'fulfilled' && chrysRes.value.registered !== state.chrysalisRegistered) {
        state.chrysalisRegistered = chrysRes.value.registered; await setExtState(state);
      }
      // Normalize balances: server returns flat numbers, App expects { amount, valueUsd }
      const balances: Record<string, { amount: number; valueUsd?: number }> = {};
      if (balsRes.status === 'fulfilled') {
        const rawBals = balsRes.value.balances ?? {};
        const rawToks = balsRes.value.tokens ?? {};
        for (const [sym, amt] of Object.entries(rawBals)) {
          const a = typeof amt === 'number' ? amt : 0;
          const price = rawToks[sym]?.price;
          balances[sym] = { amount: a, valueUsd: price !== undefined ? a * price : undefined };
        }
      }
      // Normalize transactions: server returns raw array with from/to, map to from_wallet/to_wallet
      const rawTxArr = txsRes.status === 'fulfilled' && Array.isArray(txsRes.value) ? txsRes.value : [];
      const recentTxs = rawTxArr.slice(0, 20).map((tx: RawTx) => ({
        id: tx.id, type: tx.type,
        from_wallet: tx.from, to_wallet: tx.to,
        amount: tx.amount, token: tx.token ?? 'HNY',
        timestamp: tx.timestamp,
      }));
      respond({ ok: true, balances, nfts: nftsRes.status === 'fulfilled' ? (nftsRes.value.nfts ?? []) : [], recentTxs, chrysalisRegistered });
      break;
    }

    // ── Swap quote ───────────────────────────────────────────
    case 'get_swap_quote': {
      const { fromToken, toToken, amountIn } = m as { fromToken: string; toToken: string; amountIn: number };
      try {
        const { pools } = await callServer<{
          pools: Array<{ tokenA: string; tokenB: string; reserveA: number; reserveB: number; feeRate: number }>;
        }>('/liquidity/pools');
        const pool = pools.find(p =>
          (p.tokenA === fromToken && p.tokenB === toToken) ||
          (p.tokenA === toToken   && p.tokenB === fromToken)
        );
        if (!pool) { respond({ error: 'No pool found' }); break; }
        const [rIn, rOut] = pool.tokenA === fromToken ? [pool.reserveA, pool.reserveB] : [pool.reserveB, pool.reserveA];
        const fee = pool.feeRate || 0.003;
        respond({ ok: true, amountOut: (rOut * amountIn * (1-fee)) / (rIn + amountIn*(1-fee)), priceImpact: amountIn/(rIn+amountIn)*100, fee });
      } catch (e) { respond({ error: String(e) }); }
      break;
    }

    // ── Pool ratio for LP auto-calculate ─────────────────────
    case 'get_pool_ratio': {
      const { tokenA, tokenB } = m as { tokenA: string; tokenB: string };
      try {
        const { pools } = await callServer<{
          pools: Array<{ tokenA: string; tokenB: string; reserveA: number; reserveB: number }>;
        }>('/liquidity/pools');
        const pool = pools.find(p =>
          (p.tokenA === tokenA && p.tokenB === tokenB) ||
          (p.tokenA === tokenB && p.tokenB === tokenA)
        );
        if (!pool) { respond({ ok: true, ratio: 1 }); break; }
        // ratio = how many tokenB per 1 tokenA
        const ratio = pool.tokenA === tokenA
          ? (pool.reserveA > 0 ? pool.reserveB / pool.reserveA : 1)
          : (pool.reserveB > 0 ? pool.reserveA / pool.reserveB : 1);
        respond({ ok: true, ratio: isFinite(ratio) ? ratio : 1 });
      } catch { respond({ ok: true, ratio: 1 }); }
      break;
    }

    // ── exec_send ────────────────────────────────────────────
    case 'exec_send': {
      const { toWallet, amount, token } = m as { toWallet: string; amount: number; token: string };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const from = state.address;
        // Fetch chain status (chainId, minGasFee) and account nonce
        const [statusRes, acctRes] = await Promise.all([
          callServer<{ chainId: string; minGasFee: number }>('/status'),
          callServer<{ nonce: number }>(`/account/${from}`),
        ]);
        const chainId    = statusRes.chainId ?? '1';
        const gasFee     = Number((statusRes.minGasFee ?? 0.00000001).toFixed(8));
        const nonce      = Number(acctRes.nonce ?? 0);
        const ts         = Date.now();
        const expiresAtMs = ts + 60_000;
        // serviceFee: amount * 0.000005 (HNY @ $1)
        const serviceFee = Number((Number(amount) * 0.000005).toFixed(8));
        const fmt8 = (n: number) => Number(n).toFixed(8);
        const txMsg = [chainId, 'send', from, toWallet, fmt8(amount), String(nonce),
          fmt8(gasFee), fmt8(serviceFee), String(expiresAtMs), String(ts), ''].join('|');
        const sig = await signTx(seed, state.walletIndex, txMsg);
        respond({ ok: true, result: await callServer('/send', 'POST', {
          from, to: toWallet, amount, nonce, timestamp: ts,
          chainId, gasFee, serviceFee, expiresAtMs, ...sig,
        })});
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── exec_swap ────────────────────────────────────────────
    case 'exec_swap': {
      const { fromToken, toToken, amountIn } = m as { fromToken: string; toToken: string; amountIn: number };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const ts = Date.now(); const txMsg = `swap:${state.address}:${fromToken}:${toToken}:${amountIn}:${ts}`;
        const sig = await signTx(seed, state.walletIndex, txMsg);
        respond({ ok: true, result: await callServer('/swap', 'POST', { wallet: state.address, fromToken, toToken, amountIn, timestamp: ts, ...sig }) });
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── exec_stake ───────────────────────────────────────────
    case 'exec_stake': {
      const { amount } = m as { amount: number };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const ts = Date.now(); const sig = await signTx(seed, state.walletIndex, `stake:${state.address}:${amount}:${ts}`);
        respond({ ok: true, result: await callServer('/stake', 'POST', { wallet: state.address, amount, timestamp: ts, ...sig }) });
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── exec_unstake ─────────────────────────────────────────
    case 'exec_unstake': {
      const { amount } = m as { amount: number };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const ts = Date.now(); const sig = await signTx(seed, state.walletIndex, `unstake:${state.address}:${amount}:${ts}`);
        respond({ ok: true, result: await callServer('/unstake', 'POST', { wallet: state.address, amount, timestamp: ts, ...sig }) });
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── exec_add_lp ──────────────────────────────────────────
    case 'exec_add_lp': {
      const { tokenA, tokenB, amountA, amountB } = m as { tokenA: string; tokenB: string; amountA: number; amountB: number };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const ts = Date.now(); const sig = await signTx(seed, state.walletIndex, `liquidity_add:${state.address}:${tokenA}:${tokenB}:${amountA}:${amountB}:${ts}`);
        respond({ ok: true, result: await callServer('/liquidity/add', 'POST', { wallet: state.address, tokenA, tokenB, amountA, amountB, timestamp: ts, ...sig }) });
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── exec_send_nft ────────────────────────────────────────
    case 'exec_send_nft': {
      const { toWallet, nftId } = m as { toWallet: string; nftId: string };
      const seed = await getUnlockedSeed(); const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      try {
        const ts = Date.now(); const sig = await signTx(seed, state.walletIndex, `nft_send:${state.address}:${toWallet}:${nftId}:${ts}`);
        respond({ ok: true, result: await callServer('/nft/send', 'POST', { fromWallet: state.address, toWallet, nftId, timestamp: ts, ...sig }) });
      } catch (e) { respond({ ok: false, error: String(e) }); }
      break;
    }

    // ── Approve dApp request ─────────────────────────────────
    case 'approve_request': {
      const { requestId } = m as { requestId: string };
      const req = pendingRequests.find(r => r.id === requestId);
      if (!req) { respond({ ok: false, error: 'Request not found' }); break; }
      pendingRequests = pendingRequests.filter(r => r.id !== requestId);
      try {
      const seed = await getUnlockedSeed();
      if (!seed) { respond({ ok: false, error: 'Wallet locked' }); break; }
      const state = await getExtState();
      if (req.type === 'connect') {
        // For connect, use the stored address — no need to re-derive keypair
        const connectedAddress = state?.address ?? '';
        if (state && !state.connectedOrigins.includes(req.origin)) {
          state.connectedOrigins.push(req.origin); await setExtState(state);
        }
        chrome.tabs.sendMessage(req.tabId, { type: 'hive_response', requestId: req.inpageRequestId, result: [connectedAddress] } as BackgroundToContent);
      } else if (req.type === 'sign' && req.message) {
        const kp = deriveHiveKeypair(seed, state?.walletIndex ?? 0);
        chrome.tabs.sendMessage(req.tabId, {
          type: 'hive_response', requestId: req.inpageRequestId,
          result: { signature: signMessage(kp.secretKey, req.message), address: kp.address, publicKeyHex: bytesToHex(kp.publicKey) },
        } as BackgroundToContent);
      } else if (req.type === 'tx' && req.txData) {
        const kp = deriveHiveKeypair(seed, state?.walletIndex ?? 0);
        // Execute the transaction based on txType
        try {
          const txData = req.txData;
          const params = txData.params ?? {};
          let result: unknown;
          if (txData.txType === 'swap') {
            const ts = Date.now();
            const txMsg = `swap:${kp.address}:${txData.fromToken}:${txData.toToken}:${txData.amountIn}:${ts}`;
            const sig = await signTx(seed!, state!.walletIndex, txMsg);
            result = await callServer('/swap', 'POST', {
              wallet: kp.address, fromToken: txData.fromToken, toToken: txData.toToken,
              amountIn: txData.amountIn, timestamp: ts, ...sig,
            });
          } else if (txData.txType === 'futures_open') {
            const ts = Date.now();
            const txMsg = `futures_open:${kp.address}:${txData.marketId}:${txData.side}:${params.size}:${txData.leverage}:${ts}`;
            const sig = await signTx(seed!, state!.walletIndex, txMsg);
            result = await callServer('/futures/open', 'POST', {
              wallet: kp.address, market_id: txData.marketId, side: txData.side,
              size_hny: params.size, leverage: txData.leverage, timestamp: ts, ...sig,
            });
          } else if (txData.txType === 'futures_close') {
            const ts = Date.now();
            const txMsg = `futures_close:${kp.address}:${params.positionId}:${ts}`;
            const sig = await signTx(seed!, state!.walletIndex, txMsg);
            result = await callServer('/futures/close', 'POST', {
              wallet: kp.address, position_id: params.positionId, timestamp: ts, ...sig,
            });
          } else {
            result = { success: true, message: 'Transaction signed' };
          }
          chrome.tabs.sendMessage(req.tabId, {
            type: 'hive_response', requestId: req.inpageRequestId,
            result: { txId: (result as { tx_id?: string })?.tx_id ?? `tx_${Date.now()}`, success: true },
          } as BackgroundToContent);
        } catch (e) {
          chrome.tabs.sendMessage(req.tabId, {
            type: 'hive_response', requestId: req.inpageRequestId,
            error: String(e),
          } as BackgroundToContent);
        }
      }
      respond({ ok: true });
      broadcastToPopup({ type: 'pending_requests', requests: pendingRequests });
      } catch (e) {
        // Always call respond so the popup's sendBg() doesn't hang
        respond({ ok: false, error: String(e) });
      }
      break;
    }

    // ── Reject dApp request ──────────────────────────────────
    case 'reject_request': {
      const { requestId } = m as { requestId: string };
      const req = pendingRequests.find(r => r.id === requestId);
      if (req) chrome.tabs.sendMessage(req.tabId, { type: 'hive_response', requestId: req.inpageRequestId, error: 'User rejected' } as BackgroundToContent);
      pendingRequests = pendingRequests.filter(r => r.id !== requestId);
      respond({ ok: true });
      broadcastToPopup({ type: 'pending_requests', requests: pendingRequests });
      break;
    }

    // ── Disconnect site ──────────────────────────────────────
    case 'disconnect_site': {
      const { origin } = m as { origin: string };
      const state = await getExtState();
      if (state) {
        state.connectedOrigins = state.connectedOrigins.filter(o => o !== origin);
        await setExtState(state);
        respond({ ok: true });
        broadcastToPopup({ type: 'state_update', state });
      } else { respond({ ok: false }); }
      break;
    }

    // ── inpage provider ──────────────────────────────────────
    case 'inpage_request': {
      const { method, params, requestId: reqId, origin, title } = m as ContentToBackground;
      // Use the actual tab ID from the message sender (content script sends tabId:-1 as placeholder)
      const tabId = sender?.tab?.id ?? (m as ContentToBackground).tabId ?? -1;
      const state = await getExtState(); const seed = await getUnlockedSeed();
      if (method === 'hive_chainId') { respond({ result: '0x01' }); break; }
      if (method === 'hive_accounts') {
        if (!state || state.status !== 'unlocked' || !state.connectedOrigins.includes(origin)) { respond({ result: [] }); break; }
        respond({ result: [state.address] }); break;
      }
      if (method === 'hive_requestAccounts') {
        if (!seed || !state || state.status !== 'unlocked') {
          queueRequest({ type: 'connect', origin, title, tabId, requestId: reqId }); respond({ pending: true }); break;
        }
        if (state.connectedOrigins.includes(origin)) { respond({ result: [state.address] }); }
        else { queueRequest({ type: 'connect', origin, title, tabId, requestId: reqId }); respond({ pending: true }); }
        break;
      }
      if (method === 'hive_sign') {
        const message = (params?.[0] as string) ?? '';
        if (!seed || !state || state.status !== 'unlocked') { respond({ error: 'Wallet locked' }); break; }
        if (!state.connectedOrigins.includes(origin)) { respond({ error: 'Not connected' }); break; }
        queueRequest({ type: 'sign', origin, title, tabId, requestId: reqId, message }); respond({ pending: true }); break;
      }
      if (method === 'hive_getBalance') {
        try {
          const r = await callServer<{ balances?: Record<string, { amount?: number }> }>(`/tokens/balances/${state?.address ?? ''}`);
          respond({ result: String(r.balances?.['HNY']?.amount ?? 0) });
        } catch { respond({ result: '0' }); }
        break;
      }
      if (method === 'hive_requestTx') {
        const txData = params?.[0] as import('./shared/types').DappTxData;
        if (!seed || !state || state.status !== 'unlocked') { respond({ error: 'Wallet locked — please unlock HIVE Wallet extension first' }); break; }
        if (!txData) { respond({ error: 'Missing transaction data' }); break; }
        queueRequest({ type: 'tx', origin, title, tabId, requestId: reqId, txData });
        respond({ pending: true });
        break;
      }
      respond({ error: `Unknown method: ${method}` });
      break;
    }

    // ── Wallet manager: list profiles ────────────────────────
    case 'get_profiles': {
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      respond({ ok: true, profiles, activeId });
      break;
    }

    // ── Wallet manager: create new wallet ────────────────────
    case 'create_profile': {
      const { name } = m as { name: string };
      const pass = await getSessionPassword();
      if (!pass) { respond({ ok: false, error: 'Session expired — please lock and unlock first' }); break; }
      const { generateMnemonic: gen } = await import('@scure/bip39');
      const { wordlist } = await import('@scure/bip39/wordlists/english');
      const mnemonic = gen(wordlist);
      const profiles = await getProfiles();
      const profile  = await buildProfile(name, mnemonic, pass, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      respond({ ok: true, profile, mnemonic }); // mnemonic returned so user can back up
      break;
    }

    // ── Wallet manager: import wallet ────────────────────────
    case 'import_profile': {
      const { name, mnemonic } = m as { name: string; mnemonic: string };
      const pass = await getSessionPassword();
      if (!pass) { respond({ ok: false, error: 'Session expired — please lock and unlock first' }); break; }
      const profiles = await getProfiles();
      const profile  = await buildProfile(name, mnemonic.trim(), pass, profiles.length);
      profiles.push(profile);
      await setProfiles(profiles);
      respond({ ok: true, profile });
      break;
    }

    // ── Wallet manager: switch wallet ────────────────────────
    case 'switch_profile': {
      const { profileId } = m as { profileId: string };
      const pass = await getSessionPassword();
      if (!pass) { respond({ ok: false, error: 'Session expired — please lock and unlock' }); break; }
      const profiles = await getProfiles();
      const profile  = profiles.find(p => p.id === profileId);
      if (!profile) { respond({ ok: false, error: 'Profile not found' }); break; }
      try {
        const state = await activateProfile(profile, pass);
        respond({ ok: true });
        broadcastToPopup({ type: 'state_update', state });
      } catch { respond({ ok: false, error: 'Failed to decrypt — profile may use a different password' }); }
      break;
    }

    // ── Wallet manager: delete wallet ────────────────────────
    case 'delete_profile': {
      const { profileId } = m as { profileId: string };
      const activeId = await getActiveProfileId();
      if (profileId === activeId) { respond({ ok: false, error: 'Cannot delete the active wallet. Switch first.' }); break; }
      const profiles = await getProfiles();
      await setProfiles(profiles.filter(p => p.id !== profileId));
      respond({ ok: true });
      break;
    }

    // ── Wallet manager: add HD address ───────────────────────
    case 'add_address': {
      const seed  = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile  = profiles.find(p => p.id === activeId);
      if (!profile) { respond({ ok: false, error: 'Profile not found' }); break; }
      const newIndex  = profile.hdAddresses.length;
      const { address } = deriveHiveKeypair(seed, newIndex);
      profile.hdAddresses.push(address);
      await setProfiles(profiles);
      respond({ ok: true, address, index: newIndex, hdAddresses: profile.hdAddresses });
      break;
    }

    // ── Wallet manager: switch HD address ────────────────────
    case 'switch_address': {
      const { index } = m as { index: number };
      const seed  = await getUnlockedSeed();
      const state = await getExtState();
      if (!seed || !state) { respond({ ok: false, error: 'Wallet locked' }); break; }
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile  = profiles.find(p => p.id === activeId);
      if (!profile || !profile.hdAddresses[index]) { respond({ ok: false, error: 'Address not found' }); break; }
      profile.walletIndex = index;
      await setProfiles(profiles);
      state.address      = profile.hdAddresses[index];
      state.walletIndex  = index;
      await setExtState(state);
      respond({ ok: true });
      broadcastToPopup({ type: 'state_update', state });
      break;
    }

    // ── Wallet manager: rename wallet ────────────────────────
    case 'rename_profile': {
      const { profileId, name } = m as { profileId: string; name: string };
      const profiles = await getProfiles();
      const profile  = profiles.find(p => p.id === profileId);
      if (!profile) { respond({ ok: false, error: 'Profile not found' }); break; }
      profile.name = name;
      await setProfiles(profiles);
      respond({ ok: true });
      break;
    }

    // ── View seed phrase (Chrysalis locked) ──────────────────
    case 'get_seed_phrase': {
      const { password } = m as { password: string };
      const profiles = await getProfiles();
      const activeId = await getActiveProfileId();
      const profile  = profiles.find(p => p.id === activeId);
      if (!profile) {
        // Legacy: no mnemonic stored
        respond({ ok: false, error: 'Seed phrase not available. Re-import your wallet to enable this feature.' });
        break;
      }
      try {
        const bytes    = await decryptSeed(password, profile.encryptedMnemonic);
        const mnemonic = new TextDecoder().decode(bytes);
        respond({ ok: true, mnemonic });
      } catch {
        respond({ ok: false, error: 'Wrong password' });
      }
      break;
    }

    // ── Networks: list all ───────────────────────────────────
    case 'get_networks': {
      const customs  = await getCustomNetworks();
      const activeId = await getActiveNetworkId();
      respond({ ok: true, networks: [...PRESET_NETWORKS, ...customs], activeId: activeId ?? 'hny-devnet' });
      break;
    }

    // ── Networks: add custom ─────────────────────────────────
    case 'add_network': {
      const { network } = m as { network: NetworkConfig };
      const customs = await getCustomNetworks();
      const exists  = customs.find(n => n.id === network.id);
      if (exists) { respond({ ok: false, error: 'Network ID already exists' }); break; }
      const newNet: NetworkConfig = { ...network, isPreset: false };
      await setCustomNetworks([...customs, newNet]);
      respond({ ok: true });
      break;
    }

    // ── Networks: remove custom ──────────────────────────────
    case 'remove_network': {
      const { networkId } = m as { networkId: string };
      const customs = await getCustomNetworks();
      await setCustomNetworks(customs.filter(n => n.id !== networkId));
      // If we deleted the active network, reset to default
      const activeId = await getActiveNetworkId();
      if (activeId === networkId) await setActiveNetworkId('hny-devnet');
      respond({ ok: true });
      break;
    }

    // ── Networks: switch ─────────────────────────────────────
    case 'switch_network': {
      const { networkId } = m as { networkId: string };
      await setActiveNetworkId(networkId);
      const state = await getExtState();
      if (state) { state.networkId = networkId; await setExtState(state); }
      respond({ ok: true });
      if (state) broadcastToPopup({ type: 'state_update', state });
      break;
    }

    // ── Factory reset ────────────────────────────────────────
    case 'reset': {
      await clearAll();
      respond({ ok: true });
      break;
    }

    default:
      respond({ error: 'Unknown message type' });
  }
}

// ── Queue pending dApp request ────────────────────────────────
function queueRequest(opts: {
  type: 'connect' | 'sign' | 'tx'; origin: string; title: string;
  tabId: number; requestId: string; message?: string; txData?: import('./shared/types').DappTxData;
}) {
  const req: PendingRequest = {
    id: String(nextReqId++), type: opts.type, origin: opts.origin,
    title: opts.title, tabId: opts.tabId, inpageRequestId: opts.requestId,
    message: opts.message, txData: opts.txData,
  };
  pendingRequests.push(req);
  broadcastToPopup({ type: 'pending_requests', requests: pendingRequests });
  // Try to open the popup — succeeds only in Chrome 99+ when triggered by user gesture.
  // On failure (programmatic call without gesture), the badge serves as the cue.
  chrome.action.openPopup().catch(() => {
    // Notify the tab via a message so the page can show "Click the extension icon" prompt
    if (opts.tabId > 0) {
      chrome.tabs.sendMessage(opts.tabId, { type: 'hive_popup_required' } as BackgroundToContent).catch(() => {});
    }
  });
  chrome.action.setBadgeText({ text: String(pendingRequests.length) });
  chrome.action.setBadgeBackgroundColor({ color: '#f5b429' });
}

// ── Startup: lock wallet ──────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const state = await getExtState();
  if (state) { state.status = 'locked'; await setExtState(state); }
  await clearSessionSeed();
  await clearSessionPassword();
});
