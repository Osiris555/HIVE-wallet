import express from "express";
import { balances, transactions } from "./ledger.js";

export const faucetRouter = express.Router();

faucetRouter.post("/", (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: "Missing address" });
  }

  balances[address] = (balances[address] || 0) + 100;

  transactions.push({
    type: "mint",
    to: address,
    amount: 100,
    timestamp: Date.now(),
  });

  res.json({
    success: true,
    balance: balances[address],
  });
});
