// apps/mobile/src/app/index.tsx
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
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
  type Transaction as TxLike,
} from "../chain/transactions";

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
   Theme + skin
====================== */
type ThemeKey = "noir" | "honey" | "matrix";
type SkinKey = "matrix-honeycomb" | "solid-noir";

function themeFor(t: ThemeKey) {
  const neon = "#39ff14";
  if (t === "noir") {
    return {
      text: "#f6f6f6",
      sub: "rgba(255,255,255,0.70)",
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
      border: "rgba(255,191,47,0.20)",
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
    sub: "rgba(255,255,255,0.70)",
    border: "rgba(57,255,20,0.18)",
    glass: "rgba(0,0,0,0.45)",
    glass2: "rgba(0,0,0,0.30)",
    purple: "#7b2cff",
    gold: "#caa83c",
    green: neon,
    danger: "rgba(255,90,90,0.96)",
    blue: "#2b7cff",
    bg: "#040507",
  };
}

function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}
function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}

/* ======================
   UI helpers
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

function shortAddr(a: string) {
  if (!a) return "";
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
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
    >
      <Pressable onPress={props.onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ width: "100%", maxWidth: 900 }}>{props.children}</View>
    </View>
  );
}

export default function Index() {
  /* ============
     Core state
  ============ */
  const [theme, setTheme] = useState<ThemeKey>("matrix");
  const [skin, setSkin] = useState<SkinKey>("matrix-honeycomb");

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
  const [mintBusy, setMintBusy] = useState(false);
  const [mintCooldown, setMintCooldown] = useState(0);

  // ✅ Uncontrolled input refs (fixes typing on web + iOS)
  const toRef = useRef("");
  const amountRef = useRef("");

  // Priority fee speed (gas)
  type SpeedKey = "slow" | "normal" | "fast";
  const [speed, setSpeed] = useState<SpeedKey>("normal");

  function feeMultiplier(s: SpeedKey) {
    if (s === "slow") return 1.0;
    if (s === "normal") return 1.25;
    return 1.6; // fast
  }

  function computeChosenGas(minGas: number) {
    return Number((minGas * feeMultiplier(speed)).toFixed(8));
  }

  // Tip presets + custom tip
  type TipKey = "none" | "small" | "medium" | "large" | "custom";
  const [tipMode, setTipMode] = useState<TipKey>("none");
  const customTipRef = useRef("");

  // Confirm + history + settings
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [sendBusy, setSendBusy] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Boost / cancel
  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);

  // Pause polling while modals open (prevents UI churn during confirm/edit)
  const pausePollingRef = useRef(false);

  const T = themeFor(theme);

  const matrixBg = useMemo(() => require("./assets/skins/matrix-honeycomb.png"), []);
  const bgSource = skin === "matrix-honeycomb" ? matrixBg : null;
  const bgOverlayOpacity = Platform.OS === "web" ? 0.55 : 0.32;

  // Send glow pulse (web-safe)
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const useNativeDriver = Platform.OS !== "web";
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sendGlowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.45] });
  const sendGlowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  function Card(props: { children: React.ReactNode; style?: any }) {
    return (
      <GlassCard style={[{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }, props.style]}>
        <View style={{ padding: 14 }}>{props.children}</View>
      </GlassCard>
    );
  }

  function Button(props: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    variant?: "green" | "purple" | "outline" | "danger" | "blue";
  }) {
    const v = props.variant || "green";
    const bg =
      v === "green" ? T.green : v === "purple" ? T.purple : v === "danger" ? T.danger : v === "blue" ? T.blue : "transparent";
    const fg = v === "green" ? "#041006" : v === "outline" ? T.text : "#fff";
    const border = v === "outline" ? T.border : "transparent";

    return (
      <Pressable
        onPress={props.onPress}
        disabled={props.disabled}
        style={{
          paddingVertical: 12,
          borderRadius: 12,
          alignItems: "center",
          backgroundColor: bg,
          borderWidth: v === "outline" ? 1 : 0,
          borderColor: border,
          opacity: props.disabled ? 0.55 : 1,
        }}
      >
        <Text style={{ color: fg, fontWeight: "900", fontSize: 16 }}>{props.label}</Text>
      </Pressable>
    );
  }

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
    setMinGasFee(Number(st?.minGasFee || ONE_SAT));
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

  async function hardRefreshAll() {
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
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
      try {
        await refreshStatus();
        await loadBalance();
        await loadTxs();
        setLastRefresh(Date.now());
      } catch (e: any) {
        setMessage(`Live refresh failed: ${e?.message || "Unknown error"}`);
      }
    }, 2500);

    return () => clearInterval(i);
  }, [wallet, liveRefresh]);

  // Mint cooldown
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  /* ======================
     Persist prefs per chain
  ====================== */
  useEffect(() => {
    (async () => {
      if (!chainId) return;

      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "matrix" || savedTheme === "noir" || savedTheme === "honey") setTheme(savedTheme as ThemeKey);

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix-honeycomb" || savedSkin === "solid-noir") setSkin(savedSkin as SkinKey);
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
  async function handleMint() {
    if (mintBusy) return;
    if (mintCooldown > 0) {
      setMessage(`Mint cooldown active (${mintCooldown}s)`);
      return;
    }
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted ✅");
      await hardRefreshAll();
      setMintCooldown(Number(res?.cooldownSeconds || 60));
    } catch (e: any) {
      if (e?.status === 429) {
        setMintCooldown(Number(e.cooldownSeconds || 60));
        setMessage(`Mint cooldown active (${Number(e.cooldownSeconds || 60)}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setMintBusy(false);
    }
  }

  function computeTipAmount(): number {
    if (tipMode === "none") return 0;
    if (tipMode === "small") return ONE_SAT; // 0.00000001
    if (tipMode === "medium") return Number((ONE_SAT * 10).toFixed(8)); // 0.00000010
    if (tipMode === "large") return Number((ONE_SAT * 100).toFixed(8)); // 0.00000100

    // custom
    const ct = Number(customTipRef.current || 0);
    if (!Number.isFinite(ct) || ct <= 0) return 0;
    return Number(ct.toFixed(8));
  }

  async function openSendConfirm() {
    setMessage("");

    const to = String(toRef.current || "").trim();
    const baseAmt = Number(amountRef.current || 0);

    if (!to || to.length < 8) return setMessage("Enter a recipient address.");
    if (!Number.isFinite(baseAmt) || baseAmt <= 0) return setMessage("Enter a valid amount.");

    const tipAmt = computeTipAmount();
    const totalAmt = Number((baseAmt + tipAmt).toFixed(8));

    try {
      pausePollingRef.current = true;

      const q = await quoteSend(to, totalAmt);
      const minGas = Number(q?.minGasFee ?? q?.gasFee ?? minGasFee ?? ONE_SAT);
      const chosenGas = computeChosenGas(minGas);

      const serviceFee = computeServiceFee(totalAmt, serviceFeeRate);
      const totalFee = Number((chosenGas + serviceFee).toFixed(8));
      const totalCost = Number((totalAmt + totalFee).toFixed(8));

      setQuote({
        ...q,
        to,
        baseAmt,
        tipAmt,
        totalAmt,
        chosenGas,
        serviceFee,
        totalFee,
        totalCost,
        speed,
      });

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
      await send({
        to: String(quote.to),
        amount: Number(quote.totalAmt),
        gasFee: Number(quote.chosenGas),
        serviceFee: Number(quote.serviceFee),
      });

      setConfirmOpen(false);
      pausePollingRef.current = false;
      setMessage("Send submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  async function doRbf(multiplier: number) {
    if (!rbfTx) return;
    setSendBusy(true);
    setMessage("");

    try {
      const baseGas = Number(rbfTx.gasFee || minGasFee || ONE_SAT);
      const gasFee = Math.max(minGasFee || ONE_SAT, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(Number(rbfTx.amount || 0), serviceFeeRate);

      await rbfReplacePending({
        to: String(rbfTx.to),
        amount: Number(rbfTx.amount),
        gasFee,
        serviceFee: svc,
      });

      setRbfOpen(false);
      pausePollingRef.current = false;
      setMessage("Boost submitted (RBF) ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`RBF failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  async function doCancel(multiplier: number) {
    if (!cancelTx) return;
    setSendBusy(true);
    setMessage("");

    try {
      const baseGas = Number(cancelTx.gasFee || minGasFee || ONE_SAT);
      const gasFee = Math.max(minGasFee || ONE_SAT, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(ONE_SAT, serviceFeeRate);

      await cancelPending({ gasFee, serviceFee: svc });

      setCancelOpen(false);
      pausePollingRef.current = false;
      setMessage("Cancel submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintBusy) return "Minting…";
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return "Mint";
  }, [mintCooldown, mintBusy]);

  const pendingTxs = useMemo(() => (txs || []).filter((t: any) => String(t?.status || "") === "pending"), [txs]);

  /* ======================
     Screen content
  ====================== */
  const content = (
    <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
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
        <Card style={{ marginTop: 12 }}>
          <Text style={{ color: T.text, fontWeight: "900" }}>{message}</Text>
        </Card>
      )}

      {/* Wallet + balances */}
      <Card style={{ marginTop: 12 }}>
        <Text style={{ color: T.sub, fontWeight: "800" }}>Wallet</Text>
        <Text style={{ color: T.text, fontSize: 16, fontWeight: "900", marginTop: 4 }}>{wallet ? shortAddr(wallet) : "Loading…"}</Text>

        <View style={{ height: 12 }} />

        <Text style={{ color: T.sub, fontWeight: "800" }}>Balances</Text>
        <Text style={{ color: T.text, fontWeight: "900", marginTop: 6 }}>Confirmed: {confirmedBalance}</Text>
        <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Spendable: {spendableBalance}</Text>
        <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Pending Δ: {pendingDelta}</Text>
        <Text style={{ color: T.text, fontWeight: "900", marginTop: 4 }}>Fee Vault: {feeVaultBalance}</Text>

        <View style={{ height: 14 }} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Refresh" variant="outline" onPress={hardRefreshAll} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={mintLabel} variant="purple" disabled={mintBusy || mintCooldown > 0} onPress={handleMint} />
          </View>
        </View>

        <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
          Last refresh: {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : "—"}
        </Text>
      </Card>

      {/* Send */}
      <Card style={{ marginTop: 12 }}>
        <Text style={{ color: T.text, fontSize: 18, fontWeight: "900" }}>Send</Text>

        <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>Recipient</Text>
        <TextInput
          defaultValue=""
          onChangeText={(t) => (toRef.current = t)}
          placeholder="Recipient address"
          placeholderTextColor={"rgba(255,255,255,0.35)"}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
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

        <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Amount</Text>
        <TextInput
          defaultValue=""
          onChangeText={(t) => (amountRef.current = t)}
          placeholder="0"
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

        {/* Tip presets */}
        <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Tip (optional)</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="0" variant={tipMode === "none" ? "blue" : "outline"} onPress={() => setTipMode("none")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Small" variant={tipMode === "small" ? "blue" : "outline"} onPress={() => setTipMode("small")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Medium" variant={tipMode === "medium" ? "blue" : "outline"} onPress={() => setTipMode("medium")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Large" variant={tipMode === "large" ? "blue" : "outline"} onPress={() => setTipMode("large")} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Custom Tip" variant={tipMode === "custom" ? "purple" : "outline"} onPress={() => setTipMode("custom")} />
          </View>
        </View>

        {tipMode === "custom" && (
          <>
            <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Custom Tip Amount</Text>
            <TextInput
              defaultValue=""
              onChangeText={(t) => (customTipRef.current = t)}
              placeholder="0"
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
          </>
        )}

        {/* Priority fee speed */}
        <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>Priority Fee</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Slow" variant={speed === "slow" ? "blue" : "outline"} onPress={() => setSpeed("slow")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Normal" variant={speed === "normal" ? "blue" : "outline"} onPress={() => setSpeed("normal")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Fast" variant={speed === "fast" ? "blue" : "outline"} onPress={() => setSpeed("fast")} />
          </View>
        </View>

        <View style={{ height: 14 }} />

        {/* Glow-backed Send */}
        <View style={{ position: "relative" as any }}>
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 12,
              opacity: sendGlowOpacity as any,
              transform: [{ scale: sendGlowScale as any }],
              backgroundColor: T.green,
              pointerEvents: "none",
            }}
          />
          <Button label={sendBusy ? "Sending…" : "Send"} variant="green" disabled={sendBusy} onPress={openSendConfirm} />
        </View>

        <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
          Min gas: {fmt8(minGasFee)} • Service fee rate: {serviceFeeRate}
        </Text>
      </Card>

      {/* Live tx list under send */}
      <Card style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Transactions</Text>
          <Button label={liveRefresh ? "Live: ON" : "Live: OFF"} variant={liveRefresh ? "blue" : "outline"} onPress={() => setLiveRefresh((v) => !v)} />
        </View>

        <View style={{ height: 12 }} />

        {txs.length === 0 ? (
          <Text style={{ color: T.sub, fontWeight: "800" }}>No transactions yet.</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {txs.slice(0, 12).map((tx: any, idx: number) => {
              const status = String(tx?.status || "unknown");
              const isPending = status === "pending";
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
                    {String(tx?.type || "tx").toUpperCase()} • {status}
                  </Text>
                  <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>To: {shortAddr(String(tx?.to || ""))}</Text>
                  <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Amount: {Number(tx?.amount || 0)}</Text>
                  <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                    Gas: {Number(tx?.gasFee || 0)} • Service: {Number(tx?.serviceFee || 0)}
                  </Text>

                  {isPending && (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
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

        {pendingTxs.length > 0 && (
          <Text style={{ color: T.sub, marginTop: 12, fontWeight: "800" }}>
            Pending: {pendingTxs.length} (use Boost/Cancel on pending txs above)
          </Text>
        )}
      </Card>
    </ScrollView>
  );

  /* ======================
     Render
  ====================== */
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg, minHeight: Platform.OS === "web" ? ("100vh" as any) : undefined }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {bgSource ? (
        <ImageBackground source={bgSource} resizeMode="cover" style={{ flex: 1 }}>
          {/* visual overlay must not intercept touches */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "black",
              opacity: bgOverlayOpacity,
              pointerEvents: "none",
            }}
          />
          {content}
        </ImageBackground>
      ) : (
        content
      )}

      {/* Confirm */}
      {confirmOpen && quote && (
        <Overlay
          onClose={() => {
            setConfirmOpen(false);
            pausePollingRef.current = false;
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Confirm Send</Text>
                <Pressable
                  onPress={() => {
                    setConfirmOpen(false);
                    pausePollingRef.current = false;
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>To: {shortAddr(String(quote.to || ""))}</Text>
              <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>
                Amount: {quote.baseAmt} • Tip: {quote.tipAmt} • Total sent: {quote.totalAmt}
              </Text>

              <View style={{ height: 12 }} />

              <Text style={{ color: T.sub, fontWeight: "800" }}>Priority: {String(quote.speed || "normal")}</Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Gas fee: {fmt8(Number(quote.chosenGas || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Service fee: {fmt8(Number(quote.serviceFee || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Total fee: {fmt8(Number(quote.totalFee || 0))}</Text>
              <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Total cost: {fmt8(Number(quote.totalCost || 0))}</Text>

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Back"
                    variant="outline"
                    onPress={() => {
                      setConfirmOpen(false);
                      pausePollingRef.current = false;
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label={sendBusy ? "Submitting…" : "Confirm"} variant="green" disabled={sendBusy} onPress={handleSendSubmit} />
                </View>
              </View>
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* RBF Boost modal */}
      {rbfOpen && rbfTx && (
        <Overlay
          onClose={() => {
            setRbfOpen(false);
            pausePollingRef.current = false;
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Boost Pending (RBF)</Text>
                <Pressable
                  onPress={() => {
                    setRbfOpen(false);
                    pausePollingRef.current = false;
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                Current gas: {fmt8(Number(rbfTx?.gasFee || 0))} • Min gas: {fmt8(minGasFee)}
              </Text>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button label="+10%" variant="outline" onPress={() => doRbf(1.1)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="+25%" variant="outline" onPress={() => doRbf(1.25)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="+50%" variant="outline" onPress={() => doRbf(1.5)} />
                </View>
              </View>

              <View style={{ height: 12 }} />
              <Button
                label="Close"
                variant="outline"
                onPress={() => {
                  setRbfOpen(false);
                  pausePollingRef.current = false;
                }}
              />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Cancel modal */}
      {cancelOpen && cancelTx && (
        <Overlay
          onClose={() => {
            setCancelOpen(false);
            pausePollingRef.current = false;
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Cancel Pending Tx</Text>
                <Pressable
                  onPress={() => {
                    setCancelOpen(false);
                    pausePollingRef.current = false;
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 10, fontWeight: "800" }}>
                Cancel uses a self-send with higher gas. Current gas: {fmt8(Number(cancelTx?.gasFee || 0))}
              </Text>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel w/+25%" variant="danger" onPress={() => doCancel(1.25)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel w/+50%" variant="danger" onPress={() => doCancel(1.5)} />
                </View>
              </View>

              <View style={{ height: 12 }} />
              <Button
                label="Close"
                variant="outline"
                onPress={() => {
                  setCancelOpen(false);
                  pausePollingRef.current = false;
                }}
              />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* History modal */}
      {historyOpen && (
        <Overlay
          onClose={() => {
            setHistoryOpen(false);
            pausePollingRef.current = false;
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Transaction History</Text>
                <Pressable
                  onPress={() => {
                    setHistoryOpen(false);
                    pausePollingRef.current = false;
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <View style={{ height: 12 }} />

              <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="always">
                {txs.length === 0 ? (
                  <Text style={{ color: T.sub, fontWeight: "800" }}>No transactions yet.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {txs.slice(0, 100).map((tx: any, idx: number) => (
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
                        <Text style={{ color: T.sub, marginTop: 6, fontWeight: "800" }}>To: {shortAddr(String(tx?.to || ""))}</Text>
                        <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>Amount: {Number(tx?.amount || 0)}</Text>
                        <Text style={{ color: T.sub, marginTop: 4, fontWeight: "800" }}>
                          Gas: {Number(tx?.gasFee || 0)} • Service: {Number(tx?.serviceFee || 0)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>

              <View style={{ height: 12 }} />
              <Button
                label="Close"
                variant="outline"
                onPress={() => {
                  setHistoryOpen(false);
                  pausePollingRef.current = false;
                }}
              />
            </View>
          </GlassCard>
        </Overlay>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <Overlay
          onClose={() => {
            setSettingsOpen(false);
            pausePollingRef.current = false;
          }}
        >
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 18, fontWeight: "900", flex: 1 }}>Settings</Text>
                <Pressable
                  onPress={() => {
                    setSettingsOpen(false);
                    pausePollingRef.current = false;
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <View style={{ height: 14 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>Theme</Text>
              <View style={{ height: 10 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Matrix" variant={theme === "matrix" ? "blue" : "outline"} onPress={() => setTheme("matrix")} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Noir" variant={theme === "noir" ? "blue" : "outline"} onPress={() => setTheme("noir")} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Honey" variant={theme === "honey" ? "blue" : "outline"} onPress={() => setTheme("honey")} />
                </View>
              </View>

              <View style={{ height: 14 }} />
              <Text style={{ color: T.sub, fontWeight: "800" }}>Skin</Text>
              <View style={{ height: 10 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Matrix Honeycomb"
                    variant={skin === "matrix-honeycomb" ? "purple" : "outline"}
                    onPress={() => setSkin("matrix-honeycomb")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Solid Noir"
                    variant={skin === "solid-noir" ? "purple" : "outline"}
                    onPress={() => setSkin("solid-noir")}
                  />
                </View>
              </View>

              <View style={{ height: 14 }} />
              <Button label="Hard Refresh Now" variant="outline" onPress={hardRefreshAll} />
              <View style={{ height: 12 }} />
              <Button
                label="Close"
                variant="outline"
                onPress={() => {
                  setSettingsOpen(false);
                  pausePollingRef.current = false;
                }}
              />
            </View>
          </GlassCard>
        </Overlay>
      )}
    </KeyboardAvoidingView>
  );
}
