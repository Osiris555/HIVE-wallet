import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

const SERVER = "http://192.168.0.15:3000";
const WALLET = "HNY1_DEV_WALLET";

export default function WalletScreen({ navigation }: any) {
  const [balance, setBalance] = useState(0);
  const [cooldownMs, setCooldownMs] = useState<number | null>(null);

  async function loadBalance() {
    const res = await fetch(`${SERVER}/balance/${WALLET}`);
    const data = await res.json();
    setBalance(data.balance);
  }

  async function mint() {
    try {
      const res = await fetch(`${SERVER}/mint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: WALLET }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429 && data.retryAfterMs) {
          setCooldownMs(data.retryAfterMs);
          return;
        }
        alert(data.error || "Mint failed");
        return;
      }

      setCooldownMs(null);
      await loadBalance();
    } catch (err) {
      console.error(err);
      alert("Mint failed");
    }
  }

  useEffect(() => {
    loadBalance();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (cooldownMs === null) return;

    const interval = setInterval(() => {
      setCooldownMs((prev) => {
        if (!prev || prev <= 1000) {
          clearInterval(interval);
          return null;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownMs]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HIVE Wallet</Text>
      <Text style={styles.balance}>Balance: {balance} HNY</Text>

      {cooldownMs !== null && (
        <Text style={styles.cooldown}>
          Cooldown active – {Math.ceil(cooldownMs / 1000)}s remaining
        </Text>
      )}

      <TouchableOpacity style={styles.mint} onPress={mint}>
        <Text style={styles.buttonText}>MINT</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.send}>
        <Text style={styles.buttonText}>SEND</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tx}
        onPress={() => navigation.navigate("Transactions")}
      >
        <Text style={styles.buttonText}>VIEW TRANSACTIONS</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    padding: 20,
  },
  title: {
    color: "gold",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 10,
  },
  balance: {
    color: "#fff",
    fontSize: 18,
    marginBottom: 10,
  },
  cooldown: {
    color: "red",
    marginBottom: 10,
  },
  mint: {
    backgroundColor: "#f1c40f",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  send: {
    backgroundColor: "#2ecc71",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  tx: {
    backgroundColor: "#3498db",
    padding: 15,
    borderRadius: 8,
  },
  buttonText: {
    textAlign: "center",
    fontWeight: "bold",
  },
});
