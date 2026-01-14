import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, ActivityIndicator } from "react-native";
import { fetchBalance, mintTokens } from "../chain/transactions";

const DEMO_ADDRESS = "honey_demo_address_001";

export default function FaucetScreen() {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [cooldown, setCooldown] = useState<number>(0);

  /**
   * Fetch balance on load
   */
  const loadBalance = async () => {
    try {
      const b = await fetchBalance(DEMO_ADDRESS);
      setBalance(b);
    } catch {
      // handled in axios
    }
  };

  useEffect(() => {
    loadBalance();
  }, []);

  /**
   * Cooldown timer
   */
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((c) => c - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  /**
   * Mint handler
   */
  const handleMint = async () => {
    try {
      setLoading(true);
      const res = await mintTokens(DEMO_ADDRESS);

      if (res.cooldownSeconds) {
        setCooldown(res.cooldownSeconds);
      }

      // 🔑 CRITICAL FIX — refresh balance immediately
      await loadBalance();
    } catch {
      // handled in axios
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🍯 HIVE Faucet</Text>

      <Text style={styles.balance}>Balance: {balance} HONEY</Text>

      {loading && <ActivityIndicator size="large" />}

      <Button
        title={
          cooldown > 0
            ? `Cooldown (${cooldown}s)`
            : "Mint HONEY"
        }
        disabled={cooldown > 0 || loading}
        onPress={handleMint}
      />

      {/* ✅ ALWAYS VISIBLE UI */}
      <View style={styles.section}>
        <Button
          title="Send Tokens"
          disabled={balance === 0}
          onPress={() => console.log("Send pressed")}
        />
      </View>

      <View style={styles.section}>
        <Button
          title="Transaction History"
          onPress={() => console.log("History pressed")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 16,
    textAlign: "center",
  },
  balance: {
    fontSize: 18,
    marginBottom: 24,
    textAlign: "center",
  },
  section: {
    marginTop: 16,
  },
});
