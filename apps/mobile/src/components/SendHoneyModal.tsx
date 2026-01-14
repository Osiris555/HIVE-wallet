import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend: (to: string, amount: number) => void;
};

export default function SendHoneyModal({
  visible,
  onClose,
  onSend,
}: Props) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const handleSend = () => {
    const value = Number(amount);

    if (!to.trim()) {
      Alert.alert("Invalid Address", "Recipient address is required.");
      return;
    }

    if (isNaN(value) || value <= 0) {
      Alert.alert("Invalid Amount", "Enter a valid amount.");
      return;
    }

    onSend(to.trim(), value);
    setTo("");
    setAmount("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Send HONEY</Text>

          <TextInput
            placeholder="Recipient Address"
            value={to}
            onChangeText={setTo}
            style={styles.input}
            autoCapitalize="none"
          />

          <TextInput
            placeholder="Amount"
            value={amount}
            onChangeText={setAmount}
            style={styles.input}
            keyboardType="numeric"
          />

          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSend}>
              <Text style={styles.send}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "85%",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFD54F",
    marginBottom: 12,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#222",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    marginBottom: 10,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },
  cancel: {
    color: "#aaa",
    fontSize: 16,
  },
  send: {
    color: "#FFD54F",
    fontSize: 16,
    fontWeight: "600",
  },
});
