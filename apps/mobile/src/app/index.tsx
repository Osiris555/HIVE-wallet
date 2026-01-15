// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import * as  SecureStore from "expo-secure-store"
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  Platform,
  ImageBackground,
} from "react-native";
import { BlurView } from "expo-blur";

import {
  ensureWalletId,
  getBalance,
  getTransactions,
  getChainStatus,
  quoteSend,
  mint,
  send,
  computeServiceFee,
} from "../chain/transactions";

function fmt8(n: number) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0.00000000";
  return x.toFixed(8);
}

const ONE_SAT = 0.00000001;

type ThemeKey = "cosmic" | "noir" | "minimal";

function themeFor(key: ThemeKey) {
  if (key === "noir") {
    return {
      overlay: "rgba(0,0,0,0.80)",
      panel: "rgba(0,0,0,0.55)",
      border: "#2a2a2a",
      text: "#ffffff",
      sub: "#b0b0b0",
      gold: "#caa83c",
      blue: "#2b6fff",
      danger: "#ff6b6b",
      ok: "#9dff9d",
    };
  }
  if (key === "minimal") {
    return {
      overlay: "rgba(0,0,0,0.55)",
      panel: "rgba(10,10,10,0.40)",
      border: "#2a2a2a",
      text: "#ffffff",
      sub: "#cfcfcf",
      gold: "#d6b24a",
      blue: "#4b87ff",
      danger: "#ff7a7a",
      ok: "#b9ffb9",
    };
  }
  // cosmic default
  return {
    overlay: "rgba(0,0,0,0.70)",
    panel: "rgba(0,0,0,0.35)",
    border: "#222",
    text: "#ffffff",
    sub: "#aaa",
    gold: "#caa83c",
    blue: "#2b6fff",
    danger: "#ff6b6b",
    ok: "#9dff9d",
  };
}

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function kvGet(key: string): Promise<string | null> {
  if (isWeb()) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    try { window.localStorage.setItem(key, value); } catch {}
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch {}
}

function themeKeyForChain(chainId: string) {
  return `HIVE_THEME__${chainId}`;
}
function skinKeyForChain(chainId: string) {
  return `HIVE_SKIN__${chainId}`;
}

type SkinKey = "honeycomb" | "solid-noir" | "solid-minimal";


export default function Index() {
  // --- theme / settings ---
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chainId, setChainId] = useState<string>("");      // ✅ current network id
  const [skin, setSkin] = useState<SkinKey>("honeycomb");  // ✅ per-network skin
  const [prefsLoadedForChain, setPrefsLoadedForChain] = useState<string>(""); // chainId last loaded

useEffect(() => {
  if (!chainId) return;
  kvSet(themeKeyForChain(chainId), theme).catch(() => {});
}, [theme, chainId]);

