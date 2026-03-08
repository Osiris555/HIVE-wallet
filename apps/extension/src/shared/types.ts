// Shared types for the HIVE Wallet browser extension

/** Persisted wallet state (chrome.storage.local) */
export type ExtState = {
  status: 'locked' | 'unlocked';
  address: string;        // active HNY_ address
  walletIndex: number;    // HD wallet index
  connectedOrigins: string[];
  chrysalisRegistered?: boolean;
  profileId?: string;     // active WalletProfile id
  networkId?: string;     // active NetworkConfig id
};

/** Multi-wallet profile */
export type WalletProfile = {
  id: string;
  name: string;
  address: string;           // primary address (HD index 0)
  walletIndex: number;       // currently active HD index
  hdAddresses: string[];     // all derived addresses [0, 1, 2, …]
  encryptedSeed: string;     // AES-GCM encrypted 32-byte master seed
  encryptedMnemonic: string; // AES-GCM encrypted mnemonic phrase (UTF-8)
  chrysalisRegistered: boolean;
};

/** Network configuration */
export type NetworkConfig = {
  id: string;
  name: string;
  shortName: string;
  rpcUrl: string;
  chainId?: string;
  currencySymbol: string;
  blockExplorer?: string;
  isTestnet: boolean;
  type: 'hive' | 'evm';
  isPreset?: boolean;
};

/** Transaction data from a dApp requesting authorization */
export type DappTxData = {
  txType: 'swap' | 'futures_open' | 'futures_close' | 'buy_nft' | 'generic';
  description: string;   // human-readable e.g. "Swap 10 HNY → USDC"
  fromToken?: string;
  toToken?: string;
  amountIn?: number;
  amountOut?: number;
  priceImpact?: number;
  fee?: number;
  leverage?: number;
  side?: 'long' | 'short';
  marketId?: string;
  nftId?: string;
  nftName?: string;
  price?: number;
  // raw params passed through to exec_ handler
  params?: Record<string, unknown>;
};

/** A dApp request awaiting user approval in the popup */
export type PendingRequest = {
  id: string;
  type: 'connect' | 'sign' | 'tx';
  origin: string;
  title: string;
  tabId: number;
  inpageRequestId: string;
  message?: string;
  txData?: DappTxData;
};

// ── Messages: Popup → Background ──────────────────────────────
export type PopupMessage =
  // Auth
  | { type: 'get_state' }
  | { type: 'setup';            mnemonic: string; password: string }
  | { type: 'unlock';           password: string }
  | { type: 'lock' }
  | { type: 'reset' }
  // dApp
  | { type: 'approve_request';  requestId: string }
  | { type: 'reject_request';   requestId: string }
  | { type: 'disconnect_site';  origin: string }
  // Wallet data
  | { type: 'fetch_wallet_data' }
  | { type: 'get_swap_quote';   fromToken: string; toToken: string; amountIn: number }
  | { type: 'get_pool_ratio';   tokenA: string; tokenB: string }
  // Transactions
  | { type: 'exec_send';        toWallet: string; amount: number; token: string }
  | { type: 'exec_swap';        fromToken: string; toToken: string; amountIn: number }
  | { type: 'exec_stake';       amount: number }
  | { type: 'exec_unstake';     amount: number }
  | { type: 'exec_add_lp';      tokenA: string; tokenB: string; amountA: number; amountB: number }
  | { type: 'exec_send_nft';    toWallet: string; nftId: string }
  // Wallet manager
  | { type: 'get_profiles' }
  | { type: 'create_profile';   name: string }
  | { type: 'import_profile';   name: string; mnemonic: string }
  | { type: 'switch_profile';   profileId: string }
  | { type: 'delete_profile';   profileId: string }
  | { type: 'add_address' }
  | { type: 'switch_address';   index: number }
  | { type: 'rename_profile';   profileId: string; name: string }
  | { type: 'get_seed_phrase';  password: string }
  // Networks
  | { type: 'get_networks' }
  | { type: 'add_network';      network: NetworkConfig }
  | { type: 'remove_network';   networkId: string }
  | { type: 'switch_network';   networkId: string };

// ── Messages: Content → Background ────────────────────────────
export type ContentToBackground = {
  type: 'inpage_request';
  method: string;
  params?: unknown[];
  requestId: string;
  origin: string;
  title: string;
  tabId: number;
};

// ── Messages: Background → Popup ──────────────────────────────
export type BackgroundToContent =
  | { type: 'state_update';     state: ExtState }
  | { type: 'pending_requests'; requests: PendingRequest[] }
  | { type: 'hive_response';    requestId: string; result?: unknown; error?: string }
  | { type: 'hive_popup_required' };

// ── window.hive provider ──────────────────────────────────────
export type HiveProvider = {
  isHive: true;
  accounts:           () => Promise<string[]>;
  requestAccounts:    () => Promise<string[]>;
  chainId:            () => Promise<string>;
  sign:               (message: string) => Promise<{ signature: string; address: string }>;
  getBalance:         () => Promise<string>;
  requestTransaction: (txData: DappTxData) => Promise<{ txId: string; success: boolean }>;
  on:                 (event: string, cb: (data: unknown) => void) => void;
  removeListener:     (event: string, cb: (data: unknown) => void) => void;
};
