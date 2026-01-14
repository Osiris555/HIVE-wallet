// apps/mobile/src/screens/WalletScreen.js

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from "react-native";

import {
  getBalance,
  mint,
  send,
  getTransactions,
} from "../chain/transactions";

const DEFAULT_WALLET = "demo-wallet-1";
const STORAGE_COOLDOWN_END = "HIVE_COOLDOWN_END_MS";

/* simple web-safe storage */
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, v) {
  try { localStorage.setItem(key, v); } catch {}
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

export default function WalletScreen() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [balance, setBalance] = useState(0);
  const [status, setStatus] = useState("");

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const [txs, setTxs] = useState([]);
  const [showTxs, setShowTxs] = useState(false);

  const [cooldownEndMs, setCooldownEndMs] = useState(() => {
    const saved = storageGet(STORAGE_COOLDOWN_END);
    return saved ? Number(saved) : 0;
  });

  const msLeft = Math.max(0, cooldownEndMs - Date.now());
  const isCoolingDown = msLeft > 0;
  const secondsLeft = useMemo(() => Math.ceil(msLeft / 1000), [msLeft]);

  useEffect(() => {
    if (!isCoolingDown) return;
    const id = setInterval(() => setCooldownEndMs((x) => x), 250);
    return () => clearInterval(id);
  }, [isCoolingDown]);

  useEffect(() => {
    if (!isCoolingDown && cooldownEndMs !== 0) {
      setCooldownEndMs(0);
      storageRemove(STORAGE_COOLDOWN_END);
    }
  }, [isCoolingDown, cooldownEndMs]);

  function startCooldown(seconds) {
    const end = Date.now() + seconds * 1000;
    setCooldownEndMs(end);
    storageSet(STORAGE_COOLDOWN_END, String(end));
  }

  async function refreshBalance() {
    try {
      const data = await getBalance(wallet);
      setBalance(Number(data.balance || 0));
    } catch (e) {
      setStatus(e.message);
    }
  }

  useEffect(() => {
    refreshBalance();
  }, []);

  async function handleMint() {
    if (isCoolingDown) {
      setStatus(`Cooldown active: ${secondsLeft}s`);
      return;
    }

    try {
      const data = await mint(wallet);
      startCooldown(data.cooldownSeconds || 60);
      setBalance(data.balance);
      setStatus("Mint successful!");
    } catch (e) {
      if (e.status === 429) {
        startCooldown(e.cooldownSeconds || 60);
        setStatus(`Cooldown active: ${e.cooldownSeconds}s`);
      } else {
        setStatus(e.message);
      }
    }
  }

  async function handleSend() {
    try {
      const data = await send(wallet, to, amount);
      setBalance(data.fromBalance);
      setAmount("");
      setStatus("Send successful!");
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function toggleTxs() {
    try {
      const list = await getTransactions(wallet);
      setTxs(list);
      setShowTxs(!showTxs);
    } catch (e) {
      setStatus(e.message);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HIVE Wallet</Text>

      <Text style={styles.balance}>Balance: {balance} HNY</Text>
      {!!status && <Text style={styles.status}>{status}</Text>}

      <TouchableOpacity
        style={[styles.button, isCoolingDown && styles.disabled]}
        onPress={handleMint}
        disabled={isCoolingDown}
      >
        <Text style={styles.buttonText}>
          {isCoolingDown ? `Mint (${secondsLeft}s)` : "Mint"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.smallButton} onPress={refreshBalance}>
        <Text style={styles.smallText}>Get Balance</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.smallButton} onPress={toggleTxs}>
        <Text style={styles.smallText}>Transaction History</Text>
      </TouchableOpacity>

      <TextInput
        style={styles.input}
        placeholder="Recipient"
        value={to}
        onChangeText={setTo}
      />
      <TextInput
        style={styles.input}
        placeholder="Amount"
        value={amount}
        onChangeText={setAmount}
      />

      <TouchableOpacity style={styles.button} onPress={handleSend}>
        <Text style={styles.buttonText}>Send</Text>
      </TouchableOpacity>

      {showTxs && (
        <FlatList
          data={txs}
          keyExtractor={(tx) => tx.id}
          renderItem={({ item }) => (
            <Text style={styles.tx}>
              {item.type} → {item.amount}
            </Text>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 20 },
  title: { color: "#fff", fontSize: 28, marginBottom: 20 },
  balance: { color: "#fff", fontSize: 18 },
  status: { color: "#ff6b6b", marginVertical: 10 },
  button: { backgroundColor: "#d1a93a", padding: 14, borderRadius: 10, marginTop: 10 },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#000", fontWeight: "800", textAlign: "center" },
  smallButton: { marginTop: 10, borderWidth: 1, borderColor: "#444", padding: 10 },
  smallText: { color: "#fff", textAlign: "center" },
  input: { backgroundColor: "#111", color: "#fff", padding: 10, marginTop: 10 },
  tx: { color: "#bbb", marginTop: 6 },
});
