import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  ensureWalletId,
  getBalance,
  mint as chainMint,
} from "../src/chain/transactions";

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
