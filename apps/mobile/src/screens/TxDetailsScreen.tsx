// apps/mobile/src/screens/TxDetailsScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { getTransactionById } from "../chain/transactions";

type Props = { txid: string };

function Row({ label, value }: { label: string; value: any }) {
  const v = value == null ? "" : String(value);
  return (
    <Pressable
      hitSlop={8}
      onPress={async () => {
        if (!v) return;
        try {
          await Clipboard.setStringAsync(v);
          setCopied(`${label} copied`);
          setTimeout(() => setCopied(""), 1200);
        } catch {}
      }}
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{v || "—"}</Text>
    </Pressable>
  );
}

export default function TxDetailsScreen({ txid }: Props) {
  const insets = useSafeAreaInsets();
  const id = String(txid || "").trim();
  const [tx, setTx] = useState<any>(null);
  const [copied, setCopied] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setErr(null);
        const r:any = await getTransactionById(id);
        if (!dead) setTx(r?.tx ?? r);
      } catch (e: any) {
        if (!dead) setErr(String(e?.message || e));
      }
    })();
    return () => { dead = true; };
  }, [id]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000", paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={styles.container}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Tx Details</Text>
      </View>

      {copied ? <Text style={styles.copied}>{copied}</Text> : null}

      {err ? <Text style={styles.error}>{err}</Text> : null}

      {!tx ? (
        <Text style={styles.loading}>Loading…</Text>
      ) : (
        <View style={{ gap: 8 }}>
          <Row label="TxID" value={tx.id || tx.txid} />
          <Row label="Hash" value={tx.hash} />
          <Row label="Type" value={tx.type} />
          <Row label="Status" value={tx.status} />
          <Row label="From" value={tx.fromWallet || tx.from} />
          <Row label="To" value={tx.toWallet || tx.to} />
          <Row label="Amount" value={tx.amount} />
          <Row label="Nonce" value={tx.nonce} />
          <Row label="Gas fee" value={tx.gasFee} />
          <Row label="Service fee" value={tx.serviceFee} />
          <Row label="Block height" value={tx.blockHeight} />
          <Row label="Block hash" value={tx.blockHash} />
          <Row label="Timestamp" value={tx.timestamp || tx.timeMs || tx.time} />
          <Row label="Fail reason" value={tx.failReason} />
        </View>
      )}

      <Text style={styles.hint}>Tap any row to copy its value.</Text>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: "#111", flexGrow: 1 },
  back: { color: "#60a5fa", fontWeight: "900", marginRight: 12 },
  title: { color: "#fff", fontSize: 20, fontWeight: "900" },
  copied: {
    marginBottom: 10,
    fontSize: 13,
    opacity: 0.9,
  },

  loading: { color: "#aaa", fontWeight: "800", marginTop: 10 },
  error: { color: "#f87171", fontWeight: "900", marginBottom: 10 },
  row: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  label: { color: "#aaa", fontWeight: "900", marginBottom: 4 },
  value: { color: "#fff", fontWeight: "800" },
  hint: { color: "#aaa", marginTop: 16, fontWeight: "700" },
});
