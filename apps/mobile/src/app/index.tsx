// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ImageBackground,
  StyleSheet,
} from "react-native";

import {
  ensureWalletId,
  getBalance,
  getTransactions,
  getChainStatus,
  quoteSend,
  mint,
  send,
  computeServiceFee,
  rbfReplacePending,
  cancelPending,
  ONE_SAT,
  fmt8,
  type TxLike,
} from "../chain/transactions";

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

// ---------- THEME ----------
type ThemeKey = "cosmic" | "noir" | "honey";

function themeFor(t: ThemeKey) {
  if (t === "noir") {
    return {
      text: "#f5f5f5",
      sub: "rgba(255,255,255,0.65)",
      purple: "#5e2bff",
      gold: "#caa83c",
      green: "#39ff14",
      blue: "#1f78ff",
      border: "rgba(255,255,255,0.10)",
      card: "rgba(0,0,0,0.55)",
      glassTop: "rgba(255,255,255,0.06)",
      glassBottom: "rgba(0,0,0,0.35)",
      danger: "rgba(255,90,90,0.95)",
    };
  }
  if (t === "honey") {
    return {
      text: "#fff5db",
      sub: "rgba(255,245,219,0.70)",
      purple: "#5b2cff",
      gold: "#ffbf2f",
      green: "#39ff14",
      blue: "#2b7cff",
      border: "rgba(255,255,255,0.12)",
      card: "rgba(16,6,25,0.55)",
      glassTop: "rgba(255,255,255,0.07)",
      glassBottom: "rgba(0,0,0,0.30)",
      danger: "rgba(255,90,90,0.95)",
    };
  }
  return {
    text: "#ffffff",
    sub: "rgba(255,255,255,0.70)",
    purple: "#7b2cff",
    gold: "#caa83c",
    green: "#39ff14",
    blue: "#2b7cff",
    border: "rgba(255,255,255,0.10)",
    card: "rgba(0,0,0,0.40)",
    glassTop: "rgba(255,255,255,0.06)",
    glassBottom: "rgba(0,0,0,0.28)",
    danger: "rgba(255,90,90,0.95)",
  };
}

function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}
function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}

type SkinKey = "matrix" | "solid-black";

function GlassCard(props: { children: React.ReactNode; style?: any; neon?: boolean }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
      : null;

  return (
    <View
      style={[
        {
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: props.neon ? "rgba(57,255,20,0.28)" : "rgba(255,255,255,0.10)",
          backgroundColor: "rgba(0,0,0,0.40)",
        },
        webBlur,
        props.style,
      ]}
    >
      {/* subtle top highlight (glass 2.0) */}
      <View style={{ height: 2, backgroundColor: "rgba(255,255,255,0.12)" }} />
      {props.children}
    </View>
  );
}

function Row(props: { label: string; value: string; strong?: boolean; T: any }) {
  const color = props.strong ? props.T.text : props.T.sub;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
      <Text style={{ color, fontWeight: props.strong ? "900" : "700" }}>{props.label}</Text>
      <Text style={{ color, fontWeight: props.strong ? "900" : "700" }}>{props.value}</Text>
    </View>
  );
}

