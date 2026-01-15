import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
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
  getTransactions,
  fmt8,
  type Transaction,
} from "../src/chain/transactions";

function shortId(id: string) {
  if (!id) return "";
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export default function History() {
  const router = useRouter();
  const [wallet, setWallet] = useState<string>("");
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState<string>("");

  async function refresh() {
    setError("");
    const wid = await ensureWalletId();
    setWallet(wid);
    const list = await getTransactions(wid);
    // newest first
    const sorted = [...(list || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    setTxs(sorted);
  }

  useEffect(() => {
    refresh().catch((e: any) => {
      console.error(e);
      setError(String(e?.data?.error || e?.message || "Failed to load transactions"));
    });
  }, []);

  const header = useMemo(() => {
    return (
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {wallet ? `Wallet: ${wallet}` : "…"}
        </Text>

        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.hBtn, pressed ? styles.pressed : null]}
          >
            <Text style={styles.hBtnText}>Back</Text>
          </Pressable>
          <Pressable
            onPress={() => refresh().catch(() => {})}
            style={({ pressed }) => [styles.hBtn, pressed ? styles.pressed : null]}
          >
            <Text style={styles.hBtnText}>Refresh</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [wallet, error]);

  return (
    <ImageBackground
      source={require("../images/honeycomb-texture.png")}
      resizeMode="cover"
      style={styles.bg}
    >
      <SafeAreaView style={styles.safe}>
        <FlatList
          data={txs}
          keyExtractor={(item) => String(item.id || item.hash || Math.random())}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.txCard}>
              <View style={styles.txTop}>
                <Text style={styles.txType}>{String(item.type).toUpperCase()}</Text>
                <Text style={styles.txStatus}>{(item.status || "pending").toUpperCase()}</Text>
              </View>

              <Text style={styles.txLine}>id: {shortId(String(item.id || ""))}</Text>
              <Text style={styles.txLine}>amount: {fmt8(Number(item.amount || 0))} HNY</Text>
              {item.type === "send" ? (
                <>
                  <Text style={styles.txLine} numberOfLines={1}>
                    to: {String(item.to || "")}
                  </Text>
                  <Text style={styles.txLine} numberOfLines={1}>
                    from: {String(item.from || "")}
                  </Text>
                </>
              ) : (
                <Text style={styles.txLine} numberOfLines={1}>
                  to: {String(item.to || "")}
                </Text>
              )}

              {item.failReason ? (
                <Text style={styles.fail}>fail: {String(item.failReason)}</Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No transactions yet.</Text>
            </View>
          }
        />
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  header: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.25)",
    marginBottom: 12,
  },
  title: { color: "gold", fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: 6, color: "rgba(255,255,255,0.8)" },
  headerButtons: { flexDirection: "row", gap: 10, marginTop: 12 },
  hBtn: {
    backgroundColor: "rgba(255,255,255,0.10)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  hBtnText: { color: "white", fontWeight: "700" },
  pressed: { opacity: 0.85 },
  errorBox: { marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,0,0,0.20)" },
  errorText: { color: "white" },
  txCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginBottom: 10,
  },
  txTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  txType: { color: "gold", fontWeight: "900" },
  txStatus: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },
  txLine: { color: "rgba(255,255,255,0.85)", marginTop: 2 },
  fail: { marginTop: 6, color: "#ffb3b3", fontWeight: "700" },
  empty: { padding: 22, alignItems: "center" },
  emptyText: { color: "rgba(255,255,255,0.8)" },
});
