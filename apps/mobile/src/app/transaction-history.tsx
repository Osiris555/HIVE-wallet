import { useLocalSearchParams } from "expo-router";
import TransactionHistoryScreen from "../screens/TransactionHistoryScreen";

export default function TransactionHistoryRoute() {
  const { address } = useLocalSearchParams<{ address: string }>();

  if (!address) {
    return null;
  }

  return <TransactionHistoryScreen address={address} />;
}
