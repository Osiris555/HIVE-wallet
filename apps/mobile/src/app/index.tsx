// apps/mobile/src/app/index.tsx

import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
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
  unstake,
  getStakingPositions,
  parseAmount8,
  getAccount,
  getTransactionById,
} from "../chain/transactions";
import type { Transaction as TxLike, StakingPosition } from "../chain/transactions";

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

/* ======================
   Theme + Skin
====================== */
type ThemeKey = "matrix" | "noir" | "honey";
type SkinKey = "matrix-honey-coin" | "matrix-honeycomb" | "solid-noir";

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
    <View style={[{ borderRadius: 18, overflow: "hidden" }, webBlur, props.style]}>
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

/** Full-screen modal overlay */
function Overlay(props: { children: React.ReactNode; onClose: () => void }) {
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
        zIndex: 9999,
      }}
      pointerEvents="auto"
    >
      <Pressable onPress={props.onClose} style={StyleSheet.absoluteFillObject} />
      <View style={{ width: "100%", maxWidth: 900 }} pointerEvents="auto">
        {props.children}
      </View>
    </View>
  );
}

export default function Index() {
  const insets = useSafeAreaInsets();
  /* ======================
     Core state (NO DUPLICATES)
  ====================== */
  const [theme, setTheme] = useState<ThemeKey>("matrix");
  const MIN_GAS_FEE_FLOOR = ONE_SAT; // base gas (1 Honey Cone)
  const [skin, setSkin] = useState<SkinKey>("matrix-honey-coin");

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

  const [txs, setTxs] = useState<TxLike[]>([]);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(0);

  const [message, setMessage] = useState("");
  const [mintCooldown, setMintCooldown] = useState<number>(0);
  const [mintBusy, setMintBusy] = useState<boolean>(false);

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
    const sum = (stakingPositions || []).reduce((acc, p: any) => acc + Number(p?.amount || 0), 0);
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

  // Balances: some dev servers report "spendable" including staked amounts.
  // We derive an effective spendable balance so staked HNY cannot be accidentally re-sent.
  const balancesView = useMemo(() => {
    const confirmedRaw = Number(confirmedBalance || 0);
    const spendableRaw = Number(spendableBalance || 0);
    const staked = Number(stakedBalance || 0);

    // Heuristic:
    // If spendableRaw appears to already exclude staked funds (rare in our dev server), don't subtract.
    // Otherwise, treat staked as a locked sub-balance inside confirmed/spendable.
    const looksLikeSpendableIncludesStaked = spendableRaw >= staked && confirmedRaw >= staked;

    const spendableEff = looksLikeSpendableIncludesStaked
      ? Math.max(0, Number((spendableRaw - staked).toFixed(8)))
      : spendableRaw;

    const totalEff = looksLikeSpendableIncludesStaked
      ? confirmedRaw || spendableRaw
      : Number((spendableRaw + staked).toFixed(8));

    return {
      total: totalEff,
      spendable: spendableEff,
      staked,
    };
  }, [confirmedBalance, spendableBalance, stakedBalance]);

  const [stakingApr, setStakingApr] = useState<number>(0);
  const [stakeAmountText, setStakeAmountText] = useState<string>("");
  const [stakeLockDaysText, setStakeLockDaysText] = useState<string>("30");
  const [stakeBusy, setStakeBusy] = useState<boolean>(false);
  const [unstakeBusyId, setUnstakeBusyId] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    confirmOpen || historyOpen || settingsOpen || rbfOpen || cancelOpen || receiveOpen;

  const sendFormDirty = !!toText || !!amountText;

  const T = themeFor(theme);

  /* ======================
     Background skin images
  ====================== */
  const honeyCoinBg = useMemo(() => require("./assets/skins/matrix-honey-coin.png"), []);
  const honeycombBg = useMemo(() => require("./assets/skins/matrix-honeycomb.png"), []);

  const bgSource = useMemo(() => {
    if (skin === "matrix-honey-coin") return honeyCoinBg;
    if (skin === "matrix-honeycomb") return honeycombBg;
    return null;
  }, [skin, honeyCoinBg, honeycombBg]);

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


  // ✅ keep derived gas text updated (never user typed)
  useEffect(() => {
    const v = computeChosenGas(Number(minGasFee || ONE_SAT));
    setGasFeeText(fmt8(v));
  }, [priorityTier, minGasFee, amountText]);

  /* ======================
     Data loading
  ====================== */
  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(String(w || ""));
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
    } catch {
      // ignore staking load errors in early dev
    }
  }

  async function hardRefreshAll() {
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
      await loadStaking();
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

    setQuote(null);
    setRbfTx(null);
    setCancelTx(null);

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

  async function handleStake() {
    if (stakeBusy) return;
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
    const minGas = Math.max(Number(minGasFee || 0), MIN_GAS_FEE_FLOOR);
    const chosenGas = Math.max(minGas, computeChosenGas(minGas));

    setStakeBusy(true);
    try {
      await stake({ amount: Number(amtCheck.value), lockDays, gasFee: chosenGas });
      setMessage("Stake submitted ✅");
      setStakeAmountText("");
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
      await unstake({ positionId, gasFee: chosenGas });
      setMessage("Unstake submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Unstake failed: ${e?.message || "Unknown error"}`);
    } finally {
      setUnstakeBusyId(null);
    }
  }

  /* ======================
     Send flow (confirm modal)
  ====================== */
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
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return "Mint";
  }, [mintCooldown, mintBusy]);
  /* ======================
     Render
  ====================== */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
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
        keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : "none"}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
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

        {/* Wallet + balances */}
        <Card T={T} style={{ marginTop: 12 }}>
          <Text style={{ color: T.sub, fontWeight: "800" }}>Wallet</Text>

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
            <Text style={{ color: T.text, fontSize: 16, fontWeight: "900", flex: 1 }}>
              {wallet ? shortAddr(wallet) : "Loading…"}
            </Text>

            {!!wallet && (
              <Pressable
                onPress={copyWalletToClipboard}
                hitSlop={10}
                style={{
                  padding: 6,
                  marginLeft: 6,
                  borderRadius: 8,
                  backgroundColor: "rgba(0,0,0,0.25)",
                  borderWidth: 1,
                  borderColor: T.border,
                }}
              >
                <Ionicons name="copy-outline" size={18} color={T.text} />
              </Pressable>
            )}
          </View>

          <View style={{ height: 12 }} />

          <Text style={{ color: T.sub, fontWeight: "800" }}>Balances</Text>
          <Text style={{ color: T.text, fontWeight: "900", marginTop: 6 }}>Total: {fmt8(balancesView.total)}</Text>
          <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Spendable: {fmt8(balancesView.spendable)}</Text>
          <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Staked: {fmt8(stakedBalance)}</Text>
          <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Pending Δ: {pendingDelta}</Text>
          <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Fee Vault: {feeVaultBalance}</Text>

          <View style={{ height: 14 }} />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Refresh" variant="outline" onPress={hardRefreshAll} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                T={T}
                label="Receive"
                variant="blue"
                onPress={() => {
                  pausePollingRef.current = true;
                  setReceiveOpen(true);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                T={T}
                label={mintLabel}
                variant="purple"
                disabled={mintBusy || mintCooldown > 0}
                onPress={handleMint}
              />
            </View>
          </View>

          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
            Last refresh: {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : "—"}
          </Text>
        </Card>

        {/* Send */}
        <Card T={T} style={{ marginTop: 12 }}>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Send</Text>

          
<Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Recipient</Text>
<View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 8 }}>
  <TextInput
    value={toText}
    onChangeText={(t) => setToText(sanitizeAddress(t))}
    onFocus={() => (editingRef.current = true)}
    onBlur={() => (editingRef.current = false)}
    placeholder="HNY_<40 hex>"
    placeholderTextColor={"rgba(255,255,255,0.35)"}
    autoCapitalize="none"
    autoCorrect={false}
    style={{
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: T.border,
      color: T.text,
      backgroundColor: T.glass2,
      fontWeight: "800",
    }}
  />
  <Pressable
    onPress={openQrScanner}
    style={{
      width: 48,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: T.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.glass2,
    }}
  >
    <Ionicons name="qr-code-outline" size={22} color={T.text} />
  </Pressable>
