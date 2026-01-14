import express from "express";
import { balances, transactions } from "./ledger.js";

export const txRouter = express.Router();

/**
 * SEND HONEY
 */
txRouter.post("/send", (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if ((balances[from] || 0) < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  balances[from] -= amount;
  balances[to] = (balances[to] || 0) + amount;

  transactions.push({
    type: "send",
    from,
    to,
    amount,
    timestamp: Date.now(),
  });

  res.json({ success: true });
});

/**
 * GET TRANSACTION HISTORY
 */
txRouter.get("/", (_req, res) => {
  res.json(transactions.slice().reverse());
});
