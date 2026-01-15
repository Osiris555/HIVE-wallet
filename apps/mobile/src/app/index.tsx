import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Platform } from "react-native";

import {
  getBalance,
  mint,
  send,
  getTransactions,
  getChainStatus,
  ensureWalletId,
} from "../chain/transactions";

const STORAGE_COOLDOWN_END = "HIVE_COOLDOWN_END_MS";

function storageGet(key: string): string | null {
  if (Platform.OS !== "web") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string) {
  if (Platform.OS !== "web") return;
  try { window.localStorage.setItem(key, value); } catch {}
}
function storageRemove(key: string) {
  if (Platform.OS !== "web") return;
  try { window.localStorage.removeItem(key); } catch {}
}

export default function IndexScreen() {
  const [wallet, setWallet] = useState<string>("");
  const [balance, setBalance] = useState<number>(0);
  const [pendingDelta, setPendingDelta] = useState<number>(0);
  const [spendable, setSpendable] = useState<number>(0);

  const [status, setStatus] = useState<string>("");

  const [to, setTo] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const [showTxs, setShowTxs] = useState<boolean>(true);
  const [txs, setTxs] = useState<any[]>([]);

  const [chainHeight, setChainHeight] = useState<number>(0);
  const [nextBlockSec, setNextBlockSec] = useState<number>(0);

  const [cooldownEndMs, setCooldownEndMs] = useState<number>(() => {
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

  function startCooldown(seconds: number) {
    const end = Date.now() + seconds * 1000;
    setCooldownEndMs(end);
    storageSet(STORAGE_COOLDOWN_END, String(end));
  }

  async function loadChainStatus() {
    try {
      const s: any = await getChainStatus();
      setChainHeight(Number(s?.chainHeight || 0));
      setNextBlockSec(Math.ceil(Number(s?.msUntilNextBlock || 0) / 1000));
    } catch {}
  }

  async function loadBalance(w: string) {
    const data: any = await getBalance(w);
    const confirmed = Number(data?.balance || 0);
    setBalance(confirmed);
    setPendingDelta(Number(data?.pendingDelta || 0));
    setSpendable(
      typeof data?.spendableBalance === "number"
        ? Number(data.spendableBalance)
        : confirmed
    );
  }

  async function loadTxs(w: string) {
    const list: any = await getTransactions(w);
    setTxs(Array.isArray(list) ? list : []);
  }

  function hasPending(list: any[]) {
    return list.some((t) => t?.status === "pending");
  }

  useEffect(() => {
    (async () => {
      try {
        setStatus("");
        const w = await ensureWalletId();
        setWallet(w);
        await loadChainStatus();
        await loadBalance(w);
        if (showTxs) await loadTxs(w);
      } catch (e: any) {
        setStatus(e?.message || "Startup failed");
      }
    })();

    const id = setInterval(() => loadChainStatus(), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showTxs) return;
    if (!hasPending(txs)) return;
    if (!wallet) return;

    const id = setInterval(async () => {
      await loadTxs(wallet);
      await loadBalance(wallet);
    }, 1000);

    return () => clearInterval(id);
  }, [showTxs, txs, wallet]);

  async function handleMint() {
    if (!wallet) return;
    if (isCoolingDown) {
      setStatus(`Cooldown active: ${secondsLeft}s left`);
      return;
    }
    try {
      setStatus("");
      const data: any = await mint();
      startCooldown(Number(data?.cooldownSeconds || 60));

      await loadTxs(wallet);
      await loadBalance(wallet);

      setStatus("Mint submitted (pending until next block) ✅");
    } catch (e: any) {
      if (e?.status === 429) {
        const secs = Number(e?.cooldownSeconds || 60);
        startCooldown(secs);
        setStatus(`Cooldown active: ${secs}s left`);
        return;
      }
      setStatus(e?.message || "Mint failed");
    }
  }

  async function handleSend() {
    if (!wallet) return;

    const t = to.trim();
    const n = Number(amount);
    if (!t) return setStatus("Enter a recipient address (HNY_...).");
    if (!Number.isFinite(n) || n <= 0) return setStatus("Enter a valid amount.");

    try {
      setStatus("");
      await send(t, n);
      setAmount("");

      await loadTxs(wallet);
      await loadBalance(wallet);

      setStatus("Send submitted (pending until next block) ✅");
    } catch (e: any) {
      setStatus(e?.message || "Send failed");
    }
  }

  async function handleRefresh() {
    if (!wallet) return;
    await loadBalance(wallet);
    if (showTxs) await loadTxs(wallet);
  }

  async function toggleTxs() {
    const next = !showTxs;
    setShowTxs(next);
    if (next && wallet) await loadTxs(wallet);
  }

  const pendingText =
    pendingDelta === 0
      ? ""
      : pendingDelta > 0
      ? `Pending: +${pendingDelta} HNY`
      : `Pending: ${pendingDelta} HNY`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HIVE Wallet</Text>
      <Text style={styles.chainText}>Chain height: {chainHeight} • Next block: ~{nextBlockSec}s</Text>

      <Text style={styles.walletText} numberOfLines={1}>
        Wallet: {wallet || "loading..."}
      </Text>

      <Text style={styles.balance}>Confirmed: {balance} HNY</Text>
      {!!pendingText && <Text style={styles.pending}>{pendingText}</Text>}
      <Text style={styles.spendable}>Spendable: {spendable} HNY</Text>

      {!!status && <Text style={styles.status}>{status}</Text>}

      <TouchableOpacity
        style={[styles.button, isCoolingDown ? styles.buttonDisabled : null]}
        onPress={handleMint}
        disabled={isCoolingDown || !wallet}
      >
        <Text style={styles.buttonText}>{isCoolingDown ? `Mint (${secondsLeft}s)` : "Mint"}</Text>
      </TouchableOpacity>

      <View style={styles.row}>
        <TouchableOpacity style={styles.smallButton} onPress={handleRefresh} disabled={!wallet}>
          <Text style={styles.smallButtonText}>Get Balance</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.smallButton} onPress={toggleTxs} disabled={!wallet}>
          <Text style={styles.smallButtonText}>{showTxs ? "Hide History" : "Transaction History"}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Send</Text>
      <TextInput
        style={styles.input}
        value={to}
        onChangeText={setTo}
        placeholder="Recipient address (HNY_...)"
        placeholderTextColor="#777"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount"
        placeholderTextColor="#777"
        keyboardType="numeric"
      />

      <TouchableOpacity style={styles.button} onPress={handleSend} disabled={!wallet}>
        <Text style={styles.buttonText}>Send</Text>
      </TouchableOpacity>

      {showTxs && (
        <View style={styles.txsBox}>
          {txs.length === 0 ? (
            <Text style={styles.txEmpty}>No transactions yet.</Text>
          ) : (
            <FlatList
              data={txs}
              keyExtractor={(item) => item.id || item.hash || String(item.timestamp)}
              renderItem={({ item }) => (
                <View style={styles.txRow}>
                  <Text style={styles.txMain}>
                    {String(item.type).toUpperCase()} • {item.amount} • {item.status}
                    {item.status === "confirmed" && item.blockHeight != null ? ` • block ${item.blockHeight}` : ""}
                  </Text>

                  {item.status === "failed" && item.failReason ? (
                    <Text style={styles.txFail}>Reason: {String(item.failReason)}</Text>
                  ) : null}

                  <Text style={styles.txSub}>Nonce: {item.nonce}</Text>
                  <Text style={styles.txSub}>From: {item.from || "—"}</Text>
                  <Text style={styles.txSub}>To: {item.to}</Text>
                </View>
              )}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 24, justifyContent: "center" },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  chainText: { color: "#bbb", textAlign: "center", marginBottom: 10 },
  walletText: { color: "#bbb", textAlign: "center", marginBottom: 6 },

  balance: { color: "#fff", fontSize: 18, textAlign: "center", marginBottom: 4 },
  pending: { color: "#ffd166", textAlign: "center", marginBottom: 2 },
  spendable: { color: "#bbb", textAlign: "center", marginBottom: 10 },

  status: { color: "#ff6b6b", textAlign: "center", marginBottom: 10 },

  button: { backgroundColor: "#d1a93a", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 10 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#000", fontWeight: "800", fontSize: 16 },

  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  smallButton: { flex: 1, borderWidth: 1, borderColor: "#444", padding: 12, borderRadius: 12, backgroundColor: "#111" },
  smallButtonText: { color: "#fff", textAlign: "center", fontWeight: "700", fontSize: 12 },

  sectionTitle: { color: "#fff", marginTop: 18, marginBottom: 8, fontWeight: "700" },
  input: { backgroundColor: "#111", borderWidth: 1, borderColor: "#333", borderRadius: 10, padding: 12, color: "#fff", marginBottom: 10 },

  txsBox: { marginTop: 14, borderWidth: 1, borderColor: "#333", borderRadius: 12, padding: 12, backgroundColor: "#0b0b0b", maxHeight: 300 },
  txEmpty: { color: "#bbb" },
  txRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#222" },
  txMain: { color: "#fff", fontWeight: "700" },
  txFail: { color: "#ff6b6b", marginTop: 4, fontSize: 12, fontWeight: "700" },
  txSub: { color: "#bbb", marginTop: 2, fontSize: 12 },
});