</View>
<Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Amount</Text>
          <TextInput
            value={amountText}
            onChangeText={(t) => setAmountText(normalizeAmountText(t))}
            onFocus={() => (editingRef.current = true)}
            onBlur={() => (editingRef.current = false)}
            placeholder="0.00"
            placeholderTextColor={"rgba(255,255,255,0.35)"}
            keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
            style={{
              marginTop: 8,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              color: T.text,
              backgroundColor: T.glass2,
              fontWeight: "800",
            }}
          />

          <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Priority Fee</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label="None" variant={priorityTier === "none" ? "blue" : "outline"} onPress={() => setPriorityTier("none")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Small" variant={priorityTier === "small" ? "blue" : "outline"} onPress={() => setPriorityTier("small")} />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Medium" variant={priorityTier === "medium" ? "blue" : "outline"} onPress={() => setPriorityTier("medium")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button T={T} label="Large" variant={priorityTier === "large" ? "blue" : "outline"} onPress={() => setPriorityTier("large")} />
            </View>
          </View>

          <View style={{ height: 12 }} />

          <Button
            T={T}
            label={sendBusy ? "Sending…" : "Send"}
            variant="green"
            disabled={sendBusy}
            onPress={openSendConfirm}
          />

          <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
            Min gas: {fmt8(minGasFee)} • Selected gas: {gasFeeText} • Service fee rate: {serviceFeeRate}
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
            Staked: {fmt8(stakedBalance)}
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

                const direction =
                  w && from === w ? "Sent" : w && to === w ? "Received" : String(tx?.type || "Tx");

                const amt = Number(tx?.amount || 0);
                const signedAmount = direction === "Sent" ? -amt : direction === "Received" ? amt : amt;

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
                    <Text style={{ color: T.text, fontWeight: "900" }}>
                      {direction} • {status}
                    </Text>

                    <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
                      From: {shortAddr(String(tx?.from || ""))}
                    </Text>
                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      To: {shortAddr(String(tx?.to || ""))}
                    </Text>
                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      Amount: {signedAmount}
                    </Text>
                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      Nonce: {String(tx?.nonce ?? "—")}
                    </Text>
                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      Block: {String(tx?.blockHeight ?? tx?.height ?? "—")}
                    </Text>
                    <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                      Time: {formatTxTime(tx?.timestamp ?? tx?.timeMs ?? tx?.time)}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        const id = String(tx?.id || "");
                        if (!id) return;
                        try {
                          await Clipboard.setStringAsync(id);
                          showToast("TxID copied");
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
            <View style={{ padding: 14, maxHeight: 640 }}>
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
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: T.sub, fontWeight: "800" }}>APR: {stakingApr ? `${(stakingApr * 100).toFixed(2)}%` : "—"}</Text>

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
                    onPress={handleStake}
                  />
                </View>
              )}

              {stakingTab === "unstake" && (
                <View style={{ marginTop: 12, flex: 1 }}>
                  <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 16 }}>
                    {stakingPositions.length === 0 ? (
                      <Text style={{ color: T.sub, fontWeight: "800" }}>No staking positions.</Text>
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
                          <Text style={{ color: T.text, fontWeight: "900" }}>Amount: {fmt8(Number(p.amount || 0))}</Text>
                          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Lock: {p.lockDays} days</Text>
                          <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Status: {p.status}</Text>
                          <View style={{ height: 10 }} />
                          <Button
                            T={T}
                            label={unstakeBusyId === String(p.id) ? "Working..." : "Unstake (Unlock)"}
                            variant={unstakeBusyId === String(p.id) ? "outline" : "purple"}
                            onPress={() => handleUnstake(String(p.id))}
                            disabled={!!unstakeBusyId}
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
  <Overlay onClose={() => setQrScanOpen(false)}>
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
                  // allow retry
                  scanLockRef.current = false;
                  showToast("QR doesn't contain an HNY address", "warn");
                  return;
                }
                scanLockRef.current = true;
                setToText(sanitizeAddress(addr));
                showToast("Recipient set from QR");
                setQrScanOpen(false);
                setTimeout(() => {
                  scanLockRef.current = false;
                }, 800);
              }}
              onBarcodeScanned={(ev: any) => {
                // compatibility
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
                showToast("Recipient set from QR");
                setQrScanOpen(false);
                setTimeout(() => {
                  scanLockRef.current = false;
                }, 800);
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

              <View style={{ height: 14 }} />
              <Button T={T} label="Close" variant="outline" onPress={closeAllModals} />
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
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}
