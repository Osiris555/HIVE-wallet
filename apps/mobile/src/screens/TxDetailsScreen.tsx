// apps/mobile/src/screens/TxDetailsScreen.tsx
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { getTransactionById, type Transaction } from "../chain/transactions";

type Props = {
  txid: string;
};

function kv(label: string, value: any) {
  const v = value === null || value === undefined || value === "" ? "—" : String(value);
  return { label, value: v };
}

export default function TxDetailsScreen({ txid }: Props) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [err, setErr] = useState<string>("");
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr("");
        setTx(null);
        const out = await getTransactionById(txid);
        if (!alive) return;
        if (!out) {
          setErr("Transaction not found.");
          return;
        }
        setTx(out);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message || e || "Failed to load tx"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [txid]);

  async function copy(value: string) {
    try {
      await Clipboard.setStringAsync(value);
      setCopied("Copied!");
      setTimeout(() => setCopied(""), 1200);
    } catch {
      setCopied("Copy failed");
      setTimeout(() => setCopied(""), 1200);
    }
  }

  const fields = tx
    ? [
        kv("TxID", (tx as any).id || (tx as any).hash || txid),
        kv("Hash", (tx as any).hash || "—"),
        kv("Type", (tx as any).type),
        kv("Status", (tx as any).status),
        kv("From", (tx as any).fromWallet || (tx as any).from || "—"),
        kv("To", (tx as any).toWallet || (tx as any).to || "—"),
        kv("Amount", (tx as any).amount),
        kv("Nonce", (tx as any).nonce),
        kv("Gas fee", (tx as any).gasFee),
        kv("Service fee", (tx as any).serviceFee),
        kv("Expires at", (tx as any).expiresAtMs ? new Date(Number((tx as any).expiresAtMs)).toISOString() : "—"),
        kv("Timestamp", (tx as any).timestampMs ? new Date(Number((tx as any).timestampMs)).toISOString() : "—"),
        kv("Block height", (tx as any).blockHeight),
        kv("Block hash", (tx as any).blockHash),
        kv("Fail reason", (tx as any).failReason),
      ]
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.title}>Transaction details</Text>
        <View style={{ width: 36 }} />
      </View>

      {!!copied && <Text style={styles.copied}>{copied}</Text>}
      {!!err && <Text style={styles.error}>{err}</Text>}
      {!err && !tx && <Text style={styles.loading}>Loading…</Text>}

      {tx && (
        <ScrollView contentContainerStyle={styles.card}>
          {fields.map((f) => (
            <View key={f.label} style={styles.row}>
              <Text style={styles.label}>{f.label}</Text>
              <Pressable
                onPress={() => {
                  if (f.value === "—") return;
                  copy(f.value);
                }}
                style={styles.valueWrap}
              >
                <Text style={styles.value}>{f.value}</Text>
                {f.value !== "—" && <Text style={styles.tap}>Tap to copy</Text>}
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b", paddingTop: 48, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "900" },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  backTxt: { color: "#fff", fontSize: 18, fontWeight: "900" },
  loading: { color: "#ddd", paddingVertical: 8 },
  error: { color: "#f87171", paddingVertical: 8, fontWeight: "800" },
  copied: { color: "#86efac", paddingVertical: 6, fontWeight: "900" },
  card: { paddingBottom: 40, gap: 12 },
  row: { backgroundColor: "#121212", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#1f1f1f" },
  label: { color: "#9ca3af", fontWeight: "900", marginBottom: 6 },
  valueWrap: { gap: 6 },
  value: { color: "#fff", fontWeight: "800" },
  tap: { color: "#60a5fa", fontWeight: "800", fontSize: 12 },
});
