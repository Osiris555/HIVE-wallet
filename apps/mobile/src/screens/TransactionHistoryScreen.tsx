import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { getTransactions, Transaction } from "../chain/transactions";

type Props = {
  address?: string;
};

export default function TransactionHistoryScreen({ address }: Props) {
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    getTransactions(address).then(setTxs).catch(console.error);
  }, [address]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>

      {txs.map((tx, index) => (
        <Text key={tx.id ?? index} style={styles.tx}>
          {tx.type} {tx.amount} HNY {tx.to ?? ""}
        </Text>
      ))}
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
  },
  tx: {
    color: "#fff",
    marginBottom: 8,
  },
});
