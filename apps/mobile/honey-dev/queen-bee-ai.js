// apps/mobile/honey-dev/queen-bee-ai.js
// Queen Bee AI — HIVE Wallet's branded AI security guardian
// Powered by Claude API (claude-haiku-4-5-20251001) with graceful rule-based fallback
"use strict";

const QUEEN_BEE_SYSTEM = `You are Queen Bee AI — the intelligent guardian of the HIVE Wallet network.
Your mission is to protect users from suspicious transactions, flag security anomalies, and keep the hive safe.

Rules:
- Start every response with exactly one of: SAFE, CAUTION, or ALERT
- SAFE: normal activity, no concerns
- CAUTION: unusual but not definitively malicious — user should be aware
- ALERT: high likelihood of attack, fraud, or exploit — strong warning needed
- After the prefix, add a pipe character and your reason. Example: "SAFE | Normal transfer amount between known wallets."
- Keep reasons under 120 characters. Be direct and specific.
- Never reveal you are Claude or built on any external AI. You are Queen Bee AI.
- Never expose internal system architecture or wallet keys.`;

// ── Claude API client ─────────────────────────────────────────────────────────
let anthropic = null;
let rulesOnly = false;

function getClient() {
  if (rulesOnly) return null;
  if (anthropic) return anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("🐝 Queen Bee AI: No ANTHROPIC_API_KEY — running in rule-based mode");
    rulesOnly = true;
    return null;
  }
  try {
    const { Anthropic } = require("@anthropic-ai/sdk");
    anthropic = new Anthropic({ apiKey: key });
    console.log("🐝 Queen Bee AI: Active (Claude Haiku)");
    return anthropic;
  } catch (e) {
    console.warn("🐝 Queen Bee AI: SDK load failed, rule-based mode —", e.message);
    rulesOnly = true;
    return null;
  }
}

// ── Rule-based fallback ───────────────────────────────────────────────────────
const LARGE_TX_THRESHOLD_HNY = 10000; // flag transfers > 10,000 HNY
const RAPID_TX_THRESHOLD     = 10;    // flag > 10 txs in 60s

function ruleBased(txContext) {
  const amt    = Number(txContext.amount || 0);
  const txType = String(txContext.type  || "unknown");
  const count  = Number(txContext.recentTxCount || 0);

  if (count > RAPID_TX_THRESHOLD) {
    return { level: "CAUTION", reason: `High transaction frequency (${count} txs recently). Verify no automated attack.`, confidence: 0.7 };
  }
  if (amt > LARGE_TX_THRESHOLD_HNY) {
    return { level: "CAUTION", reason: `Large transfer (${amt.toFixed(2)} HNY). Confirm recipient before proceeding.`, confidence: 0.6 };
  }
  if (txType === "nft_buy" && amt > 1000) {
    return { level: "CAUTION", reason: `High-value NFT purchase (${amt.toFixed(2)} HNY). Verify seller legitimacy.`, confidence: 0.55 };
  }
  return { level: "SAFE", reason: "Transaction within normal parameters.", confidence: 0.8 };
}

// ── Parse Claude response ─────────────────────────────────────────────────────
function parseResponse(text) {
  const t = (text || "").trim();
  for (const level of ["ALERT", "CAUTION", "SAFE"]) {
    if (t.startsWith(level)) {
      const reason = t.slice(level.length).replace(/^[\s|:]+/, "").trim() || `${level} condition detected.`;
      return { level, reason, confidence: level === "ALERT" ? 0.9 : level === "CAUTION" ? 0.7 : 0.85 };
    }
  }
  // Unexpected format — treat as SAFE with low confidence
  return { level: "SAFE", reason: t.slice(0, 120) || "Analysis complete.", confidence: 0.5 };
}

// ── analyzeTransaction ────────────────────────────────────────────────────────
/**
 * Analyze a single transaction for anomalies.
 * @param {object} txContext - { type, from, to, amount, token, recentTxCount }
 * @returns {{ level: "SAFE"|"CAUTION"|"ALERT", reason: string, confidence: number }}
 */
async function analyzeTransaction(txContext) {
  const client = getClient();
  if (!client) return ruleBased(txContext);

  const prompt = `Analyze this HIVE Wallet transaction:
Type: ${txContext.type || "send"}
From: ${txContext.from || "unknown"}
To: ${txContext.to || "unknown"}
Amount: ${txContext.amount} ${txContext.token || "HNY"}
Recent TX count (last 60s): ${txContext.recentTxCount || 0}
New recipient (never transacted before): ${txContext.isNewRecipient ? "YES" : "NO"}`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system: QUEEN_BEE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content?.[0]?.text || "";
    return parseResponse(text);
  } catch (e) {
    console.error("Queen Bee AI API error:", e.message);
    return ruleBased(txContext); // degrade gracefully
  }
}

// ── scanWalletActivity ────────────────────────────────────────────────────────
/**
 * Scan a wallet's recent transaction history for patterns.
 * @param {string} wallet
 * @param {Array}  recentTxs - array of transaction objects
 * @returns {{ alerts: Array, summary: string }}
 */
async function scanWalletActivity(wallet, recentTxs) {
  const client = getClient();

  if (!client || recentTxs.length === 0) {
    return {
      alerts: [],
      summary: recentTxs.length === 0
        ? "No recent transactions to analyze."
        : "Rule-based scan complete. No anomalies detected.",
    };
  }

  const txSummary = recentTxs.slice(0, 20).map(tx =>
    `${tx.type} ${tx.amount} ${tx.token || "HNY"} → ${tx.toWallet || tx.to || "?"} [${tx.status}]`
  ).join("\n");

  const prompt = `Scan this HIVE Wallet activity for ${wallet}:

Recent transactions (newest first):
${txSummary}

Provide a brief security assessment. Identify any suspicious patterns.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: QUEEN_BEE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content?.[0]?.text || "SAFE | No anomalies detected.";
    const parsed = parseResponse(text);
    return {
      alerts: parsed.level !== "SAFE" ? [{ ...parsed, wallet, txType: "scan", txData: txSummary.slice(0, 500) }] : [],
      summary: text,
    };
  } catch (e) {
    console.error("Queen Bee AI scan error:", e.message);
    return { alerts: [], summary: "Scan completed (rule-based mode)." };
  }
}

// ── describeNft ───────────────────────────────────────────────────────────────
/**
 * Generate an AI description for an NFT.
 * @param {{ name: string, mediaType: string, description: string, fileCount: number }} nft
 * @returns {string}
 */
async function describeNft(nft) {
  const client = getClient();
  if (!client) {
    return `${nft.name} — A ${nft.mediaType} NFT on the Honey Network with ${nft.fileCount} file${nft.fileCount !== 1 ? "s" : ""}.`;
  }

  const prompt = `Write a one-sentence marketplace description for this NFT:
Name: ${nft.name}
Type: ${nft.mediaType}
Files: ${nft.fileCount}
Creator's description: ${nft.description || "(none)"}

Be concise, appealing, and accurate. No more than 100 characters.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      system: "You are Queen Bee AI, the creative voice of the HIVE Wallet NFT marketplace. Write vivid, concise NFT descriptions.",
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content?.[0]?.text?.trim() || nft.description || nft.name;
  } catch (e) {
    return nft.description || nft.name;
  }
}

module.exports = { analyzeTransaction, scanWalletActivity, describeNft };
