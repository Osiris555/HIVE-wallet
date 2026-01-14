import React, { useState } from "react";
import {
  getBalance,
  mint,
  send,
  getTransactions
} from "./chain/transactions";

export default function App() {
  const [cooldownText, setCooldownText] = useState("");

  return (
    <div style={{ padding: 20 }}>
      <h2>HIVE Wallet</h2>

      {cooldownText && (
        <div style={{ color: "red", marginBottom: 10 }}>
          {cooldownText}
        </div>
      )}

      <button onClick={() => mint(setCooldownText)}>
        MINT
      </button>
    </div>
  );
}
