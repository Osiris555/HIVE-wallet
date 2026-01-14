import React, { useEffect, useState } from "react";
import {
  getBalance,
  mint,
  sendTokens,
  getTransactions
} from "../chain/transactions";

export default function WalletScreen() {
  const address = "HIVE_DEV_WALLET_001";
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    setBalance(getBalance(address));
  }, []);

  const handleMint = () => {
    mint(address);
    setBalance(getBalance(address));
    alert("Mint successful");
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>HIVE Wallet</h1>

      <div style={{ marginBottom: 12 }}>
        <strong>Address:</strong> {address}
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Balance:</strong> {balance} HNY
      </div>

      <button onClick={handleMint}>
        Mint from Faucet
      </button>
    </div>
  );
}
