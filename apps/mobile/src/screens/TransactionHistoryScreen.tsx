import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { getTransactions, Transaction } from "../chain/transactions";

type Props = { address?: string };

function shortId(id: string) {
  const s = String(id || "");
  if (s.length <= 20) return s;
  return `${s.slice(0, 8)}...${s.slice(-8)}`;
}

export default function TransactionHistoryScreen({ address }: Props) {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setErr(null);
        const r:any = await getTransactions(address);
        if (!dead) setTxs(Array.isArray(r) ? r : r?.txs ?? []);
      } catch (e:any) {
        if (!dead) setErr(String(e?.message || e));
      }
    })();
    return () => { dead = true; };
  }, [address]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Transaction History</Text>
      {address ? <Text style={styles.sub}>Wallet: {address}</Text> : null}
      {err ? <Text style={styles.error}>{err}</Text> : null}

      {txs.length === 0 ? (
        <Text style={styles.empty}>No transactions yet.</Text>
      ) : (
        txs.map((tx: any) => (
          <View key={String(tx.id)} style={styles.card}>
            <Text style={styles.line}>{String(tx.type || "tx")} • {String(tx.status || "unknown")}</Text>
            <Text style={styles.muted}>From: {String(tx.from || tx.fromWallet || "")}</Text>
            <Text style={styles.muted}>To: {String(tx.to || tx.toWallet || "")}</Text>
            <Text style={styles.muted}>Amount: {String(tx.amount)}</Text>
            <Text style={styles.muted}>Nonce: {String(tx.nonce ?? "")}</Text>
            {tx.blockHeight != null ? <Text style={styles.muted}>Block: {String(tx.blockHeight)}</Text> : null}

            <TouchableOpacity
              onPress={async () => {
                try { await Clipboard.setStringAsync(String(tx.id)); } catch {}
              }}
            >
              <Text style={styles.muted}>TxID: {shortId(String(tx.id))} (tap to copy)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push(`/tx/${encodeURIComponent(String(tx.id))}`)}
              style={styles.detailsBtn}
            >
              <Text style={styles.detailsText}>Details</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: "#111", padding: 24 },
  back: { color: "#60a5fa", fontWeight: "900", marginBottom: 12 },
  title: { color: "#fff", fontSize: 20, fontWeight: "900" },
  sub: { color: "#aaa", marginTop: 6, marginBottom: 12, fontWeight: "800" },
  error: { color: "#f87171", fontWeight: "900", marginTop: 10 },
  empty: { color: "#aaa", marginTop: 10, fontWeight: "800" },
  card: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginTop: 12,
  },
  line: { color: "#fff", fontWeight: "900", marginBottom: 6 },
  muted: { color: "#ddd", fontWeight: "700", marginTop: 2 },
  detailsBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(96,165,250,0.25)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.55)",
  },
  detailsText: { color: "#60a5fa", fontWeight: "900" },
});
