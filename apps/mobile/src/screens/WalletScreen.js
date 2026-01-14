import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { getBalance, mint } from "../api";

const WALLET = "demo-wallet";

export default function WalletScreen({ navigation }) {
  const [balance, setBalance] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [minting, setMinting] = useState(false);

  useEffect(() => {
    loadBalance();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;

    const interval = setInterval(() => {
      setCooldown((c) => c - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown]);

  async function loadBalance() {
    const data = await getBalance(WALLET);
    setBalance(data.balance);
  }

  async function handleMint() {
    setMinting(true);

    const result = await mint(WALLET);

    if (!result.success) {
      setCooldown(result.cooldownSeconds);
      setMinting(false);
      return;
    }

    setBalance(result.data.balance);
    setCooldown(result.data.cooldownSeconds);
    setMinting(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HIVE Wallet</Text>
      <Text style={styles.balance}>Balance: {balance} HNY</Text>

      <TouchableOpacity
        style={[
          styles.button,
          cooldown > 0 && styles.disabled,
        ]}
        disabled={cooldown > 0 || minting}
        onPress={handleMint}
      >
        <Text style={styles.buttonText}>
          {cooldown > 0 ? `Mint (${cooldown}s)` : "Mint"}
        </Text>
      </TouchableOpacity>

      {cooldown > 0 && (
        <Text style={styles.cooldownText}>
          Cooldown active — {cooldown}s remaining
        </Text>
      )}

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => navigation.navigate("Send")}
      >
        <Text style={styles.secondaryText}>Send Tokens</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => navigation.navigate("Transactions")}
      >
        <Text style={styles.secondaryText}>Transaction History</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    color: "#fff",
    marginBottom: 10,
  },
  balance: {
    fontSize: 18,
    color: "#ccc",
    marginBottom: 20,
  },
  button: {
    backgroundColor: "#b08d2f",
    padding: 15,
    borderRadius: 10,
    width: 200,
    alignItems: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#000",
    fontWeight: "bold",
  },
  cooldownText: {
    color: "#ffcc00",
    marginTop: 10,
  },
  secondaryButton: {
    marginTop: 15,
  },
  secondaryText: {
    color: "#fff",
    textDecorationLine: "underline",
  },
});
