import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, Alert, StyleSheet } from "react-native";
import { useWalletStore } from "../state/walletStore";
import { ADMIN_WALLET } from "../config/admin";
import {
  resetFaucetAll,
  resetFaucetWallet,
  getFaucetState,
} from "../chain/faucetChainState";

export default function FaucetAdminScreen() {
  const wallet = useWalletStore((s) => s.address);
  const [target, setTarget] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    getFaucetState().then((s) => setTotal(s.totalMinted));
  }, []);

  if (wallet !== ADMIN_WALLET) {
    return (
      <View style={styles.container}>
        <Text style={styles.denied}>ACCESS DENIED</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Faucet Admin</Text>
      <Text style={styles.stat}>Total Minted: {total} HNY</Text>

      <TextInput
        placeholder="Wallet address"
        placeholderTextColor="#666"
        value={target}
        onChangeText={setTarget}
        style={styles.input}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={async () => {
          await resetFaucetWallet(target);
          Alert.alert("Wallet Reset");
        }}
      >
        <Text style={styles.buttonText}>Reset Wallet</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.danger}
        onPress={async () => {
          await resetFaucetAll();
          Alert.alert("Faucet Reset");
        }}
      >
        <Text style={styles.dangerText}>RESET ENTIRE FAUCET</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 20 },
  title: { color: "#f5c542", fontSize: 26, marginBottom: 20 },
  stat: { color: "#ccc", marginBottom: 20 },
  denied: {
    color: "red",
    fontSize: 24,
    textAlign: "center",
    marginTop: 100,
  },
  input: {
    borderColor: "#444",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: "#fff",
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#555",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 20,
  },
  danger: {
    backgroundColor: "#ff4444",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff" },
  dangerText: { color: "#000", fontWeight: "bold" },
});
