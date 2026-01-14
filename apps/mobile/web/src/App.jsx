import React, { useEffect, useMemo, useState } from "react";
import { getBalance, mint, send, getTransactions } from "./chain/transactions";

const DEFAULT_COOLDOWN_SECONDS = 30;
const STORAGE_KEY = "hive_wallet_cooldown_ends_at";

export default function App() {
  // Store an absolute timestamp (ms) when cooldown ends
  const [cooldownEndsAt, setCooldownEndsAt] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : 0;
  });

  const [statusText, setStatusText] = useState("");

  const msLeft = Math.max(0, cooldownEndsAt - Date.now());
  const isCoolingDown = msLeft > 0;
  const secondsLeft = useMemo(() => Math.ceil(msLeft / 1000), [msLeft]);

  // Tick UI while cooling down
  useEffect(() => {
    if (!isCoolingDown) return;

    const id = setInterval(() => {
      // force re-render to update secondsLeft
      setCooldownEndsAt((x) => x);
    }, 250);

    return () => clearInterval(id);
  }, [isCoolingDown]);

  // Clear cooldown automatically at the end
  useEffect(() => {
    if (!isCoolingDown && cooldownEndsAt !== 0) {
      setCooldownEndsAt(0);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [isCoolingDown, cooldownEndsAt]);

  const startCooldown = (seconds = DEFAULT_COOLDOWN_SECONDS) => {
    const endsAt = Date.now() + seconds * 1000;
    setCooldownEndsAt(endsAt);
    localStorage.setItem(STORAGE_KEY, String(endsAt));
  };

  const handleMint = async () => {
    // If user clicks during cooldown, show message instead of doing nothing
    if (isCoolingDown) {
      setStatusText(`Cooldown active: ${secondsLeft}s left`);
      return;
    }

    setStatusText("");

    try {
      /**
       * Your existing mint() takes setCooldownText, but that pattern
       * doesn't let React "own" the cooldown timing.
       *
       * So we intercept the text messages and start a cooldown here.
       */
      await mint((text) => {
        // Show whatever mint() wants to show
        setStatusText(text || "");

        // If the backend signals cooldown (or mint() sets "(30 seconds)"),
        // start a 30s cooldown locally.
        // Adjust this parsing if your mint() formats differently.
        const match = String(text).match(/(\d+)\s*second/i);
        if (match) startCooldown(Number(match[1]));
        else if (String(text).toLowerCase().includes("cooldown")) startCooldown();
      });

      // If mint succeeds but doesn't set any cooldown text, still start it
      // (comment this out if your backend doesn't enforce cooldown on success)
      startCooldown();
    } catch (err) {
      // If mint() throws on 429 or errors, show a friendly message
      const msg = String(err?.message || err || "");
      if (msg.includes("429")) {
        setStatusText(`Cooldown active: ${DEFAULT_COOLDOWN_SECONDS}s left`);
        startCooldown();
      } else {
        setStatusText(msg || "Mint failed. Please try again.");
      }
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>HIVE Wallet</h2>

      {(statusText || isCoolingDown) && (
        <div style={{ color: "red", marginBottom: 10 }}>
          {isCoolingDown ? `Cooldown active: ${secondsLeft}s left` : statusText}
        </div>
      )}

      <button onClick={handleMint} disabled={isCoolingDown}>
        {isCoolingDown ? `MINT (${secondsLeft}s)` : "MINT"}
      </button>

      {/* We'll add SEND and TX HISTORY buttons next once mint flow is stable */}
    </div>
  );
}
