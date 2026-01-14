import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { getTransactions } from "../api";

const WALLET = "demo-wallet";

export default function TransactionsScreen() {
  const [txs, setTxs] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await getTransactions(WALLET);
    setTxs(data);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transactions</Text>

      <FlatList
        data={txs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.tx}>
            <Text style={styles.text}>
              {item.type.toUpperCase()} — {item.amount} HNY
            </Text>
            <Text style={styles.sub}>
              {item.status} • {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingTop: 50,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    textAlign: "center",
    marginBottom: 20,
  },
  tx: {
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    padding: 10,
  },
  text: {
    color: "#fff",
  },
  sub: {
    color: "#777",
    fontSize: 12,
  },
});