export default function Index() {
  // theme/skin/settings
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [skin, setSkin] = useState<SkinKey>("matrix");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // chain/wallet
  const [wallet, setWallet] = useState("");
  const [chainId, setChainId] = useState("");
  const [chainHeight, setChainHeight] = useState(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState(0);
  const [serviceFeeRate, setServiceFeeRate] = useState(0);

  // balances
  const [confirmedBalance, setConfirmedBalance] = useState(0);
  const [spendableBalance, setSpendableBalance] = useState(0);

  // tx list
  const [txs, setTxs] = useState<TxLike[]>([]);

  // UI state
  const [message, setMessage] = useState("");
  const [cooldownText, setCooldownText] = useState("");

  // send form
  const [to, setTo] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  // mint
  const [mintBusy, setMintBusy] = useState(false);
  const [mintCooldown, setMintCooldown] = useState(0);

  // confirm send modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  type GasPreset = "slow" | "normal" | "fast" | "custom";
  const [gasPreset, setGasPreset] = useState<GasPreset>("normal");
  const [customGasStr, setCustomGasStr] = useState("");

  // send busy / submit animation
  const [sendBusy, setSendBusy] = useState(false);

  // RBF / Cancel
  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);
  const [rbfMult, setRbfMult] = useState<number>(1.5);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);
  const [cancelMult, setCancelMult] = useState<number>(1.5);

  // pulsing header + send hex pulse
  const pulse = useRef(new Animated.Value(0)).current;
  const sendPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!sendBusy) {
      sendPulse.stopAnimation();
      sendPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sendPulse, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(sendPulse, { toValue: 0, duration: 600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sendBusy, sendPulse]);

  const headerGlow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const hexOpacity = sendPulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.55] });
  const hexScale = sendPulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.03] });

  function formatTime(ms: number) {
    if (!ms || ms <= 0) return "—";
    return `${Math.max(0, Math.floor(ms / 1000))}s`;
  }
  function shortAddr(a: string) {
    if (!a) return "";
    if (a.length <= 14) return a;
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
  }

  async function refreshStatus() {
    const st: any = await getChainStatus();
    setChainHeight(Number(st?.chainHeight ?? st?.height ?? 0));
    setMsUntilNextBlock(Number(st?.msUntilNextBlock || 0));
    setChainId(String(st?.chainId || ""));
    setFeeVaultBalance(Number(st?.feeVaultBalance ?? st?.feeVault ?? 0));
    setServiceFeeRate(Number(st?.serviceFeeRate ?? 0));
  }

  async function loadBalance() {
    if (!wallet) return;
    const b: any = await getBalance(wallet);
    // server returns { balance, spendableBalance }
    setConfirmedBalance(Number(b?.balance ?? 0));
    setSpendableBalance(Number(b?.spendableBalance ?? 0));
  }

  async function loadTxs() {
    if (!wallet) return;
    const list: any = await getTransactions(wallet);
    setTxs(Array.isArray(list) ? list : []);
  }

  async function refreshAll() {
    setMessage("");
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
      setMessage("Refreshed ✅");
    } catch (e: any) {
      setMessage(`Refresh failed: ${e?.message || "Unknown error"}`);
    }
  }

  // persist theme/skin per chain
  useEffect(() => {
    if (!chainId) return;
    kvSet(themeKeyForChain(chainId), theme).catch(() => {});
  }, [theme, chainId]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(skinKeyForChain(chainId), skin).catch(() => {});
  }, [skin, chainId]);

  useEffect(() => {
    (async () => {
      if (!chainId) return;
      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "honey") setTheme(savedTheme);

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix" || savedSkin === "solid-black") setSkin(savedSkin);
    })().catch(() => {});
  }, [chainId]);

  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet) return;
    loadBalance().catch(() => {});
    loadTxs().catch(() => {});
  }, [wallet]);

  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  useEffect(() => {
    const i = setInterval(() => refreshStatus().catch(() => {}), 2500);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const i = setInterval(() => {
      loadBalance().catch(() => {});
      loadTxs().catch(() => {});
    }, 4000);
    return () => clearInterval(i);
  }, [wallet]);

  // ---------- Actions ----------
  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await refreshAll();
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e?.cooldownSeconds || 60);
        setMintCooldown(cd);
        setMessage(`Mint cooldown active (${cd}s)`);
      } else setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
    } finally {
      setMintBusy(false);
    }
  }

  async function openSendConfirm() {
    setMessage("");
    if (!to || to.length < 8) return setMessage("Enter a recipient address.");
    if (!Number.isFinite(amount) || amount <= 0) return setMessage("Enter a valid amount.");
    try {
      const q = await quoteSend(to, amount);
      setQuote(q);
      setGasPreset("normal");
      setCustomGasStr("");
      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  function clampGas(g: number, minGas: number) {
    const x = Number(g);
    if (!Number.isFinite(x)) return minGas;
    return Math.max(minGas, Number(x.toFixed(8)));
  }

  const computedConfirmFees = useMemo(() => {
    if (!quote) return null;
    const minGas = Number(quote.minGasFee || quote.minGas || 0) || ONE_SAT;
    const baseGas = Number(quote.gasFee || 0);
    const serviceFee = Number(quote.serviceFee || 0);

    let gasFee = baseGas;
    if (gasPreset === "slow") gasFee = clampGas(baseGas * 0.8, minGas);
    if (gasPreset === "normal") gasFee = clampGas(baseGas * 1.0, minGas);
    if (gasPreset === "fast") gasFee = clampGas(baseGas * 1.5, minGas);
    if (gasPreset === "custom") gasFee = clampGas(Number(customGasStr || 0), minGas);

    const totalFee = Number((gasFee + serviceFee).toFixed(8));
    const totalCost = Number((Number(amount) + totalFee).toFixed(8));
    return { minGas, gasFee, serviceFee, totalFee, totalCost };
  }, [quote, gasPreset, customGasStr, amount]);

  async function handleSendSignedSubmit() {
    if (!computedConfirmFees) return;
    if (sendBusy) return;
    setSendBusy(true);
    setMessage("");
    try {
      const res = await send({
        to,
        amount,
        gasFee: computedConfirmFees.gasFee,
        serviceFee: computedConfirmFees.serviceFee,
      });
      setConfirmOpen(false);
      setMessage(res?.isReplacement ? "Send replaced a pending tx (RBF) ✅" : "Send submitted (pending) ✅");
      await refreshAll();
    } catch (e: any) {
      if (e?.status === 409) setMessage(`Nonce conflict (409). Expected: ${e?.expectedNonce ?? "?"}`);
      else setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  function isMyPendingSend(t: any) {
    return (
      t &&
      t.type === "send" &&
      t.status === "pending" &&
      wallet &&
      t.from === wallet &&
      t.nonce != null
    );
  }

  function openRbf(t: any) {
    setRbfTx(t);
    setRbfMult(1.5);
    setRbfOpen(true);
  }

  function openCancel(t: any) {
    setCancelTx(t);
    setCancelMult(1.5);
    setCancelOpen(true);
  }

  async function submitRbf() {
    if (!rbfTx) return;
    setSendBusy(true);
    setMessage("");
    try {
      const baseGas = Number(rbfTx.gasFee || ONE_SAT);
      const gasFee = clampGas(baseGas * rbfMult, ONE_SAT);
      const serviceFee = computeServiceFee(Number(rbfTx.amount || 0), serviceFeeRate);

      await rbfReplacePending({
        to: String(rbfTx.to),
        amount: Number(rbfTx.amount),
        nonce: Number(rbfTx.nonce),
        gasFee,
        serviceFee,
      });

      setRbfOpen(false);
      setMessage("Boost submitted ✅");
      await refreshAll();
    } catch (e: any) {
      if (e?.status === 409) setMessage(`RBF conflict (409). Expected: ${e?.expectedNonce ?? "?"}`);
      else setMessage(`RBF failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  async function submitCancel() {
    if (!cancelTx) return;
    setSendBusy(true);
    setMessage("");
    try {
      const baseGas = Number(cancelTx.gasFee || ONE_SAT);
      const gasFee = clampGas(baseGas * cancelMult, ONE_SAT);
      const serviceFee = computeServiceFee(0, serviceFeeRate);

      await cancelPending({
        nonce: Number(cancelTx.nonce),
        gasFee,
        serviceFee,
      });

      setCancelOpen(false);
      setMessage("Cancel submitted ✅");
      await refreshAll();
    } catch (e: any) {
      if (e?.status === 409) setMessage(`Cancel conflict (409). Expected: ${e?.expectedNonce ?? "?"}`);
      else setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintBusy) return "Minting…";
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return "Mint";
  }, [mintCooldown, mintBusy]);

  const estServiceFee = useMemo(() => computeServiceFee(amount, serviceFeeRate), [amount, serviceFeeRate]);

  // background (web vs native)
  const web = Platform.OS === "web";
  const bgResizeMode: any = web ? "cover" : "cover";
  const overlayOpacity = skin === "solid-black" ? 0.65 : web ? 0.55 : 0.35;

  const Background = skin === "solid-black" ? null : (
    <ImageBackground
      source={require("./assets/skins/matrix-honeycomb.png")}
      style={{ flex: 1 }}
      resizeMode={bgResizeMode}
      imageStyle={{ opacity: web ? 0.85 : 0.95 }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#050509" }}>
      {Background}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${overlayOpacity})` }]} />

      {/* Header */}
      <View style={{ paddingTop: 18 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
          <Animated.View style={{ flex: 1, opacity: headerGlow }}>
            <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
            <Text style={{ color: T.sub, marginTop: 2 }}>
              Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)}
            </Text>
          </Animated.View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(57,255,20,0.25)",
                backgroundColor: "rgba(0,0,0,0.35)",
              }}
            >
              <Text style={{ color: T.green, fontWeight: "900" }}>📜</Text>
            </Pressable>

            <Pressable
              onPress={() => setSettingsOpen(true)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: T.border,
                backgroundColor: "rgba(0,0,0,0.35)",
              }}
            >
              <Text style={{ color: T.text, fontWeight: "900" }}>⚙️</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          {/* Wallet */}
          <GlassCard neon style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 6 }}>Wallet</Text>
            <Text style={{ color: T.text, fontWeight: "900" }}>{shortAddr(wallet)}</Text>

            {message ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: "#ffd56a" }}>{message}</Text>
              </View>
            ) : null}

            {cooldownText ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: T.sub }}>{cooldownText}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={refreshAll} style={[styles.smallBtn, { borderColor: T.border }]}>
                <Text style={{ color: T.text, fontWeight: "900" }}>Refresh</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  loadBalance().catch(() => {});
                  setMessage("Balance refreshed ✅");
                }}
                style={[styles.smallBtn, { borderColor: "rgba(57,255,20,0.25)" }]}
              >
                <Text style={{ color: T.green, fontWeight: "900" }}>Get Balance</Text>
              </Pressable>
            </View>
          </GlassCard>

          <View style={{ height: 14 }} />

          {/* Balances */}
          <GlassCard style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 8 }}>Balances</Text>

            <Row label="Confirmed" value={fmt8(confirmedBalance)} strong T={T} />
            <Row label="Spendable" value={fmt8(spendableBalance)} strong T={T} />
            <Row label="Fee Vault" value={fmt8(feeVaultBalance)} T={T} />

            <View style={{ height: 12 }} />

            <Pressable
              onPress={handleMint}
              disabled={mintBusy || mintCooldown > 0}
              style={{
                paddingVertical: 12,
                borderRadius: 14,
                alignItems: "center",
                backgroundColor: T.purple,
                opacity: mintBusy || mintCooldown > 0 ? 0.5 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{mintLabel}</Text>
            </Pressable>
          </GlassCard>

          <View style={{ height: 14 }} />

          {/* Send */}
          <GlassCard style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 8 }}>Send</Text>

            <Text style={{ color: T.sub, marginBottom: 6 }}>To</Text>
            <TextInput value={to} onChangeText={setTo} placeholder="Recipient address" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input(T)} autoCapitalize="none" autoCorrect={false} />

            <View style={{ height: 10 }} />

            <Text style={{ color: T.sub, marginBottom: 6 }}>Amount</Text>
            <TextInput value={amountStr} onChangeText={setAmountStr} placeholder="0.0" placeholderTextColor="rgba(255,255,255,0.35)" keyboardType="decimal-pad" style={styles.input(T)} />

            <View style={{ height: 12 }} />

            <View style={{ position: "relative" }}>
              <Pressable
                onPress={openSendConfirm}
                disabled={sendBusy}
                style={{
                  paddingVertical: 12,
                  borderRadius: 14,
                  alignItems: "center",
                  backgroundColor: T.green,
                  opacity: sendBusy ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#041006", fontWeight: "900", fontSize: 16 }}>Send</Text>
              </Pressable>

              {/* Hex pulse overlay while sending */}
              {sendBusy ? (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    borderRadius: 14,
                    opacity: hexOpacity,
                    transform: [{ scale: hexScale }],
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#0bff3a", fontSize: 34, fontWeight: "900" }}>⬡⬡⬡</Text>
                </Animated.View>
              ) : null}
            </View>

            <Text style={{ color: T.sub, marginTop: 10 }}>
              Service fee (est): {fmt8(estServiceFee)} • Rate: {serviceFeeRate || 0}
            </Text>
          </GlassCard>

          <View style={{ height: 14 }} />

          {/* Transactions inline list */}
          <GlassCard style={{ padding: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: T.sub, marginBottom: 8 }}>Recent Transactions</Text>
              <Pressable onPress={() => setHistoryOpen(true)} style={[styles.pillBtn, { borderColor: "rgba(57,255,20,0.25)" }]}>
                <Text style={{ color: T.green, fontWeight: "900" }}>Transaction History</Text>
              </Pressable>
            </View>

            {txs.length === 0 ? (
              <Text style={{ color: T.sub }}>No transactions yet.</Text>
            ) : (
              txs.slice(0, 6).map((t: any, idx: number) => {
                const pending = t?.status === "pending";
                const isMinePending = isMyPendingSend(t);

                return (
                  <View
                    key={`${t?.id || idx}`}
                    style={{
                      paddingVertical: 10,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: T.text, fontWeight: "900" }}>
                        {t?.type === "mint" ? "Mint" : "Send"}{" "}
                        <Text style={{ color: pending ? "#ffd56a" : T.sub }}>
                          {pending ? "(pending)" : "(confirmed)"}
                        </Text>
                      </Text>
                      <Text style={{ color: T.sub }}>{fmt8(Number(t?.amount || 0))}</Text>
                    </View>

                    {t?.type === "send" ? (
                      <Text style={{ color: T.sub, marginTop: 4 }}>
                        To: {shortAddr(String(t?.to || ""))} • Nonce: {String(t?.nonce ?? "—")}
                      </Text>
                    ) : (
                      <Text style={{ color: T.sub, marginTop: 4 }}>Nonce: {String(t?.nonce ?? "—")}</Text>
                    )}

                    {isMinePending ? (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                        <Pressable onPress={() => openRbf(t)} disabled={sendBusy} style={[styles.actionBtn, { backgroundColor: T.blue, opacity: sendBusy ? 0.6 : 1 }]}>
                          <Text style={{ color: "#fff", fontWeight: "900" }}>⚡ Boost</Text>
                        </Pressable>
                        <Pressable onPress={() => openCancel(t)} disabled={sendBusy} style={[styles.actionBtn, { backgroundColor: T.danger, opacity: sendBusy ? 0.6 : 1 }]}>
                          <Text style={{ color: "#fff", fontWeight: "900" }}>✖ Cancel</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </GlassCard>
        </ScrollView>
      </View>

      {/* ---- Send Confirm Modal ---- */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalWrap}>
          <GlassCard neon style={{ width: "100%" }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Confirm Transaction</Text>

              <Text style={{ color: T.sub }}>To: {to}</Text>
              <Text style={{ color: T.sub }}>Amount: {amount}</Text>

              <View style={{ height: 10 }} />

              {computedConfirmFees ? (
                <>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Fees</Text>
                  <Text style={{ color: T.sub }}>Min gas: {fmt8(computedConfirmFees.minGas)}</Text>
                  <Text style={{ color: T.sub }}>Gas: {fmt8(computedConfirmFees.gasFee)}</Text>
                  <Text style={{ color: T.sub }}>Service: {fmt8(computedConfirmFees.serviceFee)}</Text>
                  <Text style={{ color: T.sub }}>Total fee: {fmt8(computedConfirmFees.totalFee)}</Text>
                  <Text style={{ color: T.text, fontWeight: "900", marginTop: 8 }}>Total cost: {fmt8(computedConfirmFees.totalCost)}</Text>
                </>
              ) : (
                <Text style={{ color: T.sub }}>Loading quote…</Text>
              )}

              <View style={{ height: 12 }} />
              <Text style={{ color: T.text, fontWeight: "900" }}>Gas speed</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {[
                  { k: "slow" as const, label: "Slow" },
                  { k: "normal" as const, label: "Normal" },
                  { k: "fast" as const, label: "Fast" },
                  { k: "custom" as const, label: "Custom" },
                ].map((b) => (
                  <Pressable
                    key={b.k}
                    onPress={() => setGasPreset(b.k)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: gasPreset === b.k ? "rgba(57,255,20,0.35)" : "rgba(255,255,255,0.14)",
                      backgroundColor: gasPreset === b.k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>

              {gasPreset === "custom" && computedConfirmFees ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: T.sub, marginBottom: 6 }}>Custom gas (min {fmt8(computedConfirmFees.minGas)})</Text>
                  <TextInput
                    value={customGasStr}
                    onChangeText={setCustomGasStr}
                    placeholder={`${fmt8(computedConfirmFees.minGas)}`}
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    keyboardType="decimal-pad"
                    style={styles.input(T)}
                  />
                </View>
              ) : null}

              <View style={{ height: 14 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setConfirmOpen(false)} disabled={sendBusy} style={[styles.modalBtn, { borderColor: T.border }]}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Back</Text>
                </Pressable>

                <Pressable onPress={handleSendSignedSubmit} disabled={sendBusy || !computedConfirmFees} style={[styles.modalBtn, { backgroundColor: T.green, borderColor: "transparent", opacity: sendBusy || !computedConfirmFees ? 0.6 : 1 }]}>
                  <Text style={{ color: "#041006", fontWeight: "900" }}>{sendBusy ? "Sending…" : "Confirm"}</Text>
                </Pressable>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---- RBF Modal ---- */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={styles.modalWrap}>
          <GlassCard neon style={{ width: "100%" }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Boost Pending Tx</Text>

              {rbfTx ? (
                <>
                  <Text style={{ color: T.sub }}>To: {String(rbfTx.to)}</Text>
                  <Text style={{ color: T.sub }}>Amount: {Number(rbfTx.amount)}</Text>
                  <Text style={{ color: T.sub }}>Nonce: {rbfTx.nonce}</Text>
                </>
              ) : null}

              <View style={{ height: 12 }} />
              <Text style={{ color: T.text, fontWeight: "900" }}>Choose bump</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {[1.25, 1.5, 2.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => setRbfMult(m)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: rbfMult === m ? "rgba(57,255,20,0.45)" : "rgba(255,255,255,0.14)",
                      backgroundColor: rbfMult === m ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setRbfOpen(false)} disabled={sendBusy} style={[styles.modalBtn, { borderColor: T.border }]}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Back</Text>
                </Pressable>

                <Pressable onPress={submitRbf} disabled={sendBusy} style={[styles.modalBtn, { backgroundColor: T.blue, borderColor: "transparent", opacity: sendBusy ? 0.6 : 1 }]}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Submit Boost"}</Text>
                </Pressable>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---- Cancel Modal ---- */}
      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={styles.modalWrap}>
          <GlassCard neon style={{ width: "100%" }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Cancel Pending Tx</Text>

              {cancelTx ? (
                <>
                  <Text style={{ color: T.sub }}>Nonce: {cancelTx.nonce}</Text>
                  <Text style={{ color: T.sub }}>Current gas: {fmt8(Number(cancelTx.gasFee || 0))}</Text>
                </>
              ) : null}

              <View style={{ height: 12 }} />
              <Text style={{ color: T.text, fontWeight: "900" }}>Choose bump</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {[1.25, 1.5, 2.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => setCancelMult(m)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: cancelMult === m ? "rgba(57,255,20,0.45)" : "rgba(255,255,255,0.14)",
                      backgroundColor: cancelMult === m ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={() => setCancelOpen(false)} disabled={sendBusy} style={[styles.modalBtn, { borderColor: T.border }]}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Back</Text>
                </Pressable>

                <Pressable onPress={submitCancel} disabled={sendBusy} style={[styles.modalBtn, { backgroundColor: T.danger, borderColor: "transparent", opacity: sendBusy ? 0.6 : 1 }]}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Submit Cancel"}</Text>
                </Pressable>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---- History Modal ---- */}
      <Modal transparent visible={historyOpen} animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalWrap}>
          <GlassCard neon style={{ width: "100%", maxHeight: "80%" }}>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900" }}>Transaction History</Text>
                <Pressable onPress={() => loadTxs().catch(() => {})} style={[styles.pillBtn, { borderColor: "rgba(57,255,20,0.25)" }]}>
                  <Text style={{ color: T.green, fontWeight: "900" }}>Refresh</Text>
                </Pressable>
              </View>

              <View style={{ height: 10 }} />

              <ScrollView>
                {txs.length === 0 ? (
                  <Text style={{ color: T.sub }}>No transactions yet.</Text>
                ) : (
                  txs.map((t: any, idx: number) => {
                    const pending = t?.status === "pending";
                    return (
                      <View
                        key={`${t?.id || idx}`}
                        style={{
                          paddingVertical: 10,
                          borderTopWidth: idx === 0 ? 0 : 1,
                          borderTopColor: "rgba(255,255,255,0.08)",
                        }}
                      >
                        <Text style={{ color: T.text, fontWeight: "900" }}>
                          {t?.type === "mint" ? "Mint" : "Send"}{" "}
                          <Text style={{ color: pending ? "#ffd56a" : T.sub }}>
                            {pending ? "(pending)" : "(confirmed)"}
                          </Text>
                        </Text>
                        <Text style={{ color: T.sub, marginTop: 4 }}>
                          Amount: {fmt8(Number(t?.amount || 0))} • Nonce: {String(t?.nonce ?? "—")}
                        </Text>
                        {t?.type === "send" ? <Text style={{ color: T.sub }}>To: {String(t?.to || "")}</Text> : null}
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <View style={{ height: 14 }} />
              <Pressable onPress={() => setHistoryOpen(false)} style={[styles.modalBtn, { borderColor: T.border }]}>
                <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---- Settings Modal ---- */}
      <Modal transparent visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalWrap}>
          <GlassCard neon style={{ width: "100%" }}>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Settings</Text>

              <Text style={{ color: T.sub, marginBottom: 10 }}>Theme</Text>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                {(["cosmic", "noir", "honey"] as ThemeKey[]).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setTheme(k)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme === k ? "rgba(57,255,20,0.45)" : "rgba(255,255,255,0.14)",
                      backgroundColor: theme === k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <Text style={{ color: T.sub, marginBottom: 10 }}>Background</Text>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                {([
                  { k: "matrix" as const, label: "Matrix Honeycomb" },
                  { k: "solid-black" as const, label: "Solid Black" },
                ] as const).map((b) => (
                  <Pressable
                    key={b.k}
                    onPress={() => setSkin(b.k)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: skin === b.k ? "rgba(57,255,20,0.45)" : "rgba(255,255,255,0.14)",
                      backgroundColor: skin === b.k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />
              <Pressable onPress={() => setSettingsOpen(false)} style={[styles.modalBtn, { borderColor: T.border }]}>
                <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  input: (T: any) =>
    ({
      color: T.text,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(57,255,20,0.20)",
      backgroundColor: "rgba(0,0,0,0.35)",
    } as any),

  modalWrap: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
  } as any,

  smallBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  } as any,

  pillBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  } as any,

  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
  } as any,

  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  } as any,
};
