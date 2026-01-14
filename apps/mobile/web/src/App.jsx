import React, { useEffect, useMemo, useState } from "react";
import { getBalance, mint, send, getTransactions } from "./chain/transactions";

const STORAGE_WALLET = "hive_wallet_address";
const STORAGE_COOLDOWN_ENDS = "hive_wallet_cooldown_ends_at";

export default function App() {
  const [wallet, setWallet] = useState(() => localStorage.getItem(STORAGE_WALLET) || "");
  const [statusText, setStatusText] = useState("");

  const [balance, setBalance] = useState(null);

  // cooldown ends timestamp (ms)
  const [cooldownEndsAt, setCooldownEndsAt] = useState(() => {
    const saved = localStorage.getItem(STORAGE_COOLDOWN_ENDS);
    return saved ? Number(saved) : 0;
  });

  const msLeft = Math.max(0, cooldownEndsAt - Date.now());
  const isCoolingDown = msLeft > 0;
  const secondsLeft = useMemo(() => Math.ceil(msLeft / 1000), [msLeft]);

  // tick UI while cooling down
  useEffect(() => {
    if (!isCoolingDown) return;
    const id = setInterval(() => setCooldownEndsAt((x) => x), 250);
    return () => clearInterval(id);
  }, [isCoolingDown]);

  // auto-clear when done
  useEffect(() => {
    if (!isCoolingDown && cooldownEndsAt !== 0) {
      setCooldownEndsAt(0);
      localStorage.removeItem(STORAGE_COOLDOWN_ENDS);
      setStatusText("");
    }
  }, [isCoolingDown, cooldownEndsAt]);

  const startCooldown = (cooldownSeconds) => {
    const ends = Date.now() + cooldownSeconds * 1000;
    setCooldownEndsAt(ends);
    localStorage.setItem(STORAGE_COOLDOWN_ENDS, String(ends));
  };

  // Send form
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  // Tx history
  const [showTxs, setShowTxs] = useState(false);
  const [txs, setTxs] = useState([]);

  // Persist wallet
  useEffect(() => {
    if (wallet) localStorage.setItem(STORAGE_WALLET, wallet);
  }, [wallet]);

  const requireWallet = () => {
    const w = wallet.trim();
    if (!w) {
      setStatusText("Please enter your wallet address first.");
      return null;
    }
    return w;
  };

  const handleGetBalance = async () => {
    const w = requireWallet();
    if (!w) return;

    setStatusText("");
    const res = await getBalance(w);
    if (!res.ok) return setStatusText(res.message || "Failed to fetch balance.");

    setBalance(res.data?.balance ?? null);
  };

  const handleMint = async () => {
    const w = requireWallet();
    if (!w) return;

    if (isCoolingDown) {
      setStatusText(`Cooldown active: ${secondsLeft}s left`);
      return;
    }

    setStatusText("");
    const res = await mint(w);

    if (!res.ok) {
      if (res.status === 429) {
        const secs = res.cooldownSeconds ?? 60;
        startCooldown(secs);
        setStatusText(res.message || `Cooldown active: ${secs}s left`);
        return;
      }
      return setStatusText(res.message || "Mint failed.");
    }

    // On success, server returns cooldownSeconds (60)
    const secs = res.data?.cooldownSeconds ?? 60;
    startCooldown(secs);
    setBalance(res.data?.balance ?? balance);
    setStatusText("Mint successful!");
  };

  const handleSend = async () => {
    const from = requireWallet();
    if (!from) return;

    const t = to.trim();
    if (!t) return setStatusText("Please enter a recipient address.");

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setStatusText("Please enter a valid amount.");

    setStatusText("");
    const res = await send({ from, to: t, amount: n });

    if (!res.ok) return setStatusText(res.message || "Send failed.");

    setStatusText("Send successful!");
    setAmount("");
    // Refresh balance & txs if open
    await handleGetBalance();
    if (showTxs) await handleTransactions(true);
  };

  const handleTransactions = async (keepOpen = false) => {
    const w = requireWallet();
    if (!w) return;

    setStatusText("");
    const res = await getTransactions(w);
    if (!res.ok) return setStatusText(res.message || "Failed to fetch transactions.");

    setTxs(Array.isArray(res.data) ? res.data : []);
    setShowTxs(keepOpen ? true : !showTxs);
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 820 }}>
      <h2>HIVE Wallet</h2>

      {(statusText || isCoolingDown) && (
        <div style={{ color: "red", marginBottom: 10 }}>
          {isCoolingDown ? `Cooldown active: ${secondsLeft}s left` : statusText}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Your wallet address</div>
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Enter wallet address (any string for now)"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={handleMint} disabled={isCoolingDown}>
          {isCoolingDown ? `MINT (${secondsLeft}s)` : "MINT"}
        </button>

        <button onClick={handleGetBalance}>Get Balance</button>

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
          <button onClick={handleSend}>SEND</button>
        </div>
      </div>

      {showTxs && (
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Transaction History</div>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            {txs.length === 0 ? (
              <div>No transactions found.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Type</th>
                    <th align="left">From</th>
                    <th align="left">To</th>
                    <th align="left">Amount</th>
                    <th align="left">Status</th>
                    <th align="left">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((tx) => (
                    <tr key={tx.id || tx.hash}>
                      <td>{tx.type}</td>
                      <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {tx.from || "—"}
                      </td>
                      <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {tx.to}
                      </td>
                      <td>{tx.amount}</td>
                      <td>{tx.status}</td>
                      <td>{new Date(tx.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
