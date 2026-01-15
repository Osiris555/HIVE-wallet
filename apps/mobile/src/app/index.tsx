// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

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

/** Local storage helpers (web/native) */
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

/** Glass card (no expo-blur). Uses backdrop blur on web. */
function GlassCard(props: { children: React.ReactNode; style?: any }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
      : null;

  return (
    <View
      style={[
        {
          borderRadius: 20,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(57,255,20,0.18)",
          backgroundColor: "rgba(0,0,0,0.48)",
          shadowColor: "#39ff14",
          shadowOpacity: 0.12,
          shadowRadius: 18,
        },
        webBlur,
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

// ---------- THEME ----------
type ThemeKey = "cosmic" | "noir" | "honey";
function themeFor(t: ThemeKey) {
  if (t === "noir") {
    return {
      text: "#f5f5f5",
      sub: "#a9a9a9",
      purple: "#6a2cff",
      gold: "#caa83c",
      green: "#39ff14",
      blue: "#2b7cff",
      border: "rgba(57,255,20,0.18)",
      card: "rgba(0,0,0,0.55)",
      soft: "rgba(0,0,0,0.35)",
    };
  }
  if (t === "honey") {
    return {
      text: "#fff5db",
      sub: "#d7c59a",
      purple: "#6a2cff",
      gold: "#ffbf2f",
      green: "#39ff14",
      blue: "#2b7cff",
      border: "rgba(57,255,20,0.18)",
      card: "rgba(16,6,25,0.55)",
      soft: "rgba(0,0,0,0.35)",
    };
  }
  return {
    text: "#ffffff",
    sub: "#bcb4d6",
    purple: "#6a2cff",
    gold: "#caa83c",
    green: "#39ff14",
    blue: "#2b7cff",
    border: "rgba(57,255,20,0.18)",
    card: "rgba(0,0,0,0.42)",
    soft: "rgba(0,0,0,0.32)",
  };
}

// ---------- BACKGROUNDS / SKINS ----------
type SkinKey = "matrix" | "solid-black";
function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}
function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}

export default function Index() {
  // theme / settings
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // network identity
  const [chainId, setChainId] = useState<string>("");
  const [skin, setSkin] = useState<SkinKey>("matrix");
  const [prefsLoadedForChain, setPrefsLoadedForChain] = useState<string>("");

  // main state
  const [wallet, setWallet] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  // chain status
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  // balances
  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);

  // send form
  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  // mint state
  const [mintBusy, setMintBusy] = useState<boolean>(false);
  const [mintCooldown, setMintCooldown] = useState<number>(0);

  // tx list
  const [txs, setTxs] = useState<TxLike[]>([]);

  // transaction confirmation modal
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);

  // history screen (modal)
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  // gas preset
  type GasPreset = "slow" | "normal" | "fast" | "custom";
  const [gasPreset, setGasPreset] = useState<GasPreset>("normal");
  const [customGasStr, setCustomGasStr] = useState<string>("");

  // send busy
  const [sendBusy, setSendBusy] = useState<boolean>(false);

  // RBF / Cancel
  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);
  const [rbfMult, setRbfMult] = useState<number>(1.25);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);
  const [cancelMult, setCancelMult] = useState<number>(1.5);

  // neon pulse animation (used for the Send button glow)
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sendGlow = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  // ---------- persistence per chain ----------
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
      if (prefsLoadedForChain === chainId) return;

      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "honey") setTheme(savedTheme);

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix" || savedSkin === "solid-black") setSkin(savedSkin);

      setPrefsLoadedForChain(chainId);
    })().catch(() => {});
  }, [chainId, prefsLoadedForChain]);

  // ---------- data loading ----------
  async function refreshStatus() {
    const st = await getChainStatus();
    setChainHeight(Number(st?.chainHeight ?? st?.height ?? 0));
    setMsUntilNextBlock(Number(st?.msUntilNextBlock || 0));
    setChainId(String(st?.chainId || ""));
  }

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
  }

  async function loadBalance() {
    if (!wallet) return;
    const b = await getBalance(wallet);
    setConfirmedBalance(Number(b?.confirmed || 0));
    setSpendableBalance(Number(b?.spendable || 0));
    setFeeVaultBalance(Number(b?.feeVault || 0));
  }

  async function loadTxs() {
    if (!wallet) return;
    const list = await getTransactions(wallet);
    setTxs(Array.isArray(list) ? list : []);
  }

  async function fullRefresh() {
    setMessage("");
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
    } catch (e: any) {
      setMessage(e?.message || "Refresh failed");
    }
  }

  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet) return;
    fullRefresh().catch(() => {});
  }, [wallet]);

  // status poll
  useEffect(() => {
    const i = setInterval(() => {
      refreshStatus().catch(() => {});
    }, 2500);
    return () => clearInterval(i);
  }, []);

  // balances/tx poll
  useEffect(() => {
    if (!wallet) return;
    const i = setInterval(() => {
      loadBalance().catch(() => {});
      loadTxs().catch(() => {});
    }, 4000);
    return () => clearInterval(i);
  }, [wallet]);

  // tick down mint cooldown
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  // ---------- actions ----------
  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
      await fullRefresh();
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e.cooldownSeconds || 60);
        setMintCooldown(cd);
        setMessage(`Mint cooldown active (${cd}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
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
    const totalCost = Number((Number(quote.amount || amount) + totalFee).toFixed(8));
    return { minGas, gasFee, serviceFee, totalFee, totalCost };
  }, [quote, gasPreset, customGasStr, amount]);

  async function handleSendSignedSubmit() {
    if (!quote || !computedConfirmFees) return;
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
      await fullRefresh();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
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
      Number.isInteger(t.nonce)
    );
  }

  function openRbf(t: any) {
    setRbfTx(t);
    setRbfMult(1.25);
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

      // serviceFee must match server formula for the original amount
      const status = await getChainStatus();
      const serviceFee = computeServiceFee(Number(rbfTx.amount || 0), status.serviceFeeRate);

      await rbfReplacePending({
        to: String(rbfTx.to),
        amount: Number(rbfTx.amount),
        nonce: Number(rbfTx.nonce),
        gasFee,
        serviceFee,
      });

      setRbfOpen(false);
      setMessage("Boost submitted (RBF) ✅");
      await fullRefresh();
    } catch (e: any) {
      // 409 usually means the tx is no longer pending / replaceable
      setMessage(`RBF failed: ${e?.message || "Unknown error"}`);
      await fullRefresh();
      setRbfOpen(false);
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

      await cancelPending({
        nonce: Number(cancelTx.nonce),
        gasFee,
      });

      setCancelOpen(false);
      setMessage("Cancel submitted (replacement) ✅");
      await fullRefresh();
    } catch (e: any) {
      setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
      await fullRefresh();
      setCancelOpen(false);
    } finally {
      setSendBusy(false);
    }
  }

  // ---------- UI helpers ----------
  function formatTime(ms: number) {
    if (!ms || ms <= 0) return "—";
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${s}s`;
  }
  function shortAddr(a: string) {
    if (!a) return "";
    if (a.length <= 14) return a;
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  const mintLabel = useMemo(() => {
    if (mintBusy) return "Minting…";
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return "Mint";
  }, [mintCooldown, mintBusy]);

  // ---------- Background wrapper ----------
  const content = (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
          <Text style={{ color: T.sub, marginTop: 2 }}>
            Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)}
          </Text>
        </View>

        <Pressable
          onPress={() => setHistoryOpen(true)}
          style={{
            marginRight: 10,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: T.border,
            backgroundColor: "rgba(0,0,0,0.35)",
          }}
        >
          <Text style={{ color: T.text, fontWeight: "900" }}>🧾</Text>
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

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {/* Wallet + buttons */}
        <GlassCard>
          <View style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 6 }}>Wallet</Text>
            <Text style={{ color: T.text, fontWeight: "900" }}>{shortAddr(wallet)}</Text>

            {message ? <Text style={{ color: "#ffd56a", marginTop: 8 }}>{message}</Text> : null}
            {cooldownText ? <Text style={{ color: T.sub, marginTop: 6 }}>{cooldownText}</Text> : null}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <Pressable
                onPress={fullRefresh}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>Refresh</Text>
              </Pressable>

              <Pressable
                onPress={loadBalance}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                }}
              >
                <Text style={{ color: T.green, fontWeight: "900" }}>Get Balance</Text>
              </Pressable>
            </View>
          </View>
        </GlassCard>

        <View style={{ height: 14 }} />

        {/* Balances */}
        <GlassCard>
          <View style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 8 }}>Balances</Text>

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: T.text, fontWeight: "900" }}>Confirmed</Text>
              <Text style={{ color: T.text, fontWeight: "900" }}>{fmt8(confirmedBalance)}</Text>
            </View>

            <View style={{ height: 6 }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: T.text, fontWeight: "900" }}>Spendable</Text>
              <Text style={{ color: T.text, fontWeight: "900" }}>{fmt8(spendableBalance)}</Text>
            </View>

            <View style={{ height: 6 }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: T.sub }}>Fee Vault</Text>
              <Text style={{ color: T.sub }}>{fmt8(feeVaultBalance)}</Text>
            </View>

            <View style={{ height: 12 }} />

            <Pressable
              onPress={handleMint}
              disabled={mintBusy || mintCooldown > 0}
              style={{
                paddingVertical: 12,
                borderRadius: 14,
                alignItems: "center",
                backgroundColor: T.purple,
                opacity: mintBusy || mintCooldown > 0 ? 0.55 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{mintLabel}</Text>
            </Pressable>
          </View>
        </GlassCard>

        <View style={{ height: 14 }} />

        {/* Send */}
        <GlassCard>
          <View style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 8 }}>Send</Text>

            <Text style={{ color: T.sub, marginBottom: 6 }}>To</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="Recipient address"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: T.text,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: T.border,
                backgroundColor: "rgba(0,0,0,0.35)",
              }}
            />

            <View style={{ height: 10 }} />

            <Text style={{ color: T.sub, marginBottom: 6 }}>Amount</Text>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              placeholder="0.0"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="decimal-pad"
              style={{
                color: T.text,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: T.border,
                backgroundColor: "rgba(0,0,0,0.35)",
              }}
            />

            <View style={{ height: 12 }} />

            <Animated.View style={{ opacity: sendGlow }}>
              <Pressable
                onPress={openSendConfirm}
                disabled={sendBusy}
                style={{
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: "center",
                  backgroundColor: T.green,
                  opacity: sendBusy ? 0.65 : 1,
                }}
              >
                <Text style={{ color: "#041006", fontWeight: "900", fontSize: 16 }}>Send</Text>
              </Pressable>
            </Animated.View>

            <Text style={{ color: T.sub, marginTop: 10 }}>
              Service fee (est): {fmt8(computeServiceFee(amount, quote?.status?.serviceFeeRate ?? 0))}
            </Text>
          </View>
        </GlassCard>

        <View style={{ height: 14 }} />

        {/* Transactions preview (pending only) */}
        <GlassCard>
          <View style={{ padding: 14 }}>
            <Text style={{ color: T.sub, marginBottom: 8 }}>Pending</Text>

            {txs.filter((t: any) => t?.status === "pending").length === 0 ? (
              <Text style={{ color: T.sub }}>No pending transactions.</Text>
            ) : (
              txs
                .filter((t: any) => t?.status === "pending")
                .slice(0, 6)
                .map((t: any, idx: number) => {
                  const minePending = isMyPendingSend(t);
                  return (
                    <View
                      key={`${t?.id || idx}`}
                      style={{ paddingVertical: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.08)" }}
                    >
                      <Text style={{ color: T.text, fontWeight: "900" }}>
                        {t?.type === "mint" ? "Mint" : "Send"} <Text style={{ color: "#ffd56a" }}>(pending)</Text>
                      </Text>
                      <Text style={{ color: T.sub, marginTop: 4 }}>
                        Amount: {fmt8(Number(t?.amount || 0))} • Nonce: {String(t?.nonce ?? "—")}
                      </Text>

                      {minePending ? (
                        <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                          <Pressable
                            onPress={() => openRbf(t)}
                            disabled={sendBusy}
                            style={{
                              paddingVertical: 10,
                              paddingHorizontal: 14,
                              borderRadius: 12,
                              backgroundColor: T.blue,
                              opacity: sendBusy ? 0.6 : 1,
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "900" }}>⚡ Boost</Text>
                          </Pressable>

                          <Pressable
                            onPress={() => openCancel(t)}
                            disabled={sendBusy}
                            style={{
                              paddingVertical: 10,
                              paddingHorizontal: 14,
                              borderRadius: 12,
                              backgroundColor: "rgba(255,90,90,0.95)",
                              opacity: sendBusy ? 0.6 : 1,
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "900" }}>✖ Cancel</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })
            )}

            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: T.border,
                backgroundColor: "rgba(0,0,0,0.30)",
              }}
            >
              <Text style={{ color: T.text, fontWeight: "900" }}>Open Transaction History</Text>
            </Pressable>
          </View>
        </GlassCard>
      </ScrollView>

      {/* ---------- Confirm Send Modal ---------- */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900" }}>Confirm Transaction</Text>
                <Pressable onPress={() => setConfirmOpen(false)} style={{ padding: 8 }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>✕</Text>
                </Pressable>
              </View>

              <Text style={{ color: T.sub, marginTop: 8 }}>To: {to}</Text>
              <Text style={{ color: T.sub }}>Amount: {amount}</Text>

              <View style={{ height: 10 }} />

              {computedConfirmFees ? (
                <>
                  <Text style={{ color: T.text, fontWeight: "900" }}>Fees</Text>
                  <Text style={{ color: T.sub }}>Min gas: {fmt8(computedConfirmFees.minGas)}</Text>
                  <Text style={{ color: T.sub }}>Gas: {fmt8(computedConfirmFees.gasFee)}</Text>
                  <Text style={{ color: T.sub }}>Service: {fmt8(computedConfirmFees.serviceFee)}</Text>
                  <Text style={{ color: T.sub }}>Total fee: {fmt8(computedConfirmFees.totalFee)}</Text>
                  <Text style={{ color: T.text, fontWeight: "900", marginTop: 8 }}>
                    Total cost: {fmt8(computedConfirmFees.totalCost)}
                  </Text>
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
                      borderColor: gasPreset === b.k ? T.green : "rgba(255,255,255,0.14)",
                      backgroundColor: gasPreset === b.k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>

              {gasPreset === "custom" && computedConfirmFees ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: T.sub, marginBottom: 6 }}>
                    Custom gas (min {fmt8(computedConfirmFees.minGas)})
                  </Text>
                  <TextInput
                    value={customGasStr}
                    onChangeText={setCustomGasStr}
                    placeholder={`${fmt8(computedConfirmFees.minGas)}`}
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    keyboardType="decimal-pad"
                    style={{
                      color: T.text,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: T.border,
                      backgroundColor: "rgba(0,0,0,0.35)",
                    }}
                  />
                </View>
              ) : null}

              <View style={{ height: 14 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setConfirmOpen(false)}
                  disabled={sendBusy}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: T.border,
                    backgroundColor: "rgba(0,0,0,0.35)",
                    opacity: sendBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: T.text, fontWeight: "900" }}>Back</Text>
                </Pressable>

                <Pressable
                  onPress={handleSendSignedSubmit}
                  disabled={sendBusy || !computedConfirmFees}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor: T.green,
                    opacity: sendBusy || !computedConfirmFees ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#041006", fontWeight: "900" }}>{sendBusy ? "Sending…" : "Confirm"}</Text>
                </Pressable>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- RBF Modal (Boost) ---------- */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900" }}>Boost Pending Tx</Text>
                <Pressable onPress={() => setRbfOpen(false)} style={{ padding: 8 }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>✕</Text>
                </Pressable>
              </View>

              {rbfTx ? (
                <Text style={{ color: T.sub, marginTop: 8 }}>
                  Nonce: {rbfTx.nonce} • Amount: {fmt8(Number(rbfTx.amount || 0))}
                </Text>
              ) : null}

              <View style={{ height: 12 }} />
              <Text style={{ color: T.text, fontWeight: "900" }}>Fee bump</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {[1.15, 1.25, 1.5, 2.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => setRbfMult(m)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: rbfMult === m ? T.green : "rgba(255,255,255,0.14)",
                      backgroundColor: rbfMult === m ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <Pressable
                onPress={submitRbf}
                disabled={sendBusy}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: T.blue,
                  opacity: sendBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Submit Boost"}</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Cancel Modal ---------- */}
      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900" }}>Cancel Pending Tx</Text>
                <Pressable onPress={() => setCancelOpen(false)} style={{ padding: 8 }}>
                  <Text style={{ color: T.text, fontWeight: "900" }}>✕</Text>
                </Pressable>
              </View>

              {cancelTx ? <Text style={{ color: T.sub, marginTop: 8 }}>Nonce: {cancelTx.nonce}</Text> : null}

              <View style={{ height: 12 }} />
              <Text style={{ color: T.text, fontWeight: "900" }}>Fee bump</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {[1.25, 1.5, 2.0, 3.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => setCancelMult(m)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: cancelMult === m ? "rgba(255,90,90,0.95)" : "rgba(255,255,255,0.14)",
                      backgroundColor: cancelMult === m ? "rgba(255,90,90,0.12)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <Pressable
                onPress={submitCancel}
                disabled={sendBusy}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: "rgba(255,90,90,0.95)",
                  opacity: sendBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Submit Cancel"}</Text>
              </Pressable>

              <Text style={{ color: T.sub, marginTop: 10 }}>
                Cancel submits a tiny self-send ({fmt8(ONE_SAT)}) to replace the pending tx.
              </Text>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Transaction History Modal ---------- */}
      <Modal transparent visible={historyOpen} animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
          <GlassCard style={{ maxHeight: "88%" }}>
            <View style={{ padding: 16, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", flex: 1 }}>Transaction History</Text>
              <Pressable onPress={() => setHistoryOpen(false)} style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
                <Text style={{ color: T.text, fontWeight: "900" }}>Close ✕</Text>
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Pressable
                onPress={fullRefresh}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>Refresh</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              {txs.length === 0 ? (
                <Text style={{ color: T.sub }}>No transactions yet.</Text>
              ) : (
                txs.map((t: any, idx: number) => {
                  const pending = t?.status === "pending";
                  return (
                    <View
                      key={`${t?.id || idx}`}
                      style={{ paddingVertical: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.08)" }}
                    >
                      <Text style={{ color: T.text, fontWeight: "900" }}>
                        {t?.type === "mint" ? "Mint" : "Send"}{" "}
                        <Text style={{ color: pending ? "#ffd56a" : T.sub }}>{pending ? "(pending)" : "(confirmed)"}</Text>
                      </Text>

                      <Text style={{ color: T.sub, marginTop: 4 }}>
                        Amount: {fmt8(Number(t?.amount || 0))} • Nonce: {String(t?.nonce ?? "—")}
                      </Text>

                      {t?.type === "send" ? (
                        <Text style={{ color: T.sub, marginTop: 2 }}>To: {shortAddr(String(t?.to || ""))}</Text>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Settings Modal ---------- */}
      <Modal transparent visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
          <GlassCard style={{ maxHeight: "88%" }}>
            <View style={{ padding: 16, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", flex: 1 }}>Settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)} style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
                <Text style={{ color: T.text, fontWeight: "900" }}>Close ✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
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
                      borderColor: theme === k ? T.green : "rgba(255,255,255,0.14)",
                      backgroundColor: theme === k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 16 }} />

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
                      borderColor: skin === b.k ? T.green : "rgba(255,255,255,0.14)",
                      backgroundColor: skin === b.k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </GlassCard>
        </View>
      </Modal>
    </View>
  );

  // Background selection (web dims the image for readability)
  if (skin === "matrix") {
    return (
      <ImageBackground
        source={require("./assets/skins/matrix-honeycomb.png")}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.32)" }}>
          {content}
        </View>
      </ImageBackground>
    );
  }

  // solid-black
  return <View style={{ flex: 1, backgroundColor: "#000" }}>{content}</View>;
}
