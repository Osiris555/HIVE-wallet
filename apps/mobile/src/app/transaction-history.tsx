// apps/mobile/src/app/transaction-history.tsx
import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import TransactionHistoryScreen from "../screens/TransactionHistoryScreen";
import { ensureWalletId } from "../chain/transactions";

export default function TransactionHistoryRoute() {
  const { address } = useLocalSearchParams<{ address?: string }>();
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(address || null);

  useEffect(() => {
    (async () => {
      if (resolvedAddress) return;
      const w = await ensureWalletId();
      setResolvedAddress(String(w || ""));
    })().catch(() => {});
  }, [resolvedAddress]);

  if (!resolvedAddress) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>Loading wallet…</Text>
      </View>
    );
  }

  return <TransactionHistoryScreen address={resolvedAddress} />;
}