useEffect(() => {
  if (!chainId) return;
  kvSet(skinKeyForChain(chainId), skin).catch(() => {});
}, [skin, chainId]);


  // --- chain/wallet ---
  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  // balances
  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);


  // send form
  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");

  // txs
  const [txs, setTxs] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(true);

  // status
  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  // mint cooldown
  const [mintCooldown, setMintCooldown] = useState<number>(0);
  const [mintBusy, setMintBusy] = useState<boolean>(false);

  const [sendBusy, setSendBusy] = useState<boolean>(false);

  // confirm modal (normal send)
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);

  // gas picker for confirm modal
  const [gasPreset, setGasPreset] = useState<"slow" | "normal" | "fast" | "custom">("normal");
  const [customGasStr, setCustomGasStr] = useState<string>("");

  // RBF modal
  const [rbfOpen, setRbfOpen] = useState<boolean>(false);
  const [rbfTx, setRbfTx] = useState<any>(null);
  const [rbfMultiplier, setRbfMultiplier] = useState<number>(1.5);
  const [rbfPreview, setRbfPreview] = useState<any>(null);

  // Cancel modal
  const [cancelOpen, setCancelOpen] = useState<boolean>(false);
  const [cancelTx, setCancelTx] = useState<any>(null);
  const [cancelPreview, setCancelPreview] = useState<any>(null);

  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver:      true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])
  );
    anim.start();
    return () => anim.stop();
  }, [glow]);

  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });


  async function refreshStatus() {
  const s = await getChainStatus();

  const cid = String(s.chainId || "");
  if (cid) setChainId(cid);

  setChainHeight(Number(s.chainHeight || 0));
  setMsUntilNextBlock(Number(s.msUntilNextBlock || 0));

  if (s.feeVaultBalance != null) setFeeVaultBalance(Number(s.feeVaultBalance || 0));
  else if (s.vaultBalance != null) setFeeVaultBalance(Number(s.vaultBalance || 0));

  // ✅ load saved prefs ONCE per chainId
  if (cid && prefsLoadedForChain !== cid) {
    const savedTheme = await kvGet(themeKeyForChain(cid));
    const savedSkin = await kvGet(skinKeyForChain(cid));

    if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "minimal") {
      setTheme(savedTheme);
    }
    if (savedSkin === "honeycomb" || savedSkin === "solid-noir" || savedSkin === "solid-minimal") {
      setSkin(savedSkin);
    }

    setPrefsLoadedForChain(cid);
  }

  return s;
}


  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
    return w;
  }

  async function loadBalance() {
    if (!wallet) return;
    const b = await getBalance(wallet);
    setConfirmedBalance(Number(b.balance || 0));
    setSpendableBalance(Number(b.spendableBalance || 0));
  }

  async function loadTxs() {
    if (!wallet) return;
    const list = await getTransactions(wallet);
    setTxs(list || []);
  }

  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
    })();
  }, []);

  useEffect(() => {
    if (!wallet) return;
    loadBalance();
    loadTxs();
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

  // status poll
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        await refreshStatus();
      } catch {}
    }, 1000);
    return () => clearInterval(i);
  }, []);

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await loadBalance();
      await loadTxs();
      await refreshStatus();
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e.cooldownSeconds || 60);
        setMintCooldown(cd);
        setMessage(`Cooldown active (${cd}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setMintBusy(false);
    }
  }

  async function openSendConfirm() {
    setMessage("");
    if (!to || to.length < 8) {
      setMessage("Enter a recipient address.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid amount.");
      return;
    }
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
      await loadBalance();
      await loadTxs();
      await refreshStatus();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  // ---------- RBF / Cancel ----------
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

  async function openRbf(t: any) {
    setMessage("");
    setRbfTx(t);
    setRbfMultiplier(1.5);
    setRbfOpen(true);

    const status = await getChainStatus();
    const fees = calcReplacementFees(t, status, 1.5, "rbf");
    setRbfPreview({ status, fees });
  }

  async function openCancel(t: any) {
    setMessage("");
    setCancelTx(t);
    setCancelOpen(true);

    const status = await getChainStatus();
    const fees = calcReplacementFees(t, status, 2.0, "cancel");
    setCancelPreview({ status, fees });
  }

  function calcReplacementFees(tx: any, status: any, multiplier: number, mode: "rbf" | "cancel") {
    const minGas = Number(status.minGasFee || 0) || ONE_SAT;
    const rate = Number(status.serviceFeeRate || 0);

    const amt = mode === "cancel" ? ONE_SAT : Number(tx.amount);
    const oldGas = Number(tx.gasFee || 0);
    const oldSvc = Number(tx.serviceFee || 0);
    const oldTotalFee = Number((oldGas + oldSvc).toFixed(8));

    const serviceFee = computeServiceFee(amt, rate);

    let newGas = Number(((oldGas > 0 ? oldGas : minGas) * multiplier).toFixed(8));
    newGas = Math.max(minGas, newGas);

    let newTotalFee = Number((newGas + serviceFee).toFixed(8));

    // must strictly exceed old total fee
    while (newTotalFee <= oldTotalFee) {
      newGas = Number((newGas + ONE_SAT).toFixed(8));
      newTotalFee = Number((newGas + serviceFee).toFixed(8));
    }

    return { minGas, rate, serviceFee, oldTotalFee, newGas, newTotalFee };
  }

  // update RBF preview when multiplier changes
  useEffect(() => {
    (async () => {
      if (!rbfTx || !rbfOpen) return;
      const status = await getChainStatus();
      const fees = calcReplacementFees(rbfTx, status, rbfMultiplier, "rbf");
      setRbfPreview({ status, fees });
    })();
  }, [rbfMultiplier, rbfTx, rbfOpen]);

  async function submitRbf() {
    if (sendBusy || !rbfTx) return;
    setSendBusy(true);
    setMessage("");

    try {
      // if it’s not pending anymore, show a friendly message
      const latest = (await getTransactions(wallet)).find((x: any) => x.id === rbfTx.id) || rbfTx;
      if (latest.status !== "pending") {
        setMessage("Too late — that transaction is already confirmed (or failed).");
        setRbfOpen(false);
        setRbfTx(null);
        await loadTxs();
        return;
      }

      const status = await getChainStatus();
      const fees = calcReplacementFees(latest, status, rbfMultiplier, "rbf");

      const res = await send({
        to: String(latest.to),
        amount: Number(latest.amount),
        gasFee: fees.newGas,
        serviceFee: fees.serviceFee,
        nonceOverride: Number(latest.nonce),
      });

      setRbfOpen(false);
      setRbfTx(null);

      setMessage(res?.isReplacement ? `Speed up submitted ✅ (fee ${fmt8(fees.newTotalFee)})` : "Speed up submitted ✅");
      await loadBalance();
      await loadTxs();
      await refreshStatus();
    } catch (e: any) {
      // 409 is expected if mempool state changed; we explain it nicely
      if (e?.status === 409) {
        setMessage("Speed up failed: mempool changed (nonce mismatch). Refreshing…");
        await loadTxs();
        await loadBalance();
        await refreshStatus();
      } else {
        setMessage(`Speed up failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setSendBusy(false);
    }
  }

  async function submitCancel() {
    if (sendBusy || !cancelTx) return;
    setSendBusy(true);
    setMessage("");

    try {
      const latest = (await getTransactions(wallet)).find((x: any) => x.id === cancelTx.id) || cancelTx;
      if (latest.status !== "pending") {
        setMessage("Too late — that transaction is already confirmed (or failed).");
        setCancelOpen(false);
        setCancelTx(null);
        await loadTxs();
        return;
      }

      const status = await getChainStatus();
      const fees = calcReplacementFees(latest, status, 2.0, "cancel");

      // Cancel tx: same nonce, to self, amount 0, higher fee
      const res = await send({
        to: wallet,
        amount: ONE_SAT,
        gasFee: fees.newGas,
        serviceFee: fees.serviceFee,
        nonceOverride: Number(latest.nonce),
        isCancel: true,
      });

      setCancelOpen(false);
      setCancelTx(null);

      setMessage(res?.isReplacement ? `Cancel submitted ✅ (fee ${fmt8(fees.newTotalFee)})` : "Cancel submitted ✅");
      await loadBalance();
      await loadTxs();
      await refreshStatus();
    } catch (e: any) {
      if (e?.status === 409) {
        setMessage("Cancel failed: mempool changed (nonce mismatch). Refreshing…");
        await loadTxs();
        await loadBalance();
        await refreshStatus();
      } else {
        setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return mintBusy ? "Minting..." : "Mint";
  }, [mintCooldown, mintBusy]);

  return (

   const Screen = (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          gap: 14,
          maxWidth: 950,
          alignSelf: "center",
          width: "100%",
        }}
      >
        {/* 🔽 THIS IS YOUR EXISTING CONTENT — UNCHANGED */}
        {/* header */}
        {/* balances */}
        {/* buttons */}
        {/* send form */}
        {/* tx list */}
      </ScrollView>

      {/* 🔽 ALL YOUR MODALS — UNCHANGED */}
      {/* Confirm modal */}
      {/* RBF modal */}
      {/* Cancel modal */}
      {/* Settings modal */}
    </View>
  );

  return skin === "honeycomb" ? (
    <ImageBackground
      source={require("./honeycomb-bg.png")}
      resizeMode="cover"
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1, backgroundColor: T.overlay }}>
        {Screen}
      </View>
    </ImageBackground>
  ) : (
    <View style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
      <View style={{ flex: 1, backgroundColor: T.overlay }}>
        {Screen}
      </View>
    </View>
  );


