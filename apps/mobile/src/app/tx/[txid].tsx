// apps/mobile/src/app/tx/[txid].tsx
import React from "react";
import { useLocalSearchParams } from "expo-router";
import TxDetailsScreen from "../../screens/TxDetailsScreen";

export default function TxDetailsRoute() {
  const { txid } = useLocalSearchParams<{ txid?: string }>();
  return <TxDetailsScreen txid={String(txid || "")} />;
}
