// apps/mobile/src/app/tx-details.tsx
import React from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TxDetailsScreen from "../screens/TxDetailsScreen";

export default function TxDetailsRoute() {
  const { txid } = useLocalSearchParams<{ txid?: string }>();
  const id = String(txid || "").trim();

  if (!id) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0b0b0b", paddingTop: 60, paddingHorizontal: 16 }}>
        <Text style={{ color: "#fff", fontWeight: "900" }}>Missing txid</Text>
      </View>
    );
  }

  return <TxDetailsScreen txid={id} />;
}
