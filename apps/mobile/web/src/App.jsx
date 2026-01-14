import React, { useEffect, useMemo, useState } from "react";
import { getBalance, mint, send, getTransactions } from "./chain/transactions";

const DEFAULT_COOLDOWN_SECONDS = 30;
const STORAGE_KEY = "hive_wallet_cooldown_ends_at";

export default function App() {
  // Cooldown ends timestamp (ms)
  const [cooldownEndsAt, setCooldownEndsAt] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : 0;
  });

  const [statusText, setStatusText] = useState("");

  // Basic wallet UI state
  const [balance, setBalance] = useState(null);

  // Send form state
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  // Transactions state
  const [txs, setTxs] = useState([]);
  const [showTxs, setShowTxs] = useState(false);

  // Cooldown derived values
  const msLeft = Math.max(0, cooldownEndsAt - Date.now());
  const isCoolingDown = msLeft > 0;
  const secondsLeft = useMemo(() => Math.ceil(msLeft / 1000), [msLeft]);

  // Tick UI during cooldown
  useEffect(() => {
    if (!isCoolingDown) return;
    const id = setInterval(() => {
      setCooldownEndsAt((x) => x); // force re-render
    }, 250);
    return () => clearInterval(id);
  }, [isCoolingDown]);

  // Auto-clear when done
  useEffect(() => {
    if (!isCoolingDown && cooldownEndsAt !== 0) {
      setCooldownEndsAt(0);
      localStorage.removeItem(STORAGE_KEY);
      setStatusText(""); // optional: clear message when cooldown finishes
    }
  }, [isCoolingDown, cooldownEndsAt]);

  const startCooldown = (seconds = DEFAULT_COOLDOWN_SECONDS) => {
    const ends = Date.now() + seconds * 1000;
    setCooldownEndsAt(ends);
    localStorage.setItem(STORAGE_KEY, String(ends));
  };

  const handleMint = async () => {
    if (isCoolingDown) {
      setStatusText(`Cooldown active: ${secondsLeft}s left`);
      return;
    }
    setStatusText("");

    const res = await mint(); // structured response from transactions.js below

    if (!res.ok) {
      if (res.status === 429) {
        const secs = res.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
        startCooldown(secs);
        setStatusText(res.message || `Cooldown active: ${secs}s left`);
        return;
      }
      setStatusText(res.message || "Mint failed.");
      return;
    }

    // Successful mint → start cooldown
    startCooldown(DEFAULT_COOLDOWN_SECONDS);
    setStatusText(res.message || "Mint successful!");
  };

  const handleGetBalance = async () => {
    setStatusText("");
    const res = await getBalance();
    if (!res.ok) {
      setStatusText(res.message || "Failed to fetch balance.");
      return;
    }
    // Adjust this depending on your API shape
    setBalance(res.data?.balance ?? res.data ?? null);
  };

  const handleSend = async () => {
    setStatusText("");

    if (!to.trim()) {
      setStatusText("Please enter a recipient address.");
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setStatusText("Please enter a valid amount.");
      return;
    }

    const res = await send({ to: to.trim(), amount: n });
    if (!res.ok) {
      setStatusText(res.message || "Send failed.");
      return;
    }

    setStatusText(res.message || "Send successful!");
    setAmount("");
    // Optional: refresh tx list if visible
    if (showTxs) await handleTransactions(true);
  };

  const handleTransactions = async (keepOpen = false) => {
    setStatusText("");
    const res = await getTransactions();
    if (!res.ok) {
      setStatusText(res.message || "Failed to fetch transactions.");
      return;
    }

    // Adjust based on API shape
    const list = res.data?.transactions ?? res.data ?? [];
    setTxs(Array.isArray(list) ? list : []);
    setShowTxs(keepOpen ? true : !showTxs);
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 720 }}>
      <h2>HIVE Wallet</h2>

      {(statusText || isCoolingDown) && (
        <div style={{ color: "red", marginBottom: 10 }}>
          {isCoolingDown ? `Cooldown active: ${secondsLeft}s left` : statusText}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={handleMint} disabled={isCoolingDown}>
          {isCoolingDown ? `MINT (${secondsLeft}s)` : "MINT"}
        </button>

        <button onClick={handleGetBalance}>
          Get Balance
        </button>

        <button onClick={() => handleTransactions(false)}>
          {showTxs ? "Hide Transaction History" : "Transaction History"}
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Balance</div>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          {balance === null ? "—" : String(balance)}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Send</div>
        <div style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="Recipient address"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
          <input
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
          <button onClick={handleSend}>
            SEND
          </button>
        </div>
      </div>

      {showTxs && (
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Transaction History</div>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            {txs.length === 0 ? (
              <div>No transactions found.</div>
            ) : (
              <ul
