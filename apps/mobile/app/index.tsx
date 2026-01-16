import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  ensureWalletId,
  getBalance,
  mint as chainMint,
  cancelPending,
  computeServiceFee,
  fmt8,
  getChainStatus,
  getTransactions,
  ONE_SAT,
  quoteSend,
  rbfReplacePending,
  send,
  type Transaction as TxLike,
} from "../src/chain/transactions";
import { ThemeKey, themeFor, SkinKey, kvGet, themeKeyForChain, skinKeyForChain, kvSet, GlassCard, formatTime, shortAddr } from "@/src/app";
import React from "react";

type Notice = { type: "info" | "error"; text: string } | null;

export default function WalletHome() {
  const router = useRouter();

  const [wallet, setWallet] = useState<string>("");
  const [balance, setBalance] = useState<number>(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<boolean>(false);

  // Cooldown (server authoritative)
  const [cooldownEndsAtMs, setCooldownEndsAtMs] = useState<number | null>(null);
  const [cooldownLeftMs, setCooldownLeftMs] = useState<number>(0);
  const intervalRef = useRef<any>(null);

  const mintDisabled = useMemo(() => {
    return busy || (cooldownEndsAtMs != null && cooldownLeftMs > 0);
  }, [busy, cooldownEndsAtMs, cooldownLeftMs]);

  async function refreshAll() {
    const wid = await ensureWalletId();
    setWallet(wid);
    const b = await getBalance(wid);
    setBalance(Number(b?.balance || 0));
  }

  function startCooldown(seconds: number) {
    const end = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
    setCooldownEndsAtMs(end);
  }

  useEffect(() => {
    // Timer to keep UI in sync without requiring refresh.
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldownLeftMs(() => {
        if (!cooldownEndsAtMs) return 0;
        return Math.max(0, cooldownEndsAtMs - Date.now());
      });
    }, 250);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [cooldownEndsAtMs]);

  useEffect(() => {
    // Initial load
    refreshAll().catch((e) => {
      console.error(e);
      setNotice({ type: "error", text: "Could not connect to the dev server." });
    });
  }, []);

  async function onMint() {
    setNotice(null);
    setBusy(true);
    try {
      const r: any = await chainMint();
      await refreshAll();
      setNotice({ type: "info", text: "Mint submitted." });
      // Keep the UI responsive by starting a local countdown.
      // The server also enforces this and will return a 429 with remaining seconds.
      const secs = Number(r?.cooldownSeconds || 60);
      startCooldown(secs);
    } catch (e: any) {
      const status = Number(e?.status || e?.response?.status || 0);
      const data = e?.data || e?.response?.data;

      if (status === 429) {
        const seconds = Number(e?.cooldownSeconds || data?.cooldownSeconds || 60);
        startCooldown(seconds);
        setNotice({ type: "error", text: `Cooldown active — ${seconds}s remaining` });
        return;
      }

      const msg =
        String(data?.error || e?.message || "Mint failed") +
        (status ? ` (HTTP ${status})` : "");
      Alert.alert("Mint blocked", msg);
      setNotice({ type: "error", text: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ImageBackground
      source={require("../images/honeycomb-texture.png")}
      resizeMode="cover"
      style={styles.bg}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.title}>HIVE Wallet</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Wallet</Text>
            <Text style={styles.value} numberOfLines={1}>
              {wallet || "…"}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Balance</Text>
            <Text style={styles.value}>{Number(balance).toFixed(8)} HNY</Text>
          </View>

          {notice && (
            <View
              style={[
                styles.notice,
                notice.type === "error" ? styles.noticeError : styles.noticeInfo,
              ]}
            >
              <Text style={styles.noticeText}>{notice.text}</Text>
            </View>
          )}

          {cooldownEndsAtMs != null && cooldownLeftMs > 0 && (
            <Text style={styles.cooldownText}>
              Cooldown: {Math.ceil(cooldownLeftMs / 1000)}s
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onMint}
              disabled={mintDisabled}
              style={({ pressed }) => [
                styles.btn,
                styles.btnMint,
                mintDisabled ? styles.btnDisabled : null,
                pressed && !mintDisabled ? styles.btnPressed : null,
              ]}
            >
              <View style={styles.btnInner}>
                {busy ? <ActivityIndicator /> : null}
                <Text style={styles.btnText}>{busy ? "MINTING" : "MINT"}</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => router.push("/send")}
              style={({ pressed }) => [
                styles.btn,
                styles.btnSend,
                pressed ? styles.btnPressed : null,
              ]}
            >
              <Text style={styles.btnText}>SEND</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/history")}
              style={({ pressed }) => [
                styles.btn,
                styles.btnTx,
                pressed ? styles.btnPressed : null,
              ]}
            >
              <Text style={styles.btnText}>TRANSACTIONS</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => refreshAll().catch(() => {})}
            style={({ pressed }) => [styles.link, pressed ? styles.linkPressed : null]}
          >
            <Text style={styles.linkText}>Refresh</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1, padding: 16 },
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.25)",
  },
  title: {
    color: "gold",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 12,
  },
  row: { marginBottom: 10 },
  label: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
  value: { color: "white", fontSize: 16, fontWeight: "600" },
  notice: { padding: 10, borderRadius: 10, marginTop: 8 },
  noticeError: { backgroundColor: "rgba(255,0,0,0.20)" },
  noticeInfo: { backgroundColor: "rgba(0,200,255,0.18)" },
  noticeText: { color: "white" },
  cooldownText: {
    marginTop: 10,
    color: "gold",
    fontWeight: "700",
  },
  actions: { marginTop: 16, gap: 10 },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnInner: { flexDirection: "row", gap: 10, alignItems: "center" },
  btnText: { fontWeight: "900", letterSpacing: 0.5 },
  btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.92 },
  btnDisabled: { opacity: 0.5 },
  btnMint: { backgroundColor: "#f1c40f" },
  btnSend: { backgroundColor: "#2ecc71" },
  btnTx: { backgroundColor: "#3498db" },
  link: { marginTop: 14, alignSelf: "center", padding: 8 },
  linkPressed: { opacity: 0.8 },
  linkText: { color: "rgba(255,255,255,0.85)", textDecorationLine: "underline" },
});
export default function Index() {
  const [chainId, setChainId] = useState<string>("");
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [skin, setSkin] = useState<SkinKey>("matrix-honeycomb");
  const [prefsLoadedForChain, setPrefsLoadedForChain] = useState<string>("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  // ✅ this prevents focus loss from background polling
  const [liveRefresh, setLiveRefresh] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);
  const [serviceFeeRate, setServiceFeeRate] = useState<number>(0);
  const [minGasFee, setMinGasFee] = useState<number>(ONE_SAT);

  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);

  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  const [mintBusy, setMintBusy] = useState<boolean>(false);
  const [mintCooldown, setMintCooldown] = useState<number>(0);

  const [txs, setTxs] = useState<TxLike[]>([]);

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);
  const [sendBusy, setSendBusy] = useState<boolean>(false);

  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);

  // ✅ Send glow pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sendGlowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.45] });
  const sendGlowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
  }

  async function refreshStatus() {
    const st: any = await getChainStatus();
    setChainId(String(st?.chainId || ""));
    setChainHeight(Number(st?.chainHeight || st?.height || 0));
    setMsUntilNextBlock(Number(st?.msUntilNextBlock || 0));
    setServiceFeeRate(Number(st?.serviceFeeRate || 0));
    setMinGasFee(Number(st?.minGasFee || ONE_SAT));
  }

  async function loadBalance() {
    if (!wallet) return;
    const b: any = await getBalance(wallet);
    setConfirmedBalance(Number(b?.confirmed || 0));
    setSpendableBalance(Number(b?.spendable || 0));
    setFeeVaultBalance(Number(b?.feeVault || 0));
  }

  async function loadTxs() {
    if (!wallet) return;
    const list = await getTransactions(wallet);
    setTxs(list || []);
  }

  async function hardRefreshAll() {
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
    })().catch(() => { });
  }, []);

  useEffect(() => {
    if (!wallet) return;
    hardRefreshAll();
  }, [wallet]);

  useEffect(() => {
    (async () => {
      if (!chainId) return;
      if (prefsLoadedForChain === chainId) return;

      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "honey") setTheme(savedTheme);

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix-honeycomb" || savedSkin === "solid-noir") setSkin(savedSkin);

      setPrefsLoadedForChain(chainId);
    })().catch(() => { });
  }, [chainId, prefsLoadedForChain]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(themeKeyForChain(chainId), theme).catch(() => { });
  }, [theme, chainId]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(skinKeyForChain(chainId), skin).catch(() => { });
  }, [skin, chainId]);

  // ✅ Poll only when liveRefresh is ON and user is NOT editing
  useEffect(() => {
    if (!wallet) return;
    if (!liveRefresh) return;

    const i = setInterval(async () => {
      if (isEditing) return;
      try {
        await refreshStatus();
        await loadBalance();
        await loadTxs();
      } catch { }
    }, 2500);

    return () => clearInterval(i);
  }, [wallet, liveRefresh, isEditing]);

  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted ✅");
      await hardRefreshAll();
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
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
      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  async function handleSendSubmit() {
    if (!quote) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");
    try {
      const gasFee = Number(quote.gasFee || minGasFee || ONE_SAT);
      const serviceFee = Number(quote.serviceFee || computeServiceFee(amount, serviceFeeRate));

      await send({ to, amount, gasFee, serviceFee });
      setConfirmOpen(false);
      setMessage("Send submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  function isMyPendingSend(t: any) {
    return t && t.type === "send" && t.status === "pending" && wallet && t.from === wallet && t.nonce != null;
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

  const matrixBg = useMemo(() => require("./assets/skins/matrix-honeycomb.png"), []);
  const bgSource = skin === "matrix-honeycomb" ? matrixBg : null;
  const bgOverlayOpacity = Platform.OS === "web" ? 0.55 : 0.32;

  function Card(props: { children: React.ReactNode; }) {
    return (
      <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
        <View style={{ padding: 14 }}>{props.children}</View>
      </GlassCard>
    );
  }

  function Button(props: { label: string; onPress: () => void; disabled?: boolean; variant?: "green" | "purple" | "outline" | "danger" | "blue"; }) {
    const v = props.variant || "green";
    const bg = v === "green" ? T.green :
      v === "purple" ? T.purple :
        v === "danger" ? T.danger :
          v === "blue" ? T.blue :
            "transparent";

    const fg = v === "green" ? "#041006" :
      v === "outline" ? T.text :
        "#fff";

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

  const Body = <><>
    <View style={{ flex: 1 }} />
    <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
      <View style={{ flex: 1 }} />
      <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => setSettingsOpen(true)}
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
      Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)}
    </Text>
  </>

    return
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
      <Card>
        <Text style={{ color: T.sub, marginBottom: 6 }}>Wallet</Text>
        <Text style={{ color: T.text, fontWeight: "900" }}>{shortAddr(wallet)}</Text>

        {message ? (
          <>
            <View style={{ marginTop: 10 }} />
            <Text style={{ color: "#ffd56a" }}>{message}</Text>
          </>
        ) : null}

        {cooldownText ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: T.sub }}>{cooldownText}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: T.sub, fontWeight: "900" }}>Live Refresh</Text>
          <Switch value={liveRefresh} onValueChange={setLiveRefresh} />
        </View>

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
              <Text style={{ color: rbfMultiplier === m ? T.gold : T.text }}>{m}x</Text>
            </Pressable>
          ))}
        </View>
      </Card><><View style={{ height: 14 }} /><Card>
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
        <Button label={mintLabel} onPress={handleMint} disabled={mintBusy || mintCooldown > 0} variant="purple" />
      </Card><View style={{ height: 14 }} /><Card>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Send</Text>

          <Text style={{ color: T.sub, marginBottom: 6 }}>To</Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
            <TextInput
              value={to}
              onChangeText={setTo}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
              placeholder="Recipient address"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={{ color: T.text, paddingVertical: 10, paddingHorizontal: 12 }}
              autoCapitalize="none"
              autoCorrect={false} />
          </View>

          <View style={{ height: 10 }} />

          <Text style={{ color: T.sub, marginBottom: 6 }}>Amount</Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
              placeholder="0.0"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="decimal-pad"
              style={{ color: T.text, paddingVertical: 10, paddingHorizontal: 12 }} />
          </View>

          <View style={{ height: 12 }} />

          {/* ✅ Pulsing neon glow behind Send */}
          <View style={{ position: "relative" }}>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: -8,
                right: -8,
                top: -8,
                bottom: -8,
                borderRadius: 16,
                borderWidth: 2,
                borderColor: T.green,
                opacity: sendGlowOpacity,
                transform: [{ scale: sendGlowScale }],
              }} />
            <Button label="Send" onPress={openSendConfirm} disabled={sendBusy} variant="green" />
          </View>

          <Text style={{ color: T.sub, marginTop: 10 }}>
            Service fee (est): {fmt8(computeServiceFee(amount, serviceFeeRate))}
          </Text>
        </Card><View style={{ height: 14 }} /><Card>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Recent Transactions</Text>
          {txs.length === 0 ? (
            <Text style={{ color: T.sub }}>No transactions yet.</Text>
          ) : (
            txs.slice(0, 6).map((t: any, idx: number) => {
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

                  {minePending ? (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button label="⚡ Boost" onPress={() => { setRbfTx(t); setRbfOpen(true); } } disabled={sendBusy} variant="blue" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button label="✖ Cancel" onPress={() => { setCancelTx(t); setCancelOpen(true); } } disabled={sendBusy} variant="danger" />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
          <View style={{ marginTop: 10 }}>
            <Button label="Open Full History" onPress={() => setHistoryOpen(true)} variant="outline" />
          </View>
        </Card></></></>;
  ScrollView >

    { /* Confirm Send */ }
    < Modal; transparent; visible = { confirmOpen }; animationType = "fade"; onRequestClose = {}(); setConfirmOpen(false);
}
