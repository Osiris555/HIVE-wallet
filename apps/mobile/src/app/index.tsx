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
  type Transaction,
} from "../chain/transactions";

/** ------------------------------------------------------------------ */
/** Local helpers (do NOT import fmt8/ONE_SAT from transactions.ts)     */
/** ------------------------------------------------------------------ */
const ONE_SAT = 0.00000001;
function fmt8(n: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00000000";
  return x.toFixed(8);
}

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

function GlassCard(props: { children: React.ReactNode; style?: any }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" } as any)
      : null;

  return (
    <View
      style={[
        {
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
          backgroundColor: "rgba(0,0,0,0.45)",
        },
        webBlur,
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

/** ------------------------- THEME / PREFS ------------------------- */
type ThemeKey = "cosmic" | "noir" | "honey";
type SkinKey = "matrix-honeycomb" | "solid-noir" | "solid-minimal";

function themeFor(t: ThemeKey) {
  if (t === "noir") {
    return {
      text: "#f5f5f5",
      sub: "#a9a9a9",
      purple: "#5e2bff",
      gold: "#caa83c",
      green: "#39ff14",
      blue: "#1f78ff",
      border: "rgba(255,255,255,0.10)",
      card: "rgba(0,0,0,0.55)",
    };
  }
  if (t === "honey") {
    return {
      text: "#fff5db",
      sub: "#d7c59a",
      purple: "#5b2cff",
      gold: "#ffbf2f",
      green: "#39ff14",
      blue: "#2b7cff",
      border: "rgba(255,255,255,0.12)",
      card: "rgba(16,6,25,0.55)",
    };
  }
  return {
    text: "#ffffff",
    sub: "#bcb4d6",
    purple: "#7b2cff",
    gold: "#caa83c",
    green: "#39ff14",
    blue: "#2b7cff",
    border: "rgba(255,255,255,0.10)",
    card: "rgba(0,0,0,0.40)",
  };
}

function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}
function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}

/** ------------------------------ APP ------------------------------ */
export default function Index() {
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const [skin, setSkin] = useState<SkinKey>("matrix-honeycomb");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [chainId, setChainId] = useState<string>("");
  const [prefsLoadedForChain, setPrefsLoadedForChain] = useState<string>("");

  // wallet/chain
  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  // balances + tx
  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);
  const [txs, setTxs] = useState<Transaction[]>([]);

  // UI state
  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  // mint
  const [mintBusy, setMintBusy] = useState(false);
  const [mintCooldown, setMintCooldown] = useState<number>(0);

  // send form
  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  // confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);

  type GasPreset = "slow" | "normal" | "fast" | "custom";
  const [gasPreset, setGasPreset] = useState<GasPreset>("normal");
  const [customGasStr, setCustomGasStr] = useState<string>("");

  const [sendBusy, setSendBusy] = useState(false);

  // boost/cancel modals
  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<Transaction | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<Transaction | null>(null);

  // header pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const headerGlow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });

  /** -------------------- load/save per-chain prefs -------------------- */
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
      if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "honey") {
        setTheme(savedTheme);
      }

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix-honeycomb" || savedSkin === "solid-noir" || savedSkin === "solid-minimal") {
        setSkin(savedSkin);
      }

      setPrefsLoadedForChain(chainId);
    })().catch(() => {});
  }, [chainId, prefsLoadedForChain]);

  /** ------------------------------ loaders ------------------------------ */
  async function refreshStatus() {
    const st = await getChainStatus();
    // your server returns chainHeight + msUntilNextBlock
    setChainHeight(Number((st as any)?.chainHeight || 0));
    setMsUntilNextBlock(Number((st as any)?.msUntilNextBlock || 0));
    setChainId(String((st as any)?.chainId || ""));
    return st;
  }

  async function loadWalletAndData() {
    const w = await ensureWalletId();
    setWallet(w);

    const b = await getBalance(w);
    setConfirmedBalance(Number((b as any)?.confirmed || 0));
    setSpendableBalance(Number((b as any)?.spendable || 0));
    setFeeVaultBalance(Number((b as any)?.feeVault || 0));

    const list = await getTransactions(w);
    setTxs((list as any) || []);
  }

  useEffect(() => {
    (async () => {
      await refreshStatus();
      await loadWalletAndData();
    })().catch((e) => setMessage(`Init failed: ${String(e?.message || e)}`));
  }, []);

  // poll status
  useEffect(() => {
    const i = setInterval(() => {
      refreshStatus().catch(() => {});
    }, 2500);
    return () => clearInterval(i);
  }, []);

  // poll balances/tx
  useEffect(() => {
    if (!wallet) return;
    const i = setInterval(() => {
      loadWalletAndData().catch(() => {});
    }, 4000);
    return () => clearInterval(i);
  }, [wallet]);

  /** ------------------------------ cooldown ------------------------------ */
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  /** ------------------------------ actions ------------------------------ */
  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res: any = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await refreshStatus();
      await loadWalletAndData();
      setMintCooldown(Number(res?.cooldownSeconds || 60));
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e?.cooldownSeconds || 60);
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
    const baseGas = Number(quote.gasFee || 0) || minGas;
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

  async function handleSendSubmit() {
    if (!computedConfirmFees) return;
    if (sendBusy) return;
    setSendBusy(true);
    setMessage("");

    try {
      const res: any = await send({
        to,
        amount,
        gasFee: computedConfirmFees.gasFee,
        serviceFee: computedConfirmFees.serviceFee,
      });

      setConfirmOpen(false);
      setMessage(res?.isReplacement ? "Send replaced a pending tx (RBF) ✅" : "Send submitted (pending) ✅");
      await refreshStatus();
      await loadWalletAndData();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  function shortAddr(a: string) {
    if (!a) return "";
    if (a.length <= 14) return a;
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  function formatTime(ms: number) {
    if (!ms || ms <= 0) return "—";
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${s}s`;
  }

  function isMyPendingSend(t: Transaction) {
    return t?.type === "send" && t?.status === "pending" && t?.from === wallet && t?.nonce != null;
  }

  function openBoost(t: Transaction) {
    setRbfTx(t);
    setRbfOpen(true);
  }

  function openCancel(t: Transaction) {
    setCancelTx(t);
    setCancelOpen(true);
  }

  async function doBoost(multiplier: number) {
    if (!rbfTx) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");
    try {
      const status: any = await refreshStatus();
      const minGas = Number(status?.minGasFee || ONE_SAT);

      const oldGas = Number(rbfTx.gasFee || minGas);
      const gasFee = clampGas(oldGas * multiplier, minGas);

      const amt = Number(rbfTx.amount || 0);
      const serviceFee = computeServiceFee(amt, status?.serviceFeeRate);

      const res: any = await send({
        to: String(rbfTx.to),
        amount: amt,
        gasFee,
        serviceFee,
        nonceOverride: Number(rbfTx.nonce),
      });

      setRbfOpen(false);
      setMessage(res?.isReplacement ? "Boosted pending tx (RBF) ✅" : "Boost submitted ✅");
      await loadWalletAndData();
    } catch (e: any) {
      setMessage(`Boost failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  // Cancel = replace pending tx by sending ONE_SAT to yourself with same nonce + higher fee.
  async function doCancel(multiplier: number) {
    if (!cancelTx) return;
    if (!wallet) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");
    try {
      const status: any = await refreshStatus();
      const minGas = Number(status?.minGasFee || ONE_SAT);

      const oldGas = Number(cancelTx.gasFee || minGas);
      const gasFee = clampGas(oldGas * multiplier, minGas);

      const amt = ONE_SAT; // server requires amount > 0
      const serviceFee = computeServiceFee(amt, status?.serviceFeeRate);

      const res: any = await send({
        to: wallet, // send to self
        amount: amt,
        gasFee,
        serviceFee,
        nonceOverride: Number(cancelTx.nonce),
      });

      setCancelOpen(false);
      setMessage(res?.isReplacement ? "Cancel submitted (replacement tx) ✅" : "Cancel submitted ✅");
      await loadWalletAndData();
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
  }, [mintBusy, mintCooldown]);

  /** ------------------------------ UI ------------------------------ */
  const Body = (
    <View style={{ flex: 1, paddingTop: 18 }}>
      {/* header */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <Animated.View style={{ flex: 1, opacity: headerGlow }}>
          <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
          <Text style={{ color: T.sub, marginTop: 2 }}>
            Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)}
          </Text>
        </Animated.View>

        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
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
        {/* wallet */}
        <View style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: T.border, backgroundColor: T.card }}>
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
        </View>

        <View style={{ height: 14 }} />

        {/* balances */}
        <View style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: T.border, backgroundColor: T.card }}>
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
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: T.purple,
              opacity: mintBusy || mintCooldown > 0 ? 0.5 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{mintLabel}</Text>
          </Pressable>
        </View>

        <View style={{ height: 14 }} />

        {/* send */}
        <View style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: T.border, backgroundColor: T.card }}>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Send</Text>

          <Text style={{ color: T.sub, marginBottom: 6 }}>To</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Recipient address"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={{
              color: T.text,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
            autoCapitalize="none"
            autoCorrect={false}
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
              borderRadius: 12,
              borderWidth: 1,
              borderColor: T.border,
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
          />

          <View style={{ height: 12 }} />

          <Pressable
            onPress={openSendConfirm}
            disabled={sendBusy}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: T.green,
              opacity: sendBusy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#041006", fontWeight: "900", fontSize: 16 }}>Send</Text>
          </Pressable>

          <Text style={{ color: T.sub, marginTop: 10 }}>
            Service fee (est): {fmt8(computeServiceFee(amount))}
          </Text>
        </View>

        <View style={{ height: 14 }} />

        {/* tx list */}
        <View style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: T.border, backgroundColor: T.card }}>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Transactions</Text>

          {txs.length === 0 ? (
            <Text style={{ color: T.sub }}>No transactions yet.</Text>
          ) : (
            txs.map((t, idx) => {
              const pending = t?.status === "pending";
              const minePending = isMyPendingSend(t);

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
                      <Text style={{ color: pending ? "#ffd56a" : T.sub }}>{pending ? "(pending)" : "(confirmed)"}</Text>
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

                  {minePending ? (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                      <Pressable
                        onPress={() => openBoost(t)}
                        disabled={sendBusy}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: 10,
                          backgroundColor: T.blue,
                          opacity: sendBusy ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900" }}>⚡ Boost (RBF)</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => openCancel(t)}
                        disabled={sendBusy}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: 10,
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
        </View>
      </ScrollView>

      {/* ---------- Confirm Send modal ---------- */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>
                Confirm Transaction
              </Text>

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
                  <Text style={{ color: T.text, fontWeight: "900", marginTop: 8 }}>
                    Total cost: {fmt8(computedConfirmFees.totalCost)}
                  </Text>
                </>
              ) : (
                <Text style={{ color: T.sub }}>Loading…</Text>
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
                      borderColor: gasPreset === b.k ? T.gold : "rgba(255,255,255,0.14)",
                      backgroundColor: gasPreset === b.k ? "rgba(202,168,60,0.12)" : "transparent",
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
                  onPress={handleSendSubmit}
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
                  <Text style={{ color: "#041006", fontWeight: "900" }}>
                    {sendBusy ? "Sending…" : "Confirm"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Boost modal ---------- */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>
                Boost Pending Tx (RBF)
              </Text>

              {rbfTx ? (
                <>
                  <Text style={{ color: T.sub }}>To: {String(rbfTx.to)}</Text>
                  <Text style={{ color: T.sub }}>Amount: {Number(rbfTx.amount)}</Text>
                  <Text style={{ color: T.sub }}>Nonce: {String(rbfTx.nonce)}</Text>
                </>
              ) : null}

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                {[1.25, 1.5, 2.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => doBoost(m)}
                    disabled={sendBusy}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      backgroundColor: T.blue,
                      opacity: sendBusy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 12 }} />
              <Pressable
                onPress={() => setRbfOpen(false)}
                disabled={sendBusy}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                  opacity: sendBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Cancel modal ---------- */}
      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
            <View style={{ padding: 16 }}>
              <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>
                Cancel Pending Tx
              </Text>

              <Text style={{ color: T.sub }}>
                This will replace the pending tx by sending {fmt8(ONE_SAT)} to yourself (same nonce + higher fee).
              </Text>

              <View style={{ height: 12 }} />

              <View style={{ flexDirection: "row", gap: 10 }}>
                {[1.25, 1.5, 2.0].map((m) => (
                  <Pressable
                    key={String(m)}
                    onPress={() => doCancel(m)}
                    disabled={sendBusy}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      backgroundColor: "rgba(255,90,90,0.95)",
                      opacity: sendBusy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>{m}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 12 }} />
              <Pressable
                onPress={() => setCancelOpen(false)}
                disabled={sendBusy}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                  opacity: sendBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* ---------- Settings modal ---------- */}
      <Modal transparent visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard>
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
                      borderColor: theme === k ? T.gold : "rgba(255,255,255,0.14)",
                      backgroundColor: theme === k ? "rgba(202,168,60,0.12)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />

              <Text style={{ color: T.sub, marginBottom: 10 }}>Skin</Text>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                {(["matrix-honeycomb", "solid-noir", "solid-minimal"] as SkinKey[]).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setSkin(k)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: skin === k ? T.green : "rgba(255,255,255,0.14)",
                      backgroundColor: skin === k ? "rgba(57,255,20,0.10)" : "transparent",
                    }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 14 }} />
              <Pressable
                onPress={() => setSettingsOpen(false)}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.35)",
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
    </View>
  );

  /** ------------------------------ skins ------------------------------ */
  if (skin === "solid-noir") return <View style={{ flex: 1, backgroundColor: "#050509" }}>{Body}</View>;
  if (skin === "solid-minimal") return <View style={{ flex: 1, backgroundColor: "#0b0615" }}>{Body}</View>;

  // matrix-honeycomb default
  return (
    <ImageBackground source={require("./assets/skins/matrix-honeycomb.png")} resizeMode="cover" style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.22)" }}>{Body}</View>
    </ImageBackground>
  );
}
