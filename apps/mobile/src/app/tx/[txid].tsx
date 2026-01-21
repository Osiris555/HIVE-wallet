// apps/mobile/src/app/tx/[txid].tsx
import React from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TxDetailsScreen from "../../screens/TxDetailsScreen";

export default function TxDetailsByIdRoute() {
  const { txid } = useLocalSearchParams<{ txid?: string }>();
  const id = String(txid || "").trim();

  if (!id) {
    return (
      <View style={{ flex: 1, padding: 20, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Missing txid</Text>
      </View>
    );
  }

  return <TxDetailsScreen txid={id} />;
}