<View style={{ flex: 1, backgroundColor: skin === "solid-noir" ? "#000" : "#0b0b0b" }}>
      <View style={{ flex: 1, backgroundColor: T.overlay }}

    {skin === "honeycomb" ? (
  <ImageBackground source={require("./honeycomb-bg.png")} resizeMode="cover" style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: T.overlay }}>
      {/* ... your existing content exactly as-is ... */}
    </View>
  </ImageBackground>
) : (
  <View
    style={{
      flex: 1,
      backgroundColor: skin === "solid-noir" ? "#000" : "#0b0b0b",
    }}
  >
    <View style={{ flex: 1, backgroundColor: T.overlay }}>
      {/* ... your existing content exactly as-is ... */}
    </View>
  </View>
)}

      <View style={{ flex: 1, backgroundColor: T.overlay }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 14, maxWidth: 950, alignSelf: "center", width: "100%" }}>
          {/* header with settings */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
            <View style={{ position: "absolute", right: 0 }}>
              <Pressable
                onPress={() => setSettingsOpen(true)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.border,
                  backgroundColor: "rgba(0,0,0,0.25)",
                }}
              >
                <Text style={{ color: T.text, fontWeight: "900" }}>⚙️</Text>
              </Pressable>
            </View>

            <Text style={{ color: T.text, fontSize: 34, textAlign: "center", fontWeight: "800", marginTop: 6 }}>
              HIVE Wallet
            </Text>
          </View>

          <Text style={{ color: T.sub, textAlign: "center" }}>
            Chain height: {chainHeight} · Next block: ~{Math.ceil(msUntilNextBlock / 1000)}s
          </Text>

          {wallet ? <Text style={{ color: T.sub, textAlign: "center" }}>Wallet: {wallet}</Text> : null}

          <Text style={{ color: T.text, textAlign: "center", fontSize: 20, marginTop: 6 }}>
            Confirmed: {fmt8(confirmedBalance)} HNY
          </Text>
          <Text style={{ color: T.sub, textAlign: "center" }}>Spendable: {fmt8(spendableBalance)} HNY</Text>
          <Text style={{ color: T.sub, textAlign: "center" }}>Fee vault: {fmt8(feeVaultBalance)} HNY</Text>

          {message ? (
            <Text style={{ color: message.toLowerCase().includes("failed") ? T.danger : T.ok, textAlign: "center" }}>
              {message}
            </Text>
          ) : null}

          {cooldownText ? <Text style={{ color: T.danger, textAlign: "center" }}>{cooldownText}</Text> : null}

