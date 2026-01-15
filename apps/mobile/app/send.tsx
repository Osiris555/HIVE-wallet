import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  ensureWalletId,
  getBalance,
  quoteSend,
  send as chainSend,
  fmt8,
} from "../src/chain/transactions";

type Quote = {
  chainId: string;
  gasFee: number;
  serviceFee: number;
  totalFee: number;
  totalCost: number;
};

export default function Send() {
  const router = useRouter();

  const [from, setFrom] = useState<string>("");
  const [balance, setBalance] = useState<number>(0);

  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  async function refresh() {
    const wid = await ensureWalletId();
    setFrom(wid);
    const b = await getBalance(wid);
    setBalance(Number(b?.balance || 0));
  }

  useEffect(() => {
    refresh().catch((e) => {
      console.error(e);
      Alert.alert("Error", "Could not connect to the dev server.");
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setQuote(null);
      const amt = Number(amount);
      if (!to || !Number.isFinite(amt) || amt <= 0) return;
      try {
        const q = await quoteSend(to.trim(), amt);
        if (cancelled) return;
        setQuote({
          chainId: String(q.chainId),
          gasFee: Number(q.gasFee),
          serviceFee: Number(q.serviceFee),
          totalFee: Number(q.totalFee),
          totalCost: Number(q.totalCost),
        });
      } catch (e: any) {
        if (cancelled) return;
        console.error(e);
        setQuote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [to, amount]);

  async function onSend() {
    const amt = Number(amount);
    if (!to.trim()) return Alert.alert("Missing address", "Enter a recipient wallet address.");
    if (!Number.isFinite(amt) || amt <= 0) return Alert.alert("Invalid amount", "Amount must be positive.");
    if (!quote) return Alert.alert("Quote unavailable", "Enter a valid amount and recipient to calculate fees.");

    setBusy(true);
    try {
      await chainSend({
        to: to.trim(),
        amount: amt,
        gasFee: quote.gasFee,
        serviceFee: quote.serviceFee,
      });
      await refresh();
      Alert.alert("Submitted", "Send transaction submitted.");
      router.push("/history");
    } catch (e: any) {
      console.error(e);
      const status = Number(e?.status || e?.response?.status || 0);
      const data = e?.data || e?.response?.data;
      const msg = String(data?.error || e?.message || "Send failed") + (status ? ` (HTTP ${status})` : "");
      Alert.alert("Send failed", msg);
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.card}
        >
          <Text style={styles.title}>Send</Text>

          <Text style={styles.meta} numberOfLines={1}>
            From: {from || "…"}
          </Text>
          <Text style={styles.meta}>Balance: {fmt8(balance)} HNY</Text>

          <Text style={styles.label}>To</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="HNY_…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            autoCapitalize="none"
            style={styles.input}
          />

          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={amountStr}
            onChangeText={setAmountStr}
            placeholder="0.0"
            placeholderTextColor="rgba(255,255,255,0.45)"
            keyboardType="decimal-pad"
            style={styles.input}
          />

          <View style={styles.quoteBox}>
            <Text style={styles.quoteTitle}>Fees</Text>
            <Text style={styles.quoteLine}>
              Gas fee: {quote ? fmt8(quote.gasFee) : "—"}
            </Text>
            <Text style={styles.quoteLine}>
              Service fee: {quote ? fmt8(quote.serviceFee) : "—"}
            </Text>
            <Text style={styles.quoteLine}>
              Total fee: {quote ? fmt8(quote.totalFee) : "—"}
            </Text>
            <Text style={styles.quoteLine}>
              Total cost: {quote ? fmt8(quote.totalCost) : "—"}
            </Text>
          </View>

          <View style={styles.row}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.btn, styles.btnBack, pressed ? styles.pressed : null]}
            >
              <Text style={styles.btnText}>Back</Text>
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={onSend}
              style={({ pressed }) => [
                styles.btn,
                styles.btnSend,
                busy ? styles.disabled : null,
                pressed && !busy ? styles.pressed : null,
              ]}
            >
              <View style={styles.btnInner}>
                {busy ? <ActivityIndicator /> : null}
                <Text style={styles.btnText}>{busy ? "SENDING" : "Send"}</Text>
              </View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
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
  title: { color: "gold", fontSize: 28, fontWeight: "900", marginBottom: 8 },
  meta: { color: "rgba(255,255,255,0.85)", marginTop: 4 },
  label: { marginTop: 14, color: "rgba(255,255,255,0.75)", fontSize: 12 },
  input: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    color: "white",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  quoteBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  quoteTitle: { color: "gold", fontWeight: "900", marginBottom: 6 },
  quoteLine: { color: "rgba(255,255,255,0.85)", marginTop: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 20 },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  btnText: { fontWeight: "900", letterSpacing: 0.3 },
  btnBack: { backgroundColor: "rgba(255,255,255,0.12)" },
  btnSend: { backgroundColor: "#2ecc71" },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.6 },
});
