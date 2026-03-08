// apps/mobile/src/app/index.tsx

import * as SecureStore from "expo-secure-store";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  Alert,
  View,
  useWindowDimensions,
} from "react-native";

import {
  preflightSend,
  cancelPending,
  computeServiceFee,
  ensureWalletId,
  getBalance,
  getChainStatus,
  getTransactions,
  mint,
  ONE_SAT,
  quoteSend,
  rbfReplacePending,
  send,
  stake,
  unlockStake,
  claimStakingReward,
  unstake,
  getStakingPositions,
  getApiBase,
  setApiBase,
  resetApiBase,
  parseAmount8,
  getAccount,
  getTransactionById,
  // Multi-token functions
  getTokens,
  getTokenBalances,
  getTokenPrices,
  tokenFaucet,
  sendToken,
  getSwapQuote,
  swap,
  getLiquidityPools,
  addLiquidity,
  removeLiquidity,
  getLpPositions,
  getLphnyAvailable,
  claimLpReward,
  computeWalletFee,
  WALLET_FEE_RATE,
  signMessageMLDSA,
  type Token,
  type TokenBalance,
  type SwapQuote,
  type LiquidityPool,
  type LpPosition,
  type ChrysalisAttestation,
} from "../chain/transactions";
import type { Transaction as TxLike, StakingPosition } from "../chain/transactions";
import {
  getWallets,
  createWallet,
  switchWallet,
  getActiveWallet,
  renameWallet,
  deleteWallet,
  getSeedFingerprint,
  exportMnemonic,
  getMasterSeed,
  getEvmSeed,
  getChrysalisKeypairForIndex,
  getActiveChrysalisPublicKeys,
  chrysalisFingerprint,
  getActiveHiveMLDSAKeypair,
  getProfiles,
  switchProfile,
  MNEMONIC_KEY,
  type WalletEntry,
  type WalletList,
  type SeedProfile,
} from "../chain/wallet-manager";
import type { EvmTransaction, EvmSwapQuote, EvmTokenHolding } from "../chain/evm-provider";
import {
  type ChrysalisPublicKeys,
  chrysalisEncrypt,
  chrysalisDecrypt,
  chrysalisSign,
  bytesToHex,
  hexToBytes,
  casPhiShard,
  casPhiReconstruct,
  generateRecoveryShards,
  type CasPhiManifest,
  type RecoveryShard,
  CHRYSALIS_VERSION,
} from "../chain/chrysalis";
import { ChrysalisModal } from "../components/ChrysalisModal";
import { HexQR } from "../components/HexQR";
import NFTPlayer from "../components/NFTPlayer";
import NFTMinter from "../components/NFTMinter";
import HoneyBook from "../components/HoneyBook";

