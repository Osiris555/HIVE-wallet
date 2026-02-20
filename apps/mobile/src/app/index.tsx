// apps/mobile/src/app/index.tsx

import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Alert,
  View,
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
  type Token,
  type TokenBalance,
  type SwapQuote,
  type LiquidityPool,
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
  type WalletEntry,
  type WalletList,
} from "../chain/wallet-manager";

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
  HNY: "🍯", stHNY: "🔒", ETH: "💎", BTC: "🟡", SOL: "☀️", USDT: "💵", USDC: "💚", XRP: "🌊",
};
const TOKEN_LIST = ["HNY", "stHNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];
const FAUCET_TOKENS = ["HNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];
const SWAP_TOKENS = ["HNY", "stHNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];

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
  const stakingModalHeight = Math.min(640, Math.max(420, Dimensions.get("window").height - (insets.top + insets.bottom) - 140));
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

  // ✅ Toast exists (fixes "toast is not defined")
  const [toast, setToast] = useState<{ text: string; kind?: "info" | "warn" } | null>(null);

  // Focus/poll guards
  const editingRef = useRef(false);
  const pausePollingRef = useRef(false);

  const anyModalOpen =
    confirmOpen || historyOpen || settingsOpen || rbfOpen || cancelOpen || receiveOpen || tokenSendOpen || swapOpen || swapConfirmOpen || portfolioOpen || faucetModalOpen || unifiedSendConfirmOpen || !!tokenDetailSymbol || contactsOpen || stakingModalOpen || stakeConfirmOpen || walletSwitcherOpen;

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
  // Web: camera scanning is flaky unless https; we keep it mobile-only.
  if (Platform.OS === "web") {
    showToast("QR scan not supported on web. Use paste.", "warn");
    return;
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
        setQrScanError("Camera permission denied.");
        return;
      }
    } else {
      // Some builds expose permission state via hook only. We'll still try to open.
      setCameraPerm(true);
    }

    scanLockRef.current = false;
    setQrScanOpen(true);
  } catch (e: any) {
    setQrScanError("Camera unavailable. Ensure expo-camera is installed.");
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
    // Initialize multi-wallet system
    const wl = await getWallets();
    setWalletList(wl.wallets);
    setActiveWalletIndex(wl.activeIndex);
    
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
    } catch (e: any) {
      setMessage(`Switch failed: ${e?.message || "Unknown"}`);
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

  async function hardRefreshAll() {
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
      await loadStaking();
      await loadTokenData();
      setLastRefresh(Date.now());
    } catch (e: any) {
      setMessage(e?.message || "Refresh failed");
    }
  }

  /* ======================
     Boot + live refresh
  ====================== */
  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
      await loadContactsOnBoot();
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
    // Service fee = 0.0005% of USD value (HNY @ $1)
    const hnyPriceUSD = tokenPrices["HNY"] || 1;
    const usdValue = amount * hnyPriceUSD;
    const serviceFee = Number((usdValue * serviceFeeRate).toFixed(8));
    const totalFee = Number((chosenGas + serviceFee).toFixed(8));
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
    try {
      await stake({ amount: stakePreview.amount, lockDays: stakePreview.lockDays, gasFee: stakePreview.gasFee, serviceFee: stakePreview.serviceFee });
      setMessage("Stake submitted ✅");
      setStakeAmountText("");
      setStakeConfirmOpen(false);
      setStakePreview(null);
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Stake failed: ${e?.message || "Unknown error"}`);
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
        await unlockStake({ positionId, gasFee: chosenGas });
        setMessage("Unlock initiated ✅");
      } else if (posStatus === "unlocking") {
        // If already unlocking, attempt withdraw (server will enforce unlock end time).
        await unstake({ positionId, gasFee: chosenGas });
        setMessage("Withdraw submitted ✅");
      } else {
        setMessage(`Cannot withdraw position with status: ${posStatus}`);
        return;
      }
      await hardRefreshAll();
    } catch (e: any) {
      const errMsg = String(e?.message || "Unknown error");
      // Provide more specific error messages
      if (errMsg.includes("not withdrawable") || errMsg.includes("not found")) {
        setMessage("Position has already been withdrawn or is not available");
      } else if (errMsg.includes("unlocking")) {
        setMessage("Position is still unlocking. Please wait for the unlock period to complete.");
      } else {
        setMessage(`Unstake failed: ${errMsg}`);
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
    const tokenPriceUSD = tokenPrices[unifiedSendToken] || 1;
    const usdValue = totalAmt * tokenPriceUSD;
    const serviceFee = Number((usdValue * serviceFeeRate).toFixed(8));

    if (unifiedSendToken === "HNY") {
      const totalCost = Number((totalAmt + chosenGas + serviceFee).toFixed(8));
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
      const feesInHNY = chosenGas + serviceFee;
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
    setMessage("");
    try {
      if (unifiedSendQuote.token === "HNY") {
        await send({
          to: unifiedSendQuote.to,
          amount: Number(unifiedSendQuote.amount),
          gasFee: Number(unifiedSendQuote.gasFee),
          serviceFee: Number(unifiedSendQuote.serviceFee),
        });
      } else {
        await sendToken({
          to: unifiedSendQuote.to,
          tokenSymbol: unifiedSendQuote.token,
          amount: unifiedSendQuote.amount,
          gasFee: unifiedSendQuote.gasFee,
          serviceFee: unifiedSendQuote.serviceFee,
        });
      }
      setMessage(`✅ Sent ${fmtNum(unifiedSendQuote.amount)} ${unifiedSendQuote.token}`);
      setUnifiedSendTo("");
      setUnifiedSendAmount("");
      setUnifiedSendConfirmOpen(false);
      setTokenSendOpen(false);
      setUnifiedSendQuote(null);
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
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
    setMessage("");
    try {
      const amt = Number(swapAmountIn);
      // Compute USD-based service fee for the swap
      const tokenPriceUSD = tokenPrices[swapTokenIn] || 1;
      const usdVal = amt * tokenPriceUSD;
      const svcFee = Number((usdVal * serviceFeeRate).toFixed(8));
      await swap({ tokenIn: swapTokenIn, tokenOut: swapTokenOut, amountIn: amt, minAmountOut: swapQuote.amountOut * 0.95, serviceFee: svcFee });
      setMessage(`✅ Swapped ${fmtNum(amt)} ${swapTokenIn} → ${fmtNum(swapQuote.amountOut)} ${swapTokenOut}`);
      setSwapAmountIn("");
      setSwapQuote(null);
      setSwapConfirmOpen(false);
      setSwapOpen(false);
      await hardRefreshAll();
    } catch (e: any) { setMessage(`Swap failed: ${e?.message || "Unknown error"}`); } finally { setSwapBusy(false); pausePollingRef.current = false; }
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

    const serviceFee = computeServiceFee(totalAmt, serviceFeeRate);
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
    setMessage("");

    try {
      const res: any = await send({
        to: sanitizeAddress(String(quote.to)).replace(/^hny_/i, "HNY_"),
        amount: Number(quote.totalAmt),
        gasFee: Number(quote.chosenGas),
        serviceFee: Number(quote.serviceFee),
      });

      const txid = String(res?.txid || res?.id || res?.tx?.id || "").trim();
      closeAllModals({ keepMessage: true });
      setMessage(txid ? `Send submitted ✅ (TxID: ${shortId(txid)})` : "Send submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      closeAllModals({ keepMessage: true });
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
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
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={bgSource}
            resizeMode="cover"
            style={[StyleSheet.absoluteFill, { opacity: 1 }]}
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
          <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
          <View style={{ flex: 1 }} />

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

        <Text style={{ color: T.sub, marginTop: 2 }}>
          Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)} • Chain: {chainId || "—"}
        </Text>

        {!!message && (
          <Card T={T} style={{ marginTop: 12 }}>
            <Text style={{ color: T.text, fontWeight: "900" }}>{message}</Text>
          </Card>
        )}

        {/* Wallet address (slim) */}
        <Card T={T} style={{ marginTop: 12 }}>
          <Pressable onPress={() => { pausePollingRef.current = true; setWalletSwitcherOpen(true); }} style={{ flexDirection: "row", alignItems: "center" }}>
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
              <Pressable onPress={copyWalletToClipboard} hitSlop={10} style={{ padding: 6, marginLeft: 6, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderColor: T.border }}>
                <Ionicons name="copy-outline" size={18} color={T.text} />
              </Pressable>
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
                      <Text style={{ color: txType === "swap" ? T.green : directionLabel === "Sent" || directionLabel === "Stake" ? "#ff6b6b" : T.green, fontWeight: "900", fontSize: 14 }}>
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
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Receive HNY</Text>
                <Pressable onPress={() => closeAllModals()}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Wallet address</Text>

              <View
                style={{
                  marginTop: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.25)",
                }}
              >
                {!!wallet ? (
                  <QRCode value={String(wallet).trim()} size={220} />
                ) : (
                  <Text style={{ color: T.sub, fontWeight: "800" }}>Loading wallet…</Text>
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
                }}
              >
                {wallet || "—"}
              </Text>

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button T={T} label={copied ? "Copied ✅" : "Copy"} variant="green" onPress={copyWalletToClipboard} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
                </View>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                Tip: open the app in an incognito window to create a second wallet and test sending between two addresses.
              </Text>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <Overlay onClose={closeAllModals}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Settings</Text>

              <View style={{ height: 14 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>Theme</Text>
              <View style={{ height: 10 }} />

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

              <View style={{ height: 14 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>Skin</Text>
              <View style={{ height: 10 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label="Athena's Temple"
                    variant={skin === "athena-temple2" ? "purple" : "outline"}
                    onPress={() => setSkin("athena-temple2")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label="Honey Coin"
                    variant={skin === "matrix-honey-coin" ? "purple" : "outline"}
                    onPress={() => setSkin("matrix-honey-coin")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label="Matrix Honeycomb"
                    variant={skin === "matrix-honeycomb" ? "purple" : "outline"}
                    onPress={() => setSkin("matrix-honeycomb")}
                  />
                </View>
              </View>

              <View style={{ height: 10 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    T={T}
                    label="No Background"
                    variant={skin === "solid-noir" ? "purple" : "outline"}
                    onPress={() => setSkin("solid-noir")}
                  />
                </View>
              </View>

              {Platform.OS !== "web" && (
                <>
                  <View style={{ height: 16 }} />
                  <Text style={{ color: T.sub, fontWeight: "800" }}>API Base (iOS/Android)</Text>
                  <Text style={{ color: T.sub, marginTop: 6 }}>
                    If your device can’t reach the node (common with Expo Tunnel), set this to your LAN IP,
                    e.g. http://192.168.20.11:3000
                  </Text>
                  <View style={{ height: 10 }} />
                  <TextInput
                    value={apiBaseText}
                    onChangeText={setApiBaseText}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="http://192.168.x.x:3000"
                    placeholderTextColor={T.sub}
                    style={{
                      borderWidth: 1,
                      borderColor: T.border,
                      borderRadius: 12,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      color: T.text,
                      backgroundColor: T.glass2,
                    }}
                  />
                  <View style={{ height: 10 }} />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        T={T}
                        label="Save"
                        variant="blue"
                        onPress={async () => {
                          const v = String(apiBaseText || "").trim();
                          if (!v) {
                            showToast("Enter an API base URL", "warn");
                            return;
                          }
                          await kvSet("HIVE_API_BASE_OVERRIDE", v);
                          setApiBase(v);
                          // Re-pull data immediately so the user sees positions without restarting.
                          // Use the existing unified refresher (balances, txs, staking, etc.)
                          // so we don't rely on non-existent helpers.
                          hardRefreshAll().catch(() => {});
                          showToast("API base saved", "info");
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        T={T}
                        label="Reset"
                        variant="outline"
                        onPress={async () => {
                          await kvDel("HIVE_API_BASE_OVERRIDE");
                          const d = resetApiBase();
                          setApiBaseText(d);
                          showToast("Override cleared", "info");
                        }}
                      />
                    </View>
                  </View>
                </>
              )}

              <View style={{ height: 14 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
            </View>
          </GlassCard>
        </Overlay>
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
                {` • Svc fee (0.0005% of USD): ${fmt8(Number(parseAmount8(normalizeAmountText(unifiedSendAmount)).value || 0) * (tokenPrices[unifiedSendToken] || 1) * serviceFeeRate)} HNY`}
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
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Service fee (0.0005% of USD): {fmt8(unifiedSendQuote.serviceFee)} HNY</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Total fees: {fmt8(unifiedSendQuote.gasFee + unifiedSendQuote.serviceFee)} HNY</Text>

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
                                  try {
                                    await deleteWallet(w.index);
                                    const list = await getWallets();
                                    setWalletList(list.wallets);
                                    setActiveWalletIndex(list.activeIndex);
                                    if (w.index === activeWalletIndex) {
                                      await hardRefreshAll();
                                    }
                                  } catch (e: any) {
                                    showToast(e?.message || "Cannot delete");
                                  }
                                  setEditingWalletIdx(null);
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

              <Text style={{ color: T.sub, fontWeight: "800", marginBottom: 8 }}>Add New Wallet</Text>
              <TextInput
                value={newWalletLabel}
                onChangeText={setNewWalletLabel}
                placeholder="Wallet name (e.g., Trading)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{
                  paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
                  borderWidth: 1, borderColor: T.border, color: T.text,
                  backgroundColor: T.glass2, fontWeight: "800",
                }}
              />
              <View style={{ marginTop: 10 }}>
                <Button
                  T={T}
                  label={creatingWallet ? "Creating…" : "➕ Create Wallet"}
                  variant="green"
                  onPress={handleCreateWallet}
                  disabled={creatingWallet}
                />
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "500", fontSize: 11 }}>
                Transfers between your wallets only cost the base gas fee ({fmt8(Number(minGasFee))} HNY).
              </Text>
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
                  <Text style={{ color: T.sub, marginTop: 2, fontWeight: "600" }}>Impact: {swapQuote.priceImpact.toFixed(4)}% • Pool fee: 0.30%{swapQuote.route === "multi-hop" ? " × 2 hops" : ""}</Text>
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
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Pool fee: 0.30%{swapQuote.route === "multi-hop" ? " per hop (2 hops)" : ""} ≈ {fmtNum(Number(swapAmountIn) * (swapQuote.feeRate || 0.003), 4)} {swapTokenIn}</Text>
                <Text style={{ color: T.text, fontWeight: "800", marginTop: 4 }}>Service fee: {fmt8(Number(swapAmountIn) * (tokenPrices[swapTokenIn] || 1) * serviceFeeRate)} HNY</Text>
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
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 8 }}>
                  <Text style={{ color: T.green, fontWeight: "900", fontSize: 15 }}>Total deducted: {fmtNum(stakePreview.totalCost)} HNY</Text>
                  <Text style={{ color: T.sub, fontSize: 11 }}>({fmtNum(stakePreview.amount)} staked + {fmt8(stakePreview.totalFee)} fees)</Text>
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
      </View>
    </SafeAreaView>
  );
}
