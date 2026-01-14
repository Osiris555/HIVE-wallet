import { View, Text, Button, Alert } from "react-native";
import { useEffect, useState } from "react";

const SERVER = "http://192.168.0.11:3000";
const WALLET = "HNY1_DEV_WALLET";
const ADMIN_KEY = "DEV_ADMIN_SECRET";

export default function App() {
  const [balance, setBalance] = useState(0);

  async function refresh() {
    const res = await fetch(`${SERVER}/balance/${WALLET}`);
    const data = await res.json();
    setBalance(data.balance);
  }

  async function mint() {
    const res = await fetch(`${SERVER}/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: WALLET,
        adminKey: ADMIN_KEY,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      Alert.alert("Mint blocked", data.error);
      return;
    }

    Alert.alert("Success", `Minted ${data.amount} HNY`);
    refresh();
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <View style={{ padding: 20 }}>
      <Text>Balance: {balance} HONEY</Text>
      <Button title="Admin Mint" onPress={mint} />
    </View>
  );
}
