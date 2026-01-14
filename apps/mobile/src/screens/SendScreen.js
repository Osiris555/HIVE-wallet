import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { send } from "../api";

const WALLET = "demo-wallet";

export default function SendScreen({ navigation }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  async function handleSend() {
    await send(WALLET, to, Number(amount));
    navigation.goBack();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Send Tokens</Text>

      <TextInput
        style={styles.input}
        placeholder="Recipient Wallet"
        placeholderTextColor="#777"
        value={to}
        onChangeText={setTo}
      />

      <TextInput
        style={styles.input}
        placeholder="Amount"
        placeholderTextColor="#777"
        keyboardType="numeric"
        value={amount}
        onChangeText={setAmount}
      />

      <TouchableOpacity style={styles.button} onPress={handleSend}>
        <Text style={styles.buttonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    marginBottom: 20,
  },
  input: {
    width: 250,
    borderWidth: 1,
    borderColor: "#555",
    color: "#fff",
    padding: 10,
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#b08d2f",
    padding: 15,
    borderRadius: 10,
  },
  buttonText: {
    fontWeight: "bold",
  },
});
