import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { getTransactions, Transaction } from "../chain/transactions";

type Props = {
  address?: string;
};

function shortTxId(id: string) {
  const s = String(id || "");
  if (!s) return "";
  if (s.length <= 16) return s;
  return s.slice(0, 10) + "…" + s.slice(-10);
}

export default function TransactionHistoryScreen({ address }: Props) {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    if (!address) {
      setTxs([]);
      return;
    }
    getTransactions(address).then(setTxs).catch(console.error);
  }, [address]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>

      {copied ? <Text style={styles.copied}>{copied}</Text> : null}

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {txs.length === 0 ? (
          <Text style={styles.empty}>No transactions yet.</Text>
        ) : (
          txs.map((tx, index) => {
            const txid = String(tx.id || tx.hash || "");
            return (
              <View key={txid || String(index)} style={styles.card}>
                <Text style={styles.line}>
                  <Text style={styles.bold}>{tx.type}</Text> • {tx.status || "unknown"} • {tx.amount} HNY
                </Text>
                <Text style={styles.line}>From: {tx.from || "—"}</Text>
                <Text style={styles.line}>To: {tx.to || "—"}</Text>
                <Text style={styles.line}>Nonce: {String(tx.nonce ?? "—")}</Text>
                {tx.blockHeight != null ? (
                  <Text style={styles.line}>Block: {String(tx.blockHeight)}</Text>
                ) : null}

                <Pressable
                  onPress={async () => {
                    if (!txid) return;
                    try {
                      await Clipboard.setStringAsync(txid);
                      setCopied("Copied txid: " + shortTxId(txid));
                      setTimeout(() => setCopied(""), 1800);
                    } catch {}
                  }}
                >
                  <Text style={[styles.line, styles.txid]}>TxID: {shortTxId(txid) || "—"}</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (!txid) return;
                    router.push(`/tx/${encodeURIComponent(txid)}`);
                  }}
                  style={{ marginTop: 6 }}
                >
                  <Text style={[styles.line, { color: "#60a5fa", fontWeight: "800" }]}>View details</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    padding: 24,
  },
  back: {
    color: "#facc15",
    marginBottom: 12,
    fontWeight: "800",
  },
  copied: {
    color: "#93c5fd",
    marginBottom: 10,
    fontWeight: "700",
  },
  empty: {
    color: "#aaa",
    marginTop: 12,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#151515",
  },
  line: {
    color: "#fff",
    marginBottom: 6,
  },
  bold: {
    fontWeight: "900",
  },
  txid: {
    color: "#93c5fd",
    fontWeight: "800",
  },
});