<Animated.View style={{ transform: [{ scale: glowScale }], opacity: glowOpacity }}>
  <Pressable
    onPress={handleMint}
    disabled={mintBusy || mintCooldown > 0}
    style={{
      backgroundColor: T.gold,
      opacity: mintBusy || mintCooldown > 0 ? 0.5 : 1,
      padding: 18,
      borderRadius: 10,
      alignItems: "center",
      marginTop: 10,
      // iOS glow
      shadowColor: T.gold,
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      // Android glow
      elevation: 8,
    }}
  >
    <Text style={{ fontWeight: "800", fontSize: 18 }}>{mintLabel}</Text>
  </Pressable>
</Animated.View>


          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={loadBalance}
              style={{ flex: 1, borderWidth: 1, borderColor: T.border, padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: T.panel }}
            >
              <Text style={{ color: T.text, fontWeight: "700" }}>Get Balance</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setShowHistory((v) => !v);
                if (!showHistory) loadTxs();
              }}
              style={{ flex: 1, borderWidth: 1, borderColor: T.border, padding: 14, borderRadius: 10, alignItems: "center", backgroundColor: T.panel }}
            >
              <Text style={{ color: T.text, fontWeight: "700" }}>
                {showHistory ? "Hide History" : "Transaction History"}
              </Text>
            </Pressable>
          </View>

          <Text style={{ color: T.text, fontWeight: "800", fontSize: 18, marginTop: 10 }}>Send</Text>

          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Recipient address (HNY_...)"
            placeholderTextColor="#666"
            style={{ backgroundColor: "rgba(17,17,17,0.85)", borderRadius: 10, padding: 14, color: T.text, borderWidth: 1, borderColor: T.border }}
          />

          <TextInput
            value={amountStr}
            onChangeText={setAmountStr}
            placeholder="Amount"
            placeholderTextColor="#666"
            keyboardType={Platform.OS === "web" ? "text" : "numeric"}
            style={{ backgroundColor: "rgba(17,17,17,0.85)", borderRadius: 10, padding: 14, color: T.text, borderWidth: 1, borderColor: T.border }}
          />

