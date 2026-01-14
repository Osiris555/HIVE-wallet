import axios from "axios";
import { Platform } from "react-native";

const BASE_URL = Platform.select({
  web: "http://localhost:3000",
  default: "http://192.168.1.42:3000", // replace with your LAN IP
});

if (!BASE_URL) {
  throw new Error("BASE_URL not resolved");
}

export type Transaction = {
  id?: number;
  type: string;
  from?: string;
  to?: string;
  amount: number;
  status?: string;
  timestamp?: number;
};

export async function fetchBalance(address: string): Promise<number> {
  const res = await axios.get(`${BASE_URL}/balance/${address}`);
  return res.data.balance;
}

export async function mintTokens(
  address: string
): Promise<{ cooldownSeconds?: number } | void> {
  const res = await axios.post(`${BASE_URL}/mint`, { address });
  return res.data;
}

export async function getTransactions(
  address?: string
): Promise<Transaction[]> {
  const res = await axios.get(
    `${BASE_URL}/transactions`,
    address ? { params: { address } } : undefined
  );
  return res.data;
}
