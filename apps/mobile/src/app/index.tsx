// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal, Platform } from "react-native";
import {
  ensureWalletId,
  getBalance,
  getTransactions,
  getChainStatus,
  quoteSend,
  mint,
  send,
  computeServiceFee,
} from "../chain/transactions";

function fmt8(n: number) {
  return Number(n).toFixed(8);
}

const ONE_SAT = 0.00000001;
const FEE_VAULT = "HNY_FEE_VAULT";
const CANCEL_DUST = ONE_SAT; // replacement-to-self uses dust amount (server usually rejects 0)

export default function Index() {
  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);

  // Fee vault display
  const [feeVaultBalance, setFeeVaultBalance] = useState<number | null>(null);

  // mempool stats (from /status)
  const [mempoolSize, setMempoolSize] = useState<number>(0);
  const [maxTxPerBlock, setMaxTxPerBlock] = useState<number>(25);
  const [minGasFee, setMinGasFee] = useState<number>(0);
  const [serviceFeeRate, setServiceFeeRate] = useState<number>(0.00005);

  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");

  const [txs, setTxs] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(true);

  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  const [mintCooldown, setMintCooldown] = useState<number>(0);
  const [mintBusy, setMintBusy] = useState<boolean>(false);

  const [sendBusy, setSendBusy] = useState<boolean>(false);

  // confirmation modal (normal send)
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);

  // fee chooser in confirm modal
  const [confirmStatus, setConfirmStatus] = useState<any>(null);
  const [confirmTier, setConfirmTier] = useState<"low" | "normal" | "fast" | "max">("normal");
  const [confirmMaxExtraPct, setConfirmMaxExtraPct] = useState<number>(25); // max adds +25% default

  // RBF / Cancel modal (shared)
  const [rbfOpen, setRbfOpen] = useState<boolean>(false);
  const [rbfMode, setRbfMode] = useState<"speedup" | "cancel">("speedup");
  const [rbfTx, setRbfTx] = useState<any>(null);
  const [rbfMultiplier, setRbfMultiplier] = useState<number>(1.5);
  const [rbfPreviewData, setRbfPreviewData] = useState<any>(null);

  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  function isNonceMismatchLike(e: any) {
    const msg = String(e?.message || e || "").toLowerCase();
    return (
      msg.includes("nonce mismatch") ||
      msg.includes("nonce") ||
      msg.includes("already confirmed") ||
      msg.includes("replaced") ||
      msg.includes("conflict")
    );
  }

  function safeNum(v: any, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async function refreshStatus() {
    const s = await getChainStatus();

    setChainHeight(safeNum(s.chainHeight, 0));
    setMsUntilNextBlock(safeNum(s.msUntilNextBlock, 0));

    // mempool / fee-market fields (use defaults if server doesn’t include)
    setMempoolSize(safeNum(s.mempoolSize, 0));
    setMaxTxPerBlock(Math.max(1, safeNum(s.maxTxPerBlock ?? s.blockTxLimit ?? s.txPerBlock, 25)));

    const mg = safeNum(s.minGasFee, 0);
    setMinGasFee(mg);

    const rate = safeNum(s.serviceFeeRate, 0.00005);
    setServiceFeeRate(rate);

    return s;
  }

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
    return w;
  }

  async function loadFeeVaultBalance() {
    try {
      const b = await getBalance(FEE_VAULT);
      setFeeVaultBalance(safeNum(b.balance, 0));
    } catch {
      setFeeVaultBalance(null);
    }
  }

  async function loadBalance() {
    if (!wallet) return;
    try {
      const b = await getBalance(wallet);
      setConfirmedBalance(safeNum(b.balance, 0));
      setSpendableBalance(safeNum(b.spendableBalance, 0));
    } catch (e: any) {
      console.error("Balance fetch failed:", e?.message || e);
    } finally {
      await loadFeeVaultBalance();
    }
  }

  async function loadTxs() {
    if (!wallet) return;
    try {
      const list = await getTransactions(wallet);
      setTxs(list || []);
    } catch (e: any) {
      console.error("Tx fetch failed:", e?.message || e);
    }
  }

  async function refreshAll() {
    await refreshStatus();
    await loadBalance();
    await loadTxs();
  }

  async function bootstrap() {
    await loadWallet();
    await refreshStatus();
    await loadFeeVaultBalance();
  }

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!wallet) return;
    loadBalance();
    loadTxs();
  }, [wallet]);

  // tick down mint cooldown
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  // status poll
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        await refreshStatus();
      } catch {}
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // fee vault poll
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        await loadFeeVaultBalance();
      } catch {}
    }, 5000);
    return () => clearInterval(i);
  }, []);

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await refreshAll();
      const cd = safeNum(res?.cooldownSeconds, 60);
      setMintCooldown(cd);
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = safeNum(e.cooldownSeconds, 60);
        setMintCooldown(cd);
        setMessage(`Cooldown active (${cd}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setMintBusy(false);
    }
  }

  // ---- SEND CONFIRM ----
  async function openSendConfirm() {
    setMessage("");
    if (!to || to.length < 8) {
      setMessage("Enter a recipient address.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid amount.");
      return;
    }

    try {
      const [q, s] = await Promise.all([quoteSend(to, amount), getChainStatus()]);
      setQuote(q);
      setConfirmStatus(s);
      setConfirmTier("normal");
      setConfirmMaxExtraPct(25);
      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  function computeConfirmGasFee() {
    const minGas = safeNum(confirmStatus?.minGasFee ?? quote?.gasFee ?? minGasFee, 0);
    if (!Number.isFinite(minGas) || minGas <= 0) return 0;

    if (confirmTier === "low") return Number(minGas.toFixed(8));
    if (confirmTier === "normal") return Number((minGas * 1.5).toFixed(8));
    if (confirmTier === "fast") return Number((minGas * 2.0).toFixed(8));

    const m = 1 + Math.max(0, confirmMaxExtraPct) / 100;
    return Number((minGas * m).toFixed(8));
  }

  function computeConfirmServiceFee() {
    const rate = safeNum(confirmStatus?.serviceFeeRate ?? serviceFeeRate, 0.00005);
    return computeServiceFee(amount, rate);
  }

  const confirmFeePreview = useMemo(() => {
    if (!confirmOpen) return null;
    const gasFee = computeConfirmGasFee();
    const serviceFee = computeConfirmServiceFee();
    const totalFee = Number((gasFee + serviceFee).toFixed(8));
    const totalCost = Number((amount + totalFee).toFixed(8));
    const minGas = safeNum(confirmStatus?.minGasFee ?? quote?.gasFee ?? minGasFee, 0);
    return { gasFee, serviceFee, totalFee, totalCost, minGas };
  }, [confirmOpen, confirmTier, confirmMaxExtraPct, confirmStatus, quote, amount, minGasFee, serviceFeeRate]);

  async function handleSendSignedSubmit() {
    if (!quote || !confirmFeePreview) return;
    setSendBusy(true);
    setMessage("");
    try {
      const res = await send({
        to,
        amount,
        gasFee: confirmFeePreview.gasFee,
        serviceFee: confirmFeePreview.serviceFee,
      });

      setConfirmOpen(false);

      setMessage(
        res?.isReplacement
          ? "Send replaced a pending tx with higher fee (RBF) ✅"
          : "Send submitted (pending until next block) ✅"
      );

      await refreshAll();
    } catch (e: any) {
      if (e?.status === 409 || isNonceMismatchLike(e)) {
        setConfirmOpen(false);
        setMessage("Send could not be submitted — state changed (already confirmed/replaced). Refreshing… ✅");
        await refreshAll();
      } else {
        setMessage(`Send failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setSendBusy(false);
    }
  }

  // ----- MEMPOOL ETA HELPERS -----
  const mempoolClearBlocks = useMemo(() => {
    if (maxTxPerBlock <= 0) return 0;
    return Math.ceil(mempoolSize / maxTxPerBlock);
  }, [mempoolSize, maxTxPerBlock]);

  function likelyConfirmLabel(tx: any) {
    if (!tx || tx.status !== "pending") return null;

    // Heuristic: compare tx total fee to "baseline" (minGas + serviceFee)
    const gas = safeNum(tx.gasFee, 0);
    const svc = safeNum(tx.serviceFee, 0);
    const total = tx.totalFee != null ? safeNum(tx.totalFee, gas + svc) : safeNum(gas + svc, 0);

    const baselineSvc = computeServiceFee(safeNum(tx.amount, 0), serviceFeeRate);
    const baseline = Number((Math.max(minGasFee, ONE_SAT) + baselineSvc).toFixed(8));

    // If mempool is tiny, likely next block anyway
    if (mempoolSize <= maxTxPerBlock) return "Likely confirm: next block";

    if (baseline <= 0) return "Likely confirm: 1–3 blocks";

    const ratio = total / baseline;

    if (ratio >= 2.0) return "Likely confirm: next block";
    if (ratio >= 1.5) return "Likely confirm: 1–2 blocks";
    return "Likely confirm: 3+ blocks";
  }

  // ----- RBF + CANCEL -----
  function openSpeedUpChooser(tx: any) {
    setMessage("");
    setRbfMode("speedup");
    setRbfTx(tx);
    setRbfMultiplier(1.5);
    setRbfOpen(true);
  }

  function openCancelChooser(tx: any) {
    setMessage("");
    setRbfMode("cancel");
    setRbfTx(tx);
    setRbfMultiplier(2.0); // cancellation should be “aggressive” by default
    setRbfOpen(true);
  }

  function calcRbfFees(tx: any, status: any, multiplier: number) {
    const minGas = safeNum(status.minGasFee, minGasFee);
    const rate = safeNum(status.serviceFeeRate, serviceFeeRate);

    const amt = safeNum(tx.amount, 0);
    const oldGas = safeNum(tx.gasFee, 0);
    const oldSvc = safeNum(tx.serviceFee, 0);
    const oldTotalFee = Number((oldGas + oldSvc).toFixed(8));

    const serviceFee = computeServiceFee(amt, rate);

    let newGas = Number(((oldGas > 0 ? oldGas : minGas) * multiplier).toFixed(8));
    newGas = Math.max(minGas, newGas);

    let newTotalFee = Number((newGas + serviceFee).toFixed(8));
    if (newTotalFee <= oldTotalFee) {
      while (newTotalFee <= oldTotalFee) {
        newGas = Number((newGas + ONE_SAT).toFixed(8));
        newTotalFee = Number((newGas + serviceFee).toFixed(8));
      }
    }

    return { minGas, rate, serviceFee, oldTotalFee, newGas, newTotalFee };
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!rbfTx) {
        setRbfPreviewData(null);
        return;
      }
      const s = await getChainStatus();
      const fees = calcRbfFees(rbfTx, s, rbfMultiplier);
      if (mounted) setRbfPreviewData({ status: s, fees });
    })();
    return () => {
      mounted = false;
    };
  }, [rbfTx, rbfMultiplier]);

  async function submitRbfOrCancel(multiplier: number, isMax: boolean) {
    if (sendBusy) return;
    if (!rbfTx) return;

    setSendBusy(true);
    setMessage("");

    try {
      const originalTx = rbfTx;

      if (originalTx.type !== "send") {
        setMessage("Only SEND transactions can be replaced.");
        setRbfOpen(false);
        return;
      }
      if (!wallet || originalTx.from !== wallet) {
        setMessage("You can only replace your own outgoing tx.");
        setRbfOpen(false);
        return;
      }
      if (originalTx.nonce == null) {
        setMessage("Missing nonce on tx (cannot replace).");
        setRbfOpen(false);
        return;
      }

      // refresh latest list first
      const latestTxs = await getTransactions(wallet);
      setTxs(latestTxs || []);

      const latestMatch =
        (latestTxs || []).find((t: any) => t.id === originalTx.id) ||
        (latestTxs || []).find((t: any) => t.type === "send" && t.from === wallet && Number(t.nonce) === Number(originalTx.nonce));

      if (!latestMatch || latestMatch.status !== "pending") {
        setRbfOpen(false);
        setRbfTx(null);
        setMessage("Too late — tx already confirmed/replaced. ✅");
        await refreshAll();
        return;
      }

      const status = await getChainStatus();
      const fees = calcRbfFees(latestMatch, status, multiplier);

      let gasFee = fees.newGas;
      if (isMax) gasFee = Number((gasFee + Math.max(fees.minGas, gasFee) * 0.25).toFixed(8));

      let totalFee = Number((gasFee + fees.serviceFee).toFixed(8));
      if (totalFee <= fees.oldTotalFee) {
        while (totalFee <= fees.oldTotalFee) {
          gasFee = Number((gasFee + ONE_SAT).toFixed(8));
          totalFee = Number((gasFee + fees.serviceFee).toFixed(8));
        }
      }

      // SPEEDUP: same to/amount
      // CANCEL: replace with to=self and dust amount
      const replaceTo = rbfMode === "cancel" ? wallet : String(latestMatch.to);
      const replaceAmount = rbfMode === "cancel" ? CANCEL_DUST : safeNum(latestMatch.amount, 0);

      const cancelServiceFee = computeServiceFee(replaceAmount, serviceFeeRate);
      const serviceFeeUsed = rbfMode === "cancel" ? cancelServiceFee : fees.serviceFee;

      const res = await send({
        to: replaceTo,
        amount: replaceAmount,
        gasFee,
        serviceFee: serviceFeeUsed,
        nonceOverride: Number(latestMatch.nonce),
      });

      setRbfOpen(false);
      setRbfTx(null);

      if (rbfMode === "cancel") {
        setMessage(res?.isReplacement ? `Cancel submitted ✅  Fee: ${fmt8(Number((gasFee + serviceFeeUsed).toFixed(8)))}` : "Cancel submitted, but was not treated as a replacement (already confirmed?).");
      } else {
        setMessage(res?.isReplacement ? `Speed up submitted (RBF) ✅  New fee: ${fmt8(totalFee)}` : "Speed up submitted, but not treated as replacement (already confirmed?).");
      }

      await refreshAll();
    } catch (e: any) {
      if (e?.status === 409 || isNonceMismatchLike(e)) {
        setRbfOpen(false);
        setRbfTx(null);
        setMessage("Too late — nonce/state changed (already confirmed/replaced). ✅");
        await refreshAll();
      } else {
        setMessage(`${rbfMode === "cancel" ? "Cancel" : "Speed up"} failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return mintBusy ? "Minting..." : "Mint";
  }, [mintCooldown, mintBusy]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 14, maxWidth: 950, alignSelf: "center", width: "100%" }}>
        <Text style={{ color: "#fff", fontSize: 34, textAlign: "center", fontWeight: "800", marginTop: 6 }}>
          HIVE Wallet
        </Text>

        <Text style={{ color: "#aaa", textAlign: "center" }}>
          Chain height: {chainHeight} · Next block: ~{Math.ceil(msUntilNextBlock / 1000)}s
        </Text>

        {/* ✅ mempool + ETA */}
        <Text style={{ color: "#777", textAlign: "center" }}>
          Mempool: {mempoolSize} pending · Block cap: {maxTxPerBlock}/block · ETA to clear: ~{mempoolClearBlocks} blocks
        </Text>

        {wallet ? <Text style={{ color: "#aaa", textAlign: "center" }}>Wallet: {wallet}</Text> : null}

        <Text style={{ color: "#fff", textAlign: "center", fontSize: 20, marginTop: 6 }}>
          Confirmed: {fmt8(confirmedBalance)} HNY
        </Text>
        <Text style={{ color: "#aaa", textAlign: "center" }}>
          Spendable: {fmt8(spendableBalance)} HNY
        </Text>

        <Text style={{ color: "#caa83c", textAlign: "center", fontWeight: "800" }}>
          Fee Vault: {feeVaultBalance == null ? "(unavailable)" : `${fmt8(feeVaultBalance)} HNY`}
        </Text>

        {message ? (
          <Text style={{ color: message.toLowerCase().includes("failed") ? "#ff6b6b" : "#9dff9d", textAlign: "center" }}>
            {message}
          </Text>
        ) : null}

        {cooldownText ? <Text style={{ color: "#ff6b6b", textAlign: "center" }}>{cooldownText}</Text> : null}

        <Pressable
          onPress={handleMint}
          disabled={mintBusy || mintCooldown > 0}
          style={{
            backgroundColor: "#caa83c",
            opacity: mintBusy || mintCooldown > 0 ? 0.5 : 1,
            padding: 18,
            borderRadius: 10,
            alignItems: "center",
            marginTop: 10,
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 18 }}>{mintLabel}</Text>
        </Pressable>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={refreshAll}
            style={{ flex: 1, borderWidth: 1, borderColor: "#222", padding: 14, borderRadius: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Refresh</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowHistory((v) => !v)}
            style={{ flex: 1, borderWidth: 1, borderColor: "#222", padding: 14, borderRadius: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{showHistory ? "Hide History" : "Transaction History"}</Text>
          </Pressable>
        </View>

        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18, marginTop: 10 }}>Send</Text>

        <TextInput
          value={to}
          onChangeText={setTo}
          placeholder="Recipient address (HNY_...)"
          placeholderTextColor="#666"
          style={{ backgroundColor: "#111", borderRadius: 10, padding: 14, color: "#fff", borderWidth: 1, borderColor: "#222" }}
        />

        <TextInput
          value={amountStr}
          onChangeText={setAmountStr}
          placeholder="Amount"
          placeholderTextColor="#666"
          keyboardType={Platform.OS === "web" ? "text" : "numeric"}
          style={{ backgroundColor: "#111", borderRadius: 10, padding: 14, color: "#fff", borderWidth: 1, borderColor: "#222" }}
        />

        <Pressable
          onPress={openSendConfirm}
          disabled={sendBusy}
          style={{ backgroundColor: "#caa83c", opacity: sendBusy ? 0.6 : 1, padding: 18, borderRadius: 10, alignItems: "center" }}
        >
          <Text style={{ fontWeight: "800", fontSize: 18 }}>{sendBusy ? "Working..." : "Send"}</Text>
        </Pressable>

        {showHistory ? (
          <View style={{ marginTop: 6, borderWidth: 1, borderColor: "#222", borderRadius: 10, overflow: "hidden" }}>
            {txs.length === 0 ? (
              <Text style={{ color: "#aaa", padding: 14 }}>No transactions yet.</Text>
            ) : (
              txs.map((t, idx) => {
                const gas = safeNum(t.gasFee, 0);
                const svc = safeNum(t.serviceFee, 0);
                const totalFee = t.totalFee != null ? safeNum(t.totalFee, gas + svc) : safeNum(gas + svc, 0);

                const title =
                  `${String(t.type).toUpperCase()} · ${t.amount}` +
                  ` · fee ${fmt8(totalFee)}` +
                  ` · ${t.status}` +
                  (t.blockHeight ? ` · block ${t.blockHeight}` : "");

                const outgoingPendingMine =
                  t.type === "send" && t.status === "pending" && wallet && t.from === wallet && t.nonce != null;

                const eta = outgoingPendingMine ? likelyConfirmLabel(t) : null;

                return (
                  <View key={t.id || idx} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "#222" }}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>{title}</Text>

                    <Text style={{ color: "#777", marginTop: 6 }}>
                      Gas: {fmt8(gas)} · Service: {fmt8(svc)} · Total: {fmt8(totalFee)}
                    </Text>

                    {eta ? <Text style={{ color: "#9aa7ff", marginTop: 4 }}>{eta}</Text> : null}

                    {t.failReason ? <Text style={{ color: "#ff6b6b" }}>Reason: {t.failReason}</Text> : null}
                    {t.nonce != null ? <Text style={{ color: "#aaa" }}>Nonce: {t.nonce}</Text> : null}
                    <Text style={{ color: "#aaa" }}>From: {t.from || "—"}</Text>
                    <Text style={{ color: "#aaa" }}>To: {t.to}</Text>

                    {outgoingPendingMine ? (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        <Pressable
                          onPress={() => openSpeedUpChooser(t)}
                          disabled={sendBusy}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 10,
                            backgroundColor: "#2b6fff",
                            opacity: sendBusy ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900" }}>⚡ Speed Up</Text>
                        </Pressable>

                        <Pressable
                          onPress={() => openCancelChooser(t)}
                          disabled={sendBusy}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 10,
                            backgroundColor: "#ff3b3b",
                            opacity: sendBusy ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900" }}>🛑 Cancel</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Confirm modal (normal send w/ custom gas tiers) */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: "#0b0b0b", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Confirm Transaction</Text>

            <Text style={{ color: "#aaa" }}>To: {to}</Text>
            <Text style={{ color: "#aaa" }}>Amount: {amount}</Text>

            <View style={{ height: 12 }} />
            <Text style={{ color: "#fff", fontWeight: "800" }}>Gas speed</Text>
            <Text style={{ color: "#666" }}>
              Min gas: {fmt8(safeNum(confirmStatus?.minGasFee ?? quote?.gasFee ?? minGasFee, 0))}
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              {[
                { k: "low", label: "Low" },
                { k: "normal", label: "Normal" },
                { k: "fast", label: "Fast" },
                { k: "max", label: "Max" },
              ].map((x: any) => (
                <Pressable
                  key={x.k}
                  onPress={() => setConfirmTier(x.k)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: confirmTier === x.k ? "#caa83c" : "#333",
                    backgroundColor: confirmTier === x.k ? "#1a1405" : "transparent",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{x.label}</Text>
                </Pressable>
              ))}
            </View>

            {confirmTier === "max" ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: "#aaa" }}>Max adds +{confirmMaxExtraPct}% over min gas</Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <Pressable
                    onPress={() => setConfirmMaxExtraPct((v) => Math.max(0, v - 25))}
                    style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#333", alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>−25%</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setConfirmMaxExtraPct((v) => Math.min(500, v + 25))}
                    style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#333", alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>+25%</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={{ height: 12 }} />
            {confirmFeePreview ? (
              <>
                <Text style={{ color: "#fff", fontWeight: "800" }}>Fees</Text>
                <Text style={{ color: "#aaa" }}>Gas fee: {fmt8(confirmFeePreview.gasFee)}</Text>
                <Text style={{ color: "#aaa" }}>Service fee (0.005%): {fmt8(confirmFeePreview.serviceFee)}</Text>
                <Text style={{ color: "#aaa" }}>Total fee: {fmt8(confirmFeePreview.totalFee)}</Text>
                <Text style={{ color: "#fff", marginTop: 6, fontWeight: "900" }}>
                  Total cost: {fmt8(confirmFeePreview.totalCost)} HNY
                </Text>
              </>
            ) : (
              <Text style={{ color: "#666" }}>Loading fee preview…</Text>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setConfirmOpen(false)}
                disabled={sendBusy}
                style={{ flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "#333", alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSendSignedSubmit}
                disabled={sendBusy || !confirmFeePreview}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 10,
                  backgroundColor: "#caa83c",
                  alignItems: "center",
                  opacity: sendBusy || !confirmFeePreview ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#000", fontWeight: "900" }}>{sendBusy ? "Submitting..." : "Sign & Submit"}</Text>
              </Pressable>
            </View>

            <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
              Tip: Choose Fast/Max to reduce the chance you’ll need Speed Up later.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Speed Up / Cancel modal */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: "#0b0b0b", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 }}>
              {rbfMode === "cancel" ? "Cancel Pending Tx" : "Speed Up (RBF)"}
            </Text>

            {rbfTx ? (
              <>
                <Text style={{ color: "#aaa" }}>To: {String(rbfTx.to)}</Text>
                <Text style={{ color: "#aaa" }}>Amount: {Number(rbfTx.amount)}</Text>
                <Text style={{ color: "#aaa" }}>Nonce: {rbfTx.nonce}</Text>
              </>
            ) : null}

            {rbfMode === "cancel" ? (
              <Text style={{ color: "#ff9b9b", marginTop: 10 }}>
                This will replace the pending send with a self-send (dust) using the SAME nonce + higher fee.
              </Text>
            ) : null}

            <View style={{ height: 12 }} />
            <Text style={{ color: "#fff", fontWeight: "800" }}>Choose bump</Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              {[1.25, 1.5, 2.0].map((m) => (
                <Pressable
                  key={String(m)}
                  onPress={() => setRbfMultiplier(m)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: rbfMultiplier === m ? "#caa83c" : "#333",
                    backgroundColor: rbfMultiplier === m ? "#1a1405" : "transparent",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{m}×</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setRbfMultiplier(2.5)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: rbfMultiplier === 2.5 ? "#caa83c" : "#333",
                  backgroundColor: rbfMultiplier === 2.5 ? "#1a1405" : "transparent",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>MAX</Text>
              </Pressable>
            </View>

            <View style={{ height: 12 }} />

            {rbfPreviewData?.fees ? (
              <>
                <Text style={{ color: "#aaa" }}>Old total fee: {fmt8(rbfPreviewData.fees.oldTotalFee)}</Text>
                <Text style={{ color: "#aaa" }}>New gas fee: {fmt8(rbfPreviewData.fees.newGas)}</Text>
                <Text style={{ color: "#aaa" }}>Service fee: {fmt8(rbfPreviewData.fees.serviceFee)}</Text>
                <Text style={{ color: "#fff", fontWeight: "900", marginTop: 6 }}>
                  New total fee: {fmt8(rbfPreviewData.fees.newTotalFee)}
                </Text>
              </>
            ) : (
              <Text style={{ color: "#666" }}>Loading fee preview…</Text>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setRbfOpen(false)}
                disabled={sendBusy}
                style={{ flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "#333", alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Back</Text>
              </Pressable>

              <Pressable
                onPress={() => submitRbfOrCancel(rbfMultiplier === 2.5 ? 2.0 : rbfMultiplier, rbfMultiplier === 2.5)}
                disabled={sendBusy}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 10,
                  backgroundColor: rbfMode === "cancel" ? "#ff3b3b" : "#2b6fff",
                  alignItems: "center",
                  opacity: sendBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting..." : "Sign & Submit"}</Text>
              </Pressable>
            </View>

            <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
              {rbfMode === "cancel"
                ? "Cancel works by replacement (same nonce) with a higher fee."
                : "Speed Up works by replacement (same nonce) with a higher fee."}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