<Animated.View style={{ transform: [{ scale: glowScale }], opacity: glowOpacity }}>
  <Pressable
    onPress={openSendConfirm}
    disabled={sendBusy}
    style={{
      backgroundColor: T.gold,
      opacity: sendBusy ? 0.6 : 1,
      padding: 18,
      borderRadius: 10,
      alignItems: "center",
      shadowColor: T.gold,
      shadowOpacity: 0.28,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    }}
  >
    <Text style={{ fontWeight: "800", fontSize: 18 }}>{sendBusy ? "Working..." : "Send"}</Text>
  </Pressable>
</Animated.View>


          {showHistory ? (
            <View style={{ marginTop: 6, borderWidth: 1, borderColor: T.border, borderRadius: 10, overflow: "hidden", backgroundColor: T.panel }}>
              {txs.length === 0 ? (
                <Text style={{ color: T.sub, padding: 14 }}>No transactions yet.</Text>
              ) : (
                txs.map((t, idx) => {
                  const gasFee = Number(t.gasFee || 0);
                  const serviceFee = Number(t.serviceFee || 0);
                  const totalFee = t.totalFee != null ? Number(t.totalFee) : Number((gasFee + serviceFee).toFixed(8));

                  const title =
                    `${String(t.type).toUpperCase()} · ${t.amount}` +
                    ` · fee ${fmt8(totalFee)}` +
                    ` · ${t.status}` +
                    (t.blockHeight ? ` · block ${t.blockHeight}` : "");

                  const showActions = isMyPendingSend(t);

                  return (
                    <View key={t.id || idx} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: T.border }}>
                      <Text style={{ color: T.text, fontWeight: "800" }}>{title}</Text>
                      <Text style={{ color: T.sub }}>Gas: {fmt8(gasFee)} · Service: {fmt8(serviceFee)}</Text>

                      {t.failReason ? <Text style={{ color: T.danger }}>Reason: {t.failReason}</Text> : null}
                      {t.nonce != null ? <Text style={{ color: T.sub }}>Nonce: {t.nonce}</Text> : null}
                      <Text style={{ color: T.sub }}>From: {t.from || "—"}</Text>
                      <Text style={{ color: T.sub }}>To: {t.to}</Text>

                      {showActions ? (
                        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                          <Pressable
                            onPress={() => openRbf(t)}
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
          ) : null}
        </ScrollView>

        {/* ---------- Confirm modal (normal send) ---------- */}
        <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
            <BlurView intensity={35} tint="dark" style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
              <View style={{ padding: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Confirm Transaction</Text>

                <Text style={{ color: T.sub }}>To: {to}</Text>
                <Text style={{ color: T.sub }}>Amount: {amount}</Text>

                {quote && computedConfirmFees ? (
                  <>
                    <View style={{ height: 10 }} />
                    <Text style={{ color: T.text, fontWeight: "800" }}>Gas</Text>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      {[
                        { k: "slow", label: "Slow" },
                        { k: "normal", label: "Normal" },
                        { k: "fast", label: "Fast" },
                        { k: "custom", label: "Custom" },
                      ].map((b) => (
                        <Pressable
                          key={b.k}
                          onPress={() => setGasPreset(b.k as any)}
                          style={{
                            flex: 1,
                            padding: 10,
                            borderRadius: 12,
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: gasPreset === b.k ? T.gold : "rgba(255,255,255,0.14)",
                            backgroundColor: gasPreset === b.k ? "rgba(202,168,60,0.12)" : "transparent",
                          }}
                        >
                          <Text style={{ color: T.text, fontWeight: "900" }}>{b.label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {gasPreset === "custom" ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: T.sub, marginBottom: 6 }}>
                          Custom gas (min {fmt8(computedConfirmFees.minGas)})
                        </Text>
                        <TextInput
                          value={customGasStr}
                          onChangeText={setCustomGasStr}
                          placeholder={`e.g. ${fmt8(computedConfirmFees.gasFee)}`}
                          placeholderTextColor="#666"
                          keyboardType={Platform.OS === "web" ? "text" : "numeric"}
                          style={{
                            backgroundColor: "rgba(0,0,0,0.35)",
                            borderRadius: 12,
                            padding: 12,
                            color: T.text,
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.14)",
                          }}
                        />
                      </View>
                    ) : null}

                    <View style={{ height: 10 }} />
                    <Text style={{ color: T.text, fontWeight: "800" }}>Fees</Text>
                    <Text style={{ color: T.sub }}>Gas fee: {fmt8(computedConfirmFees.gasFee)}</Text>
                    <Text style={{ color: T.sub }}>Service fee: {fmt8(computedConfirmFees.serviceFee)}</Text>
                    <Text style={{ color: T.sub }}>Total fee: {fmt8(computedConfirmFees.totalFee)}</Text>
                    <Text style={{ color: T.text, marginTop: 6, fontWeight: "900" }}>
                      Total cost: {fmt8(computedConfirmFees.totalCost)} HNY
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: "#888" }}>Loading quote…</Text>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setConfirmOpen(false)}
                    disabled={sendBusy}
                    style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", alignItems: "center" }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={handleSendSignedSubmit}
                    disabled={sendBusy || !computedConfirmFees}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: T.gold, alignItems: "center", opacity: sendBusy ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "#000", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Sign & Submit"}</Text>
                  </Pressable>
                </View>

                <Text style={{ color: "#aaa", marginTop: 10, fontSize: 12 }}>
                  Your device signs locally using your stored private key.
                </Text>
              </View>
            </BlurView>
          </View>
        </Modal>

        {/* ---------- RBF modal ---------- */}
        <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
            <BlurView intensity={35} tint="dark" style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
              <View style={{ padding: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Boost (RBF)</Text>

                {rbfTx ? (
                  <>
                    <Text style={{ color: T.sub }}>To: {String(rbfTx.to)}</Text>
                    <Text style={{ color: T.sub }}>Amount: {Number(rbfTx.amount)}</Text>
                    <Text style={{ color: T.sub }}>Nonce: {rbfTx.nonce}</Text>
                  </>
                ) : null}

                <View style={{ height: 12 }} />
                <Text style={{ color: T.text, fontWeight: "900" }}>Bump</Text>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                  {[1.25, 1.5, 2.0].map((m) => (
                    <Pressable
                      key={String(m)}
                      onPress={() => setRbfMultiplier(m)}
                      style={{
                        flex: 1,
                        padding: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: rbfMultiplier === m ? T.gold : "rgba(255,255,255,0.14)",
                        backgroundColor: rbfMultiplier === m ? "rgba(202,168,60,0.12)" : "transparent",
                      }}
                    >
                      <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={{ height: 12 }} />
                {rbfPreview?.fees ? (
                  <>
                    <Text style={{ color: T.sub }}>Old total fee: {fmt8(rbfPreview.fees.oldTotalFee)}</Text>
                    <Text style={{ color: T.sub }}>New gas fee: {fmt8(rbfPreview.fees.newGas)}</Text>
                    <Text style={{ color: T.sub }}>Service fee: {fmt8(rbfPreview.fees.serviceFee)}</Text>
                    <Text style={{ color: T.text, fontWeight: "900", marginTop: 6 }}>
                      New total fee: {fmt8(rbfPreview.fees.newTotalFee)}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: "#888" }}>Loading preview…</Text>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setRbfOpen(false)}
                    disabled={sendBusy}
                    style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", alignItems: "center" }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                  </Pressable>

                  <Pressable
                    onPress={submitRbf}
                    disabled={sendBusy}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: T.blue, alignItems: "center", opacity: sendBusy ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Sign & Submit"}</Text>
                  </Pressable>
                </View>

                <Text style={{ color: "#aaa", marginTop: 10, fontSize: 12 }}>
                  Replaces the pending tx with the same nonce using a higher total fee.
                </Text>
              </View>
            </BlurView>
          </View>
        </Modal>

        {/* ---------- Cancel modal ---------- */}
        <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
            <BlurView intensity={35} tint="dark" style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
              <View style={{ padding: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Cancel Pending Tx</Text>

                {cancelTx ? (
                  <>
                    <Text style={{ color: T.sub }}>To (original): {String(cancelTx.to)}</Text>
                    <Text style={{ color: T.sub }}>Amount (original): {Number(cancelTx.amount)}</Text>
                    <Text style={{ color: T.sub }}>Nonce: {cancelTx.nonce}</Text>
                  </>
                ) : null}

                <View style={{ height: 12 }} />
                {cancelPreview?.fees ? (
                  <>
                    <Text style={{ color: T.sub }}>This creates a replacement tx to yourself with amount 0.</Text>
                    <Text style={{ color: T.sub }}>New gas fee: {fmt8(cancelPreview.fees.newGas)}</Text>
                    <Text style={{ color: T.sub }}>Service fee: {fmt8(cancelPreview.fees.serviceFee)}</Text>
                    <Text style={{ color: T.text, fontWeight: "900", marginTop: 6 }}>
                      New total fee: {fmt8(cancelPreview.fees.newTotalFee)}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: "#888" }}>Loading preview…</Text>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setCancelOpen(false)}
                    disabled={sendBusy}
                    style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", alignItems: "center" }}
                  >
                    <Text style={{ color: T.text, fontWeight: "900" }}>Close</Text>
                  </Pressable>

                  <Pressable
                    onPress={submitCancel}
                    disabled={sendBusy}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: "rgba(255,90,90,0.95)", alignItems: "center", opacity: sendBusy ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting…" : "Sign & Cancel"}</Text>
                  </Pressable>
                </View>

                <Text style={{ color: "#aaa", marginTop: 10, fontSize: 12 }}>
                  If the original tx is already confirmed, cancel will show “too late”.
                </Text>
              </View>
            </BlurView>
          </View>
        </Modal>

        {/* ---------- Settings modal (Theme selector) ---------- */}
        <Modal transparent visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
            <BlurView intensity={35} tint="dark" style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
              <View style={{ padding: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Settings</Text>
                <Text style={{ color: T.sub, marginBottom: 10 }}>Theme</Text>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  {[
                    { k: "cosmic", label: "Cosmic" },
                    { k: "noir", label: "Noir" },
                    { k: "minimal", label: "Minimal" },
                  ].map((x) => (
                    <Pressable
                      key={x.k}
                      onPress={() => setTheme(x.k as ThemeKey)}
                      style={{
                        flex: 1,
                        padding: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: theme === x.k ? T.gold : "rgba(255,255,255,0.14)",
                        backgroundColor: theme === x.k ? "rgba(202,168,60,0.12)" : "transparent",
                      }}
                    >
                      <Text style={{ color: T.text, fontWeight: "900" }}>{x.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={{ height: 14 }} />

                <Pressable
                  onPress={() => setSettingsOpen(false)}
                  style={{ padding: 14, borderRadius: 12, backgroundColor: T.gold, alignItems: "center" }}
                >
                  <Text style={{ color: "#000", fontWeight: "900" }}>Done</Text>
                </Pressable>

                <Text style={{ color: "#aaa", marginTop: 10, fontSize: 12 }}>
                  Next: we’ll persist theme per-network in SecureStore.
                </Text>
              </View>
            </BlurView>
          </View>
        </Modal>
      </View>
    </ImageBackground>
  );
}