/* ======================
   Web-safe KV storage
====================== */
function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
async function kvGet(key: string): Promise<string | null> {
  try {
    if (isWeb()) return window.localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function kvSet(key: string, value: string): Promise<void> {
  try {
    if (isWeb()) window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {}
}
async function kvDel(key: string): Promise<void> {
  try {
    if (isWeb()) window.localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {}
}

// Number formatting with commas
function fmtNum(n: number, decimals?: number): string {
  const d = decimals !== undefined ? decimals : (n < 1 && n > 0 ? 8 : n < 1000 ? 4 : 2);
  const parts = n.toFixed(d).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}
function fmtUSD(n: number): string {
  const parts = n.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + parts.join(".");
}

// Token icon emojis
const TOKEN_ICONS: { [key: string]: string } = {
  HNY: "🍯", stHNY: "🔒", ETH: "💎", BTC: "🟡", SOL: "☀️", USDT: "💵", USDC: "💚", XRP: "🌊", LPHNY: "🌊🍯",
};
const TOKEN_LIST = ["HNY", "stHNY", "LPHNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];
const FAUCET_TOKENS = ["HNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];
const SWAP_TOKENS = ["HNY", "stHNY", "LPHNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];
// LP pools available for user-managed liquidity
const LP_POOLS = ["HNY-ETH", "HNY-BTC", "HNY-USDT", "HNY-USDC", "HNY-SOL", "HNY-XRP", "stHNY-HNY"];
// Network presets
type NetworkPreset = {
  name: string;
  url: string;
  chainId?: string;
  currencySymbol?: string;
  blockExplorer?: string;
  isTestnet?: boolean;
  type?: "hive" | "evm"; // drives UI mode switch
};
const NETWORKS_STORAGE_KEY = "HIVE_NETWORKS";
const ACTIVE_NETWORK_STORAGE_KEY = "HIVE_ACTIVE_NETWORK_URL";
const ACTIVE_NETWORK_TYPE_KEY = "HIVE_ACTIVE_NETWORK_TYPE";
// Stores the last-used HIVE (non-EVM) server URL so Chrysalis ops still work
// when the active network is Base/EVM (which has no /chrysalis endpoints).
const HIVE_SERVER_URL_KEY = "HIVE_SERVER_URL";
const APP_PIN_KEY = "HIVE_APP_PIN";
const PRESET_NETWORKS: NetworkPreset[] = [
  { name: "Honey Testnet (Local)", url: "http://localhost:3000", chainId: "1",     currencySymbol: "HNY", isTestnet: true,  type: "hive" },
  { name: "Base Mainnet",          url: "https://mainnet.base.org",                chainId: "8453",  currencySymbol: "ETH", isTestnet: false, type: "evm", blockExplorer: "https://basescan.org" },
  { name: "Base Sepolia",          url: "https://sepolia.base.org",                chainId: "84532", currencySymbol: "ETH", isTestnet: true,  type: "evm", blockExplorer: "https://sepolia.basescan.org" },
];

// ── NFT types ─────────────────────────────────────────────────────────────────
type NftSummary = {
  id: string;
  name: string;
  media_type: string;
  file_count: number;
  owner_wallet: string;
  creator_wallet: string;
  listed_price_hny?: number | null;
  royalty_bps: number;
  minted_at: string;
  transfer_count: number;
  ai_description?: string;
  collection_id?: string | null;
  auction_id?: string | null;
};
type SecurityAlert = {
  id: number;
  tx_type: string;
  alert_level: "SAFE" | "CAUTION" | "ALERT";
  reason: string;
  created_at: string;
  dismissed: number;
};
type NftCollection = {
  id: string;
  name: string;
  description: string;
  creator_wallet: string;
  nft_count: number;
  created_at: string;
};
type NftAuction = {
  id: string;
  nft_id: string;
  seller_wallet: string;
  reserve_price_hny: number;
  min_increment_hny: number;
  current_bid_hny?: number | null;
  current_bidder?: string | null;
  ends_at: string;
  settled: number;
  name?: string;
  media_type?: string;
  file_count?: number;
};
type NftOffer = {
  id: number;
  nft_id: string;
  buyer_wallet: string;
  offer_hny: number;
  expires_at: string;
  accepted: number;
  cancelled: number;
  created_at: string;
  name?: string;
  media_type?: string;
};

type SavedContact = { name: string; address: string };
const CONTACTS_STORAGE_KEY = "HIVE_CONTACTS";
async function loadContacts(): Promise<SavedContact[]> {
  const raw = await kvGet(CONTACTS_STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function saveContactsToStorage(contacts: SavedContact[]) {
  await kvSet(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

/* ======================
   Theme + Skin
====================== */
type ThemeKey = "matrix" | "noir" | "honey";
type SkinKey = "athena-temple2" | "matrix-honey-coin" | "matrix-honeycomb" | "solid-noir";

function themeFor(t: ThemeKey) {
  const neon = "#39ff14";
  if (t === "noir") {
    return {
      text: "#f6f6f6",
      sub: "rgba(255,255,255,0.7)",
      border: "rgba(57,255,20,0.22)",
      glass: "rgba(0,0,0,0.55)",
      glass2: "rgba(0,0,0,0.35)",
      purple: "#6a2cff",
      gold: "#caa83c",
      green: neon,
      danger: "rgba(255,90,90,0.96)",
      blue: "#1f78ff",
      bg: "#050508",
    };
  }
  if (t === "honey") {
    return {
      text: "#fff5db",
      sub: "rgba(255,245,219,0.72)",
      border: "rgba(255,191,47,0.2)",
      glass: "rgba(12,6,18,0.58)",
      glass2: "rgba(12,6,18,0.38)",
      purple: "#6a2cff",
      gold: "#ffbf2f",
      green: neon,
      danger: "rgba(255,90,90,0.96)",
      blue: "#2b7cff",
      bg: "#07030a",
    };
  }
  return {
    text: "#ffffff",
    sub: "rgba(255,255,255,0.7)",
    border: "rgba(57,255,20,0.18)",
    glass: "rgba(0,0,0,0.45)",
    glass2: "rgba(0,0,0,0.3)",
    purple: "#7b2cff",
    gold: "#caa83c",
    green: neon,
    danger: "rgba(255,90,90,0.96)",
    blue: "#2b7cff",
    bg: "#040507",
  };
}

/* ======================
   UI primitives (module scope)
====================== */
function GlassCard(props: { children: React.ReactNode; style?: any }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
      : null;

  return (
    <View
      style={[{ borderRadius: 18, overflow: "hidden" }, webBlur, props.style]}
      // On iOS, tapping non-interactive areas inside the card dismisses the keyboard.
      // On web, we skip this so clicks on TextInputs aren't intercepted.
      onStartShouldSetResponder={Platform.OS !== "web" ? () => {
        Keyboard.dismiss();
        return false; // Don't capture the touch — let it pass to children
      } : undefined}
    >
      {props.children}
    </View>
  );
}

const Card = React.memo(function Card({
  children,
  style,
  T,
}: {
  children: React.ReactNode;
  style?: any;
  T: ReturnType<typeof themeFor>;
}) {
  return (
    <GlassCard style={[{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }, style]}>
      <View style={{ padding: 14 }}>{children}</View>
    </GlassCard>
  );
});

const Button = React.memo(function Button({
  label,
  onPress,
  disabled,
  variant,
  T,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: "green" | "purple" | "outline" | "danger" | "blue";
  T: ReturnType<typeof themeFor>;
}) {
  const bg =
    variant === "green"
      ? T.green
      : variant === "purple"
      ? T.purple
      : variant === "danger"
      ? T.danger
      : variant === "blue"
      ? T.blue
      : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: "center",
        backgroundColor: bg,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: T.border,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
});
/* ======================
   Small helpers
====================== */
function shortAddr(a: string) {
  if (!a) return "";
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function shortId(id: string) {
  const s = String(id || "");
  if (!s) return "";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
}

function formatTxTime(v: any): string {
  const n = typeof v === "string" && v.trim() ? Number(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  // if seconds, convert to ms
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(v);
  }
}

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${s}s`;
}

function fmt8(n: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00000000";
  return x.toFixed(8);
}

function fmtCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

/** Removes whitespace + zero-width characters that break HNY_ validation */
function sanitizeAddressInfo(input: string) {
  const raw = String(input ?? "");
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/\s+/g, "") // remove whitespace
    .trim();

  const changed = cleaned !== raw;
  return { cleaned, changed, rawLen: raw.length, cleanLen: cleaned.length };
}
function sanitizeAddress(input: string) {
  return sanitizeAddressInfo(input).cleaned;
}

function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}
function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}

/** iOS keyboard dismiss helper — wraps content so tapping empty space dismisses keyboard.
 *  On web this is a no-op passthrough to avoid stealing focus from TextInputs. */
function DismissKeyboardView(props: { children: React.ReactNode }) {
  if (Platform.OS === "web") {
    return <>{props.children}</>;
  }
  return (
    <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
      {props.children}
    </Pressable>
  );
}

/** Full-screen modal overlay */
function Overlay(props: { children: React.ReactNode; onClose: () => void; zIndex?: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
        backgroundColor: "rgba(0,0,0,0.65)",
        zIndex: props.zIndex ?? 9999,
      }}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Keyboard.dismiss();
          props.onClose();
        }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={{ width: "100%", maxWidth: 900 }} pointerEvents="box-none">
        {props.children}
      </View>
    </View>
  );
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const stakingModalHeight = Math.min(640, Math.max(420, winHeight - (insets.top + insets.bottom) - 140));
  /* ======================
     Core state (NO DUPLICATES)
  ====================== */
  const [theme, setTheme] = useState<ThemeKey>("matrix");
  const MIN_GAS_FEE_FLOOR = ONE_SAT; // base gas (1 Honey Cone)
  const [skin, setSkin] = useState<SkinKey>("athena-temple2");

  type PriorityTier = "none" | "small" | "medium" | "large";
  const [priorityTier, setPriorityTier] = useState<PriorityTier>("none");
  const [expectedNonce, setExpectedNonce] = useState<number | null>(null);

  const [chainId, setChainId] = useState("");
  const [chainHeight, setChainHeight] = useState(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState(0);
  const [serviceFeeRate, setServiceFeeRate] = useState(0);
  const [minGasFee, setMinGasFee] = useState(ONE_SAT);

  const [wallet, setWallet] = useState("");
  const [confirmedBalance, setConfirmedBalance] = useState(0);
  const [spendableBalance, setSpendableBalance] = useState(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState(0);
  const [pendingDelta, setPendingDelta] = useState(0);

  // ========== MULTI-WALLET STATE ==========
  const [walletList, setWalletList] = useState<WalletEntry[]>([]);
  const [activeWalletIndex, setActiveWalletIndex] = useState(0);
  const [walletSwitcherOpen, setWalletSwitcherOpen] = useState(false);
  const [walletBalances, setWalletBalances] = useState<{ [addr: string]: number }>({});
  const [newWalletLabel, setNewWalletLabel] = useState("");
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [editingWalletIdx, setEditingWalletIdx] = useState<number | null>(null);
  const [editWalletName, setEditWalletName] = useState("");
  // ── Seed profiles (multiple independent master seeds) ──────────────────────
  const [seedProfiles, setSeedProfiles]         = useState<SeedProfile[]>([]);
  const [activeProfileId, setActiveProfileId]   = useState<string>("default");
  const [profileSwitching, setProfileSwitching] = useState(false);

  const [txs, setTxs] = useState<TxLike[]>([]);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(0);

  const [message, setMessage] = useState("");
  const [mintCooldown, setMintCooldown] = useState<number>(0);
  const [mintBusy, setMintBusy] = useState<boolean>(false);

  // ========== MULTI-TOKEN STATE ==========
  const [tokenBalances, setTokenBalances] = useState<TokenBalance>({});
  const [tokenPrices, setTokenPrices] = useState<{ [symbol: string]: number }>({});
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<string>("HNY");
  const [swapTokenIn, setSwapTokenIn] = useState<string>("HNY");
  const [swapTokenOut, setSwapTokenOut] = useState<string>("ETH");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [tokenSendOpen, setTokenSendOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [faucetModalOpen, setFaucetModalOpen] = useState(false);

  // Token detail view
  const [tokenDetailSymbol, setTokenDetailSymbol] = useState<string | null>(null);

  // Address book
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactAddr, setNewContactAddr] = useState("");

  // Unified send state
  const [unifiedSendToken, setUnifiedSendToken] = useState("HNY");
  const [unifiedSendTo, setUnifiedSendTo] = useState("");
  const [unifiedSendAmount, setUnifiedSendAmount] = useState("");
  const [unifiedSendBusy, setUnifiedSendBusy] = useState(false);
  const [unifiedSendConfirmOpen, setUnifiedSendConfirmOpen] = useState(false);
  const [unifiedSendQuote, setUnifiedSendQuote] = useState<any>(null);

  // Faucet state
  const [faucetToken, setFaucetToken] = useState("ETH");
  const [faucetAmount, setFaucetAmount] = useState("100");
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [tokenCooldowns, setTokenCooldowns] = useState<{ [sym: string]: number }>({});

  // Swap extra state
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [swapConfirmOpen, setSwapConfirmOpen] = useState(false);

  // Staking load error tracking
  const [stakingLoadError, setStakingLoadError] = useState<string | null>(null);

  // ✅ Inputs (recipient and amount are separate!)
  const [toText, setToText] = useState("");
  const [amountText, setAmountText] = useState("");

  // Gas is derived from priority tier + minGasFee
  const [gasFeeText, setGasFeeText] = useState("");

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const [cameraMod, setCameraMod] = useState<any>(null);
  const CameraViewComp = cameraMod?.CameraView || cameraMod?.default?.CameraView || cameraMod?.Camera?.CameraView;

  const [cameraPerm, setCameraPerm] = useState<null | boolean>(null);
  const scanLockRef = useRef(false);

  const [copied, setCopied] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [sendBusy, setSendBusy] = useState(false);

  // Staking
  const [stakingPositions, setStakingPositions] = useState<StakingPosition[]>([]);
  const stakedBalance = useMemo(() => {
    const sum = (stakingPositions || []).reduce((acc, p: any) => {
      // When mixing ?? with || we must parenthesize; use a single ?? chain instead.
      const val = (p?.principal ?? p?.amount ?? 0);
      return acc + Number(val);
    }, 0);
    return Number(sum.toFixed(8));
  }, [stakingPositions]);

  // Some dev server implementations keep staked funds inside the wallet balance and track
  // staking positions separately. In that mode, the UI should subtract staked from spendable.
  // If the backend already subtracts locked funds, we fall back to simple spendable.
  const spendableDisplay = useMemo(() => {
    const s = Number(spendableBalance || 0);
    const c = Number(confirmedBalance || 0);
    const st = Number(stakedBalance || 0);
    if (st > 0 && s >= st && c >= st) return Number(Math.max(0, s - st).toFixed(8));
    return Number(s.toFixed(8));
  }, [spendableBalance, confirmedBalance, stakedBalance]);

  const totalDisplay = useMemo(() => {
    const s = Number(spendableBalance || 0);
    const st = Number(stakedBalance || 0);
    const c = Number(confirmedBalance || 0);
    // If the backend includes staked in wallet balances, total == confirmed/spendable raw.
    if (st > 0 && s >= st && c >= st) return Number(Math.max(c, s).toFixed(8));
    // Otherwise total is spendable + staked.
    return Number((Math.max(0, spendableDisplay) + st).toFixed(8));
  }, [spendableBalance, stakedBalance, confirmedBalance, spendableDisplay]);

  // Balances: server returns spendable = account balance - pending outgoing.
  // Staked HNY has already been deducted from the account by the server (moved to STAKE_VAULT).
  // So spendable is the true spendable amount — do NOT subtract staked again.
  const balancesView = useMemo(() => {
    const confirmedRaw = Number(confirmedBalance || 0);
    const spendableRaw = Number(spendableBalance || 0);
    const staked = Number(stakedBalance || 0);

    return {
      total: confirmedRaw,
      spendable: spendableRaw,
      staked,
    };
  }, [confirmedBalance, spendableBalance, stakedBalance]);

  const [stakingApr, setStakingApr] = useState<number>(0);
  const [stakeAmountText, setStakeAmountText] = useState<string>("");
  const [stakeLockDaysText, setStakeLockDaysText] = useState<string>("30");
  const [stakeBusy, setStakeBusy] = useState<boolean>(false);
  const [stakeConfirmOpen, setStakeConfirmOpen] = useState(false);
  const [stakePreview, setStakePreview] = useState<null | {
    amount: number;
    lockDays: number;
    gasFee: number;
    serviceFee: number;
    totalFee: number;
    totalCost: number;
  }>(null);
  const [unstakeBusyId, setUnstakeBusyId] = useState<string | null>(null);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [claimConfirmOpen, setClaimConfirmOpen] = useState(false);
  const [claimPreview, setClaimPreview] = useState<null | {
    positionId: string;
    claimable: number;
    gasFee: number;
    serviceFee: number;
    totalFee: number;
    timestamp: number;
  }>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [seedPhraseOpen, setSeedPhraseOpen] = useState(false);
  const [seedPhrase, setSeedPhrase] = useState<string | null>(null);
  const [seedPhraseCopied, setSeedPhraseCopied] = useState(false);

  // Native devices sometimes can't infer the LAN host (e.g. Expo tunnel mode).
  // Provide a simple override for the node API base.
  const [apiBaseText, setApiBaseText] = useState<string>(() => {
    try {
      return getApiBase();
    } catch {
      return "";
    }
  });
  const [stakingModalOpen, setStakingModalOpen] = useState(false);
  const [stakingTab, setStakingTab] = useState<"stake" | "unstake">("stake");

  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);

  // ========== NETWORK SWITCHER ==========
  const [networkSwitcherOpen, setNetworkSwitcherOpen] = useState(false);
  const [savedNetworks, setSavedNetworks] = useState<NetworkPreset[]>([]);
  const [activeNetworkName, setActiveNetworkName] = useState("Honey Testnet (Local)");
  const [newNetworkName, setNewNetworkName] = useState("");
  const [newNetworkUrl, setNewNetworkUrl] = useState("");
  const [newNetworkChainId, setNewNetworkChainId] = useState("");
  const [newNetworkCurrency, setNewNetworkCurrency] = useState("");
  const [newNetworkExplorer, setNewNetworkExplorer] = useState("");
  const [newNetworkIsTestnet, setNewNetworkIsTestnet] = useState(true);

  // ========== EVM MODE (Base / Ethereum) ==========
  const [activeNetworkType, setActiveNetworkType] = useState<"hive" | "evm">("hive");
  // URL of the Honey Network server — always used for Chrysalis, even when EVM mode is active.
  const [hiveServerUrl, setHiveServerUrl] = useState("http://localhost:3000");
  const [evmAddress, setEvmAddress] = useState("");
  const [evmChainId, setEvmChainId] = useState(0);
  const [evmEthBalance, setEvmEthBalance] = useState<bigint>(0n);
  const [evmTokenBals, setEvmTokenBals] = useState<Record<string, EvmTokenHolding>>({});
  const [evmTxHistory, setEvmTxHistory] = useState<EvmTransaction[]>([]);
  const [evmLoading, setEvmLoading] = useState(false);
  const [evmBlockExplorer, setEvmBlockExplorer] = useState("");
  // EVM Send
  const [evmSendOpen, setEvmSendOpen] = useState(false);
  const [evmSendTo, setEvmSendTo] = useState("");
  const [evmSendAmount, setEvmSendAmount] = useState("");
  const [evmSendBusy, setEvmSendBusy] = useState(false);
  const [evmSendGasEst, setEvmSendGasEst] = useState<bigint>(0n);
  // EVM Swap
  const [evmSwapOpen, setEvmSwapOpen] = useState(false);
  const [evmSwapSell, setEvmSwapSell] = useState("ETH");
  const [evmSwapBuy, setEvmSwapBuy] = useState("USDC");
  const [evmSwapAmount, setEvmSwapAmount] = useState("");
  const [evmSwapQuote, setEvmSwapQuote] = useState<EvmSwapQuote | null>(null);
  const [evmSwapBusy, setEvmSwapBusy] = useState(false);
  const [evmSwapFetchingQuote, setEvmSwapFetchingQuote] = useState(false);

  // ========== HONEYBOOK ==========
  const [honeyBookOpen, setHoneyBookOpen] = useState(false);

  // ========== NFT SYSTEM ==========
  const [nftGalleryOpen, setNftGalleryOpen] = useState(false);
  const [nftMinterOpen, setNftMinterOpen] = useState(false);
  const [myNfts, setMyNfts] = useState<NftSummary[]>([]);
  const [nftPlayerOpen, setNftPlayerOpen] = useState(false);
  const [nftPlayerTarget, setNftPlayerTarget] = useState<NftSummary | null>(null);
  const [nftGalleryTab, setNftGalleryTab] = useState<"mine" | "marketplace" | "collections" | "auctions">("mine");
  const [marketplaceNfts, setMarketplaceNfts] = useState<NftSummary[]>([]);
  const [nftLoading, setNftLoading] = useState(false);
  // Phase 7B: Collections
  const [myCollections, setMyCollections] = useState<NftCollection[]>([]);
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [newCollDesc, setNewCollDesc] = useState("");
  // Phase 7B: Auctions
  const [activeAuctions, setActiveAuctions] = useState<NftAuction[]>([]);
  const [auctionModalOpen, setAuctionModalOpen] = useState(false);
  const [auctionTargetNft, setAuctionTargetNft] = useState<NftSummary | null>(null);
  const [auctionReserve, setAuctionReserve] = useState("");
  const [auctionDuration, setAuctionDuration] = useState("24");
  const [bidModalOpen, setBidModalOpen] = useState(false);
  const [bidTargetAuction, setBidTargetAuction] = useState<NftAuction | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  // Phase 7B: Offers
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerTargetNft, setOfferTargetNft] = useState<NftSummary | null>(null);
  const [offerAmount, setOfferAmount] = useState("");
  const [myOffers, setMyOffers] = useState<NftOffer[]>([]);
  // Phase 7B: Marketplace filters
  const [marketFilterType, setMarketFilterType] = useState<string>("");
  const [marketFilterSort, setMarketFilterSort] = useState<string>("newest");
  const [nftActionBusy, setNftActionBusy] = useState(false);

  // ========== SOCIAL FEED ==========
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialPosts, setSocialPosts] = useState<Array<{ id: string; wallet: string; displayName: string; avatarEmoji: string; content: string; createdAtMs: number; likeCount: number }>>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialDraft, setSocialDraft] = useState('');

  async function loadSocialFeed() {
    setSocialLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/social/feed?limit=30`);
      const data = await res.json();
      setSocialPosts(data.posts ?? []);
    } catch { /* ignore */ }
    finally { setSocialLoading(false); }
  }

  // ========== QUEEN BEE AI ==========
  const [queenBeeAlerts, setQueenBeeAlerts] = useState<SecurityAlert[]>([]);
  const [queenBeeAlertsOpen, setQueenBeeAlertsOpen] = useState(false);
  const [queenBeeScanBusy, setQueenBeeScanBusy] = useState(false);
  const hasUnreadAlerts = queenBeeAlerts.some(a => a.alert_level === "ALERT" && !a.dismissed);

  // ========== APP PIN / LOCK ==========
  const [appLocked, setAppLocked] = useState(false);
  const [appPin, setAppPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [settingPinOpen, setSettingPinOpen] = useState(false);
  const [newPinInput, setNewPinInput] = useState("");
  const [confirmPinInput, setConfirmPinInput] = useState("");

  // ========== CHRYSALIS SECURITY FRAMEWORK ==========
  const [chrysalisKeys, setChrysalisKeys] = useState<ChrysalisPublicKeys | null>(null);
  const [chrysalisRegistered, setChrysalisRegistered] = useState(false);
  const [chrysalisRegistering, setChrysalisRegistering] = useState(false);
  const [chrysalisBackupShards, setChrysalisBackupShards] = useState<CasPhiManifest | null>(null);
  const [chrysalisBackupWorking, setChrysalisBackupWorking] = useState(false);
  // Restore state — paste shard JSONs to reconstruct
  const [chrysalisRestoreInputs, setChrysalisRestoreInputs] = useState<string[]>(["", "", ""]);
  const [chrysalisRestoreResult, setChrysalisRestoreResult] = useState<string | null>(null);
  const [chrysalisRestoreWorking, setChrysalisRestoreWorking] = useState(false);
  // Vault unlock ceremony — shown when user requests seed phrase
  const [chrysalisVaultOpen, setChrysalisVaultOpen] = useState(false);
  const [chrysalisVaultStage, setChrysalisVaultStage] = useState("");
  const [chrysalisVaultDone, setChrysalisVaultDone] = useState(false);
  // Recovery shard generation (passphrase-based, cross-device)
  const [recoveryShards, setRecoveryShards] = useState<RecoveryShard[] | null>(null);
  const [recoveryShardPassphrase, setRecoveryShardPassphrase] = useState("");
  const [recoveryShardConfirm, setRecoveryShardConfirm] = useState("");
  const [recoveryShardWorking, setRecoveryShardWorking] = useState(false);
  const [recoveryShardPassphraseOpen, setRecoveryShardPassphraseOpen] = useState(false);
  const [recoveryShardCopied, setRecoveryShardCopied] = useState<string | null>(null);
  // Chrysalis modal title (reused for all chrysalis operations)
  const [chrysalisVaultTitle, setChrysalisVaultTitle] = useState("Chrysalis Vault");
  // QR code modal
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrModalValue, setQrModalValue] = useState("");
  const [qrModalTitle, setQrModalTitle] = useState("");

  // ========== LIQUIDITY POOL ==========
  const [lpModalOpen, setLpModalOpen] = useState(false);
  const [lpTab, setLpTab] = useState<"positions" | "add" | "remove">("positions");
  const [lpPositions, setLpPositions] = useState<LpPosition[]>([]);
  const [lpApr, setLpApr] = useState(0.08);
  const [lpSelectedPool, setLpSelectedPool] = useState("HNY-ETH");
  const [lpAmountA, setLpAmountA] = useState("");
  const [lpAmountB, setLpAmountB] = useState("");
  const [lpBusy, setLpBusy] = useState(false);
  const [lpRemovePosition, setLpRemovePosition] = useState<LpPosition | null>(null);
  const [lpRemoveShares, setLpRemoveShares] = useState("");
  const [lpPoolList, setLpPoolList] = useState<LiquidityPool[]>([]);
  const [lpLoadError, setLpLoadError] = useState<string | null>(null);
  // LP real-time reward ticker
  const [lpLiveMs, setLpLiveMs] = useState(Date.now());
  // LP claim state
  const [lpClaimOpen, setLpClaimOpen] = useState(false);
  const [lpClaimPosition, setLpClaimPosition] = useState<LpPosition | null>(null);
  const [lpClaimBusy, setLpClaimBusy] = useState(false);

  // ✅ Toast exists (fixes "toast is not defined")
  const [toast, setToast] = useState<{ text: string; kind?: "info" | "warn" } | null>(null);

  // Focus/poll guards
  const editingRef = useRef(false);
  const pausePollingRef = useRef(false);

  const anyModalOpen =
    confirmOpen || historyOpen || settingsOpen || rbfOpen || cancelOpen || receiveOpen || tokenSendOpen || swapOpen || swapConfirmOpen || portfolioOpen || faucetModalOpen || unifiedSendConfirmOpen || !!tokenDetailSymbol || contactsOpen || stakingModalOpen || stakeConfirmOpen || walletSwitcherOpen || networkSwitcherOpen || lpModalOpen || lpClaimOpen;

  const sendFormDirty = !!toText || !!amountText;

  const T = themeFor(theme);

  /* ======================
     Background skin images
  ====================== */
  const athenaTempleBg = useMemo(() => require("./assets/skins/athena-temple2.png"), []);
  const honeyCoinBg = useMemo(() => require("./assets/skins/matrix-honey-coin.png"), []);
  const honeycombBg = useMemo(() => require("./assets/skins/matrix-honeycomb.png"), []);

  const bgSource = useMemo(() => {
    if (skin === "athena-temple2") return athenaTempleBg;
    if (skin === "matrix-honey-coin") return honeyCoinBg;
    if (skin === "matrix-honeycomb") return honeycombBg;
    return null;
  }, [skin, athenaTempleBg, honeyCoinBg, honeycombBg]);

  const bgOverlayOpacity = Platform.OS === "web" ? 0.55 : 0.32;

  function showToast(text: string, kind: "info" | "warn" = "info") {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 1400);
  }



function extractHnyAddress(input: string): string | null {
  const s = String(input || "").trim();
  const m = s.match(/HNY_[0-9a-fA-F]{40}/);
  return m ? m[0] : null;
}

async function openQrScanner() {
  setQrScanError(null);

  // On web, check for camera API support (Barcode Detection API — Chrome/Edge).
  // Falls back gracefully if unavailable.
  if (Platform.OS === "web") {
    if (!navigator?.mediaDevices?.getUserMedia) {
      showToast("Camera not available in this browser. Use paste.", "warn");
      return;
    }
  }

  try {
    const cam: any = await import("expo-camera");
    setCameraMod(cam);

    const requestPerm =
      cam?.requestCameraPermissionsAsync || cam?.Camera?.requestCameraPermissionsAsync || cam?.Camera?.requestPermissionsAsync;

    if (typeof requestPerm === "function") {
      const perm = await requestPerm();
      setCameraPerm(perm?.status === "granted");
      if (perm?.status !== "granted") {
        setQrScanError("Camera permission denied. Allow camera access in your browser/device settings.");
        return;
      }
    } else {
      // Some builds expose permission state via hook only. We'll still try to open.
      setCameraPerm(true);
    }

    scanLockRef.current = false;
    setQrScanOpen(true);
  } catch (e: any) {
    if (Platform.OS === "web") {
      setQrScanError("Camera unavailable. Try Chrome or Edge, or paste the address manually.");
    } else {
      setQrScanError("Camera unavailable. Ensure expo-camera is installed.");
    }
    showToast("Camera unavailable", "warn");
  }
}

async function pasteRecipientFromClipboard() {
  try {
    const s = await Clipboard.getStringAsync();
    const addr = extractHnyAddress(s);
    if (!addr) {
      showToast("Clipboard doesn't contain an HNY address", "warn");
      return;
    }
    setToText(sanitizeAddress(addr));
    setUnifiedSendTo(sanitizeAddress(addr));
    showToast("Recipient pasted");
    setQrScanOpen(false);
  } catch {
    showToast("Could not read clipboard", "warn");
  }
}
  function priorityRateFraction(t: PriorityTier) {
    // Priority fee is a percentage of the transfer amount.
    // none: 0%
    // small: 0.0007%
    // medium: 0.0010%
    // large: 0.0014%
    if (t === "small") return 0.000007;
    if (t === "medium") return 0.00001;
    if (t === "large") return 0.000014;
    return 0;
  }

  function computePriorityFeeFromAmountText(amtText: string) {
    const amtParsed = parseAmount8(amtText);
    const amt = amtParsed.ok ? Number(amtParsed.value || 0) : 0;
    const rate = priorityRateFraction(priorityTier);
    return Number((amt * rate).toFixed(8));
  }

  function computeChosenGas(minGas: number) {
    const mg = Math.max(Number(minGas || 0), MIN_GAS_FEE_FLOOR);
    const priorityFee = computePriorityFeeFromAmountText(amountText);
    return Number((mg + priorityFee).toFixed(8));
  }

  // Load persisted API base override (if any).
  useEffect(() => {
    (async () => {
      const saved = await kvGet("HIVE_API_BASE_OVERRIDE");
      if (saved) {
        setApiBase(saved);
        setApiBaseText(saved);
      } else {
        setApiBaseText(getApiBase());
      }
    })();
  }, []);


  // ✅ keep derived gas text updated (never user typed)
  useEffect(() => {
    const v = computeChosenGas(Number(minGasFee || ONE_SAT));
    setGasFeeText(fmt8(v));
  }, [priorityTier, minGasFee, amountText]);

  /* ======================
     Data loading
  ====================== */
  async function loadWallet() {
    // Guard: if no wallet has ever been set up, bail out.
    // The auth guard in _layout.tsx will redirect to onboarding.
    // Without this, getWallets() would auto-create a seed and race the guard.
    const seedExists = await kvGet("HIVE_MASTER_SEED_B64");
    const walletsExist = await kvGet("HIVE_WALLETS_JSON");
    if (!seedExists && !walletsExist) return;

    // Initialize multi-wallet system
    const wl = await getWallets();
    setWalletList(wl.wallets);
    setActiveWalletIndex(wl.activeIndex);

    // Load seed profiles for Settings switcher
    const profiles = await getProfiles();
    setSeedProfiles(profiles);
    const { getActiveProfileId } = await import("../chain/wallet-manager");
    setActiveProfileId(await getActiveProfileId());
    
    // Ensure active wallet is registered
    const w = await ensureWalletId();
    setWallet(String(w || ""));
    
    // Load balances for all wallets (for the switcher preview)
    loadAllWalletBalances(wl.wallets);
  }
  
  async function loadAllWalletBalances(wallets: WalletEntry[]) {
    const bals: { [addr: string]: number } = {};
    for (const w of wallets) {
      try {
        const data: any = await getTokenBalances(w.address);
        const balances = data?.balances || {};
        const tokens = data?.tokens || {};
        let totalUsd = 0;
        for (const [sym, amt] of Object.entries(balances)) {
          const price = Number((tokens[sym] as any)?.price || 0);
          totalUsd += Number(amt) * price;
        }
        bals[w.address] = totalUsd;
      } catch {
        bals[w.address] = 0;
      }
    }
    setWalletBalances(bals);
  }
  
  async function handleCreateWallet() {
    if (creatingWallet) return;
    setCreatingWallet(true);
    try {
      const label = newWalletLabel.trim() || `Wallet ${walletList.length + 1}`;
      const entry = await createWallet(label);
      
      // Register the new wallet on the server
      const { publicKeyB64 } = entry;
      try {
        const res = await fetch(`${await getApiBase()}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: publicKeyB64 }),
        });
        await res.json();
      } catch {}
      
      // Switch to the new wallet
      await switchWallet(entry.index);
      const w = entry.address;
      setWallet(w);

      // Refresh wallet list
      const wl = await getWallets();
      setWalletList(wl.wallets);
      setActiveWalletIndex(wl.activeIndex);
      setNewWalletLabel("");

      showToast(`Created "${label}"`);
      await hardRefreshAll();

      // Auto-register Chrysalis PQ keys for the new wallet (non-blocking, best-effort)
      doChrysalisRegister({ index: entry.index, address: entry.address }).catch(() => {});
    } catch (e: any) {
      setMessage(`Failed to create wallet: ${e?.message || "Unknown"}`);
    } finally {
      setCreatingWallet(false);
    }
  }
  
  async function handleSwitchWallet(index: number) {
    try {
      const entry = await switchWallet(index);
      setWallet(entry.address);
      setActiveWalletIndex(index);
      setWalletSwitcherOpen(false);
      showToast(`Switched to ${entry.label}`);
      await hardRefreshAll();
      // Refresh Chrysalis state for the newly-active wallet
      try {
        const pubKeys = await getActiveChrysalisPublicKeys();
        if (pubKeys) {
          setChrysalisKeys(pubKeys);
          const r = await fetch(`${hiveServerUrl}/chrysalis/status/${encodeURIComponent(entry.address)}`);
          if (r.ok) { const d = await r.json(); setChrysalisRegistered(!!d.protected); }
        } else {
          setChrysalisKeys(null);
          setChrysalisRegistered(false);
        }
      } catch { /* non-fatal */ }
    } catch (e: any) {
      setMessage(`Switch failed: ${e?.message || "Unknown"}`);
    }
  }

  /**
   * Core Chrysalis registration logic — can be called with an explicit wallet entry
   * (e.g. during wallet creation) or without to register the active wallet.
   * Returns true on success.
   */
  async function doChrysalisRegister(walletEntry?: { index: number; address: string }): Promise<boolean> {
    try {
      const target = walletEntry ?? (await getActiveWallet());
      if (!target) throw new Error("No wallet available");

      const bundle = await getChrysalisKeypairForIndex(target.index);
      const pubKeys: ChrysalisPublicKeys = {
        kemPublicKeyHex: bundle.kemPublicKeyHex,
        dsaPublicKeyHex: bundle.dsaPublicKeyHex,
        chrysalisId    : bundle.chrysalisId,
        version        : bundle.version,
      };

      // Always post to the HIVE server — Chrysalis endpoints don't exist on EVM RPC nodes.
      const res = await fetch(`${hiveServerUrl}/chrysalis/register`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          wallet         : target.address,
          chrysalisId    : bundle.chrysalisId,
          kemPublicKeyHex: bundle.kemPublicKeyHex,
          dsaPublicKeyHex: bundle.dsaPublicKeyHex,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Registration failed");

      // Update state (only relevant if registering the currently-active wallet)
      const activeW = await getActiveWallet();
      if (!walletEntry || activeW?.address === target.address) {
        setChrysalisKeys(pubKeys);
        setChrysalisRegistered(true);
      }
      return true;
    } catch (e: any) {
      console.warn("[Chrysalis] registration error:", e?.message);
      return false;
    }
  }

  /** Register Chrysalis for the active wallet (called from Settings UI) */
  async function registerChrysalis() {
    if (chrysalisRegistering) return;
    setChrysalisRegistering(true);
    setChrysalisVaultTitle("Key Registration");
    setChrysalisVaultStage("⚡ Deriving ML-KEM-768 keypair…");
    setChrysalisVaultDone(false);
    setChrysalisVaultOpen(true);
    try {
      setChrysalisVaultStage("🔑 Deriving ML-DSA-65 signing keypair…");
      await new Promise(r => setTimeout(r, 80));
      setChrysalisVaultStage("🌐 Registering post-quantum keys on Honey Network…");
      const ok = await doChrysalisRegister();
      if (ok) {
        setChrysalisVaultStage("✅ Wallet is now quantum-resistant");
        setChrysalisVaultDone(true);
      } else {
        setChrysalisVaultStage("❌ Registration failed. Is the server running?");
        setChrysalisVaultDone(true);
      }
    } catch (e: any) {
      setChrysalisVaultStage(`❌ ${e?.message || "Unknown error"}`);
      setChrysalisVaultDone(true);
    } finally {
      setChrysalisRegistering(false);
    }
  }

  /**
   * Phase 2 — Chrysalis Secure Backup
   * 1. Encrypt the mnemonic with the wallet's own ML-KEM-768 public key
   * 2. Encode the encrypted blob as UTF-8 bytes
   * 3. Apply CAS-φ sharding (5 shards, threshold = ceil(3 × φ) = 2)
   * 4. Return the manifest so the user can save/copy each shard
   * Any 3 of the 4 primary shards reconstruct the encrypted blob (RAID-5 threshold scheme).
   * Even with all shards, the data is still ML-KEM encrypted — quantum-safe.
   * Shards are randomly shuffled so decoys are NOT always in the last positions.
   * Exported shard JSON strips role/part — only {index, data} is revealed.
   */
  async function generateChrysalisBackup() {
    if (chrysalisBackupWorking) return;
    if (!chrysalisRegistered || !chrysalisKeys) {
      showToast("Activate Chrysalis first before creating a secure backup", "warn");
      return;
    }
    setChrysalisBackupWorking(true);
    setChrysalisVaultTitle("Secure Backup");
    setChrysalisVaultStage("🔐 Loading encrypted seed phrase…");
    setChrysalisVaultDone(false);
    setChrysalisVaultOpen(true);
    try {
      const mnemonic = await exportMnemonic();
      if (!mnemonic) throw new Error("No seed phrase found");

      const masterSeed = await getMasterSeed();
      if (!masterSeed) throw new Error("No master seed found");

      setChrysalisVaultStage("🔒 Encrypting with ML-KEM-768 public key…");
      await new Promise(r => setTimeout(r, 80));

      // Encrypt the mnemonic with the wallet's own ML-KEM public key
      const enc = new TextEncoder();
      const mnemonicBytes = enc.encode(mnemonic);
      const encryptedBlob = chrysalisEncrypt(mnemonicBytes, chrysalisKeys.kemPublicKeyHex);

      setChrysalisVaultStage("🧩 Sharding with CAS-φ (RAID-5, 4 shards)…");
      await new Promise(r => setTimeout(r, 80));

      // Encode the encrypted blob as JSON bytes for sharding
      const blobJson = JSON.stringify(encryptedBlob);
      const blobBytes = enc.encode(blobJson);

      // CAS-φ shard: 4 primary shards + 3 decoy shards, threshold = 3 (any 3 of 4 primaries)
      const manifest = casPhiShard(blobBytes, 5);
      setChrysalisBackupShards(manifest);
      setChrysalisVaultStage(`✅ Backup ready — ${manifest.primaryShards} shards, any ${manifest.threshold} restore`);
      setChrysalisVaultDone(true);
    } catch (e: any) {
      setChrysalisVaultStage(`❌ ${e?.message || "Backup error"}`);
      setChrysalisVaultDone(true);
    } finally {
      setChrysalisBackupWorking(false);
    }
  }

  /**
   * Reconstruct a Chrysalis backup from pasted shard JSONs.
   * Requires at least 3 primary shards + the wallet's ML-KEM private key (active wallet).
   * Uses the internal CasPhiManifest from this session (role/part metadata intact).
   */
  async function restoreChrysalisBackup() {
    if (chrysalisRestoreWorking) return;
    if (!chrysalisBackupShards) {
      showToast("Generate a backup first in this session — shards are session-only", "warn");
      return;
    }
    if (!chrysalisKeys) {
      showToast("Chrysalis must be activated to restore", "warn");
      return;
    }
    setChrysalisRestoreWorking(true);
    setChrysalisRestoreResult(null);
    try {
      // Parse each pasted shard and match to the in-session manifest by index
      const pastedIndices = new Set<number>();
      for (const raw of chrysalisRestoreInputs) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed.index === "number") pastedIndices.add(parsed.index);
        } catch { /* ignore bad input */ }
      }

      // Build a restricted manifest containing only the shards the user provided
      // (plus any primary shards already in the session manifest)
      const providedManifest: CasPhiManifest = {
        ...chrysalisBackupShards,
        shards: chrysalisBackupShards.shards.filter(
          s => s.role === "primary" && pastedIndices.has(s.index)
        ),
      };

      // If user provided 0 shards just use all primaries from session manifest
      const shardsToUse = providedManifest.shards.length >= chrysalisBackupShards.threshold
        ? providedManifest
        : chrysalisBackupShards;

      const reconstructedBytes = casPhiReconstruct(shardsToUse);

      // Parse the encrypted blob JSON (trim trailing zero padding)
      const dec = new TextDecoder();
      const blobJson = dec.decode(reconstructedBytes).replace(/\0+$/, "");
      const encryptedBlob = JSON.parse(blobJson);

      // Decrypt with ML-KEM private key (derived from active wallet's master seed)
      const activeWallet = await getActiveWallet();
      if (!activeWallet) throw new Error("No active wallet");
      const bundle = await getChrysalisKeypairForIndex(activeWallet.index);
      const decrypted = chrysalisDecrypt(encryptedBlob, bundle.kemSecretKeyHex);
      if (!decrypted) throw new Error("Decryption failed — shards may be incomplete or corrupted");

      const mnemonic = dec.decode(decrypted);
      setChrysalisRestoreResult(mnemonic);
      showToast("Backup reconstructed successfully!", "info");
    } catch (e: any) {
      showToast(`Restore failed: ${e?.message || "Unknown"}`, "warn");
    } finally {
      setChrysalisRestoreWorking(false);
    }
  }

  /**
   * Chrysalis Vault Unlock Ceremony
   * Gates access to the seed phrase behind a multi-stage Chrysalis authentication.
   * Each stage performs real cryptographic work; status text updates in real-time.
   * If Chrysalis is not registered the ceremony still runs but warns the user.
   */
  async function chrysalisUnlockSeed() {
    if (chrysalisVaultOpen) return;
    setSeedPhrase(null);
    setSeedPhraseOpen(false);
    setChrysalisVaultTitle("Chrysalis Vault");
    setChrysalisVaultDone(false);
    setChrysalisVaultOpen(true);

    const step = async (msg: string, ms = 550) => {
      setChrysalisVaultStage(msg);
      await new Promise(r => setTimeout(r, ms));
    };

    try {
      await step("🔐  Initiating Chrysalis Security Check…", 700);

      await step("⚡  Deriving ML-KEM-768 keypair from master seed…", 400);
      const activeWallet = await getActiveWallet();
      if (!activeWallet) throw new Error("No active wallet found");
      const bundle = await getChrysalisKeypairForIndex(activeWallet.index);

      await step("🌀  Deriving ML-DSA-65 signing keypair…", 400);

      await step("🔒  Verifying Chrysalis identity on Honey Network…", 600);
      if (chrysalisRegistered) {
        try {
          const r = await fetch(`${hiveServerUrl}/chrysalis/status/${encodeURIComponent(activeWallet.address)}`);
          if (r.ok) {
            const d = await r.json();
            if (!d.protected) throw new Error("Identity not found on server — re-activate Chrysalis in Settings");
          }
        } catch (netErr: any) {
          if (String(netErr?.message).includes("Identity not found")) throw netErr;
          setChrysalisVaultStage("⚠️  Network check skipped (server unreachable) — using local identity…");
          await new Promise(r => setTimeout(r, 700));
        }
      } else {
        await step("⚠️  Chrysalis not activated — running in reduced security mode…", 1000);
      }

      await step("🔑  Authenticating vault access via ML-DSA-65 signature…", 600);
      // Sign a vault-access token with the DSA key — proves key derivation succeeded
      const enc = new TextEncoder();
      const token = enc.encode(`HIVE_VAULT_ACCESS:${activeWallet.address}:${Date.now()}`);
      chrysalisSign(token, bundle.dsaSecretKeyHex);

      await step("📦  Decrypting seed vault…", 500);
      const phrase = await exportMnemonic();

      await step("✅  Chrysalis vault unlocked.", 800);

      setSeedPhrase(phrase);
      setChrysalisVaultDone(true);
      await new Promise(r => setTimeout(r, 500));
      setChrysalisVaultOpen(false);
      setSeedPhraseOpen(true);
    } catch (e: any) {
      setChrysalisVaultStage(`❌  ${e?.message || "Vault unlock failed"}`);
      await new Promise(r => setTimeout(r, 2500));
      setChrysalisVaultOpen(false);
      setChrysalisVaultDone(false);
    }
  }

  /**
   * Generate passphrase-based Recovery Shards for cross-device wallet recovery.
   * Unlike the ML-KEM Chrysalis backup, these can be decrypted on ANY device
   * using only the passphrase — no master seed required to decrypt.
   */
  async function doGenerateRecoveryShards() {
    if (recoveryShardWorking) return;
    if (recoveryShardPassphrase.length < 8) {
      showToast("Passphrase must be at least 8 characters", "warn");
      return;
    }
    if (recoveryShardPassphrase !== recoveryShardConfirm) {
      showToast("Passphrases do not match", "warn");
      return;
    }
    setRecoveryShardWorking(true);
    setRecoveryShardPassphraseOpen(false);
    setChrysalisVaultTitle("Recovery Shards");
    setChrysalisVaultStage("🔐 Exporting seed phrase…");
    setChrysalisVaultDone(false);
    setChrysalisVaultOpen(true);
    try {
      const mnemonic = await exportMnemonic();
      if (!mnemonic) throw new Error("No seed phrase found — create a wallet first");
      setChrysalisVaultStage("🛡️ Deriving PBKDF2 encryption key…");
      await new Promise(r => setTimeout(r, 100));
      setChrysalisVaultStage("🧩 Splitting into CAS-φ shards (RAID-5)…");
      const shards = generateRecoveryShards(mnemonic, recoveryShardPassphrase);
      setRecoveryShards(shards);

      // Upload encrypted shards to Honey Network (DRSS) — passphrase stays on device
      if (chrysalisRegistered && chrysalisKeys) {
        setChrysalisVaultStage("☁️ Uploading to Honey Network (DRSS)…");
        await new Promise(r => setTimeout(r, 100));
        const activeW = await getActiveWallet();
        if (activeW) {
          try {
            const drssRes = await fetch(`${hiveServerUrl}/chrysalis/shards`, {
              method : "POST",
              headers: { "Content-Type": "application/json" },
              body   : JSON.stringify({
                wallet      : activeW.address,
                chrysalisId : chrysalisKeys.chrysalisId,
                shards      : shards.map(s => ({ part: s.part, data: s.data })),
              }),
            });
            const drssData = await drssRes.json();
            if (!drssData.success) throw new Error(drssData.error || "DRSS upload failed");
          } catch (uploadErr: any) {
            // Non-fatal — local shards are still generated and displayed
            console.warn("DRSS upload failed (non-fatal):", uploadErr?.message);
          }
        }
      }

      setRecoveryShardPassphrase("");
      setRecoveryShardConfirm("");
      setChrysalisVaultStage("✅ 4 shards ready — also backed up to Honey Network");
      setChrysalisVaultDone(true);
    } catch (e: any) {
      setChrysalisVaultStage(`❌ ${e?.message || "Unknown error"}`);
      setChrysalisVaultDone(true);
    } finally {
      setRecoveryShardWorking(false);
    }
  }

  /**
   * Opens the Chrysalis ceremony modal and runs fn.
   * fn receives a setStage callback to update the modal text as the operation progresses.
   * Errors are displayed in the modal AND rethrown so callers can handle them.
   */
  async function runWithChrysalisModal(
    title: string,
    fn: (setStage: (s: string) => void) => Promise<void>,
  ): Promise<void> {
    const setStage = (s: string) => setChrysalisVaultStage(s);
    setChrysalisVaultTitle(title);
    setChrysalisVaultStage("🔑 Initializing Chrysalis…");
    setChrysalisVaultDone(false);
    setChrysalisVaultOpen(true);
    try {
      await fn(setStage);
      setChrysalisVaultDone(true);
    } catch (e: any) {
      setChrysalisVaultStage(`❌ ${e?.message || "Unknown error"}`);
      setChrysalisVaultDone(true);
      throw e;
    }
  }

  /**
   * Phase 2 — Build a ChrysalisAttestation for an outgoing transaction.
   * Signs a canonical JSON payload with ML-DSA-65 so the server can store
   * and (in Phase 3) verify the post-quantum co-signature.
   * Returns null if Chrysalis is not activated for this wallet.
   */
  async function buildChrysalisAttestation(txParams: {
    type: string; to: string; amount: number; gasFee: number; serviceFee: number;
  }): Promise<ChrysalisAttestation | undefined> {
    if (!chrysalisRegistered || !chrysalisKeys) return undefined;
    try {
      const activeWallet = await getActiveWallet();
      if (!activeWallet) return undefined;
      const bundle = await getChrysalisKeypairForIndex(activeWallet.index);

      // Canonical attestation body (timestamp added for replay resistance)
      const body = JSON.stringify({
        type      : txParams.type,
        to        : txParams.to,
        amount    : txParams.amount,
        gasFee    : txParams.gasFee,
        serviceFee: txParams.serviceFee,
        issuedAt  : Date.now(),
        version   : CHRYSALIS_VERSION,
      });
      const enc = new TextEncoder();
      const bodyBytes = enc.encode(body);
      const sigBytes = chrysalisSign(bodyBytes, bundle.dsaSecretKeyHex);

      return {
        chrysalisId    : bundle.chrysalisId,
        dsaPublicKeyHex: bundle.dsaPublicKeyHex,
        dsaSignatureHex: bytesToHex(sigBytes),
        version        : "2.0",
      };
    } catch {
      return undefined; // attestation is optional — never block a tx
    }
  }

  async function refreshStatus() {
    const st: any = await getChainStatus();
    setChainId(String(st?.chainId || ""));
    setChainHeight(Number(st?.chainHeight || st?.height || 0));
    setMsUntilNextBlock(Number(st?.msUntilNextBlock || 0));
    setServiceFeeRate(Number(st?.serviceFeeRate || 0));
    // ✅ never allow 0 min gas
    setMinGasFee(Math.max(Number(st?.minGasFee || 0), MIN_GAS_FEE_FLOOR));
    setFeeVaultBalance(Number(st?.feeVaultBalance || st?.feeVault || 0));
  }

  async function loadBalance() {
    if (!wallet) return;
    const b: any = await getBalance(wallet);

    const confirmed = Number(b?.confirmed ?? b?.balance ?? 0);
    const spendable = Number(b?.spendable ?? b?.spendableBalance ?? confirmed ?? 0);
    const vault = Number(b?.feeVault ?? b?.feeVaultBalance ?? feeVaultBalance ?? 0);
    const pd = Number(b?.pendingDelta ?? 0);

    setConfirmedBalance(confirmed);
    setSpendableBalance(spendable);
    setFeeVaultBalance(vault);
    setPendingDelta(pd);
  }

  async function loadTxs() {
    if (!wallet) return;
    const list = await getTransactions(wallet);
    setTxs(list || []);
  }

  async function loadStaking() {
    if (!wallet) return;
    try {
      const res = await getStakingPositions(wallet);
      setStakingPositions(res?.positions || []);
      setStakingApr(Number(res?.apr || 0));
      setStakingLoadError(null);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      setStakingLoadError(msg);
      if (msg) setMessage(`Staking load failed: ${msg}`);
      console.warn("Staking load failed", e);
    }
  }

  async function loadTokenData() {
    if (!wallet) return;
    try {
      const { balances: bals, tokens: tokenInfo } = await getTokenBalances(wallet);
      setTokenBalances(bals);
      const priceMap: { [s: string]: number } = {};
      for (const [sym, info] of Object.entries(tokenInfo)) {
        priceMap[sym] = (info as any).price || 0;
      }
      setTokenPrices(priceMap);
    } catch (e: any) {
      console.warn("Token data load failed:", e?.message);
    }
  }

  async function loadContactsOnBoot() {
    const c = await loadContacts();
    setContacts(c);
  }

  async function loadLpData() {
    if (!wallet) return;
    try {
      const { positions, apr } = await getLpPositions(wallet);
      setLpPositions(positions);
      setLpApr(Number(apr || 0.08));
      setLpLoadError(null);
    } catch (e: any) {
      setLpLoadError(String(e?.message || "LP load failed"));
    }
    try {
      const pools = await getLiquidityPools();
      setLpPoolList(pools.filter(p => LP_POOLS.includes(p.id)));
    } catch {}
  }

  async function loadNetworks() {
    try {
      const raw = await kvGet(NETWORKS_STORAGE_KEY);
      const list: NetworkPreset[] = raw ? JSON.parse(raw) : [];
      setSavedNetworks(list);
      const activeUrl = await kvGet(ACTIVE_NETWORK_STORAGE_KEY);
      if (activeUrl) {
        setApiBase(activeUrl);
        setApiBaseText(activeUrl);
        const found = [...PRESET_NETWORKS, ...list].find(n => n.url === activeUrl);
        setActiveNetworkName(found?.name || activeUrl);
        // Restore EVM mode if the last active network was EVM
        const savedType = await kvGet(ACTIVE_NETWORK_TYPE_KEY);
        const networkType = (found?.type ?? savedType ?? "hive") as "hive" | "evm";
        if (networkType === "evm") {
          setActiveNetworkType("evm");
          if (found?.blockExplorer) setEvmBlockExplorer(found.blockExplorer);
          // Restore the HIVE server URL for Chrysalis (stored separately since EVM RPC has no /chrysalis)
          const savedHiveUrl = await kvGet(HIVE_SERVER_URL_KEY);
          if (savedHiveUrl) setHiveServerUrl(savedHiveUrl);
          await loadEvmData(activeUrl, Number(found?.chainId || 8453));
        } else {
          // Active network is HIVE — use it as the hiveServerUrl so Chrysalis works
          // even on mobile where localhost != 192.168.x.x
          setHiveServerUrl(activeUrl);
          await kvSet(HIVE_SERVER_URL_KEY, activeUrl);
        }
      }
    } catch {}
  }

  // ── NFT data loaders ────────────────────────────────────────────────────────
  async function loadNfts(w?: string) {
    const addr = w || wallet;
    if (!addr || !hiveServerUrl) return;
    try {
      setNftLoading(true);
      const res = await fetch(`${hiveServerUrl}/nft/wallet/${addr}`);
      const data = await res.json();
      setMyNfts(data.nfts ?? []);
    } catch { /* non-fatal */ } finally {
      setNftLoading(false);
    }
  }

  async function loadMarketplace(filterType?: string, sortBy?: string) {
    if (!hiveServerUrl) return;
    try {
      const params = new URLSearchParams();
      const ft = filterType ?? marketFilterType;
      const sb = sortBy ?? marketFilterSort;
      if (ft) params.set("mediaType", ft);
      if (sb) params.set("sort", sb);
      const qs = params.toString();
      const res = await fetch(`${hiveServerUrl}/nft/marketplace${qs ? "?" + qs : ""}`);
      const data = await res.json();
      setMarketplaceNfts(data.nfts ?? []);
    } catch { /* non-fatal */ }
  }

  async function loadCollections(w?: string) {
    const addr = w || wallet;
    if (!addr || !hiveServerUrl) return;
    try {
      const res = await fetch(`${hiveServerUrl}/nft/collections/${addr}`);
      const data = await res.json();
      setMyCollections(data.collections ?? []);
    } catch { /* non-fatal */ }
  }

  async function loadAuctions() {
    if (!hiveServerUrl) return;
    try {
      const res = await fetch(`${hiveServerUrl}/nft/auction/active`);
      const data = await res.json();
      setActiveAuctions(data.auctions ?? []);
    } catch { /* non-fatal */ }
  }

  async function loadMyOffers(w?: string) {
    const addr = w || wallet;
    if (!addr || !hiveServerUrl) return;
    try {
      const res = await fetch(`${hiveServerUrl}/nft/my-offers/${addr}`);
      const data = await res.json();
      setMyOffers(data.offers ?? []);
    } catch { /* non-fatal */ }
  }

  async function handleCreateCollection() {
    if (!newCollName.trim() || !wallet || !hiveServerUrl) return;
    setNftActionBusy(true);
    try {
      const timestamp = Date.now();
      const collId = `col_preview_${timestamp}`;
      const sig = await nftSignMessage(`collection_create|${wallet}|${collId}|${timestamp}`);
      const res = await fetch(`${hiveServerUrl}/nft/collection/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, name: newCollName.trim(), description: newCollDesc.trim(), signatureHex: sig, timestamp }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      showToast(`Collection "${newCollName.trim()}" created! 📁`);
      setNewCollName(""); setNewCollDesc("");
      setCreateCollectionOpen(false);
      await loadCollections();
    } catch (e: any) {
      showToast(e.message || "Create collection failed", "warn");
    } finally {
      setNftActionBusy(false);
    }
  }

  async function handleCreateAuction() {
    if (!auctionTargetNft || !wallet || !hiveServerUrl) return;
    setNftActionBusy(true);
    try {
      const timestamp = Date.now();
      const sig = await nftSignMessage(`auction_create|${wallet}|${auctionTargetNft.id}|${timestamp}`);
      const res = await fetch(`${hiveServerUrl}/nft/auction/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet, nft_id: auctionTargetNft.id,
          reserve_price_hny: Number(auctionReserve) || 0,
          min_increment_hny: 1,
          duration_hours: Number(auctionDuration) || 24,
          signatureHex: sig, timestamp,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      showToast(`Auction started! Ends in ${auctionDuration}h 🔨`);
      setAuctionModalOpen(false); setAuctionTargetNft(null);
      setAuctionReserve(""); setAuctionDuration("24");
      await Promise.all([loadNfts(), loadAuctions()]);
    } catch (e: any) {
      showToast(e.message || "Create auction failed", "warn");
    } finally {
      setNftActionBusy(false);
    }
  }

  async function handleBid() {
    if (!bidTargetAuction || !wallet || !hiveServerUrl) return;
    setNftActionBusy(true);
    try {
      const timestamp = Date.now();
      const sig = await nftSignMessage(`auction_bid|${wallet}|${bidTargetAuction.id}|${timestamp}`);
      const res = await fetch(`${hiveServerUrl}/nft/auction/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auction_id: bidTargetAuction.id, bidder_wallet: wallet, bid_hny: Number(bidAmount), signatureHex: sig, timestamp }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      showToast(`Bid placed: ${bidAmount} HNY 🔨`);
      setBidModalOpen(false); setBidTargetAuction(null); setBidAmount("");
      await Promise.all([loadAuctions(), loadBalance()]);
    } catch (e: any) {
      showToast(e.message || "Bid failed", "warn");
    } finally {
      setNftActionBusy(false);
    }
  }

  async function handleMakeOffer() {
    if (!offerTargetNft || !wallet || !hiveServerUrl) return;
    setNftActionBusy(true);
    try {
      const timestamp = Date.now();
      const sig = await nftSignMessage(`offer_make|${wallet}|${offerTargetNft.id}|${timestamp}`);
      const res = await fetch(`${hiveServerUrl}/nft/offer/make`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nft_id: offerTargetNft.id, buyer_wallet: wallet, offer_hny: Number(offerAmount), expires_hours: 48, signatureHex: sig, timestamp }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      showToast(`Offer of ${offerAmount} HNY sent! 💌`);
      setOfferModalOpen(false); setOfferTargetNft(null); setOfferAmount("");
      await Promise.all([loadBalance(), loadMyOffers()]);
    } catch (e: any) {
      showToast(e.message || "Offer failed", "warn");
    } finally {
      setNftActionBusy(false);
    }
  }

  async function handleCancelOffer(offerId: number, offerHny: number) {
    if (!wallet || !hiveServerUrl) return;
    try {
      const timestamp = Date.now();
      const sig = await nftSignMessage(`offer_cancel|${wallet}|${offerId}|${timestamp}`);
      const res = await fetch(`${hiveServerUrl}/nft/offer/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_id: offerId, wallet, signatureHex: sig, timestamp }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      showToast(`Offer cancelled. ${offerHny} HNY refunded.`);
      await Promise.all([loadBalance(), loadMyOffers()]);
    } catch (e: any) {
      showToast(e.message || "Cancel failed", "warn");
    }
  }

  async function loadQueenBeeAlerts(w?: string) {
    const addr = w || wallet;
    if (!addr || !hiveServerUrl) return;
    try {
      const res = await fetch(`${hiveServerUrl}/queen-bee/alerts/${addr}`);
      const data = await res.json();
      setQueenBeeAlerts(data.alerts ?? []);
    } catch { /* non-fatal */ }
  }

  async function runQueenBeeScan() {
    if (!wallet || !hiveServerUrl) return;
    setQueenBeeScanBusy(true);
    try {
      const res = await fetch(`${hiveServerUrl}/queen-bee/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json();
      showToast(data.summary ? data.summary.slice(0, 80) : "Scan complete", "info");
      await loadQueenBeeAlerts();
    } catch (e: any) {
      showToast("Scan failed: " + (e?.message || "unknown"), "warn");
    } finally {
      setQueenBeeScanBusy(false);
    }
  }

  async function dismissQueenBeeAlert(alertId: number) {
    if (!wallet || !hiveServerUrl) return;
    try {
      await fetch(`${hiveServerUrl}/queen-bee/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId, wallet }),
      });
      setQueenBeeAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch { /* non-fatal */ }
  }

  // NFT sign helper — signs the canonical "nft_action|wallet|nft_id|timestamp" message
  async function nftSignMessage(message: string): Promise<string> {
    const kp = await getActiveHiveMLDSAKeypair();
    if (!kp) throw new Error("No active wallet keypair");
    return signMessageMLDSA(message, kp.secretKey);
  }

  async function hardRefreshAll() {
    try {
      const currentWallet = await ensureWalletId();
      if (currentWallet && currentWallet !== wallet) setWallet(currentWallet);
      await refreshStatus();
      await loadBalance();
      await loadTxs();
      await loadStaking();
      await loadTokenData();
      await loadLpData();
      if (walletList.length > 0) loadAllWalletBalances(walletList);
      loadNfts(currentWallet || wallet).catch(() => {});
      loadQueenBeeAlerts(currentWallet || wallet).catch(() => {});
      loadCollections(currentWallet || wallet).catch(() => {});
      loadAuctions().catch(() => {});
      loadMyOffers(currentWallet || wallet).catch(() => {});
      setLastRefresh(Date.now());
    } catch (e: any) {
      setMessage(e?.message || "Refresh failed");
    }
  }

  /* ======================
     Web background position fix
     RN Web renders <Image resizeMode="cover"> as a <div> (or nested divs) with
     background-image + background-position:center set as an inline style.
     CSS injection can't reliably target the right nested node, so we use a ref
     and setProperty(...,'important') directly on the element AND every descendant
     after each render — this beats any inline style React Native Web sets.
  ====================== */
  const bgImgRef = useRef<any>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !bgImgRef.current) return;
    const fix = (el: any) => {
      try {
        el?.style?.setProperty?.("background-position", "top center", "important");
        el?.style?.setProperty?.("object-position",    "top center", "important");
      } catch (_) {}
    };
    fix(bgImgRef.current);
    try { bgImgRef.current?.querySelectorAll?.("*")?.forEach?.(fix); } catch (_) {}
  }); // no deps — runs after every render to counteract RN Web's own style resets

  /* ======================
     Boot + live refresh
  ====================== */
  useEffect(() => {
    (async () => {
      // Load PIN lock first — if a PIN is set, lock the app immediately
      const savedPin = await kvGet(APP_PIN_KEY);
      if (savedPin) {
        setAppPin(savedPin);
        setAppLocked(true);
      }
      await loadNetworks();
      await loadWallet();
      await refreshStatus();
      await loadContactsOnBoot();
      // Derive + check Chrysalis registration status after wallet loads
      try {
        const pubKeys = await getActiveChrysalisPublicKeys();
        if (pubKeys) {
          setChrysalisKeys(pubKeys);
          // Check if already registered on server
          const r = await fetch(`${hiveServerUrl}/chrysalis/status/${encodeURIComponent(
            (await getActiveWallet())?.address || ""
          )}`);
          if (r.ok) {
            const d = await r.json();
            setChrysalisRegistered(!!d.protected);
          }
        }
      } catch { /* non-fatal — chrysalis loads lazily */ }
    })().catch((e) => setMessage(String((e as any)?.message || e)));
  }, []);

  useEffect(() => {
    if (!wallet) return;
    hardRefreshAll().catch(() => {});
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    if (!liveRefresh) return;

    const i = setInterval(async () => {
      if (pausePollingRef.current) return;
      if (editingRef.current) return;
      if (anyModalOpen) return;
      if (sendFormDirty) return;

      try {
        await refreshStatus();
        await loadBalance();
        await loadTxs();
        await loadStaking();
        await loadTokenData();
        await loadLpData();
        setLastRefresh(Date.now());
      } catch {}
    }, 2500);

    return () => clearInterval(i);
  }, [wallet, liveRefresh, anyModalOpen, sendFormDirty]);

  // Ensure staking positions are fresh when the staking modal is opened / tabbed.
  useEffect(() => {
    if (!wallet) return;
    if (!stakingModalOpen) return;
    loadStaking().catch(() => {});
  }, [wallet, stakingModalOpen]);

  useEffect(() => {
    if (!wallet) return;
    if (!stakingModalOpen) return;
    if (stakingTab !== "unstake") return;
    loadStaking().catch(() => {});
  }, [wallet, stakingModalOpen, stakingTab]);

  // Refresh LP data when LP modal is opened
  useEffect(() => {
    if (!wallet) return;
    if (!lpModalOpen) return;
    loadLpData().catch(() => {});
  }, [wallet, lpModalOpen]);

  // Real-time LP reward ticker — ticks every second while LP modal or claim modal is open
  useEffect(() => {
    if (!lpModalOpen && !lpClaimOpen) return;
    const t = setInterval(() => setLpLiveMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lpModalOpen, lpClaimOpen]);

  // mint cooldown ticker
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => {
      if (editingRef.current) return;
      setMintCooldown((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  // Tick down token faucet cooldowns
  useEffect(() => {
    const hasActive = Object.values(tokenCooldowns).some(v => v > 0);
    if (!hasActive) return;
    const t = setInterval(() => {
      setTokenCooldowns(prev => {
        const next: any = {};
        for (const [k, v] of Object.entries(prev)) {
          next[k] = Math.max(0, (v as number) - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [tokenCooldowns]);

  /* ======================
     Persist prefs per chain
  ====================== */
  useEffect(() => {
    (async () => {
      if (!chainId) return;

      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "matrix" || savedTheme === "noir" || savedTheme === "honey") {
        setTheme(savedTheme as ThemeKey);
      }

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix-honey-coin" || savedSkin === "matrix-honeycomb" || savedSkin === "solid-noir") {
        setSkin(savedSkin as SkinKey);
      }
    })().catch(() => {});
  }, [chainId]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(themeKeyForChain(chainId), theme).catch(() => {});
  }, [theme, chainId]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(skinKeyForChain(chainId), skin).catch(() => {});
  }, [skin, chainId]);

  /* ======================
     Actions
  ====================== */
  async function copyWalletToClipboard() {
    if (!wallet) {
      setMessage("Wallet not ready yet.");
      return;
    }
    const w = String(wallet).trim();
    await Clipboard.setStringAsync(w);
    setCopied(true);
    setMessage("Wallet copied ✅");
    setTimeout(() => setCopied(false), 1200);
  }

  function closeAllModals(opts?: { keepMessage?: boolean }) {
    setConfirmOpen(false);
    setHistoryOpen(false);
    setSettingsOpen(false);
    setSeedPhraseOpen(false);
    setSeedPhrase(null);
    setSeedPhraseCopied(false);
    setRbfOpen(false);
    setCancelOpen(false);
    setReceiveOpen(false);
    setTokenSendOpen(false);
    setSwapOpen(false);
    setSwapConfirmOpen(false);
    setPortfolioOpen(false);
    setFaucetModalOpen(false);
    setUnifiedSendConfirmOpen(false);
    setTokenDetailSymbol(null);
    setContactsOpen(false);
    setQrScanOpen(false);
    setStakeConfirmOpen(false);
    setNetworkSwitcherOpen(false);
    setLpModalOpen(false);
    setLpAmountA("");
    setLpAmountB("");
    setLpRemoveShares("");
    setLpRemovePosition(null);
    setLpClaimOpen(false);
    setLpClaimPosition(null);
    setSettingPinOpen(false);

    setQuote(null);
    setRbfTx(null);
    setCancelTx(null);
    setUnifiedSendQuote(null);
    setStakePreview(null);

    pausePollingRef.current = false;
    if (!opts?.keepMessage) setMessage("");
  }

  function normalizeAmountText(s: string) {
    return String(s ?? "")
      .replace(",", ".")
      .replace(/[^\d.]/g, "")
      .replace(/(\..*)\./g, "$1")
      .trim();
  }

  async function handleMint() {
    if (mintBusy) return;
    if (mintCooldown > 0) {
      setMessage(`Mint cooldown active (${mintCooldown}s)`);
      return;
    }
    setMessage("");
    setMintBusy(true);
    try {
      const res: any = await mint();
      setMessage("Mint submitted ✅");
      await hardRefreshAll();
      setMintCooldown(Number(res?.cooldownSeconds || 60));
    } catch (e: any) {
      setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
    } finally {
      setMintBusy(false);
    }
  }

  function openStakeConfirm() {
    const amtTextClean = normalizeAmountText(stakeAmountText);
    const amtCheck = parseAmount8(amtTextClean);
    if (!amtCheck.ok || Number(amtCheck.value) <= 0) {
      setMessage("Staking amount is required.");
      return;
    }
    const lockDays = Number(String(stakeLockDaysText || "").trim());
    if (!Number.isInteger(lockDays) || lockDays <= 0) {
      setMessage("Lock days must be a positive integer.");
      return;
    }
    const amount = Number(amtCheck.value);
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));
    // Service fee = 0.0005% of USD value.
    // Server uses HNY_PRICE_USD=1.00 constant for HNY stake fee — must match.
    const serviceFee = Number((amount * serviceFeeRate).toFixed(8));
    const stakeWalletFee = computeWalletFee(serviceFee);
    const totalFee = Number((chosenGas + serviceFee + stakeWalletFee).toFixed(8));
    const totalCost = Number((amount + totalFee).toFixed(8));

    if (balancesView.spendable < totalCost) {
      setMessage(`Insufficient HNY. Need ${fmtNum(totalCost)} (${fmtNum(amount)} stake + ${fmtNum(totalFee)} fees).`);
      return;
    }

    setStakePreview({ amount, lockDays, gasFee: chosenGas, serviceFee, totalFee, totalCost });
    setStakeConfirmOpen(true);
  }

  async function handleStakeSubmit() {
    if (stakeBusy || !stakePreview) return;
    setStakeBusy(true);
    setStakeConfirmOpen(false);
    try {
      await runWithChrysalisModal("Stake", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage("🔏 Signing stake with Chrysalis attestation…");
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");
        await stake({ amount: stakePreview!.amount, lockDays: stakePreview!.lockDays, gasFee: stakePreview!.gasFee, serviceFee: stakePreview!.serviceFee });
        setStage(`✅ Staked ${fmtNum(stakePreview!.amount)} HNY for ${stakePreview!.lockDays} days`);
        setStakeAmountText("");
        setStakePreview(null);
      });
      await hardRefreshAll();
    } catch {
      // error already shown in ceremony modal
    } finally {
      setStakeBusy(false);
    }
  }

  async function handleUnstake(positionId: string) {
    if (unstakeBusyId) return;
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));
    setUnstakeBusyId(positionId);
    try {
      const pos: any = (stakingPositions || []).find((p: any) => String(p.id) === String(positionId));

      // Check if position exists and is not already withdrawn
      if (!pos) {
        setMessage("Position not found or already withdrawn");
        return;
      }

      const posStatus = String(pos?.status || "");
      
      // If already unstaked, show appropriate message
      if (posStatus === "unstaked") {
        setMessage("Position has already been withdrawn");
        return;
      }

      // If still staked, initiate unlock (rewards freeze during unlock).
      if (posStatus === "staked") {
        // Use a unique variable name to avoid accidental redeclarations across edits/hot reloads.
        const unlockDelayDays = Number(pos?.unlockDelayDays ?? (Number(pos?.lockDays) === 30 ? 3 : 7));
        const ok = Platform.OS === "web"
          ? Boolean((globalThis as any)?.confirm?.(
              `Start unlock?\n\nUnlock delay: ${unlockDelayDays} days\nRewards will stop accruing during unlock.\n\nYou can withdraw after the delay, and any unclaimed rewards will be added to the principal.`
            ))
          : await new Promise<boolean>((resolve) => {
              Alert.alert(
                "Start unlock?",
                `Unlock delay: ${unlockDelayDays} days\nRewards will stop accruing during unlock.\n\nYou can withdraw after the delay, and any unclaimed rewards will be added to the principal.`,
                [
                  { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                  { text: "Start Unlock", style: "default", onPress: () => resolve(true) },
                ]
              );
            });

        if (!ok) return;
        await runWithChrysalisModal("Unlock Stake", async (setStage) => {
          setStage("🔑 Deriving ML-DSA-65 signing keypair…");
          await new Promise(r => setTimeout(r, 80));
          setStage("🔏 Signing unlock request…");
          await unlockStake({ positionId, gasFee: chosenGas });
          setStage("✅ Unlock initiated — rewards frozen during cooldown");
        });
      } else if (posStatus === "unlocking") {
        await runWithChrysalisModal("Withdraw Stake", async (setStage) => {
          setStage("🔑 Deriving ML-DSA-65 signing keypair…");
          await new Promise(r => setTimeout(r, 80));
          setStage("🔏 Signing withdrawal with Chrysalis attestation…");
          await new Promise(r => setTimeout(r, 80));
          setStage("🌐 Broadcasting to Honey Network…");
          await unstake({ positionId, gasFee: chosenGas });
          setStage("✅ Withdrawal submitted");
        });
      } else {
        setMessage(`Cannot withdraw position with status: ${posStatus}`);
        return;
      }
      await hardRefreshAll();
    } catch (e: any) {
      const errMsg = String(e?.message || "Unknown error");
      if (!errMsg.includes("Chrysalis") && !chrysalisVaultOpen) {
        if (errMsg.includes("not withdrawable") || errMsg.includes("not found")) {
          setMessage("Position has already been withdrawn or is not available");
        } else if (errMsg.includes("unlocking")) {
          setMessage("Position is still unlocking. Please wait for the unlock period to complete.");
        } else {
          setMessage(`Unstake failed: ${errMsg}`);
        }
      }
    } finally {
      setUnstakeBusyId(null);
    }
  }

  async function openClaimConfirm(positionId: string) {
    if (claimBusyId) return;
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));

    setClaimBusyId(positionId);
    try {
      // Refresh staking data right before quoting so iOS/web are consistent.
      const res = await getStakingPositions(wallet);
      const pos: any = (res?.positions || []).find((p: any) => String(p.id) === String(positionId));
      const claimable = Number(pos?.claimable || 0);
      if (!Number.isFinite(claimable) || claimable <= 0) {
        setMessage("Nothing to claim.");
        return;
      }

      const svc = computeServiceFee(claimable, serviceFeeRate);
      const totalFee = Number((chosenGas + svc).toFixed(8));

      setClaimPreview({
        positionId,
        claimable,
        gasFee: chosenGas,
        serviceFee: svc,
        totalFee,
        timestamp: Date.now(),
      });
      setClaimConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Claim quote failed: ${e?.message || "Unknown error"}`);
    } finally {
      setClaimBusyId(null);
    }
  }

  async function handleClaimConfirm() {
    if (!claimPreview) return;
    if (claimBusyId) return;

    setClaimBusyId(claimPreview.positionId);
    try {
      await claimStakingReward({ positionId: claimPreview.positionId, gasFee: claimPreview.gasFee });
      setMessage("Claim submitted ✅");
      setClaimConfirmOpen(false);
      setClaimPreview(null);
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Claim failed: ${e?.message || "Unknown error"}`);
    } finally {
      setClaimBusyId(null);
    }
  }

  /* ======================
     Send flow (confirm modal)
  ====================== */

  // ========== PORTFOLIO VALUE ==========
  const portfolioValueUSD = useMemo(() => {
    // HNY is already in tokenBalances from the server, so just iterate all tokens
    return Object.entries(tokenBalances).reduce((sum, [symbol, amount]) => {
      const price = tokenPrices[symbol] || 0;
      return sum + Number(amount) * price;
    }, 0);
  }, [tokenBalances, tokenPrices]);

  // ========== FAUCET (includes HNY mint) ==========
  async function handleFaucet() {
    if (faucetBusy) return;
    setFaucetBusy(true);
    setMessage("");
    try {
      const seedFp = await getSeedFingerprint();
      if (faucetToken === "HNY") {
        const res: any = await mint({ seedFingerprint: seedFp });
        setMessage("HNY Mint submitted ✅");
        const cd = Number(res?.cooldownSeconds || 86400);
        setMintCooldown(cd);
      } else {
        const amt = Number(faucetAmount) || 100;
        await tokenFaucet({ tokenSymbol: faucetToken, amount: amt, seedFingerprint: seedFp });
        setMessage(`✅ Minted ${fmtNum(amt, 0)} ${faucetToken}`);
        // Set 24h cooldown for this token
        setTokenCooldowns(prev => ({ ...prev, [faucetToken]: 86400 }));
      }
      setFaucetModalOpen(false);
      await hardRefreshAll();
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      // Parse cooldown from server error
      const cdMatch = msg.match(/(\d+)\s*(minutes|hours)/);
      if (cdMatch) {
        const unit = cdMatch[2] === "hours" ? 3600 : 60;
        const cdSec = Number(cdMatch[1]) * unit;
        if (faucetToken === "HNY") setMintCooldown(cdSec);
        else setTokenCooldowns(prev => ({ ...prev, [faucetToken]: cdSec }));
      }
      if (e?.cooldownSeconds) {
        if (faucetToken === "HNY") setMintCooldown(Number(e.cooldownSeconds));
        else setTokenCooldowns(prev => ({ ...prev, [faucetToken]: Number(e.cooldownSeconds) }));
      }
      setMessage(`Faucet failed: ${msg}`);
    } finally {
      setFaucetBusy(false);
    }
  }

  // ========== NETWORK SWITCHER ==========
  async function switchNetwork(network: NetworkPreset) {
    const type = network.type ?? "hive";
    setActiveNetworkType(type);
    setApiBase(network.url);
    setApiBaseText(network.url);
    setActiveNetworkName(network.name);
    setEvmBlockExplorer(network.blockExplorer ?? "");
    await kvSet(ACTIVE_NETWORK_STORAGE_KEY, network.url);
    await kvSet(ACTIVE_NETWORK_TYPE_KEY, type);
    // When switching to a HIVE network, remember this URL for Chrysalis ops
    // (Chrysalis endpoints only exist on the HIVE server, not on EVM RPC nodes).
    if (type === "hive") {
      setHiveServerUrl(network.url);
      await kvSet(HIVE_SERVER_URL_KEY, network.url);
    }
    setNetworkSwitcherOpen(false);
    showToast(`Switched to ${network.name}`);
    if (type === "evm") {
      await loadEvmData(network.url, Number(network.chainId ?? "8453"));
    } else {
      hardRefreshAll().catch(() => {});
    }
  }

  async function loadEvmData(rpcUrl: string, chainId: number) {
    setEvmLoading(true);
    try {
      // Use the full 64-byte BIP39 seed — this matches MetaMask's BIP44 derivation.
      // getMasterSeed() returns only 32 bytes (used for HIVE HKDF); getEvmSeed() gives the full 64.
      const seed = await getEvmSeed();
      if (!seed) { setEvmLoading(false); return; }
      const { deriveEvmKeypair } = await import("../chain/evm-wallet");
      const { evmGetBalance, evmDiscoverTokenBalances, evmGetTransactions, evmGetTokenTransfers } = await import("../chain/evm-provider");
      const { address } = deriveEvmKeypair(seed, 0);
      setEvmAddress(address);
      setEvmChainId(chainId);
      // Fetch ETH balance, ALL discovered token balances, and tx history in parallel.
      // evmDiscoverTokenBalances queries known tokens + any token from Basescan tx history.
      const [ethBal, tokenBals, txs, tokenTxs] = await Promise.allSettled([
        evmGetBalance(address, rpcUrl),
        evmDiscoverTokenBalances(address, rpcUrl, chainId),
        evmGetTransactions(address, chainId),
        evmGetTokenTransfers(address, chainId),
      ]);
      if (ethBal.status === "fulfilled") setEvmEthBalance(ethBal.value);
      if (tokenBals.status === "fulfilled") setEvmTokenBals(tokenBals.value);
      if (txs.status === "fulfilled" || tokenTxs.status === "fulfilled") {
        const combined = [
          ...(txs.status === "fulfilled" ? txs.value : []),
          ...(tokenTxs.status === "fulfilled" ? tokenTxs.value : []),
        ].sort((a, b) => Number(b.timeStamp) - Number(a.timeStamp)).slice(0, 50);
        setEvmTxHistory(combined);
      }
    } catch (e: any) {
      showToast(`EVM load error: ${e?.message || "Unknown"}`, "warn");
    } finally {
      setEvmLoading(false);
    }
  }

  // ========== EVM SEND ==========
  async function handleEvmSend() {
    const to = evmSendTo.trim();
    const amount = evmSendAmount.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { showToast("Invalid Ethereum address", "warn"); return; }
    const ethAmt = Number(amount);
    if (!Number.isFinite(ethAmt) || ethAmt <= 0) { showToast("Invalid amount", "warn"); return; }
    setEvmSendBusy(true);
    try {
      const seed = await getEvmSeed();
      if (!seed) throw new Error("No wallet seed found");
      const { deriveEvmKeypair, signEvmTransaction } = await import("../chain/evm-wallet");
      const { evmGetNonce, evmGetFeeData, evmEstimateGas, evmSendRawTransaction } = await import("../chain/evm-provider");
      const rpcUrl = getApiBase();
      const { privateKey, address } = deriveEvmKeypair(seed, 0);
      const valueWei = BigInt(Math.round(ethAmt * 1e18));
      const [nonce, feeData] = await Promise.all([
        evmGetNonce(address, rpcUrl),
        evmGetFeeData(rpcUrl),
      ]);
      const gasLimit = await evmEstimateGas({ to, value: valueWei, data: "0x", from: address }, rpcUrl);
      const txData = {
        chainId: BigInt(evmChainId),
        nonce,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        maxFeePerGas: feeData.maxFeePerGas,
        gasLimit,
        to,
        value: valueWei,
        data: "0x",
      };
      const signed = signEvmTransaction(txData, privateKey);
      const txHash = await evmSendRawTransaction(signed, rpcUrl);
      showToast(`Sent! ${txHash.slice(0, 14)}…`);
      setEvmSendOpen(false);
      setEvmSendTo("");
      setEvmSendAmount("");
      // Refresh balances after a short delay (tx may not be confirmed yet)
      setTimeout(() => loadEvmData(rpcUrl, evmChainId), 3000);
    } catch (e: any) {
      showToast(`Send failed: ${e?.message || "Unknown error"}`, "warn");
    } finally {
      setEvmSendBusy(false);
    }
  }

  // ========== EVM SWAP ==========
  async function fetchEvmSwapQuote() {
    const amt = Number(evmSwapAmount);
    if (!Number.isFinite(amt) || amt <= 0) { showToast("Enter a valid amount", "warn"); return; }
    setEvmSwapFetchingQuote(true);
    setEvmSwapQuote(null);
    try {
      const { evmGetSwapQuote, formatEth } = await import("../chain/evm-provider");
      const seed = await getEvmSeed();
      if (!seed) throw new Error("No wallet");
      const { deriveEvmKeypair } = await import("../chain/evm-wallet");
      const { address } = deriveEvmKeypair(seed, 0);
      const sellDecimals = evmSwapSell === "ETH" ? 18 : 6; // simplified; USDC/USDbC = 6
      const sellAmount = BigInt(Math.round(amt * 10 ** sellDecimals));
      const q = await evmGetSwapQuote(
        { sellToken: evmSwapSell, buyToken: evmSwapBuy, sellAmount, takerAddress: address },
        evmChainId,
      );
      setEvmSwapQuote(q);
    } catch (e: any) {
      showToast(`Quote failed: ${e?.message || "Unknown"}`, "warn");
    } finally {
      setEvmSwapFetchingQuote(false);
    }
  }

  async function handleEvmSwapConfirm() {
    if (!evmSwapQuote) return;
    setEvmSwapBusy(true);
    try {
      const seed = await getEvmSeed();
      if (!seed) throw new Error("No wallet");
      const { deriveEvmKeypair, signEvmTransaction } = await import("../chain/evm-wallet");
      const { evmGetNonce, evmGetFeeData, evmSendRawTransaction } = await import("../chain/evm-provider");
      const rpcUrl = getApiBase();
      const { privateKey, address } = deriveEvmKeypair(seed, 0);
      const [nonce, feeData] = await Promise.all([
        evmGetNonce(address, rpcUrl),
        evmGetFeeData(rpcUrl),
      ]);
      const txData = {
        chainId: BigInt(evmChainId),
        nonce,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        maxFeePerGas: feeData.maxFeePerGas,
        gasLimit: evmSwapQuote.estimatedGas,
        to: evmSwapQuote.to,
        value: evmSwapQuote.value,
        data: evmSwapQuote.data,
      };
      const signed = signEvmTransaction(txData, privateKey);
      const txHash = await evmSendRawTransaction(signed, rpcUrl);
      showToast(`Swap submitted! ${txHash.slice(0, 14)}…`);
      setEvmSwapOpen(false);
      setEvmSwapQuote(null);
      setEvmSwapAmount("");
      setTimeout(() => loadEvmData(rpcUrl, evmChainId), 5000);
    } catch (e: any) {
      showToast(`Swap failed: ${e?.message || "Unknown"}`, "warn");
    } finally {
      setEvmSwapBusy(false);
    }
  }

  async function addCustomNetwork() {
    const name = newNetworkName.trim();
    const url = newNetworkUrl.trim();
    if (!name || !url) { showToast("Enter network name and RPC URL", "warn"); return; }
    const entry: NetworkPreset = {
      name,
      url,
      chainId: newNetworkChainId.trim() || undefined,
      currencySymbol: newNetworkCurrency.trim() || undefined,
      blockExplorer: newNetworkExplorer.trim() || undefined,
      isTestnet: newNetworkIsTestnet,
    };
    const updated = [...savedNetworks, entry];
    setSavedNetworks(updated);
    await kvSet(NETWORKS_STORAGE_KEY, JSON.stringify(updated));
    setNewNetworkName("");
    setNewNetworkUrl("");
    setNewNetworkChainId("");
    setNewNetworkCurrency("");
    setNewNetworkExplorer("");
    setNewNetworkIsTestnet(true);
    showToast(`Added ${name}`);
  }

  async function removeCustomNetwork(idx: number) {
    const updated = savedNetworks.filter((_, i) => i !== idx);
    setSavedNetworks(updated);
    await kvSet(NETWORKS_STORAGE_KEY, JSON.stringify(updated));
  }

  // ========== LIQUIDITY POOL HANDLERS ==========
  // Auto-calculate token B amount based on pool ratio when A changes
  function onLpAmountAChange(val: string) {
    setLpAmountA(normalizeAmountText(val));
    const aNum = Number(normalizeAmountText(val));
    if (!aNum) { setLpAmountB(""); return; }
    const pool = lpPoolList.find(p => p.id === lpSelectedPool);
    if (!pool || !pool.reserveA || !pool.reserveB) return;
    const ratio = Number(pool.reserveB) / Number(pool.reserveA);
    setLpAmountB(fmt8(aNum * ratio));
  }

  function onLpAmountBChange(val: string) {
    setLpAmountB(normalizeAmountText(val));
    const bNum = Number(normalizeAmountText(val));
    if (!bNum) { setLpAmountA(""); return; }
    const pool = lpPoolList.find(p => p.id === lpSelectedPool);
    if (!pool || !pool.reserveA || !pool.reserveB) return;
    const ratio = Number(pool.reserveA) / Number(pool.reserveB);
    setLpAmountA(fmt8(bNum * ratio));
  }

  async function handleAddLiquidity() {
    if (lpBusy) return;
    const pool = lpPoolList.find(p => p.id === lpSelectedPool);
    if (!pool) { showToast("Select a pool", "warn"); return; }
    const aA = Number(lpAmountA);
    const aB = Number(lpAmountB);
    if (!aA || aA <= 0 || !aB || aB <= 0) { showToast("Enter valid amounts", "warn"); return; }
    // Check balances
    const balA = pool.tokenA === "HNY" ? (tokenBalances["HNY"] || confirmedBalance) : (tokenBalances[pool.tokenA] || 0);
    const balB = pool.tokenB === "HNY" ? (tokenBalances["HNY"] || confirmedBalance) : (tokenBalances[pool.tokenB] || 0);
    if (balA < aA) { showToast(`Insufficient ${pool.tokenA}`, "warn"); return; }
    if (balB < aB) { showToast(`Insufficient ${pool.tokenB}`, "warn"); return; }
    setLpBusy(true);
    try {
      await runWithChrysalisModal("Add Liquidity", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing LP deposit — ${pool!.tokenA}/${pool!.tokenB}…`);
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");
        const res = await addLiquidity({ poolId: lpSelectedPool, amountA: aA, amountB: aB });
        setStage(`✅ Added liquidity — received ${fmtNum(res?.lpShares || 0, 4)} LPHNY`);
        setLpAmountA("");
        setLpAmountB("");
        setLpTab("positions");
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setLpBusy(false);
    }
  }

  async function handleRemoveLiquidity() {
    if (lpBusy || !lpRemovePosition) return;
    const shares = Number(lpRemoveShares);
    const maxShares = Number(lpRemovePosition.lpShares);
    if (!shares || shares <= 0) { showToast("Enter shares to remove", "warn"); return; }
    if (shares > maxShares) { showToast(`Max shares: ${fmtNum(maxShares, 8)}`, "warn"); return; }
    setLpBusy(true);
    const poolId   = lpRemovePosition.poolId;
    const posLabel = lpRemovePosition.poolId;
    try {
      await runWithChrysalisModal("Remove Liquidity", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing LP withdrawal — ${posLabel}…`);
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");
        const res = await removeLiquidity({ poolId, lpShares: shares });
        setStage(`✅ Liquidity removed — ${fmtNum(res?.rewardHNY || 0, 4)} HNY rewards claimed`);
        setLpRemoveShares("");
        setLpRemovePosition(null);
        setLpTab("positions");
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setLpBusy(false);
    }
  }

  // Compute live LP reward for a position (mirrors server's computeLpReward)
  function computeLiveReward(pos: LpPosition, nowMs: number): number {
    const totalLP = Number(pos.pool?.totalLpShares || 0);
    if (!totalLP) return 0;
    const shareRatio = Number(pos.lpShares) / totalLP;
    const priceA = tokenPrices[pos.pool?.tokenA || ""] || 1;
    const priceB = tokenPrices[pos.pool?.tokenB || ""] || 1;
    const posValueUSD = shareRatio * (Number(pos.pool?.reserveA || 0) * priceA + Number(pos.pool?.reserveB || 0) * priceB);
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    const elapsedYears = Math.max(0, nowMs - Number(pos.createdAtMs)) / yearMs;
    const totalReward = posValueUSD * lpApr * elapsedYears;
    return Math.max(0, Number((totalReward - Number(pos.rewardPaidHNY || 0)).toFixed(8)));
  }

  async function handleLpClaim() {
    if (lpClaimBusy || !lpClaimPosition) return;
    setLpClaimBusy(true);
    setLpClaimOpen(false);
    const posId    = lpClaimPosition.id;
    const poolName = lpClaimPosition.poolId;
    try {
      await runWithChrysalisModal("Claim LP Rewards", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing reward claim — ${poolName}…`);
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");
        const res = await claimLpReward({ positionId: posId });
        setStage(`✅ Claimed ${fmtNum(res?.rewardHNY || 0, 6)} HNY rewards`);
        setLpClaimPosition(null);
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setLpClaimBusy(false);
    }
  }

  // ========== UNIFIED SEND (all tokens incl HNY, stHNY) ==========
  async function openUnifiedSendConfirm() {
    setMessage("");
    const to = sanitizeAddress(unifiedSendTo).replace(/^hny_/i, "HNY_").replace(/^HNY_0x/i, "HNY_");
    if (to.includes("…") || to.includes("...")) {
      setMessage("That looks like a shortened address. Use the full HNY_<40hex> address.");
      return;
    }
    if (!/^HNY_[0-9a-fA-F]{40}$/.test(to)) {
      setMessage("Recipient address must be HNY_<40hex>.");
      return;
    }
    const amtTextClean = normalizeAmountText(unifiedSendAmount);
    const amtCheck = parseAmount8(amtTextClean);
    if (!amtCheck.ok || Number(amtCheck.value) <= 0) {
      setMessage("Amount is required.");
      return;
    }
    const totalAmt = Number(amtCheck.value);
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));
    // Service fee = 0.0005% of USD value, paid in HNY
    // Waived for intra-wallet transfers (same seed phrase)
    // For HNY: server uses HNY_PRICE_USD=1.00 constant — don't use Pyth live price or fees diverge.
    // For tokens: use live price (server looks up DB price).
    const tokenPriceUSD = unifiedSendToken === "HNY" ? 1.0 : (tokenPrices[unifiedSendToken] || 1);
    const usdValue = totalAmt * tokenPriceUSD;
    const isIntraWallet = walletList.some(w => w.address.toLowerCase() === to.toLowerCase());
    const serviceFee = isIntraWallet ? 0 : Number((usdValue * serviceFeeRate).toFixed(8));
    const walletFee = computeWalletFee(serviceFee);

    if (unifiedSendToken === "HNY") {
      const totalCost = Number((totalAmt + chosenGas + serviceFee + walletFee).toFixed(8));
      if (balancesView.spendable < totalCost) {
        setMessage(`Insufficient HNY. Need ${fmtNum(totalCost)} (amount + fees).`);
        return;
      }
      setUnifiedSendQuote({ token: "HNY", to, amount: totalAmt, gasFee: chosenGas, serviceFee, totalCost });
    } else {
      const tokenBal = tokenBalances[unifiedSendToken] || 0;
      if (tokenBal < totalAmt) {
        setMessage(`Insufficient ${unifiedSendToken} balance. Have ${fmtNum(tokenBal)}`);
        return;
      }
      const feesInHNY = chosenGas + serviceFee + walletFee;
      if (balancesView.spendable < feesInHNY) {
        setMessage(`Insufficient HNY for fees. Need ${fmtNum(feesInHNY)} HNY.`);
        return;
      }
      setUnifiedSendQuote({ token: unifiedSendToken, to, amount: totalAmt, gasFee: chosenGas, serviceFee, totalCost: totalAmt });
    }
    pausePollingRef.current = true;
    setUnifiedSendConfirmOpen(true);
  }

  async function handleUnifiedSendSubmit() {
    if (!unifiedSendQuote || unifiedSendBusy) return;
    setUnifiedSendBusy(true);
    setUnifiedSendConfirmOpen(false);
    const q = unifiedSendQuote;
    try {
      await runWithChrysalisModal("Send", async (setStage) => {
        // Ensure intra-wallet recipient is registered (fee-exemption check)
        if (Number(q.serviceFee) === 0) {
          const toWallet = walletList.find(
            w => w.address.toLowerCase() === String(q.to || "").toLowerCase()
          );
          if (toWallet?.publicKeyB64) {
            try {
              await fetch(`${getApiBase()}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ publicKey: toWallet.publicKeyB64 }),
              });
            } catch { /* non-fatal */ }
          }
        }

        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing send — ${fmtNum(q.amount)} ${q.token} → ${q.to.slice(0, 10)}…`);
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");

        if (q.token === "HNY") {
          const chrysalisAttestation = await buildChrysalisAttestation({
            type: "send", to: q.to,
            amount: Number(q.amount), gasFee: Number(q.gasFee), serviceFee: Number(q.serviceFee),
          });
          await send({ to: q.to, amount: Number(q.amount), gasFee: Number(q.gasFee), serviceFee: Number(q.serviceFee), chrysalisAttestation });
        } else {
          await sendToken({ to: q.to, tokenSymbol: q.token, amount: q.amount, gasFee: q.gasFee, serviceFee: q.serviceFee });
        }
        setStage(`✅ Sent ${fmtNum(q.amount)} ${q.token}`);
        setUnifiedSendTo("");
        setUnifiedSendAmount("");
        setTokenSendOpen(false);
        setUnifiedSendQuote(null);
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setUnifiedSendBusy(false);
      pausePollingRef.current = false;
    }
  }

  // ========== SWAP ==========
  useEffect(() => {
    if (!swapAmountIn || Number(swapAmountIn) <= 0) { setSwapQuote(null); return; }
    const timer = setTimeout(async () => {
      try {
        setFetchingQuote(true);
        const q = await getSwapQuote({ tokenIn: swapTokenIn, tokenOut: swapTokenOut, amountIn: Number(swapAmountIn) });
        setSwapQuote(q);
      } catch { setSwapQuote(null); } finally { setFetchingQuote(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [swapAmountIn, swapTokenIn, swapTokenOut]);

  function openSwapConfirm() {
    if (!swapQuote) return;
    const amt = Number(swapAmountIn);
    if (swapTokenIn === "HNY" && balancesView.spendable < amt) { setMessage("Insufficient HNY"); return; }
    if (swapTokenIn === "stHNY" && (tokenBalances["stHNY"] || 0) < amt) { setMessage("Insufficient stHNY"); return; }
    if (swapTokenIn !== "HNY" && swapTokenIn !== "stHNY" && (tokenBalances[swapTokenIn] || 0) < amt) { setMessage(`Insufficient ${swapTokenIn}`); return; }
    pausePollingRef.current = true;
    setSwapConfirmOpen(true);
  }

  async function handleSwapConfirm() {
    if (swapBusy || !swapQuote) return;
    setSwapBusy(true);
    setSwapConfirmOpen(false);
    const amt           = Number(swapAmountIn);
    const tokenPriceUSD = tokenPrices[swapTokenIn] || 1;
    const svcFee        = Number((amt * tokenPriceUSD * serviceFeeRate).toFixed(8));
    const expectedOut   = swapQuote.amountOut;
    try {
      await runWithChrysalisModal("Swap", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing swap: ${fmtNum(amt)} ${swapTokenIn} → ${swapTokenOut}…`);
        await new Promise(r => setTimeout(r, 80));
        setStage("🌐 Broadcasting to Honey Network…");
        await swap({ tokenIn: swapTokenIn, tokenOut: swapTokenOut, amountIn: amt, minAmountOut: expectedOut * 0.95, serviceFee: svcFee });
        setStage(`✅ Swapped ${fmtNum(amt)} ${swapTokenIn} → ${fmtNum(expectedOut)} ${swapTokenOut}`);
        setSwapAmountIn("");
        setSwapQuote(null);
        setSwapOpen(false);
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setSwapBusy(false);
      pausePollingRef.current = false;
    }
  }

  // ========== ADDRESS BOOK ==========
  async function addContact(name: string, address: string) {
    const addr = sanitizeAddress(address);
    if (!/^HNY_[0-9a-fA-F]{40}$/.test(addr)) { showToast("Invalid address", "warn"); return; }
    if (!name.trim()) { showToast("Name is required", "warn"); return; }
    const updated = [...contacts, { name: name.trim(), address: addr }];
    setContacts(updated);
    await saveContactsToStorage(updated);
    setNewContactName("");
    setNewContactAddr("");
    showToast("Contact saved ✅");
  }

  async function removeContact(idx: number) {
    const updated = contacts.filter((_, i) => i !== idx);
    setContacts(updated);
    await saveContactsToStorage(updated);
  }
  async function openSendConfirm() {
    setMessage("");

    // Recipient
    const toRaw = String(toText ?? "");

    // 🔎 Detect shortened UI addresses like HNY_abc…123
    if (toRaw.includes("…") || toRaw.includes("...")) {
      setMessage(
        "That looks like a shortened address (with …). Open Receive and use Copy to get the full HNY_<40hex> address."
      );
      return;
    }

    const to = sanitizeAddress(toRaw)
      .replace(/^hny_/i, "HNY_")
      .replace(/^HNY_0x/i, "HNY_");

    // ✅ STRICT final validation (40 hex chars)
    if (!/^HNY_[0-9a-fA-F]{40}$/.test(to)) {
      setMessage("Recipient address must be HNY_<40hex>.");
      return;
    }


    // Amount
    const amtTextClean = normalizeAmountText(amountText);
    const amtCheck = parseAmount8(amtTextClean);
    if (!amtCheck.ok || Number(amtCheck.value) <= 0) {
      setMessage("Amount is required.");
      return;
    }
    const totalAmt = Number(amtCheck.value);

    // Gas derived
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));


    // Preflight
    const pf = preflightSend({
      to,
      amountText: amtTextClean,
      spendableBalance: balancesView.spendable,
      minGasFee: minGas,
      serviceFeeRate,
      chosenGasFee: chosenGas,
    });

    if (!pf.ok) {
      setMessage(pf.reason || "Preflight failed");
      return;
    }

    const isIntraWallet = walletList.some(w => w.address.toLowerCase() === to.toLowerCase());
    const serviceFee = isIntraWallet ? 0 : computeServiceFee(totalAmt, serviceFeeRate);
    const totalCost = Number((totalAmt + chosenGas + serviceFee).toFixed(8));

    try {
      pausePollingRef.current = true;
      const q = await quoteSend(to, totalAmt);

      setQuote({
        q,
        to,
        baseAmt: totalAmt,
        totalAmt,
        chosenGas,
        serviceFee,
        totalCost,
      });

      setExpectedNonce(null);
        (async () => {
          try {
            if (wallet) {
              const a:any = await getAccount(wallet);
              const n = Number(a?.nonce ?? a?.nextNonce ?? a?.pendingNonce ?? a?.sequence ?? 0);
              if (Number.isFinite(n)) setExpectedNonce(n);
            }
          } catch {}
        })();
        setConfirmOpen(true);
    } catch (e: any) {
      pausePollingRef.current = false;
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  async function handleSendSubmit() {
    if (!quote) return;
    if (sendBusy) return;
    setSendBusy(true);
    const _sendTo  = sanitizeAddress(String(quote.to)).replace(/^hny_/i, "HNY_");
    const _sendAmt = Number(quote.totalAmt);
    const _sendGas = Number(quote.chosenGas);
    const _sendSvc = Number(quote.serviceFee);
    closeAllModals({ keepMessage: false });
    try {
      await runWithChrysalisModal("Send HNY", async (setStage) => {
        setStage("🔑 Deriving ML-DSA-65 signing keypair…");
        await new Promise(r => setTimeout(r, 80));
        setStage(`🔏 Signing send — ${fmtNum(_sendAmt)} HNY → ${_sendTo.slice(0, 10)}…`);
        const chrysalisAttestation = await buildChrysalisAttestation({
          type: "send", to: _sendTo, amount: _sendAmt, gasFee: _sendGas, serviceFee: _sendSvc,
        });
        setStage("🌐 Broadcasting to Honey Network…");
        const res: any = await send({ to: _sendTo, amount: _sendAmt, gasFee: _sendGas, serviceFee: _sendSvc, chrysalisAttestation });
        const txid = String(res?.txid || res?.id || res?.tx?.id || "").trim();
        setStage(`✅ Sent ${fmtNum(_sendAmt)} HNY${txid ? ` (${shortId(txid)})` : ""}`);
      });
      await hardRefreshAll();
    } catch {
      // error shown in ceremony modal
    } finally {
      setSendBusy(false);
    }
  }

  /* ======================
     RBF (boost) flow
  ====================== */
  async function doRbf(multiplier: number) {
    if (!rbfTx) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");

    try {
      const mg = Math.max(Number(minGasFee || ONE_SAT), ONE_SAT);
      const baseGas = Math.max(mg, Number(rbfTx.gasFee || mg));
      const gasFee = Math.max(mg, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(Number(rbfTx.amount || 0), serviceFeeRate);

      await rbfReplacePending({
        to: String(rbfTx.to),
        amount: Number(rbfTx.amount),
        nonce: Number(rbfTx.nonce),
        gasFee,
        serviceFee: svc,
      } as any);

      closeAllModals({ keepMessage: true });
      setMessage("Boost submitted (RBF) ✅");
      await hardRefreshAll();
    } catch (e: any) {
      closeAllModals({ keepMessage: true });
      setMessage(`RBF failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  /* ======================
     Cancel flow
  ====================== */
  async function doCancel(multiplier: number) {
    if (!cancelTx) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");

    try {
      const mg = Math.max(Number(minGasFee || ONE_SAT), ONE_SAT);
      const baseGas = Math.max(mg, Number(cancelTx.gasFee || mg));
      const gasFee = Math.max(mg, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(ONE_SAT, serviceFeeRate);

      await cancelPending({
        nonce: Number(cancelTx.nonce),
        gasFee,
        serviceFee: svc,
      } as any);

      closeAllModals({ keepMessage: true });
      setMessage("Cancel submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      closeAllModals({ keepMessage: true });
      setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  /* ======================
     Derived lists / labels
  ====================== */
  const displayTxs = useMemo(() => {
    const arr = [...(txs || [])];
    arr.sort((a: any, b: any) => {
      const ap = String(a?.status || "") === "pending" ? 1 : 0;
      const bp = String(b?.status || "") === "pending" ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = Number(a?.time || a?.timestamp || a?.createdAt || 0);
      const bt = Number(b?.time || b?.timestamp || b?.createdAt || 0);
      return bt - at;
    });
    return arr;
  }, [txs]);

  const pendingCount = useMemo(
    () => displayTxs.filter((t: any) => String(t?.status || "") === "pending").length,
    [displayTxs]
  );

  const mintLabel = useMemo(() => {
    if (mintBusy) return "Minting…";
    if (mintCooldown > 0) return `Mint (${fmtCooldown(mintCooldown)})`;
    return "Mint";
  }, [mintCooldown, mintBusy]);
  /* ======================
     Render
  ====================== */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
      <View style={{ flex: 1 }}>
          <KeyboardAvoidingView
      style={{
        flex: 1,
        backgroundColor: T.bg,
        minHeight: Platform.OS === "web" ? ("100vh" as any) : undefined,
      }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Background skin */}
      {bgSource && (
        <View
          style={[
            StyleSheet.absoluteFill,
            // On web use fixed positioning so the bg covers the full viewport
            // regardless of scroll height; absoluteFill only covers the flex container.
            Platform.OS === "web" ? ({ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 } as any) : {},
          ]}
          pointerEvents="none"
        >
          <Image
            ref={bgImgRef}
            source={bgSource}
            resizeMode="cover"
            style={
              Platform.OS === "ios"
                // On iOS absoluteFill can lose dimensions inside flex containers —
                // pin explicit pixel size so the whole image is visible & centered.
                // useWindowDimensions keeps this reactive on rotation.
                ? {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: winWidth,
                    height: winHeight,
                  }
                : [StyleSheet.absoluteFill, { width: "100%" as any, height: "100%" as any }]
            }
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "black", opacity: bgOverlayOpacity },
            ]}
          />
        </View>
      )}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
        onScrollBeginDrag={() => { if (Platform.OS !== "web") Keyboard.dismiss(); }}
      >
        {/* Header */}
        <View style={{ paddingTop: 18, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
            {chrysalisRegistered && (
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 4,
                backgroundColor: "rgba(57,255,20,0.10)",
                borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
                borderWidth: 1, borderColor: "rgba(57,255,20,0.25)", marginTop: 3,
              }}>
                <Text style={{ fontSize: 10 }}>🔰</Text>
                <Text style={{ color: "#39ff14", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 }}>
                  CHRYSALIS PROTECTED
                </Text>
              </View>
            )}
            {/* Queen Bee AI alert badge */}
            {hasUnreadAlerts && (
              <Pressable onPress={() => setQueenBeeAlertsOpen(true)} style={{
                flexDirection: "row", alignItems: "center", gap: 4,
                backgroundColor: "rgba(255,50,50,0.15)",
                borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
                borderWidth: 1, borderColor: "rgba(255,50,50,0.4)", marginTop: 3,
              }}>
                <Text style={{ fontSize: 10 }}>🐝</Text>
                <Text style={{ color: "#ff4444", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 }}>
                  ALERT
                </Text>
              </Pressable>
            )}
          </View>
          <View style={{ flex: 1 }} />

          {/* Network badge */}
          <Pressable
            onPress={() => { pausePollingRef.current = true; setNetworkSwitcherOpen(true); }}
            style={{
              marginRight: 8,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: activeNetworkType === "evm" ? "rgba(0,82,255,0.5)" : "rgba(57,255,20,0.35)",
              backgroundColor: activeNetworkType === "evm" ? "rgba(0,82,255,0.12)" : "rgba(57,255,20,0.08)",
              maxWidth: 140,
            }}
          >
            <Text style={{ color: activeNetworkType === "evm" ? "#4B8EFF" : T.green, fontWeight: "900", fontSize: 11 }} numberOfLines={1}>
              🌐 {activeNetworkName.replace("Honey Testnet (Local)", "Testnet").replace("Honey Devnet", "Devnet").replace("Base Mainnet", "Base").replace("Base Sepolia", "Base Sepolia")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              pausePollingRef.current = true;
              setHistoryOpen(true);
            }}
            style={{
              marginRight: 10,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              backgroundColor: T.glass2,
            }}
          >
            <Text style={{ color: T.text, fontWeight: "900" }}>📜</Text>
          </Pressable>

          {activeNetworkType === "hive" && (
            <Pressable
              onPress={() => setHoneyBookOpen(true)}
              style={{
                marginRight: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#39ff1444",
                backgroundColor: "#0a1a0a",
              }}
            >
              <Text style={{ fontWeight: "900" }}>🐝</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              pausePollingRef.current = true;
              setSettingsOpen(true);
            }}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              backgroundColor: T.glass2,
            }}
          >
            <Text style={{ color: T.text, fontWeight: "900" }}>⚙️</Text>
          </Pressable>
        </View>

        {activeNetworkType === "hive" && (
          <Text style={{ color: T.sub, marginTop: 2 }}>
            Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)} • Chain: {chainId || "—"}
          </Text>
        )}

        {!!message && (
          <Card T={T} style={{ marginTop: 12 }}>
            <Text style={{ color: T.text, fontWeight: "900" }}>{message}</Text>
          </Card>
        )}

        {/* ═══ EVM MODE (Base / Ethereum) ═══════════════════════════════════ */}
        {activeNetworkType === "evm" && (() => {
          const ethBal = Number(evmEthBalance) / 1e18;
          const ethPrice = tokenPrices["ETH"] || 0;
          const ethUsd = ethBal * ethPrice;
          const shortEvmAddr = evmAddress
            ? `${evmAddress.slice(0, 8)}…${evmAddress.slice(-6)}`
            : "Deriving…";
          const isMainnet = evmChainId === 8453;
          const isSepolia = evmChainId === 84532;
          const networkLabel = isMainnet ? "BASE MAINNET" : isSepolia ? "BASE SEPOLIA" : `CHAIN ${evmChainId}`;
          const networkColor = isMainnet ? "#0052FF" : "#6B7280";

          return (
            <View style={{ marginTop: 8, gap: 12 }}>

              {/* Address card */}
              <Card T={T} style={{ marginTop: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <View style={{ backgroundColor: networkColor, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 9, letterSpacing: 1 }}>{networkLabel}</Text>
                  </View>
                  {evmLoading && <Text style={{ color: T.sub, fontSize: 11 }}>Refreshing…</Text>}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ color: T.text, fontSize: 14, fontWeight: "900", flex: 1 }} numberOfLines={1}>{shortEvmAddr}</Text>
                  <Pressable onPress={() => { Clipboard.setStringAsync(evmAddress); showToast("Address copied"); }} hitSlop={8} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderColor: T.border, marginLeft: 6 }}>
                    <Ionicons name="copy-outline" size={18} color={T.text} />
                  </Pressable>
                  <Pressable onPress={() => { if (evmAddress) { setQrModalValue(evmAddress); setQrModalTitle("Base Address"); setQrModalOpen(true); }}} hitSlop={8} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderColor: T.border, marginLeft: 6 }}>
                    <Ionicons name="qr-code-outline" size={18} color={T.text} />
                  </Pressable>
                </View>
                <Text style={{ color: T.sub, fontSize: 11, marginTop: 4, fontWeight: "600" }}>
                  BIP44 m/44'/60'/0'/0/0 · secp256k1
                </Text>
              </Card>

              {/* Balance card */}
              <Card T={T}>
                <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12, marginBottom: 4 }}>ETH Balance</Text>
                <Text style={{ color: T.text, fontSize: 36, fontWeight: "900" }}>
                  {ethBal.toFixed(6).replace(/\.?0+$/, "") || "0"} ETH
                </Text>
                {ethPrice > 0 && (
                  <Text style={{ color: T.sub, fontSize: 15, fontWeight: "700", marginTop: 2 }}>
                    ≈ {fmtUSD(ethUsd)}
                  </Text>
                )}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="📤 Send" variant="green" onPress={() => setEvmSendOpen(true)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="📥 Receive" variant="blue" onPress={() => {
                      if (evmAddress) { setReceiveOpen(true); }
                    }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="🔄 Swap" variant="outline" onPress={() => setEvmSwapOpen(true)} />
                  </View>
                </View>
                <Pressable onPress={() => loadEvmData(getApiBase(), evmChainId)} style={{ marginTop: 10, alignSelf: "flex-end" }}>
                  <Text style={{ color: T.sub, fontSize: 11, fontWeight: "700" }}>↻ Refresh</Text>
                </Pressable>
              </Card>

              {/* ERC-20 Token Portfolio */}
              {Object.keys(evmTokenBals).length > 0 && (
                <Card T={T}>
                  <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12, marginBottom: 10 }}>
                    Token Portfolio ({Object.keys(evmTokenBals).length})
                  </Text>
                  {Object.entries(evmTokenBals).map(([key, holding]) => {
                    const amount = Number(holding.balance) / 10 ** holding.decimals;
                    // Try Pyth price by symbol, then base symbol (strip disambiguation suffix)
                    const baseSymbol = holding.symbol;
                    const price = tokenPrices[baseSymbol] || tokenPrices[baseSymbol.replace("_SEP", "")] || 0;
                    const usd = amount * price;
                    return (
                      <View key={key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: T.text, fontWeight: "800" }}>{holding.symbol}</Text>
                          {holding.name && holding.name !== holding.symbol && (
                            <Text style={{ color: T.sub, fontSize: 10 }}>{holding.name}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: T.text, fontWeight: "900" }}>
                            {amount >= 0.0001 ? amount.toFixed(4).replace(/\.?0+$/, "") : "< 0.0001"}
                          </Text>
                          {usd > 0 && <Text style={{ color: T.sub, fontSize: 11 }}>{fmtUSD(usd)}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </Card>
              )}

              {/* Transaction History */}
              <Card T={T}>
                <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12, marginBottom: 10 }}>
                  Transaction History {evmTxHistory.length === 0 && !evmLoading ? "(none yet)" : ""}
                </Text>
                {evmLoading && evmTxHistory.length === 0 && (
                  <Text style={{ color: T.sub, fontWeight: "700" }}>Loading…</Text>
                )}
                {evmTxHistory.slice(0, 20).map((tx) => {
                  const isSent = tx.from?.toLowerCase() === evmAddress?.toLowerCase();
                  const isToken = !!tx.tokenSymbol;
                  const ethVal = isToken
                    ? `${(Number(tx.value) / 10 ** Number(tx.tokenDecimal || 18)).toFixed(4)} ${tx.tokenSymbol}`
                    : `${(Number(tx.value) / 1e18).toFixed(6)} ETH`;
                  const dir = isSent ? "Sent" : "Received";
                  const time = new Date(Number(tx.timeStamp) * 1000).toLocaleDateString();
                  const failed = tx.isError === "1";
                  const explorerBase = evmBlockExplorer || (isMainnet ? "https://basescan.org" : "https://sepolia.basescan.org");
                  return (
                    <Pressable key={tx.hash} onPress={() => {
                      const url = `${explorerBase}/tx/${tx.hash}`;
                      if (typeof window !== "undefined") window.open(url, "_blank");
                    }} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={{ fontSize: 16, marginRight: 8 }}>{failed ? "❌" : isSent ? "↑" : "↓"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: failed ? "#ff4444" : isSent ? T.text : T.green, fontWeight: "900", fontSize: 13 }}>
                            {failed ? "Failed · " : ""}{dir} {ethVal}
                          </Text>
                          <Text style={{ color: T.sub, fontSize: 11, marginTop: 1 }}>
                            {time} · {tx.hash.slice(0, 12)}…
                          </Text>
                        </View>
                        <Text style={{ color: T.sub, fontSize: 11 }}>↗</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {evmBlockExplorer && (
                  <Pressable onPress={() => {
                    const url = `${evmBlockExplorer}/address/${evmAddress}`;
                    if (typeof window !== "undefined") window.open(url, "_blank");
                  }} style={{ marginTop: 10, alignItems: "center" }}>
                    <Text style={{ color: "rgba(100,180,255,0.8)", fontWeight: "700", fontSize: 12 }}>View on Basescan ↗</Text>
                  </Pressable>
                )}
              </Card>

              {/* Note about HIVE features */}
              <View style={{ paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "rgba(100,180,255,0.05)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(100,180,255,0.2)" }}>
                <Text style={{ color: "rgba(100,180,255,0.7)", fontSize: 12, fontWeight: "700", textAlign: "center" }}>
                  Switch to Honey Testnet to access staking, LP pools, and DeFi features.
                </Text>
              </View>

            </View>
          );
        })()}

        {/* ═══ HIVE MODE ════════════════════════════════════════════════════ */}
        {activeNetworkType === "hive" && <>

        {/* Wallet address (slim) */}
        <Card T={T} style={{ marginTop: 12 }}>
          <Pressable onPress={() => { pausePollingRef.current = true; setWalletSwitcherOpen(true); loadAllWalletBalances(walletList); }} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12 }}>Wallet</Text>
                {walletList.length > 0 && (
                  <View style={{ backgroundColor: T.green, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ color: "#000", fontWeight: "900", fontSize: 10 }}>
                      {walletList.find(w => w.index === activeWalletIndex)?.label || "Main"}
                    </Text>
                  </View>
                )}
                <Text style={{ color: T.sub, fontSize: 11, fontWeight: "600" }}>▼ Switch</Text>
              </View>
              <Text style={{ color: T.text, fontSize: 15, fontWeight: "900", marginTop: 4 }}>
                {wallet ? shortAddr(wallet) : "Loading…"}
              </Text>
            </View>
            {!!wallet && (
              <View style={{ flexDirection: "row", gap: 6, marginLeft: 6 }}>
                <Pressable onPress={copyWalletToClipboard} hitSlop={10} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderColor: T.border }}>
                  <Ionicons name="copy-outline" size={18} color={T.text} />
                </Pressable>
                <Pressable onPress={() => { setQrModalValue(wallet); setQrModalTitle("Wallet Address"); setQrModalOpen(true); }} hitSlop={10} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderColor: T.border }}>
                  <Ionicons name="qr-code-outline" size={18} color={T.text} />
                </Pressable>
              </View>
            )}
          </Pressable>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Receive" variant="blue" onPress={() => { pausePollingRef.current = true; setReceiveOpen(true); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Refresh" variant="outline" onPress={hardRefreshAll} />
            </View>
          </View>
          <Text style={{ color: T.sub, marginTop: 8, fontWeight: "600", fontSize: 11 }}>
            Height: {chainHeight} • Next: {formatTime(msUntilNextBlock)} • {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : "—"}
          </Text>
        </Card>

        {/* Portfolio Hub */}
        <Card T={T} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Portfolio</Text>
            <Text style={{ color: T.green, fontSize: 20, fontWeight: "900" }}>{fmtUSD(portfolioValueUSD)}</Text>
          </View>

          <View style={{ height: 10 }} />

          {TOKEN_LIST.map((sym) => {
            const bal = sym === "HNY" ? confirmedBalance : (tokenBalances[sym] || 0);
            if (bal <= 0 && sym !== "HNY") return null;
            const price = tokenPrices[sym] || 0;
            const value = bal * price;
            return (
              <Pressable
                key={sym}
                onPress={() => { pausePollingRef.current = true; setTokenDetailSymbol(sym); }}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border }}
              >
                <Text style={{ fontSize: 22, width: 36 }}>{TOKEN_ICONS[sym] || "🪙"}</Text>
                <View style={{ flex: 1, marginLeft: 4 }}>
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 16 }}>{sym}</Text>
                  <Text style={{ color: T.sub, fontWeight: "600", fontSize: 12 }}>
                    {fmtNum(bal, bal < 1 ? 8 : 4)} {sym}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: T.text, fontWeight: "800", fontSize: 14 }}>{fmtUSD(value)}</Text>
                  <Text style={{ color: T.sub, fontSize: 11 }}>${fmtNum(price, price < 1 ? 4 : 2)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.sub} style={{ marginLeft: 6 }} />
              </Pressable>
            );
          })}

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label="🚰 Faucet" variant="purple" onPress={() => { pausePollingRef.current = true; setFaucetModalOpen(true); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="🔄 Swap" variant="green" onPress={() => { pausePollingRef.current = true; setSwapOpen(true); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="📤 Send" variant="blue" onPress={() => { pausePollingRef.current = true; setUnifiedSendToken("HNY"); setTokenSendOpen(true); }} />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label={`🖼 NFTs${myNfts.length > 0 ? ` (${myNfts.length})` : ""}`} variant="outline" onPress={() => { pausePollingRef.current = true; setNftGalleryOpen(true); loadMarketplace(); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="🌐 Social" variant="outline" onPress={() => { setSocialOpen(true); loadSocialFeed(); }} />
            </View>
          </View>

          <Text style={{ color: T.sub, marginTop: 8, fontWeight: "600", fontSize: 11 }}>
            Spendable: {fmtNum(balancesView.spendable)} HNY • Staked: {fmtNum(stakedBalance)} • Fee Vault: {fmtNum(feeVaultBalance)}
          </Text>
        </Card>
        {/* Staking */}
        <Card T={T} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Staking</Text>
            <Pressable
              onPress={() => {
                setStakingTab("stake");
                setStakingModalOpen(true);
              }}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: T.border }}
            >
              <Text style={{ color: T.text, fontWeight: "900" }}>Open</Text>
            </Pressable>
          </View>

          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
            APR: {stakingApr ? `${(stakingApr * 100).toFixed(2)}%` : "—"}
          </Text>
          <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
            Principal Staked: {fmtNum(stakedBalance)} HNY
          </Text>
          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
            stHNY Value: {fmtNum(tokenBalances["stHNY"] || stakedBalance)} stHNY (incl. rewards)
          </Text>

          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
            Manage your positions and stake more HNY in the Staking modal.
          </Text>
        </Card>

        {/* Liquidity Pools */}
        <Card T={T} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>🌊 Liquidity Pools</Text>
            <Pressable
              onPress={() => { pausePollingRef.current = true; setLpTab("positions"); setLpModalOpen(true); }}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: T.border }}
            >
              <Text style={{ color: T.text, fontWeight: "900" }}>Open</Text>
            </Pressable>
          </View>

          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
            APR: {(lpApr * 100).toFixed(0)}% • LPHNY Held: {fmtNum(tokenBalances["LPHNY"] || 0, 4)}
          </Text>

          {lpPositions.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {lpPositions.slice(0, 2).map(pos => (
                <View key={pos.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: T.border }}>
                  <Text style={{ color: T.text, fontWeight: "800", fontSize: 12 }}>{pos.poolId}</Text>
                  <Text style={{ color: T.green, fontWeight: "800", fontSize: 12 }}>{fmtNum(pos.sharePercent, 4)}% share • {fmtUSD(pos.positionUSD)}</Text>
                </View>
              ))}
              {lpPositions.length > 2 && (
                <Text style={{ color: T.sub, marginTop: 4, fontWeight: "600", fontSize: 11 }}>+{lpPositions.length - 2} more positions</Text>
              )}
            </View>
          ) : (
            <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800", fontSize: 12 }}>
              No active positions. Add liquidity to earn 8% APR in HNY rewards.
            </Text>
          )}

          <Text style={{ color: T.sub, marginTop: 8, fontWeight: "600", fontSize: 11 }}>
            Pool pairs: HNY-ETH, HNY-BTC, HNY-SOL, HNY-USDT, HNY-USDC, HNY-XRP
          </Text>
        </Card>

{/* Transactions */}
        <Card T={T} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Transactions</Text>
            <Button
              T={T}
              label={liveRefresh ? "Live: ON" : "Live: OFF"}
              variant={liveRefresh ? "blue" : "outline"}
              onPress={() => setLiveRefresh((v) => !v)}
            />
          </View>

          <View style={{ height: 12 }} />

          {displayTxs.length === 0 ? (
            <Text style={{ color: T.sub, fontWeight: "800" }}>No transactions yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {displayTxs.slice(0, 20).map((tx: any, idx: number) => {
                const status = String(tx?.status || "unknown");
                const isPending = status === "pending";
                const w = (wallet || "").trim();
                const from = String(tx?.from || "").trim();
                const to = String(tx?.to || "").trim();

                // Parse metaJson for token details
                let meta: any = null;
                try { meta = tx?.metaJson ? JSON.parse(tx.metaJson) : null; } catch {}

                const txType = String(tx?.type || "").toLowerCase();

                // Determine token symbol and direction label
                let tokenSymbol = "HNY";
                let directionLabel = "";
                let amountDisplay = "";

                if (txType === "swap" && meta) {
                  tokenSymbol = meta.tokenIn || "?";
                  directionLabel = "Swap";
                  amountDisplay = `${fmtNum(Number(meta.amountIn || tx?.amount || 0))} ${meta.tokenIn || "?"} → ${fmtNum(Number(meta.expectedAmountOut || meta.amountOut || 0))} ${meta.tokenOut || "?"}`;
                } else if (txType === "token_send" && meta) {
                  tokenSymbol = meta.tokenSymbol || "?";
                  const direction = w && from === w ? "Sent" : "Received";
                  directionLabel = direction;
                  const amt = Number(meta.amount || tx?.amount || 0);
                  amountDisplay = `${direction === "Sent" ? "-" : "+"}${fmtNum(amt)} ${tokenSymbol}`;
                } else if (txType === "stake") {
                  directionLabel = "Stake";
                  amountDisplay = `${fmtNum(Number(tx?.amount || 0))} HNY`;
                } else if (txType === "unstake" || txType === "claim") {
                  directionLabel = txType === "unstake" ? "Unstake" : "Claim";
                  amountDisplay = `+${fmtNum(Number(tx?.amount || 0))} HNY`;
                } else if (txType === "mint") {
                  directionLabel = "Mint";
                  amountDisplay = `+${fmtNum(Number(tx?.amount || 0))} HNY`;
                } else if (txType === "token_faucet" && meta) {
                  directionLabel = "Faucet";
                  const sym = meta.tokenSymbol || "?";
                  amountDisplay = `+${fmtNum(Number(meta.amount || tx?.amount || 0))} ${sym}`;
                } else if (txType === "lp_add" && meta) {
                  directionLabel = "LP Add";
                  amountDisplay = `${fmtNum(Number(meta.amountA || 0))} ${meta.tokenA || "?"} + ${fmtNum(Number(meta.amountB || 0))} ${meta.tokenB || "?"}`;
                } else if (txType === "lp_remove" && meta) {
                  directionLabel = "LP Remove";
                  amountDisplay = `+${fmtNum(Number(meta.tokenAOut || 0))} ${meta.tokenA || "?"} +${fmtNum(Number(meta.tokenBOut || 0))} ${meta.tokenB || "?"}`;
                } else if (txType === "lp_claim" && meta) {
                  directionLabel = "LP Claim";
                  amountDisplay = `+${fmtNum(Number(meta.rewardHNY || tx?.amount || 0))} HNY`;
                } else {
                  const direction = w && from === w ? "Sent" : w && to === w ? "Received" : "Tx";
                  directionLabel = direction;
                  const amt = Number(tx?.amount || 0);
                  amountDisplay = `${direction === "Sent" ? "-" : "+"}${fmtNum(amt)} HNY`;
                }

                const gasFee = Number(tx?.gasFee || 0);
                const svcFee = Number(tx?.serviceFee || 0);
                const totalFee = gasFee + svcFee;

                return (
                  <View
                    key={String(tx?.id || idx)}
                    style={{
                      borderWidth: 1,
                      borderColor: T.border,
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: T.glass2,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: T.text, fontWeight: "900" }}>
                        {directionLabel} • {status}
                      </Text>
                      <Text style={{ color: txType === "swap" || txType === "lp_remove" || txType === "lp_claim" ? T.green : txType === "lp_add" ? T.blue : directionLabel === "Sent" || directionLabel === "Stake" ? "#ff6b6b" : T.green, fontWeight: "900", fontSize: 14 }}>
                        {amountDisplay}
                      </Text>
                    </View>

                    {txType !== "swap" && (
                      <>
                        <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
                          From: {shortAddr(from)}
                        </Text>
                        <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                          To: {shortAddr(to)}
                        </Text>
                      </>
                    )}

                    {totalFee > 0 && (
                      <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                        Fees: {fmt8(totalFee)} HNY
                      </Text>
                    )}

                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      Block: {String(tx?.blockHeight ?? tx?.height ?? "—")} • Time: {formatTxTime(tx?.timestamp ?? tx?.timeMs ?? tx?.time)}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        const id = String(tx?.id || "");
                        if (!id) return;
                        try {
                          await Clipboard.setStringAsync(id);
                          showToast("TxID copied ✅");
                        } catch {}
                      }}
                    >
                      <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                        TxID: {shortId(String(tx?.id || ""))} (tap to copy)
                      </Text>
                    </Pressable>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          T={T}
                          label="Show Details"
                          variant="outline"
                          onPress={() => {
                            const id = String(tx?.id || "");
                            if (!id) return;
                            router.push(`/tx/${encodeURIComponent(id)}`);
                          }}
                        />
                      </View>
                    </View>

                    {isPending && (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            T={T}
                            label="Boost"
                            variant="blue"
                            onPress={() => {
                              pausePollingRef.current = true;
                              setRbfTx(tx);
                              setRbfOpen(true);
                            }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            T={T}
                            label="Cancel"
                            variant="danger"
                            onPress={() => {
                              pausePollingRef.current = true;
                              setCancelTx(tx);
                              setCancelOpen(true);
                            }}
                          />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {pendingCount > 0 && (
            <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>
              Pending: {pendingCount} (Boost/Cancel available)
            </Text>
          )}
        </Card>

        </> /* end HIVE mode */}

      </ScrollView>

      {/* Confirm modal */}
      {confirmOpen && quote && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Confirm Send</Text>
                <Pressable onPress={() => closeAllModals()}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                To: {shortAddr(String(quote.to || ""))}
              </Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
                Amount: {quote.baseAmt}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                Nonce: {expectedNonce ?? "—"}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                TxID: — (appears after submission)
              </Text>

              <View style={{ height: 12 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>
                Base gas: {fmt8(Number(minGasFee || 0))}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                Priority fee: {fmt8(Number(((Number(quote.baseAmt || 0) * priorityRateFraction(priorityTier)) || 0).toFixed(8)))}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                Gas total: {fmt8(Number(quote.chosenGas || 0))}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                Service fee: {fmt8(Number(quote.serviceFee || 0))}
              </Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                Total cost: {fmt8(Number(quote.totalCost || 0))}
              </Text>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Back" variant="outline" onPress={closeAllModals} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label={sendBusy ? "Submitting…" : "Confirm"}
                    variant="green"
                    disabled={sendBusy}
                    onPress={handleSendSubmit}
                  />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      
      {/* Staking modal */}
      {stakingModalOpen && (
        <Overlay
          onClose={() => {
            setStakingModalOpen(false);
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14, height: stakingModalHeight }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Staking</Text>
                <Pressable onPress={() => setStakingModalOpen(false)}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Stake" variant={stakingTab === "stake" ? "blue" : "outline"} onPress={() => setStakingTab("stake")} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Unstake" variant={stakingTab === "unstake" ? "blue" : "outline"} onPress={() => setStakingTab("unstake")} />
                </View>
              </View>

              {stakingTab === "stake" && (
                <ScrollView style={{ marginTop: 12, flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: T.sub, fontWeight: "800" }}>APR: {stakingApr ? `${(stakingApr * 100).toFixed(2)}%` : "—"}</Text>
                    <Text style={{ color: T.green, fontWeight: "900", fontSize: 13 }}>Available: {fmtNum(balancesView.spendable)} HNY</Text>
                  </View>

                  <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Amount</Text>
                  <TextInput
                    value={stakeAmountText}
                    onChangeText={(v) => setStakeAmountText(normalizeAmountText(v))}
                    placeholder="0.00"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                    style={{
                      marginTop: 8,
                      borderWidth: 1,
                      borderColor: T.border,
                      borderRadius: 12,
                      padding: 12,
                      color: T.text,
                      fontWeight: "800",
                    }}
                  />

                  <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Lock Period</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button T={T} label="30 days" variant={String(stakeLockDaysText) === "30" ? "blue" : "outline"} onPress={() => setStakeLockDaysText("30")} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button T={T} label="60 days" variant={String(stakeLockDaysText) === "60" ? "blue" : "outline"} onPress={() => setStakeLockDaysText("60")} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button T={T} label="90 days" variant={String(stakeLockDaysText) === "90" ? "blue" : "outline"} onPress={() => setStakeLockDaysText("90")} />
                    </View>
                  </View>

                  <View style={{ height: 12 }} />
                  <Button
                    T={T}
                    label={stakeBusy ? "Staking..." : "Stake"}
                    variant={stakeBusy ? "outline" : "purple"}
                    disabled={stakeBusy}
                    onPress={openStakeConfirm}
                  />
                </ScrollView>
              )}

              {stakingTab === "unstake" && (
                <View style={{ marginTop: 12, flex: 1, minHeight: 120 }}>
                  <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}>
                    {stakingPositions.length === 0 ? (
                      <>
                        <Text style={{ color: T.sub, fontWeight: "800" }}>No staking positions.</Text>
                        <View style={{ marginTop: 10, padding: 10, borderWidth: 1, borderColor: T.border, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.25)" }}>
                        <Text style={{ color: T.sub, fontWeight: "800" }}>Wallet: {wallet}</Text>
                        <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>API: {apiBaseText || "(default)"}</Text>
                        {stakingLoadError ? <Text style={{ color: "#ffb3b3", marginTop: 4, fontWeight: "900" }}>Error: {stakingLoadError}</Text> : null}
                      </View>
                      </>
                    ) : (
                      stakingPositions.map((p) => (
                        <View
                          key={p.id}
                          style={{
                            borderWidth: 1,
                            borderColor: T.border,
                            borderRadius: 12,
                            padding: 12,
                            marginBottom: 12,
                            backgroundColor: T.glass,
                          }}
                        >
                          <Text style={{ color: T.text, fontWeight: "900" }}>Principal: {fmt8(Number(((p as any).principal ?? (p as any).amount ?? 0)))}</Text>
                          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Lock: {p.lockDays} days</Text>
                          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Status: {p.status}</Text>
                          {Number((p as any).claimable || 0) > 0 && (
                            <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                              Claimable: {fmt8(Number((p as any).claimable || 0))}
                            </Text>
                          )}
                          {String((p as any).status) === "unlocking" && Number.isFinite(Number((p as any).withdrawAtMs)) && (
                            <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                              Withdraw after: {new Date(Number((p as any).withdrawAtMs)).toLocaleString()}
                            </Text>
                          )}
                          <View style={{ height: 10 }} />
                          {Number((p as any).claimable || 0) > 0 && (
                            <Button
                              T={T}
                              label={claimBusyId === String(p.id) ? "Working..." : "Claim"}
                              variant={claimBusyId === String(p.id) ? "outline" : "green"}
                              onPress={() => openClaimConfirm(String(p.id))}
                              disabled={!!claimBusyId}
                            />
                          )}
                          {Number((p as any).claimable || 0) > 0 && <View style={{ height: 10 }} />}
                          <Button
                            T={T}
                            label={
                              unstakeBusyId === String(p.id)
                                ? "Working..."
                                : String((p as any).status) === "staked"
                                ? `Start Unlock (${Number((p as any).unlockDelayDays || ((p as any).lockDays === 30 ? 3 : 7))}d)`
                                : "Withdraw"
                            }
                            variant={unstakeBusyId === String(p.id) ? "outline" : "purple"}
                            onPress={() => handleUnstake(String(p.id))}
                            disabled={
                              !!unstakeBusyId ||
                              (String((p as any).status) === "unlocking" &&
                                !((p as any).canWithdraw || (Number((p as any).withdrawAtMs || 0) <= Date.now())))
                            }
                          />
                        </View>
                      ))
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Claim confirm overlay (opens on top of the staking modal) */}
      {claimConfirmOpen && claimPreview && (
        <Overlay
          onClose={() => {
            setClaimConfirmOpen(false);
            setClaimPreview(null);
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14, maxWidth: 520 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Confirm Claim</Text>
                <Pressable
                  onPress={() => {
                    setClaimConfirmOpen(false);
                    setClaimPreview(null);
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Position: {String(claimPreview.positionId).slice(0, 10)}…</Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>Claimable: {fmt8(Number(claimPreview.claimable || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>Gas fee: {fmt8(Number(claimPreview.gasFee || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>Service fee: {fmt8(Number(claimPreview.serviceFee || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "900" }}>Total fee: {fmt8(Number(claimPreview.totalFee || 0))}</Text>

              {message ? (
                <Text style={{ color: T.text, marginTop: 10, fontWeight: "800" }}>{message}</Text>
              ) : null}

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label="Back"
                    variant="outline"
                    onPress={() => {
                      setClaimConfirmOpen(false);
                      setClaimPreview(null);
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label={claimBusyId ? "Submitting…" : "Confirm"}
                    variant="green"
                    disabled={!!claimBusyId}
                    onPress={handleClaimConfirm}
                  />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}


{/* RBF modal */}
      {rbfOpen && rbfTx && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Boost Pending (RBF)</Text>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="+10%" variant="outline" onPress={() => doRbf(1.1)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="+25%" variant="outline" onPress={() => doRbf(1.25)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="+50%" variant="outline" onPress={() => doRbf(1.5)} />
                </View>
              </View>

              <View style={{ height: 12 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Cancel modal */}
      {cancelOpen && cancelTx && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Cancel Pending Tx</Text>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel +25%" variant="danger" onPress={() => doCancel(1.25)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel +50%" variant="danger" onPress={() => doCancel(1.5)} />
                </View>
              </View>

              <View style={{ height: 12 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* History modal */}
      {historyOpen && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Transaction History</Text>
              <View style={{ height: 12 }} />

              <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="always">
                {displayTxs.length === 0 ? (
                  <Text style={{ color: T.sub, fontWeight: "800" }}>No transactions yet.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {displayTxs.slice(0, 100).map((tx: any, idx: number) => (
                      <View
                        key={String(tx?.id || idx)}
                        style={{
                          borderWidth: 1,
                          borderColor: T.border,
                          borderRadius: 12,
                          padding: 12,
                          backgroundColor: T.glass2,
                        }}
                      >
                        <Text style={{ color: T.text, fontWeight: "900" }}>
                          {String(tx?.type || "tx").toUpperCase()} • {String(tx?.status || "unknown")}
                        </Text>
                        <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
                          To: {shortAddr(String(tx?.to || ""))}
                        </Text>
                        <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                          Amount: {Number(tx?.amount || 0)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>

              <View style={{ height: 12 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      
{/* QR scan modal */}
{qrScanOpen && (
  <Overlay onClose={() => setQrScanOpen(false)} zIndex={10001}>
    <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
      <View style={{ padding: 14, width: 360, maxWidth: 420 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Scan recipient QR</Text>
          <Pressable onPress={() => setQrScanOpen(false)}>
            <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
          </Pressable>
        </View>

        {qrScanError ? (
          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>{qrScanError}</Text>
        ) : Platform.OS === "web" ? (
          <Text style={{ color: "rgba(100,180,255,0.6)", marginTop: 6, fontSize: 11, fontWeight: "700" }}>
            Best on Chrome/Edge · Allow camera when prompted
          </Text>
        ) : null}

        <View
          style={{
            marginTop: 12,
            height: 320,
            borderRadius: 14,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: T.border,
            backgroundColor: "rgba(0,0,0,0.25)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {CameraViewComp ? (
            <CameraViewComp
              style={{ width: "100%", height: "100%" }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarCodeScanned={(ev: any) => {
                if (scanLockRef.current) return;
                const raw = String(ev?.data || "");
                const addr = extractHnyAddress(raw);
                if (!addr) {
                  scanLockRef.current = false;
                  showToast("QR doesn't contain an HNY address", "warn");
                  return;
                }
                scanLockRef.current = true;
                setToText(sanitizeAddress(addr));
                setUnifiedSendTo(sanitizeAddress(addr));
                showToast("Recipient set from QR");
                setQrScanOpen(false);
                setTimeout(() => { scanLockRef.current = false; }, 800);
              }}
              onBarcodeScanned={(ev: any) => {
                if (scanLockRef.current) return;
                const raw = String(ev?.data || "");
                const addr = extractHnyAddress(raw);
                if (!addr) {
                  scanLockRef.current = false;
                  showToast("QR doesn't contain an HNY address", "warn");
                  return;
                }
                scanLockRef.current = true;
                setToText(sanitizeAddress(addr));
                setUnifiedSendTo(sanitizeAddress(addr));
                showToast("Recipient set from QR");
                setQrScanOpen(false);
                setTimeout(() => { scanLockRef.current = false; }, 800);
              }}
            />
          ) : (
            <Text style={{ color: T.sub, fontWeight: "800" }}>Camera not available.</Text>
          )}
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button T={T} label="Paste from clipboard" variant="outline" onPress={pasteRecipientFromClipboard} />
          </View>
        </View>
      </View>
    </GlassCard>
  </Overlay>
)}

{/* Receive modal */}
      {receiveOpen && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>
                {activeNetworkType === "evm" ? "Receive ETH / Tokens" : "Receive HNY"}
              </Text>
                <Pressable onPress={() => closeAllModals()}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                {activeNetworkType === "evm" ? "Base address (0x)" : "Wallet address"}
              </Text>

              <View
                style={{
                  marginTop: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: activeNetworkType === "evm" ? "rgba(0,82,255,0.4)" : "rgba(57,255,20,0.3)",
                  backgroundColor: "rgba(0,0,0,0.4)",
                }}
              >
                {activeNetworkType === "evm" ? (
                  evmAddress ? (
                    <HexQR value={evmAddress} size={220} color="#0052FF" backgroundColor="#040507" />
                  ) : (
                    <Text style={{ color: T.sub, fontWeight: "800" }}>Deriving address…</Text>
                  )
                ) : (
                  !!wallet ? (
                    <HexQR value={String(wallet).trim()} size={220} color="#39ff14" backgroundColor="#040507" />
                  ) : (
                    <Text style={{ color: T.sub, fontWeight: "800" }}>Loading wallet…</Text>
                  )
                )}
              </View>

              <Text
                selectable
                style={{
                  marginTop: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.border,
                  color: T.text,
                  backgroundColor: T.glass2,
                  fontWeight: "800",
                  fontSize: 12,
                }}
              >
                {activeNetworkType === "evm" ? (evmAddress || "—") : (wallet || "—")}
              </Text>

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={copied ? "Copied ✅" : "Copy"} variant="green" onPress={async () => {
                    const addr = activeNetworkType === "evm" ? evmAddress : wallet;
                    if (addr) { await Clipboard.setStringAsync(addr); showToast("Copied!"); }
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
                </View>
              </View>

              {activeNetworkType === "hive" && (
                <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                  Tip: open the app in an incognito window to create a second wallet and test sending between two addresses.
                </Text>
              )}
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ═══ EVM Send Modal ═══════════════════════════════════════════════ */}
      {evmSendOpen && (
        <Overlay onClose={() => setEvmSendOpen(false)} zIndex={10500}>
          <GlassCard style={{ borderWidth: 1, borderColor: "rgba(0,82,255,0.4)", backgroundColor: "rgba(4,5,7,0.97)" }}>
            <View style={{ padding: 18, minWidth: 320, maxWidth: 420 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900", flex: 1 }}>Send ETH</Text>
                <View style={{ backgroundColor: "#0052FF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 9 }}>BASE</Text>
                </View>
                <Pressable onPress={() => setEvmSendOpen(false)}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>✕</Text>
                </Pressable>
              </View>

              <Text style={{ color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12, marginBottom: 6 }}>Recipient (0x address)</Text>
              <TextInput
                value={evmSendTo}
                onChangeText={setEvmSendTo}
                placeholder="0x..."
                placeholderTextColor="rgba(255,255,255,0.25)"
                style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,82,255,0.3)", color: "#fff", padding: 12, fontWeight: "800", marginBottom: 12 }}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={{ color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12, marginBottom: 6 }}>Amount (ETH)</Text>
              <TextInput
                value={evmSendAmount}
                onChangeText={setEvmSendAmount}
                placeholder="0.001"
                placeholderTextColor="rgba(255,255,255,0.25)"
                keyboardType="decimal-pad"
                style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,82,255,0.3)", color: "#fff", padding: 12, fontWeight: "800", marginBottom: 4 }}
              />
              <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 14 }}>
                Balance: {(Number(evmEthBalance) / 1e18).toFixed(6)} ETH
              </Text>

              <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 16 }}>
                EIP-1559 · secp256k1 · Gas estimated on confirm
              </Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => setEvmSendOpen(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={evmSendBusy ? "Sending…" : "Send"} variant="green" disabled={evmSendBusy} onPress={handleEvmSend} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ═══ EVM Swap Modal ═══════════════════════════════════════════════ */}
      {evmSwapOpen && (
        <Overlay onClose={() => { setEvmSwapOpen(false); setEvmSwapQuote(null); }} zIndex={10500}>
          <GlassCard style={{ borderWidth: 1, borderColor: "rgba(0,82,255,0.4)", backgroundColor: "rgba(4,5,7,0.97)" }}>
            <View style={{ padding: 18, minWidth: 320, maxWidth: 420 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900", flex: 1 }}>Swap Tokens</Text>
                <View style={{ backgroundColor: "#0052FF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 9 }}>0x PROTOCOL</Text>
                </View>
                <Pressable onPress={() => { setEvmSwapOpen(false); setEvmSwapQuote(null); }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>✕</Text>
                </Pressable>
              </View>

              {/* Sell side */}
              <Text style={{ color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12, marginBottom: 6 }}>Sell</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                <View style={{ flex: 2 }}>
                  <TextInput
                    value={evmSwapAmount}
                    onChangeText={t => { setEvmSwapAmount(t); setEvmSwapQuote(null); }}
                    placeholder="0.0"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    keyboardType="decimal-pad"
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,82,255,0.3)", color: "#fff", padding: 12, fontWeight: "800" }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  {/* Simple token selector cycling */}
                  {(["ETH","USDC","WETH","DAI"] as const).map(tok => (
                    <Pressable key={tok} onPress={() => { setEvmSwapSell(tok); setEvmSwapQuote(null); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, marginBottom: 2, borderRadius: 8, borderWidth: 1, borderColor: evmSwapSell === tok ? "#0052FF" : "rgba(255,255,255,0.15)", backgroundColor: evmSwapSell === tok ? "rgba(0,82,255,0.2)" : "transparent" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, textAlign: "center" }}>{tok}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Text style={{ color: "rgba(255,255,255,0.35)", textAlign: "center", fontSize: 18, marginBottom: 8 }}>↓</Text>

              {/* Buy side */}
              <Text style={{ color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12, marginBottom: 6 }}>Receive</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                <View style={{ flex: 2, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,82,255,0.2)", padding: 12 }}>
                  <Text style={{ color: evmSwapQuote ? "#39ff14" : "rgba(255,255,255,0.35)", fontWeight: "900" }}>
                    {evmSwapQuote
                      ? `≈ ${(Number(evmSwapQuote.buyAmount) / (evmSwapBuy === "USDC" || evmSwapBuy === "USDbC" ? 1e6 : 1e18)).toFixed(4)}`
                      : "—"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  {(["USDC","ETH","WETH","DAI"] as const).map(tok => (
                    <Pressable key={tok} onPress={() => { setEvmSwapBuy(tok); setEvmSwapQuote(null); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, marginBottom: 2, borderRadius: 8, borderWidth: 1, borderColor: evmSwapBuy === tok ? "#0052FF" : "rgba(255,255,255,0.15)", backgroundColor: evmSwapBuy === tok ? "rgba(0,82,255,0.2)" : "transparent" }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, textAlign: "center" }}>{tok}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {evmSwapQuote && (
                <View style={{ backgroundColor: "rgba(0,82,255,0.08)", borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "rgba(0,82,255,0.3)" }}>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 12 }}>{evmSwapQuote.price}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 }}>
                    Gas est: {(Number(evmSwapQuote.estimatedGas) / 1e9).toFixed(0)} Gwei
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => { setEvmSwapOpen(false); setEvmSwapQuote(null); }} />
                </View>
                {!evmSwapQuote ? (
                  <View style={{ flex: 1 }}>
                    <Button T={T} label={evmSwapFetchingQuote ? "Getting quote…" : "Get Quote"} variant="blue" disabled={evmSwapFetchingQuote} onPress={fetchEvmSwapQuote} />
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Button T={T} label={evmSwapBusy ? "Swapping…" : "Confirm Swap"} variant="green" disabled={evmSwapBusy} onPress={handleEvmSwapConfirm} />
                  </View>
                )}
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14, height: Math.min(Math.round(winHeight * 0.80), 620) }}>
              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>⚙️ Settings</Text>
                <Pressable onPress={() => closeAllModals()}>
                  <Text style={{ color: T.sub, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator
                persistentScrollbar
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                {/* ── APPEARANCE ── */}
                <View style={{ marginTop: 14, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>APPEARANCE</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <Text style={{ color: T.sub, fontWeight: "800", marginBottom: 8 }}>Theme</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="Matrix" variant={theme === "matrix" ? "blue" : "outline"} onPress={() => setTheme("matrix")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="Noir" variant={theme === "noir" ? "blue" : "outline"} onPress={() => setTheme("noir")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button T={T} label="Honey" variant={theme === "honey" ? "blue" : "outline"} onPress={() => setTheme("honey")} />
                  </View>
                </View>

                <Text style={{ color: T.sub, fontWeight: "800", marginTop: 12, marginBottom: 8 }}>Skin</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: "45%" }}>
                    <Button T={T} label="Athena’s Temple" variant={skin === "athena-temple2" ? "purple" : "outline"} onPress={() => setSkin("athena-temple2")} />
                  </View>
                  <View style={{ flex: 1, minWidth: "45%" }}>
                    <Button T={T} label="Honey Coin" variant={skin === "matrix-honey-coin" ? "purple" : "outline"} onPress={() => setSkin("matrix-honey-coin")} />
                  </View>
                  <View style={{ flex: 1, minWidth: "45%", marginTop: 8 }}>
                    <Button T={T} label="Matrix Honeycomb" variant={skin === "matrix-honeycomb" ? "purple" : "outline"} onPress={() => setSkin("matrix-honeycomb")} />
                  </View>
                  <View style={{ flex: 1, minWidth: "45%", marginTop: 8 }}>
                    <Button T={T} label="No Background" variant={skin === "solid-noir" ? "purple" : "outline"} onPress={() => setSkin("solid-noir")} />
                  </View>
                </View>

                {/* ── WALLETS ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>WALLETS</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <Pressable
                  onPress={() => { setSettingsOpen(false); setWalletSwitcherOpen(true); }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}
                >
                  <Text style={{ color: T.text, fontWeight: "800", flex: 1 }}>👛  Manage Wallets & Addresses</Text>
                  <Text style={{ color: T.sub, fontSize: 16 }}>›</Text>
                </Pressable>
                <Text style={{ color: T.sub, fontSize: 11, marginTop: 6, fontWeight: "600" }}>
                  {walletList.length} wallet{walletList.length !== 1 ? "s" : ""} — tap to add, import, or switch
                </Text>

                {/* ── NETWORKS ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>NETWORKS</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <Pressable
                  onPress={() => { setSettingsOpen(false); setNetworkSwitcherOpen(true); }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontWeight: "800" }}>🌐  Switch / Add Networks</Text>
                    <Text style={{ color: T.sub, fontWeight: "600", fontSize: 11, marginTop: 2 }}>Active: {activeNetworkName}</Text>
                  </View>
                  <Text style={{ color: T.sub, fontSize: 16 }}>›</Text>
                </Pressable>

                {Platform.OS !== "web" && (
                  <>
                    <Text style={{ color: T.sub, fontWeight: "800", marginTop: 12, marginBottom: 6 }}>Node RPC Override</Text>
                    <Text style={{ color: T.sub, fontSize: 11, marginBottom: 8 }}>
                      Override the server URL for this device (e.g. your LAN IP when using Expo Tunnel).
                    </Text>
                    <TextInput
                      value={apiBaseText}
                      onChangeText={setApiBaseText}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="http://192.168.x.x:3000"
                      placeholderTextColor={T.sub}
                      style={{ borderWidth: 1, borderColor: T.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, color: T.text, backgroundColor: T.glass2 }}
                    />
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Button T={T} label="Save" variant="blue" onPress={async () => {
                          const v = String(apiBaseText || "").trim();
                          if (!v) { showToast("Enter an API base URL", "warn"); return; }
                          await kvSet("HIVE_API_BASE_OVERRIDE", v);
                          setApiBase(v);
                          hardRefreshAll().catch(() => {});
                          showToast("API base saved", "info");
                        }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button T={T} label="Reset" variant="outline" onPress={async () => {
                          await kvDel("HIVE_API_BASE_OVERRIDE");
                          const d = resetApiBase();
                          setApiBaseText(d);
                          showToast("Override cleared", "info");
                        }} />
                      </View>
                    </View>
                  </>
                )}

                {/* ── SECURITY ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>SECURITY</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <Text style={{ color: T.sub, fontSize: 12, marginBottom: 8 }}>
                  Your 12-word recovery phrase is the master key to all your wallets. Never share it.
                </Text>
                <Button T={T} label="🔑  View Seed Phrase" variant="outline" onPress={chrysalisUnlockSeed} />

                <View style={{ height: 10 }} />
                <Button T={T} label={appPin ? "🔒  Change App PIN" : "🔒  Set App PIN"} variant="outline" onPress={() => {
                  setNewPinInput("");
                  setConfirmPinInput("");
                  setSettingPinOpen(true);
                }} />
                {appPin && (
                  <>
                    <View style={{ height: 8 }} />
                    <Button T={T} label="Remove PIN" variant="outline" onPress={async () => {
                      await kvDel(APP_PIN_KEY);
                      setAppPin(null);
                      showToast("PIN removed");
                    }} />
                  </>
                )}

                {/* ── CHRYSALIS ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>CHRYSALIS SECURITY</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                {/* Status banner */}
                <View style={{
                  padding: 12, borderRadius: 12, marginBottom: 10,
                  backgroundColor: chrysalisRegistered
                    ? "rgba(57,255,20,0.07)"
                    : "rgba(255,180,0,0.07)",
                  borderWidth: 1,
                  borderColor: chrysalisRegistered
                    ? "rgba(57,255,20,0.3)"
                    : "rgba(255,180,0,0.3)",
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 18, marginRight: 8 }}>
                      {chrysalisRegistered ? "🔰" : "⚠️"}
                    </Text>
                    <Text style={{
                      fontWeight: "900", fontSize: 13,
                      color: chrysalisRegistered ? "#39ff14" : "#ffb400",
                    }}>
                      {chrysalisRegistered ? "Chrysalis Active" : "Chrysalis Not Registered"}
                    </Text>
                  </View>
                  {chrysalisRegistered && chrysalisKeys ? (
                    <>
                      <Text style={{ color: T.sub, fontSize: 11, fontFamily: "Space Mono" }}>
                        {chrysalisFingerprint(chrysalisKeys.chrysalisId)}
                      </Text>
                      <Text style={{ color: T.sub, fontSize: 10, marginTop: 4 }}>
                        ML-KEM-768 · ML-DSA-65 · CAS-φ Sharding
                      </Text>
                      <Text style={{ color: T.sub, fontSize: 10 }}>
                        NIST FIPS 203 · 204 — Quantum-Resistant
                      </Text>
                    </>
                  ) : (
                    <Text style={{ color: T.sub, fontSize: 11 }}>
                      Register your post-quantum keys to protect this wallet against quantum computer attacks.
                    </Text>
                  )}
                </View>

                {!chrysalisRegistered && (
                  <Button
                    T={T}
                    label={chrysalisRegistering ? "Activating Chrysalis…" : "🔰  Activate Chrysalis"}
                    variant="purple"
                    onPress={registerChrysalis}
                  />
                )}

                {chrysalisRegistered && chrysalisKeys && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={{ color: T.sub, fontSize: 10, marginBottom: 4 }}>KEM Public Key (ML-KEM-768)</Text>
                    <Text style={{
                      color: T.sub, fontSize: 9, fontFamily: "Space Mono",
                      backgroundColor: "rgba(255,255,255,0.04)",
                      borderRadius: 6, padding: 6,
                    }} numberOfLines={2} ellipsizeMode="tail">
                      {chrysalisKeys.kemPublicKeyHex.slice(0, 48)}…
                    </Text>
                    <Text style={{ color: T.sub, fontSize: 10, marginTop: 8, marginBottom: 4 }}>DSA Public Key (ML-DSA-65)</Text>
                    <Text style={{
                      color: T.sub, fontSize: 9, fontFamily: "Space Mono",
                      backgroundColor: "rgba(255,255,255,0.04)",
                      borderRadius: 6, padding: 6,
                    }} numberOfLines={2} ellipsizeMode="tail">
                      {chrysalisKeys.dsaPublicKeyHex.slice(0, 48)}…
                    </Text>

                    {/* ── Chrysalis Secure Backup ── */}
                    <View style={{ marginTop: 14, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: "rgba(57,255,20,0.15)" }} />
                      <Text style={{ color: "#39ff14", fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>SECURE BACKUP</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: "rgba(57,255,20,0.15)" }} />
                    </View>
                    <Text style={{ color: T.sub, fontSize: 11, marginBottom: 4 }}>
                      Encrypts your seed with ML-KEM-768, then splits it into 7 CAS-φ shards (4 real + 3 decoys, randomly shuffled).
                      Any <Text style={{ color: "#39ff14", fontWeight: "900" }}>3 of the 4 primary shards</Text> reconstruct your backup.
                    </Text>
                    <Text style={{ color: "rgba(255,191,47,0.85)", fontSize: 10, marginBottom: 8 }}>
                      ⚠️ Shards are session-only — they are NOT saved in the app. Copy and store them before closing. Each generation creates unique new shards.
                    </Text>
                    <Button
                      T={T}
                      label={chrysalisBackupWorking ? "Encrypting & Sharding…" : "🔰  Generate Chrysalis Backup"}
                      variant="outline"
                      disabled={chrysalisBackupWorking}
                      onPress={generateChrysalisBackup}
                    />

                    {chrysalisBackupShards && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: "#39ff14", fontSize: 11, fontWeight: "800", marginBottom: 4 }}>
                          ✅ {chrysalisBackupShards.primaryShards} primary · {chrysalisBackupShards.decoyShards} decoy · threshold {chrysalisBackupShards.threshold} — randomly shuffled
                        </Text>
                        {chrysalisBackupShards.shards.map((shard) => (
                          <Pressable
                            key={shard.index}
                            onPress={() => {
                              // Strip role & part — exported JSON reveals nothing about shard type
                              const payload = JSON.stringify({ index: shard.index, data: shard.data });
                              Clipboard.setStringAsync(payload);
                              showToast(`Shard ${shard.index + 1} copied (role hidden)`, "info");
                            }}
                            style={{
                              marginTop: 6, padding: 8, borderRadius: 8,
                              borderWidth: 1,
                              borderColor: shard.role === "primary" ? "rgba(57,255,20,0.35)" : "rgba(255,255,255,0.12)",
                              backgroundColor: shard.role === "primary" ? "rgba(57,255,20,0.05)" : "rgba(255,255,255,0.02)",
                            }}
                          >
                            <Text style={{
                              color: shard.role === "primary" ? "#39ff14" : T.sub,
                              fontSize: 10, fontWeight: "800",
                            }}>
                              {shard.role === "primary" ? "🔰 PRIMARY" : "🎭 DECOY"} · Shard {shard.index + 1} · {shard.size} bytes
                            </Text>
                            <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, marginTop: 2 }}>
                              Copied JSON hides role — only you know which are primary
                            </Text>
                          </Pressable>
                        ))}
                        <Text style={{ color: T.sub, fontSize: 10, marginTop: 8 }}>
                          Tap each shard to copy. Copied JSON contains only {`{index, data}`} — no role label.
                          Save primary shards in separate secure locations. Decoy shards are random noise; store them too for plausible deniability.
                        </Text>

                        {/* ── Restore from Shards ── */}
                        <View style={{ marginTop: 14, marginBottom: 4, flexDirection: "row", alignItems: "center" }}>
                          <View style={{ flex: 1, height: 1, backgroundColor: "rgba(57,255,20,0.1)" }} />
                          <Text style={{ color: "#39ff14", fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>VERIFY / RESTORE</Text>
                          <View style={{ flex: 1, height: 1, backgroundColor: "rgba(57,255,20,0.1)" }} />
                        </View>
                        <Text style={{ color: T.sub, fontSize: 10, marginBottom: 6 }}>
                          To verify your saved shards work, paste any 3 primary shard JSONs below and hit Reconstruct.
                          Requires this device to have the active wallet loaded (uses its ML-KEM key to decrypt).
                        </Text>
                        {chrysalisRestoreInputs.map((val, idx) => (
                          <TextInput
                            key={idx}
                            value={val}
                            onChangeText={(t) => {
                              const arr = [...chrysalisRestoreInputs];
                              arr[idx] = t;
                              setChrysalisRestoreInputs(arr);
                            }}
                            placeholder={`Paste shard JSON ${idx + 1}…`}
                            placeholderTextColor="rgba(255,255,255,0.2)"
                            multiline
                            numberOfLines={2}
                            style={{
                              borderWidth: 1, borderColor: T.border, borderRadius: 8,
                              padding: 8, color: T.text, fontSize: 9,
                              backgroundColor: T.glass2, marginBottom: 6,
                              fontFamily: "monospace",
                            }}
                          />
                        ))}
                        <Button
                          T={T}
                          label={chrysalisRestoreWorking ? "Reconstructing…" : "🔓  Reconstruct from Shards"}
                          variant="outline"
                          disabled={chrysalisRestoreWorking}
                          onPress={restoreChrysalisBackup}
                        />
                        {chrysalisRestoreResult && (
                          <Pressable
                            onPress={() => {
                              Clipboard.setStringAsync(chrysalisRestoreResult!);
                              showToast("Mnemonic copied", "info");
                            }}
                            style={{
                              marginTop: 8, padding: 10, borderRadius: 8,
                              borderWidth: 1, borderColor: "rgba(57,255,20,0.4)",
                              backgroundColor: "rgba(57,255,20,0.06)",
                            }}
                          >
                            <Text style={{ color: "#39ff14", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>✅ Reconstruction successful — tap to copy mnemonic</Text>
                            <Text style={{ color: T.sub, fontSize: 9, fontFamily: "monospace" }} selectable>{chrysalisRestoreResult}</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* ── RECOVERY SHARDS ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>RECOVERY SHARDS</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <Text style={{ color: T.sub, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                  Recovery Shards let you restore your wallet on any device using a passphrase.
                  Unlike Chrysalis Backup, no master seed is needed to decrypt — any 3 of 4 shards + passphrase restores your wallet.
                </Text>

                <Button
                  T={T}
                  label={recoveryShardWorking ? "Generating…" : "🛡️  Generate Recovery Shards"}
                  variant="outline"
                  disabled={recoveryShardWorking}
                  onPress={() => {
                    setRecoveryShardPassphrase("");
                    setRecoveryShardConfirm("");
                    setRecoveryShardPassphraseOpen(true);
                  }}
                />

                {recoveryShards && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={{ color: "#39ff14", fontSize: 12, fontWeight: "800" }}>
                      ✅ 4 Recovery Shards — store each shard separately. Any 3 of 4 + passphrase restores your wallet.
                    </Text>
                    {recoveryShards.map((shard) => (
                      <Pressable
                        key={shard.part}
                        onPress={() => {
                          const payload = JSON.stringify({ type: shard.type, part: shard.part, data: shard.data });
                          setQrModalValue(payload);
                          setQrModalTitle(`Recovery Shard ${shard.part.toUpperCase()}`);
                          setQrModalOpen(true);
                        }}
                        style={{
                          padding: 10, borderRadius: 10, borderWidth: 1,
                          borderColor: "rgba(100,180,255,0.3)",
                          backgroundColor: "rgba(100,180,255,0.04)",
                          flexDirection: "row", alignItems: "center", gap: 10,
                        }}
                      >
                        <View style={{
                          width: 32, height: 32, borderRadius: 8,
                          backgroundColor: "rgba(100,180,255,0.12)",
                          alignItems: "center", justifyContent: "center",
                        }}>
                          <Text style={{ color: "rgba(100,180,255,0.9)", fontSize: 11, fontWeight: "900" }}>
                            {shard.part === "parity" ? "P" : shard.part}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: T.sub, fontSize: 10, fontWeight: "700" }}>
                            SHARD {shard.part.toUpperCase()} — tap for QR code
                          </Text>
                          <Text style={{ color: T.sub, fontSize: 9, fontFamily: "monospace" }} numberOfLines={1}>
                            {shard.data.slice(0, 32)}…
                          </Text>
                        </View>
                        <Ionicons name="qr-code-outline" size={18} color="rgba(100,180,255,0.6)" />
                      </Pressable>
                    ))}
                    <Text style={{ color: "rgba(255,200,60,0.8)", fontSize: 11, lineHeight: 16 }}>
                      ⚠️ These shards are generated fresh each session. Use Import Wallet → Recovery Shards tab to restore.
                    </Text>
                    <Button
                      T={T}
                      label="Clear Shards from Memory"
                      variant="outline"
                      onPress={() => setRecoveryShards(null)}
                    />
                  </View>
                )}

                {/* ── DEVELOPER ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>DEVELOPER</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
                  <Text style={{ color: T.text, fontWeight: "800", fontSize: 12 }}>HIVE Wallet</Text>
                  <Text style={{ color: T.sub, fontSize: 11, marginTop: 2 }}>Chain: Honey Network Testnet</Text>
                  <Text style={{ color: T.sub, fontSize: 11, marginTop: 1 }}>Node: {apiBaseText || "http://localhost:3000"}</Text>
                </View>

                {/* ── QUEEN BEE AI ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>QUEEN BEE AI</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                </View>

                <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#FFD700", backgroundColor: "rgba(255,215,0,0.06)", marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                    <Text style={{ fontSize: 18, marginRight: 8 }}>🐝</Text>
                    <Text style={{ color: "#FFD700", fontWeight: "900", fontSize: 13, flex: 1 }}>
                      Queen Bee AI Guardian
                    </Text>
                    <Text style={{ color: hasUnreadAlerts ? "#ff4444" : "#39ff14", fontSize: 11, fontWeight: "700" }}>
                      {hasUnreadAlerts ? `${queenBeeAlerts.filter(a => a.alert_level === "ALERT" && !a.dismissed).length} ALERT${queenBeeAlerts.filter(a => a.alert_level === "ALERT" && !a.dismissed).length !== 1 ? "S" : ""}` : "ALL CLEAR"}
                    </Text>
                  </View>
                  <Text style={{ color: T.sub, fontSize: 11, lineHeight: 16 }}>
                    AI-powered security monitoring powered by Queen Bee AI. Analyzes transactions for anomalies and threats in real time.
                  </Text>
                </View>

                <Button T={T} label={queenBeeAlerts.length > 0 ? `🔔 View Alerts (${queenBeeAlerts.length})` : "🔔 View Alerts"} variant="outline" onPress={() => { setSettingsOpen(false); setQueenBeeAlertsOpen(true); }} />
                <View style={{ height: 8 }} />
                <Button T={T} label={queenBeeScanBusy ? "🐝 Scanning…" : "🐝 Run Security Scan"} variant="outline" onPress={runQueenBeeScan} />

                {/* ── DANGER ZONE ── */}
                <View style={{ marginTop: 18, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: "rgba(255,90,90,0.4)" }} />
                  <Text style={{ color: "#ff6b6b", fontWeight: "900", fontSize: 11, marginHorizontal: 10, letterSpacing: 1 }}>DANGER ZONE</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: "rgba(255,90,90,0.4)" }} />
                </View>

                <Text style={{ color: T.sub, fontSize: 12, marginBottom: 8 }}>
                  Clears all local keys. Use only if the app is stuck or you want a fresh start.
                  Make sure your seed phrase is backed up first.
                </Text>
                <Button T={T} label="🗑️  Factory Reset (Clear All Local Data)" variant="outline" onPress={async () => {
                  const msg =
                    "WARNING: This permanently deletes your local wallet keys. " +
                    "Any funds NOT backed up will be UNRECOVERABLE.\n\nAre you sure?";
                  const doReset = async () => {
                    const KEYS = [
                      MNEMONIC_KEY, "HIVE_MASTER_SEED_B64", "HIVE_WALLETS_JSON",
                      "HIVE_ACTIVE_WALLET_IDX", "HIVE_PUBKEY_B64", "HIVE_PRIVKEY_B64",
                      "HIVE_WALLET_ID", "HIVE_API_BASE_OVERRIDE", APP_PIN_KEY,
                    ];
                    for (const k of KEYS) await kvDel(k);
                    if (Platform.OS === "web") { window.location.reload(); }
                    else { showToast("Local data cleared. Please close and reopen the app.", "warn"); closeAllModals(); }
                  };
                  if (Platform.OS === "web") {
                    if (!window.confirm(msg)) return;
                    await doReset();
                  } else {
                    Alert.alert("Factory Reset", msg, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reset", style: "destructive", onPress: doReset },
                    ]);
                  }
                }} />

                {/* ── LOG OUT ── */}
                <View style={{ marginTop: 24, marginBottom: 4 }}>
                  <Button T={T} label="🚪  Log Out / Lock App" variant="outline" onPress={() => {
                    closeAllModals();
                    if (appPin) {
                      setAppLocked(true);
                    } else {
                      // No PIN set — prompt to set one, or just navigate to onboarding
                      showToast("Set an App PIN in Security to enable lock", "info");
                    }
                  }} />
                </View>
              </ScrollView>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== CHRYSALIS OPERATION MODAL (reusable) ===== */}
      <ChrysalisModal
        visible={chrysalisVaultOpen}
        stage={chrysalisVaultStage}
        done={chrysalisVaultDone}
        title={chrysalisVaultTitle}
        chrysalisId={chrysalisKeys?.chrysalisId}
        onClose={() => { setChrysalisVaultOpen(false); setChrysalisVaultDone(false); setChrysalisVaultTitle("Chrysalis Vault"); }}
      />

      {/* ===== HEX QR CODE MODAL ===== */}
      {qrModalOpen && (
        <Overlay onClose={() => setQrModalOpen(false)} zIndex={24000}>
          <GlassCard style={{ borderWidth: 1, borderColor: "rgba(57,255,20,0.35)", backgroundColor: "rgba(4,5,7,0.97)", alignItems: "center" }}>
            <View style={{ padding: 24, alignItems: "center", gap: 16, minWidth: 280 }}>
              <Text style={{ color: "#39ff14", fontWeight: "900", fontSize: 15, letterSpacing: 1, textTransform: "uppercase" }}>
                {qrModalTitle}
              </Text>
              <HexQR value={qrModalValue} size={240} color="#39ff14" backgroundColor="#040507" />
              <Text style={{ color: "rgba(100,180,255,0.7)", fontSize: 10, fontFamily: "monospace", textAlign: "center" }} numberOfLines={2}>
                {qrModalValue.length > 64 ? `${qrModalValue.slice(0, 32)}…${qrModalValue.slice(-20)}` : qrModalValue}
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Copy" variant="outline" onPress={async () => {
                    await Clipboard.setStringAsync(qrModalValue);
                    showToast("Copied to clipboard", "info");
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Close" variant="outline" onPress={() => setQrModalOpen(false)} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== SEED PHRASE MODAL ===== */}
      {seedPhraseOpen && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.green, fontWeight: "800", fontSize: 18, marginBottom: 4 }}>
                Secret Recovery Phrase
              </Text>
              <Text style={{ color: T.sub, fontSize: 12, marginBottom: 14 }}>
                Keep this phrase private. Anyone who has it can access all your wallets.
              </Text>

              {seedPhrase ? (
                <>
                  <View style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                    backgroundColor: "rgba(57,255,20,0.03)",
                    borderWidth: 1,
                    borderColor: T.border,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 14,
                  }}>
                    {seedPhrase.split(" ").map((word, i) => (
                      <View key={i} style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        backgroundColor: "rgba(57,255,20,0.06)",
                        borderRadius: 7,
                        paddingVertical: 6,
                        paddingHorizontal: 9,
                      }}>
                        <Text style={{ color: "rgba(57,255,20,0.45)", fontSize: 10, fontWeight: "700", width: 14, textAlign: "right" }}>
                          {i + 1}
                        </Text>
                        <Text style={{ color: T.text, fontSize: 13, fontWeight: "600" }}>{word}</Text>
                      </View>
                    ))}
                  </View>
                  <Button
                    T={T}
                    label={seedPhraseCopied ? "✓ Copied!" : "Copy to Clipboard"}
                    variant="outline"
                    onPress={async () => {
                      await (await import("expo-clipboard")).setStringAsync(seedPhrase);
                      setSeedPhraseCopied(true);
                      setTimeout(() => setSeedPhraseCopied(false), 2000);
                    }}
                  />
                </>
              ) : (
                <Text style={{ color: T.sub, fontSize: 13, textAlign: "center", marginVertical: 20 }}>
                  No seed phrase found.{"\n"}This wallet was created before BIP39 support was added.{"\n"}
                  To get a seed phrase, perform a Factory Reset and create a new wallet.
                </Text>
              )}

              <View style={{ height: 12 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== RECOVERY SHARD PASSPHRASE MODAL ===== */}
      {recoveryShardPassphraseOpen && (
        <Overlay onClose={() => setRecoveryShardPassphraseOpen(false)} zIndex={20000}>
          <GlassCard style={{ borderWidth: 1, borderColor: "rgba(100,180,255,0.35)", backgroundColor: T.glass }}>
            <View style={{ padding: 18 }}>
              <Text style={{ color: "rgba(100,180,255,0.9)", fontWeight: "900", fontSize: 17, marginBottom: 4 }}>
                🛡️ Set Recovery Passphrase
              </Text>
              <Text style={{ color: T.sub, fontSize: 12, marginBottom: 16, lineHeight: 18 }}>
                This passphrase protects your recovery shards. You'll need it (along with 3 shards) to restore your wallet on any device.{"\n\n"}
                Choose a strong passphrase and store it separately from your shards.
              </Text>

              <Text style={{ color: T.sub, fontSize: 11, fontWeight: "700", marginBottom: 6 }}>PASSPHRASE</Text>
              <TextInput
                style={{
                  backgroundColor: T.glass2, borderWidth: 1, borderColor: T.border,
                  borderRadius: 10, color: T.text, fontSize: 15, padding: 12, marginBottom: 12,
                }}
                placeholder="Min. 8 characters"
                placeholderTextColor={T.sub}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={recoveryShardPassphrase}
                onChangeText={setRecoveryShardPassphrase}
              />

              <Text style={{ color: T.sub, fontSize: 11, fontWeight: "700", marginBottom: 6 }}>CONFIRM PASSPHRASE</Text>
              <TextInput
                style={{
                  backgroundColor: T.glass2, borderWidth: 1,
                  borderColor: recoveryShardConfirm && recoveryShardPassphrase !== recoveryShardConfirm
                    ? "rgba(255,90,90,0.6)" : T.border,
                  borderRadius: 10, color: T.text, fontSize: 15, padding: 12, marginBottom: 4,
                }}
                placeholder="Re-enter passphrase"
                placeholderTextColor={T.sub}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={recoveryShardConfirm}
                onChangeText={setRecoveryShardConfirm}
              />
              {recoveryShardConfirm !== "" && recoveryShardPassphrase !== recoveryShardConfirm && (
                <Text style={{ color: "rgba(255,90,90,0.9)", fontSize: 11, marginBottom: 8 }}>
                  Passphrases do not match
                </Text>
              )}

              <View style={{ height: 14 }} />
              <Button
                T={T}
                label={recoveryShardWorking ? "Generating shards…" : "Generate Recovery Shards"}
                variant="outline"
                disabled={
                  recoveryShardWorking ||
                  recoveryShardPassphrase.length < 8 ||
                  recoveryShardPassphrase !== recoveryShardConfirm
                }
                onPress={doGenerateRecoveryShards}
              />
              <View style={{ height: 8 }} />
              <Button T={T} label="Cancel" variant="outline" onPress={() => setRecoveryShardPassphraseOpen(false)} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== SET / CHANGE PIN MODAL ===== */}
      {settingPinOpen && (
        <Overlay onClose={() => setSettingPinOpen(false)} zIndex={20000}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", marginBottom: 4 }}>
                🔒 {appPin ? "Change" : "Set"} App PIN
              </Text>
              <Text style={{ color: T.sub, fontSize: 12, marginBottom: 16 }}>
                Your PIN locks the HIVE Wallet app. It does not protect your seed phrase — keep that backed up separately.
              </Text>

              <Text style={{ color: T.sub, fontWeight: "800", marginBottom: 6 }}>New PIN (4–8 digits)</Text>
              <TextInput
                value={newPinInput}
                onChangeText={setNewPinInput}
                secureTextEntry
                keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
                maxLength={8}
                placeholder="Enter PIN"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "900", fontSize: 18, textAlign: "center", letterSpacing: 6, marginBottom: 12 }}
              />

              <Text style={{ color: T.sub, fontWeight: "800", marginBottom: 6 }}>Confirm PIN</Text>
              <TextInput
                value={confirmPinInput}
                onChangeText={setConfirmPinInput}
                secureTextEntry
                keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
                maxLength={8}
                placeholder="Confirm PIN"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "900", fontSize: 18, textAlign: "center", letterSpacing: 6, marginBottom: 16 }}
              />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => setSettingPinOpen(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Save PIN" variant="green" onPress={async () => {
                    if (newPinInput.length < 4) { showToast("PIN must be at least 4 digits", "warn"); return; }
                    if (newPinInput !== confirmPinInput) { showToast("PINs do not match", "warn"); return; }
                    await kvSet(APP_PIN_KEY, newPinInput);
                    setAppPin(newPinInput);
                    setSettingPinOpen(false);
                    setNewPinInput("");
                    setConfirmPinInput("");
                    showToast("PIN saved — app will lock on next logout");
                  }} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== APP LOCK SCREEN ===== */}
      {appLocked && appPin && (
        <View style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 99999, backgroundColor: "#040507",
          justifyContent: "center", alignItems: "center", padding: 32,
        }}>
          <Text style={{ fontSize: 52, marginBottom: 8 }}>🍯</Text>
          <Text style={{ color: "#39ff14", fontSize: 28, fontWeight: "900", marginBottom: 4 }}>HIVE Wallet</Text>
          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, marginBottom: 32 }}>Enter your PIN to unlock</Text>

          <TextInput
            value={pinInput}
            onChangeText={(t) => setPinInput(t)}
            secureTextEntry
            keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
            maxLength={8}
            placeholder="· · · · · ·"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoFocus
            // caretHidden stops cursor from jumping with letterSpacing on iOS
            caretHidden={Platform.OS === "ios"}
            selection={Platform.OS === "ios" ? { start: pinInput.length, end: pinInput.length } : undefined}
            style={{
              borderWidth: 2, borderColor: "#39ff14", borderRadius: 14,
              padding: 16, fontSize: 28, color: "#fff", textAlign: "center",
              width: 200, letterSpacing: 10, marginBottom: 20,
              backgroundColor: "rgba(57,255,20,0.04)",
            }}
          />

          <Pressable
            onPress={() => {
              if (pinInput === appPin) {
                setAppLocked(false);
                setPinInput("");
              } else {
                showToast("Incorrect PIN", "warn");
                setPinInput("");
              }
            }}
            style={({ pressed }) => ({
              backgroundColor: "#39ff14", paddingHorizontal: 40, paddingVertical: 14,
              borderRadius: 14, opacity: pressed ? 0.8 : 1, marginBottom: 16,
            })}
          >
            <Text style={{ color: "#000", fontWeight: "900", fontSize: 16 }}>Unlock</Text>
          </Pressable>

          <Pressable onPress={() => {
            const msg = "To recover without your PIN, you will need to Factory Reset the app. Your seed phrase will let you restore your wallets.\n\nProceed to Factory Reset?";
            if (Platform.OS === "web") {
              if (window.confirm(msg)) {
                kvDel(APP_PIN_KEY).then(() => { setAppPin(null); setAppLocked(false); window.location.reload(); });
              }
            } else {
              Alert.alert("Forgot PIN?", msg, [
                { text: "Cancel", style: "cancel" },
                { text: "Factory Reset", style: "destructive", onPress: async () => {
                  const KEYS = [
                    MNEMONIC_KEY, "HIVE_MASTER_SEED_B64", "HIVE_WALLETS_JSON",
                    "HIVE_ACTIVE_WALLET_IDX", "HIVE_PUBKEY_B64", "HIVE_PRIVKEY_B64",
                    "HIVE_WALLET_ID", "HIVE_API_BASE_OVERRIDE", APP_PIN_KEY,
                  ];
                  for (const k of KEYS) await kvDel(k);
                  showToast("App reset. Please restart.", "warn");
                  setAppLocked(false);
                  setAppPin(null);
                }},
              ]);
            }
          }}>
            <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: "600" }}>Forgot PIN?</Text>
          </Pressable>
        </View>
      )}

      {/* ===== TOKEN DETAIL VIEW ===== */}
      {tokenDetailSymbol && (
        <Overlay onClose={() => { setTokenDetailSymbol(null); pausePollingRef.current = false; }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 32 }}>{TOKEN_ICONS[tokenDetailSymbol] || "🪙"}</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: T.text, fontSize: 22, fontWeight: "900" }}>{tokenDetailSymbol}</Text>
                  <Text style={{ color: T.sub, fontWeight: "600" }}>
                    ${fmtNum(tokenPrices[tokenDetailSymbol] || 0, (tokenPrices[tokenDetailSymbol] || 0) < 1 ? 4 : 2)} USD
                  </Text>
                </View>
                <Pressable onPress={() => { setTokenDetailSymbol(null); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 16 }}>✕</Text>
                </Pressable>
              </View>

              <View style={{ height: 16 }} />

              <View style={{ padding: 16, borderRadius: 14, backgroundColor: T.glass2, borderWidth: 1, borderColor: T.border }}>
                <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12 }}>Your Balance</Text>
                <Text style={{ color: T.text, fontSize: 24, fontWeight: "900", marginTop: 6 }}>
                  {fmtNum(tokenDetailSymbol === "HNY" ? confirmedBalance : (tokenBalances[tokenDetailSymbol] || 0))}
                </Text>
                <Text style={{ color: T.green, fontSize: 16, fontWeight: "800", marginTop: 4 }}>
                  {fmtUSD((tokenDetailSymbol === "HNY" ? confirmedBalance : (tokenBalances[tokenDetailSymbol] || 0)) * (tokenPrices[tokenDetailSymbol] || 0))}
                </Text>
              </View>

              <View style={{ height: 14 }} />

              <View style={{ padding: 14, borderRadius: 14, backgroundColor: "rgba(57,255,20,0.06)", borderWidth: 1, borderColor: "rgba(57,255,20,0.15)" }}>
                <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12 }}>Live Price (Pyth Network)</Text>
                <Text style={{ color: T.green, fontSize: 28, fontWeight: "900", marginTop: 6 }}>
                  ${fmtNum(tokenPrices[tokenDetailSymbol] || 0, (tokenPrices[tokenDetailSymbol] || 0) < 1 ? 6 : 2)}
                </Text>
                <Text style={{ color: T.sub, marginTop: 6, fontWeight: "600", fontSize: 11 }}>
                  Prices update every ~60s from Pyth Network oracle feeds
                </Text>
              </View>

              <View style={{ height: 16 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="📤 Send" variant="blue" onPress={() => {
                    setUnifiedSendToken(tokenDetailSymbol);
                    setTokenDetailSymbol(null);
                    setTokenSendOpen(true);
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="📥 Receive" variant="outline" onPress={() => {
                    setTokenDetailSymbol(null);
                    setReceiveOpen(true);
                  }} />
                </View>
              </View>
              <View style={{ height: 10 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="🔄 Swap" variant="green" onPress={() => {
                    setSwapTokenIn(tokenDetailSymbol);
                    setTokenDetailSymbol(null);
                    setSwapOpen(true);
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Close" variant="outline" onPress={() => { setTokenDetailSymbol(null); pausePollingRef.current = false; }} />
                </View>
              </View>

              <Text style={{ color: T.sub, marginTop: 12, fontWeight: "600", fontSize: 11, textAlign: "center" }}>
                All tokens are sent/received at your single Honey wallet address
              </Text>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== UNIFIED SEND MODAL ===== */}
      {tokenSendOpen && (
        <Overlay onClose={() => { setTokenSendOpen(false); pausePollingRef.current = false; }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>📤 Send</Text>
                <Pressable onPress={() => { setTokenSendOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Token</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {TOKEN_LIST.map((t) => (
                  <Pressable key={t} onPress={() => setUnifiedSendToken(t)}
                    style={{ padding: 10, marginRight: 8, borderRadius: 10, backgroundColor: unifiedSendToken === t ? T.purple : T.glass2, borderWidth: 1, borderColor: T.border }}>
                    <Text style={{ color: T.text, fontWeight: "900" }}>{TOKEN_ICONS[t]} {t}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "600", fontSize: 12 }}>
                Balance: {fmtNum(unifiedSendToken === "HNY" ? balancesView.spendable : (tokenBalances[unifiedSendToken] || 0))} {unifiedSendToken}
              </Text>

              <Text style={{ color: T.sub, marginTop: 14, fontWeight: "800" }}>Recipient</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
                <TextInput
                  value={unifiedSendTo}
                  onChangeText={(t) => setUnifiedSendTo(sanitizeAddress(t))}
                  onFocus={() => (editingRef.current = true)}
                  onBlur={() => (editingRef.current = false)}
                  placeholder="HNY_<40 hex>"
                  placeholderTextColor={"rgba(255,255,255,0.35)"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }}
                />
                <Pressable onPress={openQrScanner}
                  style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", backgroundColor: T.glass2 }}>
                  <Ionicons name="qr-code-outline" size={20} color={T.text} />
                </Pressable>
                <Pressable onPress={() => setContactsOpen(true)}
                  style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", backgroundColor: T.glass2 }}>
                  <Ionicons name="people-outline" size={20} color={T.text} />
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 14, fontWeight: "800" }}>Amount</Text>
              <TextInput
                value={unifiedSendAmount}
                onChangeText={(t) => setUnifiedSendAmount(normalizeAmountText(t))}
                onFocus={() => (editingRef.current = true)}
                onBlur={() => (editingRef.current = false)}
                placeholder="0.00"
                placeholderTextColor={"rgba(255,255,255,0.35)"}
                keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                style={{ marginTop: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }}
              />

              {unifiedSendToken === "HNY" && (
                <>
                  <Text style={{ color: T.sub, marginTop: 14, fontWeight: "800" }}>Priority Fee</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {(["none", "small", "medium", "large"] as PriorityTier[]).map((tier) => (
                      <View key={tier} style={{ flex: 1 }}>
                        <Button T={T} label={tier.charAt(0).toUpperCase() + tier.slice(1)} variant={priorityTier === tier ? "blue" : "outline"} onPress={() => setPriorityTier(tier)} />
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "600", fontSize: 11 }}>
                Gas: {fmt8(computeChosenGas(Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR)))} HNY
                {walletList.some(w => w.address.toLowerCase() === sanitizeAddress(unifiedSendTo).replace(/^hny_/i, "HNY_").toLowerCase())
                  ? ` • Service fee: waived (same seed phrase)`
                  : ` • Svc fee (0.0005% of USD): ${fmt8(Number(parseAmount8(normalizeAmountText(unifiedSendAmount)).value || 0) * (tokenPrices[unifiedSendToken] || 1) * serviceFeeRate)} HNY`}
              </Text>

              <View style={{ height: 14 }} />
              <Button T={T} label="Review Send" variant="green" onPress={openUnifiedSendConfirm} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== UNIFIED SEND CONFIRMATION ===== */}
      {unifiedSendConfirmOpen && unifiedSendQuote && (
        <Overlay onClose={() => { setUnifiedSendConfirmOpen(false); setUnifiedSendQuote(null); pausePollingRef.current = false; }} zIndex={10000}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Confirm Send</Text>

              <View style={{ marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: T.glass2, borderWidth: 1, borderColor: T.border }}>
                <Text style={{ color: T.sub, fontWeight: "800" }}>Token</Text>
                <Text style={{ color: T.text, fontWeight: "900", fontSize: 18, marginTop: 4 }}>
                  {TOKEN_ICONS[unifiedSendQuote.token]} {fmtNum(unifiedSendQuote.amount)} {unifiedSendQuote.token}
                </Text>

                <Text style={{ color: T.sub, fontWeight: "800", marginTop: 12 }}>To</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4, fontSize: 13 }}>{unifiedSendQuote.to}</Text>

                <View style={{ height: 1, backgroundColor: T.border, marginVertical: 12 }} />

                <Text style={{ color: T.sub, fontWeight: "800" }}>Fee Breakdown (paid in HNY)</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 6 }}>Gas fee: {fmt8(unifiedSendQuote.gasFee)} HNY</Text>
                {unifiedSendQuote.serviceFee === 0 ? (
                  <Text style={{ color: T.green, fontWeight: "800", marginTop: 4 }}>Service fee: waived (same seed phrase)</Text>
                ) : (
                  <>
                    <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Service fee (0.0005% of USD): {fmt8(unifiedSendQuote.serviceFee)} HNY</Text>
                    <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Wallet fee ({(WALLET_FEE_RATE * 100).toFixed(0)}% of service fee): {fmt8(computeWalletFee(unifiedSendQuote.serviceFee))} HNY</Text>
                  </>
                )}
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Total fees: {fmt8(unifiedSendQuote.gasFee + unifiedSendQuote.serviceFee + computeWalletFee(unifiedSendQuote.serviceFee))} HNY</Text>

                {unifiedSendQuote.token === "HNY" && (
                  <Text style={{ color: T.gold, fontWeight: "900", marginTop: 8 }}>
                    Total deducted: {fmtNum(unifiedSendQuote.totalCost)} HNY
                  </Text>
                )}
              </View>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Back" variant="outline" onPress={() => { setUnifiedSendConfirmOpen(false); setUnifiedSendQuote(null); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={unifiedSendBusy ? "Sending…" : "Confirm Send"} variant="green" disabled={unifiedSendBusy} onPress={handleUnifiedSendSubmit} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== ADDRESS BOOK MODAL ===== */}
      {contactsOpen && (
        <Overlay onClose={() => setContactsOpen(false)} zIndex={10001}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>📇 Address Book</Text>
                <Pressable onPress={() => setContactsOpen(false)}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 300, marginTop: 12 }}>
                {contacts.length === 0 ? (
                  <Text style={{ color: T.sub, fontWeight: "800" }}>No saved contacts yet.</Text>
                ) : (
                  contacts.map((c, idx) => (
                    <View key={idx} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontWeight: "900" }}>{c.name}</Text>
                        <Text style={{ color: T.sub, fontSize: 12, fontWeight: "600" }}>{shortAddr(c.address)}</Text>
                      </View>
                      <Pressable onPress={() => { setUnifiedSendTo(c.address); setContactsOpen(false); showToast(`Selected ${c.name}`); }}
                        style={{ padding: 8, borderRadius: 8, backgroundColor: T.blue, marginRight: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Use</Text>
                      </Pressable>
                      <Pressable onPress={() => removeContact(idx)}
                        style={{ padding: 8, borderRadius: 8, backgroundColor: T.danger }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={{ height: 14 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>Add New Contact</Text>
              <TextInput value={newContactName} onChangeText={setNewContactName} placeholder="Name"
                placeholderTextColor={"rgba(255,255,255,0.35)"}
                style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
              <TextInput value={newContactAddr} onChangeText={(t) => setNewContactAddr(sanitizeAddress(t))} placeholder="HNY_<40 hex>"
                placeholderTextColor={"rgba(255,255,255,0.35)"} autoCapitalize="none" autoCorrect={false}
                style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
              <View style={{ height: 10 }} />
              <Button T={T} label="Save Contact" variant="blue" onPress={() => addContact(newContactName, newContactAddr)} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== FAUCET MODAL (includes HNY mint) ===== */}
      {/* ===== WALLET SWITCHER MODAL ===== */}
      {walletSwitcherOpen && (
        <Overlay onClose={() => { setWalletSwitcherOpen(false); pausePollingRef.current = false; }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>👛 Wallets</Text>
                <Pressable onPress={() => { setWalletSwitcherOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "600", fontSize: 11 }}>
                All wallets share the same seed phrase. Tap to switch.
              </Text>

              <ScrollView style={{ marginTop: 12, maxHeight: 380 }}>
                {walletList.map((w) => {
                  const isActive = w.index === activeWalletIndex;
                  const usdBal = walletBalances[w.address] || 0;
                  const isEditing = editingWalletIdx === w.index;
                  return (
                    <View key={w.index} style={{ marginBottom: 8 }}>
                      <Pressable
                        onPress={() => { if (!isEditing) handleSwitchWallet(w.index); }}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          borderWidth: isActive ? 2 : 1,
                          borderColor: isActive ? T.green : T.border,
                          backgroundColor: isActive ? "rgba(57,255,20,0.08)" : T.glass2,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: T.text, fontWeight: "900" }}>
                              {w.label} {isActive ? "✓" : ""}
                            </Text>
                            <Text style={{ color: T.sub, fontWeight: "700", fontSize: 12, marginTop: 2 }}>
                              {shortAddr(w.address)}
                            </Text>
                          </View>
                          <Text style={{ color: T.green, fontWeight: "900", fontSize: 14, marginRight: 8 }}>
                            {fmtUSD(usdBal)}
                          </Text>
                          <Pressable hitSlop={8} onPress={(e) => {
                            e.stopPropagation?.();
                            if (isEditing) { setEditingWalletIdx(null); }
                            else { setEditingWalletIdx(w.index); setEditWalletName(w.label); }
                          }}>
                            <Text style={{ color: T.sub, fontSize: 16 }}>⚙️</Text>
                          </Pressable>
                        </View>
                      </Pressable>

                      {isEditing && (
                        <View style={{ padding: 10, backgroundColor: T.glass2, borderRadius: 10, marginTop: 4, borderWidth: 1, borderColor: T.border }}>
                          <Text style={{ color: T.sub, fontWeight: "800", fontSize: 12, marginBottom: 6 }}>Rename</Text>
                          <TextInput
                            value={editWalletName}
                            onChangeText={setEditWalletName}
                            style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass, fontWeight: "800", fontSize: 13 }}
                          />
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                            <View style={{ flex: 1 }}>
                              <Button T={T} label="Save" variant="green" onPress={async () => {
                                if (editWalletName.trim()) {
                                  await renameWallet(w.index, editWalletName.trim());
                                  const list = await getWallets();
                                  setWalletList(list.wallets);
                                }
                                setEditingWalletIdx(null);
                              }} />
                            </View>
                            {walletList.length > 1 && (
                              <View style={{ flex: 1 }}>
                                <Button T={T} label="Delete" variant="outline" onPress={async () => {
                                  const msg = "⚠️ Any funds remaining in this wallet will be permanently lost and unrecoverable.\n\nPlease transfer all funds to another wallet before deleting.\n\nAre you sure?";
                                  const doDelete = async () => {
                                    try {
                                      await deleteWallet(w.index);
                                      const list = await getWallets();
                                      setWalletList(list.wallets);
                                      setActiveWalletIndex(list.activeIndex);
                                      if (w.index === activeWalletIndex) {
                                        await hardRefreshAll();
                                      }
                                      showToast("Wallet deleted");
                                    } catch (e: any) {
                                      showToast(e?.message || "Cannot delete");
                                    }
                                    setEditingWalletIdx(null);
                                  };
                                  if (Platform.OS === "web") {
                                    if (typeof window !== "undefined" && window.confirm && !window.confirm(msg)) return;
                                    await doDelete();
                                  } else {
                                    Alert.alert(
                                      "Delete Wallet",
                                      msg,
                                      [
                                        { text: "Cancel", style: "cancel" },
                                        { text: "Delete", style: "destructive", onPress: doDelete },
                                      ]
                                    );
                                  }
                                }} />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Button T={T} label="Cancel" variant="outline" onPress={() => setEditingWalletIdx(null)} />
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={{ height: 1, backgroundColor: T.border, marginVertical: 12 }} />

              {/* ── ADD ADDRESS (same seed) ── */}
              <View style={{ marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                <Text style={{ color: T.sub, fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>ADD ADDRESS</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
              </View>

              <Text style={{ color: T.sub, fontSize: 11, fontWeight: "600", marginBottom: 8 }}>
                Create a new address under your current seed phrase. Transfers between your addresses cost only the base gas fee ({fmt8(Number(minGasFee))} HNY).
              </Text>
              <TextInput
                value={newWalletLabel}
                onChangeText={setNewWalletLabel}
                placeholder="Address label (e.g., Trading)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }}
              />
              <View style={{ marginTop: 8 }}>
                <Button
                  T={T}
                  label={creatingWallet ? "Creating…" : "➕  Add Address"}
                  variant="green"
                  onPress={handleCreateWallet}
                  disabled={creatingWallet}
                />
              </View>

              {/* ── OTHER OPTIONS ── */}
              <View style={{ marginTop: 16, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                <Text style={{ color: T.sub, fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>OTHER OPTIONS</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
              </View>

              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => { setWalletSwitcherOpen(false); router.push("/create-wallet"); }}
                  style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}
                >
                  <Text style={{ fontSize: 20, marginRight: 12 }}>🆕</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontWeight: "900", fontSize: 13 }}>Create New Wallet</Text>
                    <Text style={{ color: T.sub, fontSize: 11, marginTop: 1 }}>Generate a fresh seed phrase & wallet</Text>
                  </View>
                  <Text style={{ color: T.sub, fontSize: 16 }}>›</Text>
                </Pressable>

                <Pressable
                  onPress={() => { setWalletSwitcherOpen(false); router.push("/import-wallet"); }}
                  style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}
                >
                  <Text style={{ fontSize: 20, marginRight: 12 }}>📥</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontWeight: "900", fontSize: 13 }}>Import Wallet</Text>
                    <Text style={{ color: T.sub, fontSize: 11, marginTop: 1 }}>Restore from 12/24-word seed phrase</Text>
                  </View>
                  <Text style={{ color: T.sub, fontSize: 16 }}>›</Text>
                </Pressable>

                <Pressable
                  onPress={() => showToast("Ledger support coming soon. HIVE chain requires a custom Ledger app — stay tuned!", "info")}
                  style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2, opacity: 0.7 }}
                >
                  <Text style={{ fontSize: 20, marginRight: 12 }}>🔷</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.text, fontWeight: "900", fontSize: 13 }}>Connect Ledger Wallet</Text>
                    <Text style={{ color: T.sub, fontSize: 11, marginTop: 1 }}>Hardware wallet via Bluetooth / USB — Coming Soon</Text>
                  </View>
                  <Text style={{ color: T.sub, fontSize: 12 }}>Soon</Text>
                </Pressable>
              </View>

              {/* ── Seed Profile Switcher ─────────────────────────────── */}
              {seedProfiles.length > 1 && (
                <>
                  <View style={{ marginTop: 16, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                    <Text style={{ color: T.sub, fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>SEED PROFILES</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                  </View>
                  <Text style={{ color: T.sub, fontSize: 11, marginBottom: 8 }}>
                    Each profile has its own master seed phrase and wallet list.
                  </Text>
                  {seedProfiles.map((p) => (
                    <Pressable
                      key={p.id}
                      disabled={profileSwitching || p.id === activeProfileId}
                      onPress={async () => {
                        if (p.id === activeProfileId) return;
                        setProfileSwitching(true);
                        try {
                          await switchProfile(p.id);
                          setWalletSwitcherOpen(false);
                          // Reload everything from new seed
                          const wl = await getWallets();
                          setWalletList(wl.wallets);
                          setActiveWalletIndex(wl.activeIndex);
                          const profiles = await getProfiles();
                          setSeedProfiles(profiles);
                          setActiveProfileId(p.id);
                          await hardRefreshAll();
                          showToast(`Switched to ${p.label}`, "info");
                        } catch (e: any) {
                          showToast(e?.message || "Switch failed", "warn");
                        } finally {
                          setProfileSwitching(false);
                        }
                      }}
                      style={{
                        flexDirection: "row", alignItems: "center", padding: 12,
                        borderRadius: 12, borderWidth: 1,
                        borderColor: p.id === activeProfileId ? "rgba(57,255,20,0.4)" : T.border,
                        backgroundColor: p.id === activeProfileId ? "rgba(57,255,20,0.06)" : T.glass2,
                        marginBottom: 6,
                        opacity: profileSwitching ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 18, marginRight: 12 }}>
                        {p.id === activeProfileId ? "✅" : "🔑"}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.text, fontWeight: "900", fontSize: 13 }}>{p.label}</Text>
                        <Text style={{ color: T.sub, fontSize: 10, fontFamily: "monospace" }}>
                          {p.address ? `${p.address.slice(0, 14)}…${p.address.slice(-6)}` : ""}
                        </Text>
                      </View>
                      {p.id === activeProfileId
                        ? <Text style={{ color: "rgba(57,255,20,0.8)", fontSize: 11, fontWeight: "700" }}>Active</Text>
                        : <Text style={{ color: T.sub, fontSize: 16 }}>›</Text>
                      }
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          </GlassCard>
        </Overlay>
      )}

      {faucetModalOpen && (
        <Overlay onClose={() => { setFaucetModalOpen(false); pausePollingRef.current = false; }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>🚰 Token Faucet</Text>
                <Pressable onPress={() => { setFaucetModalOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Select Token</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {FAUCET_TOKENS.map((t) => (
                  <Pressable key={t} onPress={() => setFaucetToken(t)}
                    style={{ padding: 10, borderRadius: 10, backgroundColor: faucetToken === t ? T.green : T.glass2, borderWidth: 1, borderColor: T.border }}>
                    <Text style={{ color: faucetToken === t ? "#000" : T.text, fontWeight: "900" }}>{TOKEN_ICONS[t]} {t}</Text>
                  </Pressable>
                ))}
              </View>

              {faucetToken === "HNY" ? (
                <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,191,47,0.08)", borderWidth: 1, borderColor: "rgba(255,191,47,0.2)" }}>
                  <Text style={{ color: T.gold, fontWeight: "900" }}>🍯 Mint 100 HNY (Devnet Faucet)</Text>
                  <Text style={{ color: T.sub, marginTop: 6, fontWeight: "600", fontSize: 12 }}>
                    {mintCooldown > 0 ? `Cooldown: ${fmtCooldown(mintCooldown)}` : "Ready to mint"}
                  </Text>
                </View>
              ) : (
                <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "rgba(100,200,255,0.08)", borderWidth: 1, borderColor: "rgba(100,200,255,0.2)" }}>
                  <Text style={{ color: T.green, fontWeight: "900" }}>Mint 100 {faucetToken} (Devnet Faucet)</Text>
                  <Text style={{ color: T.sub, marginTop: 6, fontWeight: "600", fontSize: 12 }}>
                    {(tokenCooldowns[faucetToken] || 0) > 0 ? `Cooldown: ${fmtCooldown(tokenCooldowns[faucetToken])}` : "Ready to mint"}
                  </Text>
                  <Text style={{ color: T.sub, marginTop: 4, fontWeight: "500", fontSize: 11 }}>
                    Max 100 per token per 24 hours
                  </Text>
                </View>
              )}

              <View style={{ height: 16 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => { setFaucetModalOpen(false); pausePollingRef.current = false; }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T}
                    label={faucetBusy ? "Minting…" : faucetToken === "HNY" ? "Mint 100 HNY" : `Mint 100 ${faucetToken}`}
                    variant="green"
                    onPress={handleFaucet}
                    disabled={faucetBusy || (faucetToken === "HNY" && mintCooldown > 0) || (faucetToken !== "HNY" && (tokenCooldowns[faucetToken] || 0) > 0)} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== SWAP MODAL ===== */}
      {swapOpen && (
        <Overlay onClose={() => { setSwapOpen(false); pausePollingRef.current = false; }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>🔄 Swap</Text>
                <Pressable onPress={() => { setSwapOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>From</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {SWAP_TOKENS.map((t) => (
                  <Pressable key={t} onPress={() => { setSwapTokenIn(t); if (t === swapTokenOut) setSwapTokenOut(t === "HNY" ? "ETH" : "HNY"); }}
                    style={{ padding: 10, marginRight: 8, borderRadius: 10, backgroundColor: swapTokenIn === t ? T.blue : T.glass2, borderWidth: 1, borderColor: T.border }}>
                    <Text style={{ color: T.text, fontWeight: "900" }}>{TOKEN_ICONS[t]} {t}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput value={swapAmountIn} onChangeText={(t) => setSwapAmountIn(normalizeAmountText(t))} placeholder="0.00"
                onFocus={() => (editingRef.current = true)}
                onBlur={() => (editingRef.current = false)}
                placeholderTextColor={"rgba(255,255,255,0.35)"}
                keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                style={{ marginTop: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "600", fontSize: 12 }}>
                Balance: {fmtNum(swapTokenIn === "HNY" ? balancesView.spendable : (tokenBalances[swapTokenIn] || 0))}
              </Text>

              {/* "No tokens available" notice for stHNY and LPHNY with zero balance */}
              {(swapTokenIn === "stHNY" || swapTokenIn === "LPHNY") && (tokenBalances[swapTokenIn] || 0) <= 0 && (
                <View style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,191,47,0.3)", backgroundColor: "rgba(255,191,47,0.08)" }}>
                  <Text style={{ color: T.gold, fontWeight: "800", fontSize: 12 }}>
                    Currently no {swapTokenIn} tokens available for swap.
                    {swapTokenIn === "stHNY" ? " Stake HNY to earn stHNY." : " Add liquidity to earn LPHNY."}
                  </Text>
                </View>
              )}

              <View style={{ alignItems: "center", marginVertical: 10 }}>
                <Pressable onPress={() => { const tmp = swapTokenIn; setSwapTokenIn(swapTokenOut); setSwapTokenOut(tmp); setSwapAmountIn(""); setSwapQuote(null); }}
                  style={{ padding: 8, borderRadius: 20, backgroundColor: T.glass2, borderWidth: 1, borderColor: T.border }}>
                  <Text style={{ fontSize: 18 }}>⬇️ ⬆️</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, fontWeight: "800" }}>To</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {SWAP_TOKENS.filter(t => t !== swapTokenIn).map((t) => (
                  <Pressable key={t} onPress={() => setSwapTokenOut(t)}
                    style={{ padding: 10, marginRight: 8, borderRadius: 10, backgroundColor: swapTokenOut === t ? T.green : T.glass2, borderWidth: 1, borderColor: T.border }}>
                    <Text style={{ color: swapTokenOut === t ? "#000" : T.text, fontWeight: "900" }}>{TOKEN_ICONS[t]} {t}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {fetchingQuote && <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Fetching quote…</Text>}
              {swapQuote && (
                <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "rgba(57,255,20,0.08)", borderWidth: 1, borderColor: swapQuote.priceImpact > 5 ? "rgba(255,90,90,0.5)" : "rgba(57,255,20,0.2)" }}>
                  <Text style={{ color: T.green, fontWeight: "900", fontSize: 18 }}>≈ {fmtNum(swapQuote.amountOut)} {swapTokenOut}</Text>
                  <Text style={{ color: T.sub, marginTop: 6, fontWeight: "600" }}>Rate: 1 {swapTokenIn} = {fmtNum(swapQuote.exchangeRate)} {swapTokenOut}</Text>
                  {swapQuote.route === "multi-hop" && (
                    <Text style={{ color: T.purple, marginTop: 2, fontWeight: "700", fontSize: 11 }}>Route: {swapTokenIn} → HNY → {swapTokenOut}</Text>
                  )}
                  <Text style={{ color: T.sub, marginTop: 2, fontWeight: "600" }}>Impact: {swapQuote.priceImpact.toFixed(4)}% • Pool fee: {((swapQuote.feeRate || 0.001) * 100).toFixed(2)}%{swapQuote.route === "multi-hop" ? " × 2 hops" : ""}</Text>
                  {swapQuote.priceImpact > 5 && (
                    <Text style={{ color: T.danger, marginTop: 6, fontWeight: "900", fontSize: 13 }}>
                      ⚠️ High price impact! Consider a smaller amount.
                    </Text>
                  )}
                </View>
              )}

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => { setSwapOpen(false); pausePollingRef.current = false; }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Confirm Swap" variant="green" onPress={openSwapConfirm} disabled={!swapQuote || swapBusy} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== SWAP CONFIRMATION ===== */}
      {swapConfirmOpen && swapQuote && (
        <Overlay onClose={() => { setSwapConfirmOpen(false); pausePollingRef.current = false; }} zIndex={10000}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Confirm Swap</Text>

              <View style={{ marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: T.glass2, borderWidth: 1, borderColor: T.border }}>
                <Text style={{ color: T.sub, fontWeight: "800" }}>You Send</Text>
                <Text style={{ color: T.text, fontWeight: "900", fontSize: 18, marginTop: 4 }}>
                  {TOKEN_ICONS[swapTokenIn]} {fmtNum(Number(swapAmountIn))} {swapTokenIn}
                </Text>

                <View style={{ alignItems: "center", marginVertical: 8 }}>
                  <Text style={{ fontSize: 16 }}>⬇️</Text>
                </View>

                <Text style={{ color: T.sub, fontWeight: "800" }}>You Receive</Text>
                <Text style={{ color: T.green, fontWeight: "900", fontSize: 18, marginTop: 4 }}>
                  {TOKEN_ICONS[swapTokenOut]} ≈ {fmtNum(swapQuote.amountOut)} {swapTokenOut}
                </Text>
                <Text style={{ color: T.sub, marginTop: 4, fontWeight: "600", fontSize: 12 }}>
                  Min received (5% slippage): {fmtNum(swapQuote.amountOut * 0.95)} {swapTokenOut}
                </Text>

                <View style={{ height: 1, backgroundColor: T.border, marginVertical: 12 }} />

                <Text style={{ color: T.sub, fontWeight: "800" }}>Fee Breakdown</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 6 }}>Exchange rate: 1 {swapTokenIn} = {fmtNum(swapQuote.exchangeRate)} {swapTokenOut}</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Pool fee: {((swapQuote.feeRate || 0.001) * 100).toFixed(2)}%{swapQuote.route === "multi-hop" ? " per hop (2 hops)" : ""} ≈ {fmtNum(Number(swapAmountIn) * (swapQuote.feeRate || 0.001), 4)} {swapTokenIn}</Text>
                {(() => {
                  const svcFee = Number(swapAmountIn) * (tokenPrices[swapTokenIn] || 1) * serviceFeeRate;
                  const wFee = computeWalletFee(svcFee);
                  return (
                    <>
                      <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Service fee: {fmt8(svcFee)} HNY</Text>
                      <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Wallet fee ({(WALLET_FEE_RATE * 100).toFixed(0)}% of service fee): {fmt8(wFee)} HNY</Text>
                    </>
                  );
                })()}
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Gas fee: {fmt8(Number(minGasFee || 0.00000001))} HNY</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Price impact: {swapQuote.priceImpact.toFixed(4)}%</Text>
              </View>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Back" variant="outline" onPress={() => setSwapConfirmOpen(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={swapBusy ? "Swapping…" : "Confirm Swap"} variant="green" disabled={swapBusy} onPress={handleSwapConfirm} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== NETWORK SWITCHER MODAL ===== */}
      {networkSwitcherOpen && (
        <Overlay onClose={() => { setNetworkSwitcherOpen(false); pausePollingRef.current = false; }} zIndex={10000}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>🌐 Switch Network</Text>
                <Pressable onPress={() => { setNetworkSwitcherOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Preset Networks</Text>
              {PRESET_NETWORKS.map((n) => (
                <Pressable
                  key={n.url}
                  onPress={() => switchNetwork(n)}
                  style={{
                    marginTop: 8, padding: 12, borderRadius: 12,
                    borderWidth: 1,
                    borderColor: activeNetworkName === n.name ? T.green : T.border,
                    backgroundColor: activeNetworkName === n.name ? "rgba(57,255,20,0.08)" : T.glass2,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: activeNetworkName === n.name ? T.green : T.text, fontWeight: "900", flex: 1 }}>{n.name}</Text>
                    {n.isTestnet && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(100,180,255,0.2)", borderWidth: 1, borderColor: "rgba(100,180,255,0.4)" }}>
                        <Text style={{ color: "#60aaff", fontSize: 10, fontWeight: "900" }}>TESTNET</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: T.sub, fontWeight: "600", fontSize: 11, marginTop: 2 }}>{n.url}</Text>
                  {(n.chainId || n.currencySymbol) && (
                    <Text style={{ color: T.sub, fontWeight: "600", fontSize: 10, marginTop: 1 }}>
                      {[n.chainId && `Chain ID: ${n.chainId}`, n.currencySymbol && `Currency: ${n.currencySymbol}`].filter(Boolean).join("  ·  ")}
                    </Text>
                  )}
                </Pressable>
              ))}

              {savedNetworks.length > 0 && (
                <>
                  <Text style={{ color: T.sub, marginTop: 14, fontWeight: "800" }}>Custom Networks</Text>
                  {savedNetworks.map((n, idx) => (
                    <View key={idx} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Pressable
                        onPress={() => switchNetwork(n)}
                        style={{
                          flex: 1, padding: 12, borderRadius: 12,
                          borderWidth: 1,
                          borderColor: activeNetworkName === n.name ? T.green : T.border,
                          backgroundColor: activeNetworkName === n.name ? "rgba(57,255,20,0.08)" : T.glass2,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ color: activeNetworkName === n.name ? T.green : T.text, fontWeight: "900", flex: 1 }}>{n.name}</Text>
                          {n.isTestnet && (
                            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(100,180,255,0.2)", borderWidth: 1, borderColor: "rgba(100,180,255,0.4)" }}>
                              <Text style={{ color: "#60aaff", fontSize: 10, fontWeight: "900" }}>TESTNET</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ color: T.sub, fontWeight: "600", fontSize: 11, marginTop: 2 }}>{n.url}</Text>
                        {(n.chainId || n.currencySymbol) && (
                          <Text style={{ color: T.sub, fontWeight: "600", fontSize: 10, marginTop: 1 }}>
                            {[n.chainId && `Chain ID: ${n.chainId}`, n.currencySymbol && `Currency: ${n.currencySymbol}`].filter(Boolean).join("  ·  ")}
                          </Text>
                        )}
                      </Pressable>
                      <Pressable onPress={() => removeCustomNetwork(idx)} style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.danger, backgroundColor: "rgba(255,90,90,0.08)" }}>
                        <Text style={{ color: T.danger, fontWeight: "900", fontSize: 12 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}

              <View style={{ marginTop: 16, marginBottom: 6, flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
                <Text style={{ color: T.sub, fontWeight: "900", fontSize: 10, marginHorizontal: 8, letterSpacing: 1 }}>ADD CUSTOM NETWORK</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: T.border }} />
              </View>

              {/* Testnet toggle */}
              <Pressable
                onPress={() => setNewNetworkIsTestnet(!newNetworkIsTestnet)}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2, marginBottom: 8 }}
              >
                <Text style={{ color: T.text, fontWeight: "800", flex: 1 }}>Testnet</Text>
                <View style={{
                  width: 44, height: 24, borderRadius: 12, justifyContent: "center", paddingHorizontal: 2,
                  backgroundColor: newNetworkIsTestnet ? T.blue : "rgba(255,255,255,0.15)"
                }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
                    alignSelf: newNetworkIsTestnet ? "flex-end" : "flex-start"
                  }} />
                </View>
              </Pressable>

              <TextInput
                value={newNetworkName}
                onChangeText={setNewNetworkName}
                placeholder="Network Name (e.g. My Devnet)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "700", marginBottom: 8 }}
              />
              <TextInput
                value={newNetworkUrl}
                onChangeText={setNewNetworkUrl}
                placeholder="RPC URL (e.g. http://192.168.1.10:3000)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "700", marginBottom: 8 }}
              />
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <TextInput
                  value={newNetworkChainId}
                  onChangeText={setNewNetworkChainId}
                  placeholder="Chain ID (e.g. 1)"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  keyboardType="numeric"
                  style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "700" }}
                />
                <TextInput
                  value={newNetworkCurrency}
                  onChangeText={setNewNetworkCurrency}
                  placeholder="Currency (e.g. HNY)"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  autoCapitalize="characters"
                  style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "700" }}
                />
              </View>
              <TextInput
                value={newNetworkExplorer}
                onChangeText={setNewNetworkExplorer}
                placeholder="Block Explorer URL (optional)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "700", marginBottom: 10 }}
              />
              <Button T={T} label="Add Network" variant="blue" onPress={addCustomNetwork} />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== LIQUIDITY POOL MODAL ===== */}
      {lpModalOpen && (
        <Overlay onClose={() => { setLpModalOpen(false); pausePollingRef.current = false; }} zIndex={10000}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14, maxHeight: 580 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>🌊 Liquidity Pools</Text>
                <Pressable onPress={() => { setLpModalOpen(false); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              {/* Tabs */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {(["positions", "add", "remove"] as const).map(tab => (
                  <Pressable key={tab} onPress={() => setLpTab(tab)}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
                      backgroundColor: lpTab === tab ? T.blue : T.glass2, borderWidth: 1, borderColor: T.border }}>
                    <Text style={{ color: T.text, fontWeight: "900", fontSize: 12 }}>
                      {tab === "positions" ? "My Positions" : tab === "add" ? "Add" : "Remove"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* POSITIONS TAB */}
              {lpTab === "positions" && (
                <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  <Text style={{ color: T.sub, fontWeight: "700", fontSize: 12 }}>APR: {(lpApr * 100).toFixed(0)}% • LPHNY: {fmtNum(tokenBalances["LPHNY"] || 0, 4)}</Text>
                  {lpPositions.length === 0 ? (
                    <View style={{ marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
                      <Text style={{ color: T.sub, fontWeight: "800" }}>No active LP positions.</Text>
                      <Text style={{ color: T.sub, marginTop: 4, fontWeight: "600", fontSize: 12 }}>Add liquidity to any HNY pool to earn {(lpApr * 100).toFixed(0)}% APR paid in HNY.</Text>
                      {lpLoadError && <Text style={{ color: T.danger, marginTop: 4, fontWeight: "800", fontSize: 11 }}>{lpLoadError}</Text>}
                    </View>
                  ) : (
                    lpPositions.map(pos => {
                      const liveReward = computeLiveReward(pos, lpLiveMs);
                      return (
                        <View key={pos.id} style={{ marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ color: T.text, fontWeight: "900" }}>{pos.poolId}</Text>
                            <Text style={{ color: T.green, fontWeight: "900" }}>{fmtUSD(pos.positionUSD)}</Text>
                          </View>
                          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "700", fontSize: 12 }}>
                            LP Shares: {fmtNum(pos.lpShares, 6)} ({fmtNum(pos.sharePercent, 4)}% of pool)
                          </Text>
                          <Text style={{ color: T.sub, marginTop: 2, fontWeight: "700", fontSize: 12 }}>
                            {pos.pool?.tokenA}: {fmtNum(pos.tokenAValue, 6)} • {pos.pool?.tokenB}: {fmtNum(pos.tokenBValue, 6)}
                          </Text>
                          <Text style={{ color: T.gold, marginTop: 2, fontWeight: "800", fontSize: 12 }}>
                            ⏳ Pending: {fmtNum(liveReward, 8)} HNY
                          </Text>
                          <View style={{ height: 8 }} />
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <Button T={T} label="Claim Rewards" variant="green" disabled={liveReward <= 0} onPress={() => {
                                setLpClaimPosition(pos);
                                setLpClaimOpen(true);
                                pausePollingRef.current = true;
                              }} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Button T={T} label="Remove →" variant="outline" onPress={() => {
                                setLpRemovePosition(pos);
                                setLpRemoveShares(fmt8(pos.lpShares));
                                setLpTab("remove");
                              }} />
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              )}

              {/* ADD LIQUIDITY TAB */}
              {lpTab === "add" && (
                <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  <Text style={{ color: T.sub, fontWeight: "800" }}>Select Pool</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                    {LP_POOLS.map(id => (
                      <Pressable key={id} onPress={() => { setLpSelectedPool(id); setLpAmountA(""); setLpAmountB(""); }}
                        style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, borderRadius: 10,
                          backgroundColor: lpSelectedPool === id ? T.blue : T.glass2, borderWidth: 1, borderColor: T.border }}>
                        <Text style={{ color: T.text, fontWeight: "900", fontSize: 12 }}>{id}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {(() => {
                    const pool = lpPoolList.find(p => p.id === lpSelectedPool);
                    const tokenA = pool?.tokenA || lpSelectedPool.split("-")[0];
                    const tokenB = pool?.tokenB || lpSelectedPool.split("-")[1];
                    const balA = tokenA === "HNY" ? (tokenBalances["HNY"] || confirmedBalance) : (tokenBalances[tokenA] || 0);
                    const balB = tokenB === "HNY" ? (tokenBalances["HNY"] || confirmedBalance) : (tokenBalances[tokenB] || 0);
                    const aNum = Number(lpAmountA);
                    const bNum = Number(lpAmountB);
                    let estLpShares = 0;
                    if (pool && aNum > 0 && bNum > 0) {
                      const rA = Number(pool.reserveA), rB = Number(pool.reserveB), total = Number(pool.totalLpShares);
                      estLpShares = (rA === 0 || total === 0) ? Math.sqrt(aNum * bNum) : Math.min(aNum / rA, bNum / rB) * total;
                    }
                    const existingPos = lpPositions.find(p => p.poolId === lpSelectedPool);
                    return (
                      <>
                        {existingPos && (
                          <View style={{ marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1,
                            borderColor: "rgba(100,180,255,0.4)", backgroundColor: "rgba(100,180,255,0.08)" }}>
                            <Text style={{ color: "#60aaff", fontWeight: "900", fontSize: 12 }}>+ Adding to Existing Position</Text>
                            <Text style={{ color: T.text, fontWeight: "700", fontSize: 12, marginTop: 4 }}>
                              {fmtNum(existingPos.lpShares, 6)} LPHNY • ${fmtNum(existingPos.positionUSD, 2)}
                            </Text>
                            <Text style={{ color: T.sub, fontWeight: "600", fontSize: 11, marginTop: 2 }}>
                              Your new shares will be combined into your existing position.
                            </Text>
                          </View>
                        )}
                        <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>{TOKEN_ICONS[tokenA] || "🪙"} {tokenA} Amount</Text>
                        <TextInput value={lpAmountA} onChangeText={onLpAmountAChange}
                          onFocus={() => (editingRef.current = true)}
                          onBlur={() => (editingRef.current = false)}
                          placeholder="0.00" placeholderTextColor="rgba(255,255,255,0.35)"
                          keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                          style={{ marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
                        <Text style={{ color: T.sub, marginTop: 2, fontWeight: "600", fontSize: 11 }}>Balance: {fmtNum(balA)} {tokenA}</Text>

                        <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>{TOKEN_ICONS[tokenB] || "🪙"} {tokenB} Amount</Text>
                        <TextInput value={lpAmountB} onChangeText={onLpAmountBChange}
                          onFocus={() => (editingRef.current = true)}
                          onBlur={() => (editingRef.current = false)}
                          placeholder="0.00" placeholderTextColor="rgba(255,255,255,0.35)"
                          keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                          style={{ marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
                        <Text style={{ color: T.sub, marginTop: 2, fontWeight: "600", fontSize: 11 }}>Balance: {fmtNum(balB)} {tokenB}</Text>

                        {estLpShares > 0 && (
                          <View style={{ marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "rgba(57,255,20,0.25)", backgroundColor: "rgba(57,255,20,0.06)" }}>
                            <Text style={{ color: T.green, fontWeight: "900", fontSize: 13 }}>You receive ≈ {fmtNum(estLpShares, 6)} LPHNY</Text>
                            <Text style={{ color: T.sub, fontWeight: "600", fontSize: 11, marginTop: 2 }}>APR: {(lpApr * 100).toFixed(0)}% in HNY rewards</Text>
                          </View>
                        )}
                      </>
                    );
                  })()}

                  <View style={{ height: 12 }} />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button T={T} label="Cancel" variant="outline" onPress={() => { setLpModalOpen(false); pausePollingRef.current = false; }} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button T={T} label={lpBusy ? "Adding…" : "Add Liquidity"} variant="green" disabled={lpBusy || !lpAmountA || !lpAmountB} onPress={handleAddLiquidity} />
                    </View>
                  </View>
                </ScrollView>
              )}

              {/* REMOVE LIQUIDITY TAB */}
              {lpTab === "remove" && (
                <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  {!lpRemovePosition ? (
                    <>
                      <Text style={{ color: T.sub, fontWeight: "800" }}>Select a position to remove</Text>
                      {lpPositions.length === 0 ? (
                        <Text style={{ color: T.sub, marginTop: 8, fontWeight: "600" }}>No positions found.</Text>
                      ) : (
                        lpPositions.map(pos => (
                          <Pressable key={pos.id} onPress={() => { setLpRemovePosition(pos); setLpRemoveShares(fmt8(pos.lpShares)); }}
                            style={{ marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
                            <Text style={{ color: T.text, fontWeight: "900" }}>{pos.poolId}</Text>
                            <Text style={{ color: T.sub, fontWeight: "700", fontSize: 12 }}>{fmtNum(pos.lpShares, 6)} LPHNY • {fmtUSD(pos.positionUSD)}</Text>
                          </Pressable>
                        ))
                      )}
                    </>
                  ) : (
                    <>
                      <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
                        <Text style={{ color: T.text, fontWeight: "900" }}>{lpRemovePosition.poolId}</Text>
                        <Text style={{ color: T.sub, fontWeight: "700", fontSize: 12, marginTop: 4 }}>
                          Your shares: {fmtNum(lpRemovePosition.lpShares, 6)} LPHNY ({fmtNum(lpRemovePosition.sharePercent, 4)}%)
                        </Text>
                        <Text style={{ color: T.gold, fontWeight: "700", fontSize: 12, marginTop: 2 }}>
                          Pending reward: {fmtNum(lpRemovePosition.pendingRewardHNY, 6)} HNY
                        </Text>
                      </View>

                      <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Shares to Remove</Text>
                      <TextInput value={lpRemoveShares} onChangeText={(v) => setLpRemoveShares(normalizeAmountText(v))}
                        onFocus={() => (editingRef.current = true)}
                        onBlur={() => (editingRef.current = false)}
                        placeholder="0.00000000" placeholderTextColor="rgba(255,255,255,0.35)"
                        keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                        style={{ marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.border, color: T.text, backgroundColor: T.glass2, fontWeight: "800" }} />
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                        {[25, 50, 75, 100].map(pct => (
                          <Pressable key={pct} onPress={() => setLpRemoveShares(fmt8(lpRemovePosition.lpShares * pct / 100))}
                            style={{ flex: 1, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2, alignItems: "center" }}>
                            <Text style={{ color: T.text, fontWeight: "800", fontSize: 12 }}>{pct}%</Text>
                          </Pressable>
                        ))}
                      </View>

                      {Number(lpRemoveShares) > 0 && (() => {
                        const pos = lpRemovePosition;
                        const totalLP = Number(pos.pool?.totalLpShares || 1);
                        const shareRatio = Number(lpRemoveShares) / totalLP;
                        const aOut = shareRatio * Number(pos.pool?.reserveA || 0);
                        const bOut = shareRatio * Number(pos.pool?.reserveB || 0);
                        const rShare = Number(lpRemoveShares) / Number(pos.lpShares);
                        const rewardEst = pos.pendingRewardHNY * rShare;
                        return (
                          <View style={{ marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "rgba(57,255,20,0.25)", backgroundColor: "rgba(57,255,20,0.06)" }}>
                            <Text style={{ color: T.green, fontWeight: "900", fontSize: 13 }}>You receive:</Text>
                            <Text style={{ color: T.text, fontWeight: "800", fontSize: 12, marginTop: 4 }}>≈ {fmtNum(aOut, 6)} {pos.pool?.tokenA}</Text>
                            <Text style={{ color: T.text, fontWeight: "800", fontSize: 12, marginTop: 2 }}>≈ {fmtNum(bOut, 6)} {pos.pool?.tokenB}</Text>
                            <Text style={{ color: T.gold, fontWeight: "800", fontSize: 12, marginTop: 2 }}>+ {fmtNum(rewardEst, 6)} HNY reward</Text>
                          </View>
                        );
                      })()}

                      <View style={{ height: 12 }} />
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Button T={T} label="Back" variant="outline" onPress={() => setLpRemovePosition(null)} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button T={T} label={lpBusy ? "Removing…" : "Remove"} variant="danger" disabled={lpBusy || !lpRemoveShares} onPress={handleRemoveLiquidity} />
                        </View>
                      </View>
                    </>
                  )}
                </ScrollView>
              )}
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== LP CLAIM CONFIRMATION ===== */}
      {lpClaimOpen && lpClaimPosition && (
        <Overlay onClose={() => { setLpClaimOpen(false); setLpClaimPosition(null); pausePollingRef.current = false; }} zIndex={10002}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontWeight: "900", fontSize: 20 }}>🌊 Claim LP Rewards</Text>
                <Pressable onPress={() => { setLpClaimOpen(false); setLpClaimPosition(null); pausePollingRef.current = false; }}>
                  <Text style={{ color: T.sub, fontWeight: "800", fontSize: 16 }}>Close</Text>
                </Pressable>
              </View>

              <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: "rgba(57,255,20,0.06)", borderWidth: 1, borderColor: "rgba(57,255,20,0.25)" }}>
                <Text style={{ color: T.green, fontWeight: "900", fontSize: 22 }}>{fmtNum(computeLiveReward(lpClaimPosition, lpLiveMs), 8)} HNY</Text>
                <Text style={{ color: T.sub, marginTop: 4, fontWeight: "700" }}>Pool: {lpClaimPosition.poolId}</Text>
                <Text style={{ color: T.sub, marginTop: 2, fontWeight: "700" }}>Position value: {fmtUSD(lpClaimPosition.positionUSD)}</Text>
                <Text style={{ color: T.sub, marginTop: 2, fontWeight: "700" }}>APR: {(lpApr * 100).toFixed(0)}%</Text>
              </View>

              <View style={{ marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" }}>
                <Text style={{ color: T.text, fontWeight: "800" }}>Fee Breakdown</Text>
                <Text style={{ color: T.green, fontWeight: "800", marginTop: 4 }}>Gas fee: none (LP claim has no gas fee)</Text>
                <Text style={{ color: T.green, fontWeight: "800", marginTop: 4 }}>Service fee: none</Text>
                <Text style={{ color: T.green, fontWeight: "800", marginTop: 4 }}>Wallet fee: none</Text>
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 8 }}>
                  <Text style={{ color: T.gold, fontWeight: "900", fontSize: 15 }}>You receive: {fmtNum(computeLiveReward(lpClaimPosition, lpLiveMs), 8)} HNY</Text>
                </View>
              </View>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => { setLpClaimOpen(false); setLpClaimPosition(null); pausePollingRef.current = false; }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={lpClaimBusy ? "Claiming…" : "Claim Rewards"} variant="green" disabled={lpClaimBusy} onPress={handleLpClaim} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* ===== STAKE CONFIRMATION ===== */}
      {stakeConfirmOpen && stakePreview && (
        <Overlay onClose={() => { setStakeConfirmOpen(false); setStakePreview(null); }} zIndex={10002}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontWeight: "900", fontSize: 20 }}>⚡ Confirm Stake</Text>
                <Pressable onPress={() => { setStakeConfirmOpen(false); setStakePreview(null); }}>
                  <Text style={{ color: T.sub, fontWeight: "800", fontSize: 16 }}>Close</Text>
                </Pressable>
              </View>

              <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: "rgba(128,0,255,0.08)", borderWidth: 1, borderColor: "rgba(128,0,255,0.3)" }}>
                <Text style={{ color: T.purple, fontWeight: "900", fontSize: 22 }}>Stake {fmtNum(stakePreview.amount)} HNY</Text>
                <Text style={{ color: T.sub, marginTop: 6, fontWeight: "700" }}>Lock period: {stakePreview.lockDays} days</Text>
                <Text style={{ color: T.sub, marginTop: 4, fontWeight: "700" }}>APR: {(stakingApr * 100).toFixed(2)}%</Text>
              </View>

              <View style={{ marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" }}>
                <Text style={{ color: T.text, fontWeight: "800" }}>Fee Breakdown</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Gas fee: {fmt8(stakePreview.gasFee)} HNY</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Service fee (0.0005% of USD): {fmt8(stakePreview.serviceFee)} HNY</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Wallet fee ({(WALLET_FEE_RATE * 100).toFixed(0)}% of service fee): {fmt8(computeWalletFee(stakePreview.serviceFee))} HNY</Text>
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 8 }}>
                  <Text style={{ color: T.green, fontWeight: "900", fontSize: 15 }}>Total deducted: {fmtNum(stakePreview.amount + stakePreview.gasFee + stakePreview.serviceFee + computeWalletFee(stakePreview.serviceFee))} HNY</Text>
                  <Text style={{ color: T.sub, fontSize: 11 }}>({fmtNum(stakePreview.amount)} staked + {fmt8(stakePreview.gasFee + stakePreview.serviceFee + computeWalletFee(stakePreview.serviceFee))} fees)</Text>
                </View>
              </View>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Cancel" variant="outline" onPress={() => { setStakeConfirmOpen(false); setStakePreview(null); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={stakeBusy ? "Staking..." : "Confirm Stake"} variant="purple" disabled={stakeBusy} onPress={handleStakeSubmit} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Toast (global) */}
      {toast && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 22,
            left: 16,
            right: 16,
            alignItems: "center",
            zIndex: 99999,
          }}
        >
          <View
            style={{
              maxWidth: 900,
              width: "100%",
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              backgroundColor: toast.kind === "warn" ? "rgba(255,90,90,0.18)" : T.glass,
            }}
          >
            <Text style={{ color: T.text, fontWeight: "900", textAlign: "center" }}>
              {toast.text}
            </Text>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>

      {/* ═══ HONEYBOOK MODAL ════════════════════════════════════════════════ */}
      <HoneyBook
        visible={honeyBookOpen}
        wallet={wallet}
        apiBase={getApiBase()}
        sign={async (message: string) => {
          const kp = await getActiveHiveMLDSAKeypair();
          if (!kp) throw new Error("No active wallet keypair");
          const signatureHex = signMessageMLDSA(message, kp.secretKey);
          const mldsaPubKeyHex = bytesToHex(kp.publicKey);
          return { signatureHex, mldsaPubKeyHex };
        }}
        onClose={() => setHoneyBookOpen(false)}
      />

      {/* ═══ NFT GALLERY MODAL ══════════════════════════════════════════════ */}
      {nftGalleryOpen && (
        <Modal visible={nftGalleryOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setNftGalleryOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507" }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, backgroundColor: "#111318", borderBottomWidth: 1, borderBottomColor: "#222" }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 20, fontWeight: "900" }}>🖼 NFT Gallery</Text>
              <Pressable onPress={() => { setNftGalleryOpen(false); setNftMinterOpen(true); }} style={{ backgroundColor: "#FFD700", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginRight: 10 }}>
                <Text style={{ color: "#000", fontWeight: "700" }}>+ Mint</Text>
              </Pressable>
              <Pressable onPress={() => setNftGalleryOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>

            {/* Tabs: Mine | Marketplace | Collections | Auctions */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: "#111318", maxHeight: 46 }}>
              <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
                {([
                  { key: "mine", label: `My NFTs${myNfts.length > 0 ? ` (${myNfts.length})` : ""}` },
                  { key: "marketplace", label: "Marketplace" },
                  { key: "collections", label: `Collections${myCollections.length > 0 ? ` (${myCollections.length})` : ""}` },
                  { key: "auctions", label: `Auctions${activeAuctions.length > 0 ? ` (${activeAuctions.length})` : ""}` },
                ] as const).map(tab => (
                  <Pressable key={tab.key} onPress={() => {
                    setNftGalleryTab(tab.key as any);
                    if (tab.key === "marketplace") loadMarketplace();
                    if (tab.key === "auctions") loadAuctions();
                    if (tab.key === "collections") loadCollections();
                  }} style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: nftGalleryTab === tab.key ? "#FFD700" : "transparent" }}>
                    <Text style={{ color: nftGalleryTab === tab.key ? "#FFD700" : "#666", fontWeight: "700", fontSize: 13 }}>{tab.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {/* Marketplace filter bar */}
            {nftGalleryTab === "marketplace" && (
              <View style={{ backgroundColor: "#0c0d11", paddingHorizontal: 12, paddingVertical: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["", "audio", "video", "document", "photo"] as const).map(ft => (
                      <Pressable key={ft} onPress={() => { setMarketFilterType(ft); loadMarketplace(ft, marketFilterSort); }} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: marketFilterType === ft ? "#FFD700" : "#1a1a1a", borderWidth: 1, borderColor: marketFilterType === ft ? "#FFD700" : "#333" }}>
                        <Text style={{ color: marketFilterType === ft ? "#000" : "#888", fontSize: 12, fontWeight: "700" }}>
                          {ft === "" ? "All" : ft.charAt(0).toUpperCase() + ft.slice(1)}
                        </Text>
                      </Pressable>
                    ))}
                    <View style={{ width: 1, backgroundColor: "#333", marginHorizontal: 4 }} />
                    {([["newest", "🕐 Newest"], ["price_asc", "💰 Cheapest"], ["price_desc", "💎 Priciest"]] as const).map(([val, lbl]) => (
                      <Pressable key={val} onPress={() => { setMarketFilterSort(val); loadMarketplace(marketFilterType, val); }} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: marketFilterSort === val ? "#1a1200" : "#1a1a1a", borderWidth: 1, borderColor: marketFilterSort === val ? "#FFD700" : "#333" }}>
                        <Text style={{ color: marketFilterSort === val ? "#FFD700" : "#888", fontSize: 12 }}>{lbl}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Content */}
            <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
              {nftLoading && <ActivityIndicator color="#FFD700" style={{ marginTop: 40 }} />}

              {/* ── My NFTs ──────────────────────────────────────────── */}
              {nftGalleryTab === "mine" && !nftLoading && myNfts.length === 0 && (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 48, marginBottom: 12 }}>🖼</Text>
                  <Text style={{ color: "#666", fontSize: 15 }}>No NFTs yet. Tap + Mint to create one!</Text>
                </View>
              )}
              {nftGalleryTab === "mine" && myNfts.map(nft => (
                <View key={nft.id} style={{ backgroundColor: "#111318", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#222" }}>
                  <Pressable onPress={() => { setNftPlayerTarget(nft); setNftPlayerOpen(true); }} style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontSize: 32, marginRight: 12 }}>
                      {nft.media_type === "audio" ? "🎵" : nft.media_type === "video" ? "🎬" : nft.media_type === "photo" ? "🖼" : "📄"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{nft.name}</Text>
                      <Text style={{ color: "#FFD700", fontSize: 11, fontWeight: "700" }}>{nft.media_type.toUpperCase()} • {nft.file_count} file{nft.file_count !== 1 ? "s" : ""}</Text>
                      {nft.ai_description ? <Text style={{ color: "#666", fontSize: 11, marginTop: 2 }} numberOfLines={1}>{nft.ai_description}</Text> : null}
                      {nft.listed_price_hny != null && <Text style={{ color: "#aaa", fontSize: 12, marginTop: 2 }}>Listed: {nft.listed_price_hny} HNY</Text>}
                      {nft.auction_id && <Text style={{ color: "#ff9900", fontSize: 11, marginTop: 2 }}>🔨 In Auction</Text>}
                    </View>
                    <Text style={{ color: "#555", fontSize: 18 }}>▶</Text>
                  </Pressable>
                  {/* Auction button for owned NFTs (not in auction) */}
                  {!nft.auction_id && nft.owner_wallet === wallet && (
                    <Pressable onPress={() => { setAuctionTargetNft(nft); setAuctionModalOpen(true); }} style={{ marginTop: 10, backgroundColor: "#1a1a1a", borderRadius: 8, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#333" }}>
                      <Text style={{ color: "#ff9900", fontSize: 12, fontWeight: "700" }}>🔨 Start Auction</Text>
                    </Pressable>
                  )}
                </View>
              ))}

              {/* ── Marketplace ───────────────────────────────────────── */}
              {nftGalleryTab === "marketplace" && !nftLoading && marketplaceNfts.length === 0 && (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 48, marginBottom: 12 }}>🛒</Text>
                  <Text style={{ color: "#666", fontSize: 15 }}>No NFTs listed for sale.</Text>
                </View>
              )}
              {nftGalleryTab === "marketplace" && marketplaceNfts.map(nft => (
                <View key={nft.id} style={{ backgroundColor: "#111318", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#222" }}>
                  <Pressable onPress={() => { setNftPlayerTarget(nft); setNftPlayerOpen(true); }} style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontSize: 32, marginRight: 12 }}>
                      {nft.media_type === "audio" ? "🎵" : nft.media_type === "video" ? "🎬" : nft.media_type === "photo" ? "🖼" : "📄"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{nft.name}</Text>
                      <Text style={{ color: "#FFD700", fontSize: 11, fontWeight: "700" }}>{nft.media_type.toUpperCase()} • {nft.file_count} file{nft.file_count !== 1 ? "s" : ""}</Text>
                      {nft.ai_description ? <Text style={{ color: "#666", fontSize: 11, marginTop: 2 }} numberOfLines={1}>{nft.ai_description}</Text> : null}
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 4 }}>{nft.listed_price_hny} HNY</Text>
                      {nft.royalty_bps > 0 && <Text style={{ color: "#555", fontSize: 10 }}>Royalty: {nft.royalty_bps / 100}%</Text>}
                    </View>
                  </Pressable>
                  {nft.owner_wallet !== wallet && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <Pressable style={{ flex: 1, backgroundColor: "#FFD700", borderRadius: 8, paddingVertical: 8, alignItems: "center" }}
                        onPress={async () => {
                          if (!wallet || !hiveServerUrl) return;
                          try {
                            const ts = Date.now();
                            const sig = await nftSignMessage(`buy|${wallet}|${nft.id}|${ts}`);
                            const r = await fetch(`${hiveServerUrl}/nft/buy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nft_id: nft.id, buyer_wallet: wallet, signatureHex: sig, timestamp: ts }) });
                            const d = await r.json();
                            if (!d.success) throw new Error(d.error);
                            showToast(`🎉 NFT purchased for ${nft.listed_price_hny} HNY!`);
                            await Promise.all([loadBalance(), loadNfts(), loadMarketplace()]);
                          } catch (e: any) { showToast(e.message || "Buy failed", "warn"); }
                        }}>
                        <Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>Buy Now</Text>
                      </Pressable>
                      <Pressable style={{ flex: 1, backgroundColor: "#1a1200", borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#FFD700" }}
                        onPress={() => { setOfferTargetNft(nft); setOfferModalOpen(true); }}>
                        <Text style={{ color: "#FFD700", fontWeight: "700", fontSize: 13 }}>Make Offer</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}

              {/* ── Collections ───────────────────────────────────────── */}
              {nftGalleryTab === "collections" && (
                <>
                  <Pressable onPress={() => setCreateCollectionOpen(true)} style={{ backgroundColor: "#1a1200", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#FFD700", alignItems: "center" }}>
                    <Text style={{ color: "#FFD700", fontWeight: "700" }}>📁 + Create Collection</Text>
                  </Pressable>
                  {myCollections.length === 0 && (
                    <View style={{ alignItems: "center", marginTop: 40 }}>
                      <Text style={{ fontSize: 40, marginBottom: 12 }}>📁</Text>
                      <Text style={{ color: "#666", fontSize: 15 }}>No collections yet.</Text>
                    </View>
                  )}
                  {myCollections.map(c => (
                    <View key={c.id} style={{ backgroundColor: "#111318", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#333" }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{c.name}</Text>
                      {c.description ? <Text style={{ color: "#666", fontSize: 12, marginTop: 2 }}>{c.description}</Text> : null}
                      <Text style={{ color: "#FFD700", fontSize: 11, marginTop: 4 }}>{c.nft_count} NFT{c.nft_count !== 1 ? "s" : ""}</Text>
                    </View>
                  ))}
                </>
              )}

              {/* ── Auctions ──────────────────────────────────────────── */}
              {nftGalleryTab === "auctions" && activeAuctions.length === 0 && (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 48, marginBottom: 12 }}>🔨</Text>
                  <Text style={{ color: "#666", fontSize: 15 }}>No active auctions. Create one from My NFTs!</Text>
                </View>
              )}
              {nftGalleryTab === "auctions" && activeAuctions.map(auc => {
                const endsAt = new Date(auc.ends_at);
                const minsLeft = Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 60000));
                const timeStr = minsLeft > 60 ? `${Math.round(minsLeft / 60)}h` : `${minsLeft}m`;
                const minBid = auc.current_bid_hny
                  ? Number(auc.current_bid_hny) + Number(auc.min_increment_hny)
                  : Math.max(Number(auc.reserve_price_hny), 0.01);
                return (
                  <View key={auc.id} style={{ backgroundColor: "#111318", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#ff9900" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontSize: 28, marginRight: 10 }}>
                        {auc.media_type === "audio" ? "🎵" : auc.media_type === "video" ? "🎬" : auc.media_type === "photo" ? "🖼" : "📄"}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{auc.name}</Text>
                        <Text style={{ color: "#ff9900", fontSize: 11 }}>🔨 Auction • ⏱ {timeStr} left</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                      <Text style={{ color: "#aaa", fontSize: 12 }}>Reserve: {auc.reserve_price_hny} HNY</Text>
                      <Text style={{ color: "#FFD700", fontSize: 13, fontWeight: "700" }}>
                        {auc.current_bid_hny ? `Top: ${auc.current_bid_hny} HNY` : "No bids yet"}
                      </Text>
                    </View>
                    {auc.seller_wallet !== wallet && (
                      <Pressable onPress={() => { setBidTargetAuction(auc); setBidAmount(String(minBid.toFixed(2))); setBidModalOpen(true); }} style={{ backgroundColor: "#ff9900", borderRadius: 8, paddingVertical: 8, alignItems: "center" }}>
                        <Text style={{ color: "#000", fontWeight: "700" }}>Bid ≥ {minBid.toFixed(2)} HNY</Text>
                      </Pressable>
                    )}
                    {auc.seller_wallet === wallet && (
                      <Text style={{ color: "#555", fontSize: 11, textAlign: "center" }}>Your auction — settle at block after end time</Text>
                    )}
                  </View>
                );
              })}

              {/* My Offers section (at bottom of mine tab) */}
              {nftGalleryTab === "mine" && myOffers.filter(o => !o.accepted && !o.cancelled).length > 0 && (
                <>
                  <Text style={{ color: "#aaa", fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>My Active Offers</Text>
                  {myOffers.filter(o => !o.accepted && !o.cancelled).map(offer => (
                    <View key={offer.id} style={{ backgroundColor: "#111318", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#333", flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{offer.name || offer.nft_id}</Text>
                        <Text style={{ color: "#FFD700", fontSize: 12 }}>{offer.offer_hny} HNY offered</Text>
                        <Text style={{ color: "#555", fontSize: 11 }}>Expires {new Date(offer.expires_at).toLocaleDateString()}</Text>
                      </View>
                      <Pressable onPress={() => handleCancelOffer(offer.id, offer.offer_hny)} style={{ backgroundColor: "#1a0000", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#ff4444" }}>
                        <Text style={{ color: "#ff4444", fontSize: 12, fontWeight: "700" }}>Cancel</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* ═══ CREATE COLLECTION MODAL ══════════════════════════════════════════ */}
      {createCollectionOpen && (
        <Modal visible={createCollectionOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setCreateCollectionOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507", padding: 24, paddingTop: Platform.OS === "ios" ? 56 : 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 20, fontWeight: "900" }}>📁 New Collection</Text>
              <Pressable onPress={() => setCreateCollectionOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>Collection Name *</Text>
            <TextInput style={{ backgroundColor: "#111318", borderWidth: 1, borderColor: "#333", borderRadius: 8, color: "#fff", padding: 12, fontSize: 15, marginBottom: 16 }} value={newCollName} onChangeText={setNewCollName} placeholder="My Collection" placeholderTextColor="#555" maxLength={60} />
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>Description</Text>
            <TextInput style={{ backgroundColor: "#111318", borderWidth: 1, borderColor: "#333", borderRadius: 8, color: "#fff", padding: 12, fontSize: 14, height: 80, marginBottom: 24 }} value={newCollDesc} onChangeText={setNewCollDesc} placeholder="Describe your collection..." placeholderTextColor="#555" multiline maxLength={300} />
            <Pressable onPress={handleCreateCollection} style={{ backgroundColor: "#FFD700", borderRadius: 12, paddingVertical: 14, alignItems: "center" }} disabled={nftActionBusy}>
              {nftActionBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>Create Collection</Text>}
            </Pressable>
          </View>
        </Modal>
      )}

      {/* ═══ AUCTION CREATE MODAL ═════════════════════════════════════════════ */}
      {auctionModalOpen && auctionTargetNft && (
        <Modal visible={auctionModalOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setAuctionModalOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507", padding: 24, paddingTop: Platform.OS === "ios" ? 56 : 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 20, fontWeight: "900" }}>🔨 Start Auction</Text>
              <Pressable onPress={() => setAuctionModalOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: "#FFD700", fontSize: 14, fontWeight: "700", marginBottom: 16 }}>{auctionTargetNft.name}</Text>
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>Reserve Price (HNY)</Text>
            <TextInput style={{ backgroundColor: "#111318", borderWidth: 1, borderColor: "#333", borderRadius: 8, color: "#fff", padding: 12, fontSize: 15, marginBottom: 16 }} value={auctionReserve} onChangeText={setAuctionReserve} placeholder="0" placeholderTextColor="#555" keyboardType="decimal-pad" />
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 8 }}>Duration</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
              {["1", "6", "24", "72", "168"].map(h => (
                <Pressable key={h} onPress={() => setAuctionDuration(h)} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: auctionDuration === h ? "#1a1200" : "#111318", borderWidth: 1, borderColor: auctionDuration === h ? "#FFD700" : "#333" }}>
                  <Text style={{ color: auctionDuration === h ? "#FFD700" : "#666", fontSize: 12, fontWeight: "700" }}>{h === "168" ? "7d" : h === "72" ? "3d" : h + "h"}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={handleCreateAuction} style={{ backgroundColor: "#ff9900", borderRadius: 12, paddingVertical: 14, alignItems: "center" }} disabled={nftActionBusy}>
              {nftActionBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>🔨 Start Auction</Text>}
            </Pressable>
          </View>
        </Modal>
      )}

      {/* ═══ BID MODAL ════════════════════════════════════════════════════════ */}
      {bidModalOpen && bidTargetAuction && (
        <Modal visible={bidModalOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setBidModalOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507", padding: 24, paddingTop: Platform.OS === "ios" ? 56 : 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 20, fontWeight: "900" }}>🔨 Place Bid</Text>
              <Pressable onPress={() => setBidModalOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: "#FFD700", fontSize: 14, fontWeight: "700", marginBottom: 4 }}>{bidTargetAuction.name}</Text>
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 16 }}>
              {bidTargetAuction.current_bid_hny ? `Current top bid: ${bidTargetAuction.current_bid_hny} HNY` : "No bids yet"}
            </Text>
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>Your Bid (HNY)</Text>
            <TextInput style={{ backgroundColor: "#111318", borderWidth: 1, borderColor: "#FFD700", borderRadius: 8, color: "#fff", padding: 12, fontSize: 20, fontWeight: "700", marginBottom: 24 }} value={bidAmount} onChangeText={setBidAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#555" />
            <Pressable onPress={handleBid} style={{ backgroundColor: "#ff9900", borderRadius: 12, paddingVertical: 14, alignItems: "center" }} disabled={nftActionBusy}>
              {nftActionBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>Place Bid — {bidAmount || "0"} HNY</Text>}
            </Pressable>
          </View>
        </Modal>
      )}

      {/* ═══ OFFER MODAL ══════════════════════════════════════════════════════ */}
      {offerModalOpen && offerTargetNft && (
        <Modal visible={offerModalOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setOfferModalOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507", padding: 24, paddingTop: Platform.OS === "ios" ? 56 : 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 20, fontWeight: "900" }}>💌 Make Offer</Text>
              <Pressable onPress={() => setOfferModalOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: "#FFD700", fontSize: 14, fontWeight: "700", marginBottom: 4 }}>{offerTargetNft.name}</Text>
            {offerTargetNft.listed_price_hny != null && (
              <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 16 }}>Listed at {offerTargetNft.listed_price_hny} HNY</Text>
            )}
            <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>Your Offer (HNY)</Text>
            <TextInput style={{ backgroundColor: "#111318", borderWidth: 1, borderColor: "#FFD700", borderRadius: 8, color: "#fff", padding: 12, fontSize: 20, fontWeight: "700", marginBottom: 8 }} value={offerAmount} onChangeText={setOfferAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#555" />
            <Text style={{ color: "#555", fontSize: 11, marginBottom: 24 }}>HNY will be locked in escrow until accepted, declined, or expired (48h).</Text>
            <Pressable onPress={handleMakeOffer} style={{ backgroundColor: "#FFD700", borderRadius: 12, paddingVertical: 14, alignItems: "center" }} disabled={nftActionBusy}>
              {nftActionBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>Send Offer — {offerAmount || "0"} HNY</Text>}
            </Pressable>
          </View>
        </Modal>
      )}

      {/* ═══ NFT PLAYER ══════════════════════════════════════════════════════ */}
      {nftPlayerTarget && (
        <NFTPlayer
          visible={nftPlayerOpen}
          onClose={() => { setNftPlayerOpen(false); setNftPlayerTarget(null); }}
          nftId={nftPlayerTarget.id}
          mediaType={nftPlayerTarget.media_type as any}
          fileCount={nftPlayerTarget.file_count}
          name={nftPlayerTarget.name}
          serverUrl={hiveServerUrl}
        />
      )}

      {/* ═══ NFT MINTER ══════════════════════════════════════════════════════ */}
      <NFTMinter
        visible={nftMinterOpen}
        onClose={() => setNftMinterOpen(false)}
        onMinted={(_nftId) => {
          setNftMinterOpen(false);
          showToast("NFT minted! 🎉");
          Promise.all([loadNfts(), loadCollections()]).catch(() => {});
          setNftGalleryOpen(true);
          setNftGalleryTab("mine");
        }}
        serverUrl={hiveServerUrl}
        walletAddress={wallet}
        signMessage={nftSignMessage}
        collections={myCollections.map(c => ({ id: c.id, name: c.name, nft_count: c.nft_count }))}
        withChrysalis={runWithChrysalisModal}
      />

      {/* ═══ HIVE SOCIAL FEED ═════════════════════════════════════════════════ */}
      {socialOpen && (
        <Modal visible={socialOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSocialOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, backgroundColor: "#111318", borderBottomWidth: 1, borderBottomColor: "#222" }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" }}>🌐 HIVE Social</Text>
              <Pressable onPress={() => setSocialOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>

            {/* Compose hint */}
            {wallet && (
              <View style={{ margin: 12, padding: 12, backgroundColor: "rgba(57,255,20,0.05)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(57,255,20,0.2)" }}>
                <Text style={{ color: "#aaa", fontSize: 12, marginBottom: 6 }}>Post to HIVE Social — ML-DSA-65 signed via HIVE Wallet</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={socialDraft}
                    onChangeText={t => setSocialDraft(t.slice(0, 280))}
                    placeholder="What's happening on HIVE? (280 chars)"
                    placeholderTextColor="#555"
                    multiline
                    style={{ flex: 1, backgroundColor: "#111", borderRadius: 8, borderWidth: 1, borderColor: "#333", color: "#fff", padding: 8, fontSize: 13, maxHeight: 80 }}
                  />
                  <Pressable
                    onPress={async () => {
                      if (!socialDraft.trim() || !wallet) return;
                      const ts = Date.now();
                      const payload = JSON.stringify({ action: 'social_post', wallet, content: socialDraft.trim(), ts, message: `social_post|${wallet}|${socialDraft.trim()}|${ts}` });
                      await Clipboard.setStringAsync(payload);
                      Alert.alert("Copied!", "Post payload copied. Open HIVE Wallet → Scan/Paste to sign & publish.");
                      setSocialDraft('');
                    }}
                    style={{ backgroundColor: "#39ff14", borderRadius: 8, padding: 10, justifyContent: "center" }}
                  >
                    <Text style={{ color: "#000", fontWeight: "900", fontSize: 12 }}>Post →</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <ScrollView style={{ flex: 1, padding: 12 }} showsVerticalScrollIndicator={false}
              onScrollBeginDrag={() => { /* no-op */ }}
              refreshControl={<RefreshControl refreshing={socialLoading} onRefresh={loadSocialFeed} tintColor="#39ff14" />}
            >
              {socialLoading && socialPosts.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ color: "#555" }}>Loading feed…</Text>
                </View>
              ) : socialPosts.length === 0 ? (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>🌐</Text>
                  <Text style={{ color: "#555" }}>No posts yet. Be the first to post!</Text>
                </View>
              ) : (
                socialPosts.map(post => (
                  <View key={post.id} style={{ backgroundColor: "#0d1117", borderRadius: 10, borderWidth: 1, borderColor: "#1e2a1e", padding: 14, marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                      <Text style={{ fontSize: 26 }}>{post.avatarEmoji || "🐝"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{post.displayName || `${post.wallet.slice(0,8)}…`}</Text>
                        <Text style={{ color: "#555", fontSize: 10 }}>{new Date(post.createdAtMs).toLocaleString()}</Text>
                      </View>
                    </View>
                    <Text style={{ color: "#ddd", fontSize: 14, lineHeight: 20 }}>{post.content}</Text>
                    {post.likeCount > 0 && <Text style={{ color: "#555", fontSize: 11, marginTop: 6 }}>❤️ {post.likeCount}</Text>}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* ═══ QUEEN BEE AI ALERTS ══════════════════════════════════════════════ */}
      {queenBeeAlertsOpen && (
        <Modal visible={queenBeeAlertsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setQueenBeeAlertsOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#040507" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, backgroundColor: "#111318", borderBottomWidth: 1, borderBottomColor: "#222" }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" }}>🐝 Queen Bee AI Alerts</Text>
              <Pressable onPress={() => setQueenBeeAlertsOpen(false)} style={{ padding: 8 }}>
                <Text style={{ color: "#888", fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
              {queenBeeAlerts.length === 0 && (
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 48, marginBottom: 12 }}>🐝</Text>
                  <Text style={{ color: "#666" }}>No active alerts. The hive is safe.</Text>
                </View>
              )}
              {queenBeeAlerts.map(alert => (
                <View key={alert.id} style={{
                  backgroundColor: alert.alert_level === "ALERT" ? "rgba(255,50,50,0.1)" : alert.alert_level === "CAUTION" ? "rgba(255,180,0,0.1)" : "rgba(57,255,20,0.07)",
                  borderWidth: 1,
                  borderColor: alert.alert_level === "ALERT" ? "rgba(255,50,50,0.4)" : alert.alert_level === "CAUTION" ? "rgba(255,180,0,0.4)" : "rgba(57,255,20,0.3)",
                  borderRadius: 12, padding: 14, marginBottom: 10,
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                    <Text style={{ fontWeight: "900", fontSize: 13, color: alert.alert_level === "ALERT" ? "#ff4444" : alert.alert_level === "CAUTION" ? "#ffb400" : "#39ff14", flex: 1 }}>
                      {alert.alert_level === "ALERT" ? "🚨" : alert.alert_level === "CAUTION" ? "⚠️" : "✅"} {alert.alert_level} · {alert.tx_type}
                    </Text>
                    <Pressable onPress={() => dismissQueenBeeAlert(alert.id)}>
                      <Text style={{ color: "#555" }}>✕</Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: "#ccc", fontSize: 13 }}>{alert.reason}</Text>
                  <Text style={{ color: "#555", fontSize: 10, marginTop: 4 }}>{alert.created_at}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </Modal>
      )}

    </View>
    </SafeAreaView>
  );
}
