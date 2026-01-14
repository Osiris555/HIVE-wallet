import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { getTransactions } from "../chain/transactions";

export default function TransactionsScreen() {
  const router = useRouter();
  const [txs, setTxs] = useState<any[]>([]);

  useEffect(() => {
    getTransactions().then(setTxs);
  }, []);

  return (
    <View style={styles.container}>
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Transaction History</Text>

      <ScrollView>
        {txs.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <Text style={styles.type}>{tx.type}</Text>
            <Text style={styles.amount}>{tx.amount} HNY</Text>
            <Text style={styles.status}>Status: {tx.status}</Text>
            <Text style={styles.time}>{tx.timestamp}</Text>
            <Text style={styles.id}>TxID: {tx.id}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    padding: 20,
  },
  back: {
    marginBottom: 10,
  },
  backText: {
    color: "#3498db",
    fontSize: 16,
  },
  title: {
    color: "gold",
    fontSize: 24,
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#111",
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
  },
  type: {
    color: "#5dade2",
    fontWeight: "bold",
  },
  amount: {
    color: "#fff",
    fontSize: 16,
  },
  status: {
    color: "#2ecc71",
  },
  time: {
    color: "#aaa",
    fontSize: 12,
  },
  id: {
    color: "#666",
    fontSize: 11,
    marginTop: 4,
  },
});
