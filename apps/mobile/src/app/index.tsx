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

export default function Index() {
  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);

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

  // RBF fee chooser modal
  const [rbfOpen, setRbfOpen] = useState<boolean>(false);
  const [rbfTx, setRbfTx] = useState<any>(null);
  const [rbfMultiplier, setRbfMultiplier] = useState<number>(1.5);

  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  async function refreshStatus() {
    const s = await getChainStatus();
    setChainHeight(Number(s.chainHeight || 0));
    setMsUntilNextBlock(Number(s.msUntilNextBlock || 0));
    return s;
  }

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
    return w;
  }

  async function loadBalance() {
    if (!wallet) return;
    try {
      const b = await getBalance(wallet);
      setConfirmedBalance(Number(b.balance || 0));
      setSpendableBalance(Number(b.spendableBalance || 0));
    } catch (e: any) {
      console.error("Balance fetch failed:", e?.message || e);
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

  async function bootstrap() {
    await loadWallet();
    await refreshStatus();
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

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await loadBalance();
      await loadTxs();
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e.cooldownSeconds || 60);
        setMintCooldown(cd);
        setMessage(`Cooldown active (${cd}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setMintBusy(false);
    }
  }

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
      const q = await quoteSend(to, amount);
      setQuote(q);
      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  async function handleSendSignedSubmit() {
    if (!quote) return;
    setSendBusy(true);
    setMessage("");
    try {
      const res = await send({
        to,
        amount,
        gasFee: quote.gasFee,
        serviceFee: quote.serviceFee,
      });

      setConfirmOpen(false);

      setMessage(res?.isReplacement ? "Send replaced a pending tx with higher fee (RBF) ✅" : "Send submitted (pending until next block) ✅");

      await loadBalance();
      await loadTxs();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  // ----- RBF helpers -----
  function openRbfChooser(tx: any) {
    setMessage("");
    setRbfTx(tx);
    setRbfMultiplier(1.5);
    setRbfOpen(true);
  }

  function calcRbfFees(tx: any, status: any, multiplier: number) {
    const minGas = Number(status.minGasFee || 0);
    const rate = Number(status.serviceFeeRate || 0);

    const amt = Number(tx.amount);
    const oldGas = Number(tx.gasFee || 0);
    const oldSvc = Number(tx.serviceFee || 0);
    const oldTotalFee = Number((oldGas + oldSvc).toFixed(8));

    const serviceFee = computeServiceFee(amt, rate);

    // bump gas by multiplier from oldGas (fallback to minGas)
    let newGas = Number(((oldGas > 0 ? oldGas : minGas) * multiplier).toFixed(8));
    newGas = Math.max(minGas, newGas);

    // For "MAX", we’ll still pass multiplier, but the caller can add extra.
    let newTotalFee = Number((newGas + serviceFee).toFixed(8));

    // ensure strictly higher than old (server requires >)
    if (newTotalFee <= oldTotalFee) {
      while (newTotalFee <= oldTotalFee) {
        newGas = Number((newGas + ONE_SAT).toFixed(8));
        newTotalFee = Number((newGas + serviceFee).toFixed(8));
      }
    }

    return { minGas, rate, serviceFee, oldTotalFee, oldGas, oldSvc, newGas, newTotalFee };
  }

  async function submitRbf(multiplier: number, isMax: boolean) {
    if (sendBusy) return;
    if (!rbfTx) return;

    setSendBusy(true);
    setMessage("");

    try {
      const tx = rbfTx;

      if (tx.type !== "send" || tx.status !== "pending") {
        setMessage("RBF only works for pending SEND transactions.");
        return;
      }
      if (!wallet || tx.from !== wallet) {
        setMessage("You can only speed up your own outgoing pending tx.");
        return;
      }
      if (tx.nonce == null) {
        setMessage("Missing nonce on pending tx (cannot RBF).");
        return;
      }

      const status = await getChainStatus();
      const fees = calcRbfFees(tx, status, multiplier);

      let gasFee = fees.newGas;

      // “MAX” adds an extra bump to strongly outbid typical replacements
      if (isMax) {
        gasFee = Number((gasFee + Math.max(fees.minGas, gasFee) * 0.25).toFixed(8)); // +25%
      }

      // re-check strict > old total fee after max bump
      let totalFee = Number((gasFee + fees.serviceFee).toFixed(8));
      if (totalFee <= fees.oldTotalFee) {
        while (totalFee <= fees.oldTotalFee) {
          gasFee = Number((gasFee + ONE_SAT).toFixed(8));
          totalFee = Number((gasFee + fees.serviceFee).toFixed(8));
        }
      }

      const res = await send({
        to: String(tx.to),
        amount: Number(tx.amount),
        gasFee,
        serviceFee: fees.serviceFee,
        nonceOverride: Number(tx.nonce), // ✅ replacement nonce
      });

      setRbfOpen(false);
      setRbfTx(null);

      setMessage(res?.isReplacement ? `Speed up submitted (RBF) ✅  New fee: ${fmt8(totalFee)}` : "Speed up submitted, but not treated as replacement (already confirmed?).");

      await loadBalance();
      await loadTxs();
    } catch (e: any) {
      setMessage(`Speed up failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return mintBusy ? "Minting..." : "Mint";
  }, [mintCooldown, mintBusy]);

  // derived preview for RBF modal
  const rbfPreview = useMemo(() => {
    if (!rbfTx) return null;
    return (async () => {
      try {
        const status = await getChainStatus();
        return { status, fees: calcRbfFees(rbfTx, status, rbfMultiplier) };
      } catch {
        return null;
      }
    })();
  }, [rbfTx, rbfMultiplier]);

  const [rbfPreviewData, setRbfPreviewData] = useState<any>(null);
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

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 14, maxWidth: 950, alignSelf: "center", width: "100%" }}>
        <Text style={{ color: "#fff", fontSize: 34, textAlign: "center", fontWeight: "800", marginTop: 6 }}>
          HIVE Wallet
        </Text>

        <Text style={{ color: "#aaa", textAlign: "center" }}>
          Chain height: {chainHeight} · Next block: ~{Math.ceil(msUntilNextBlock / 1000)}s
        </Text>

        {wallet ? <Text style={{ color: "#aaa", textAlign: "center" }}>Wallet: {wallet}</Text> : null}

        <Text style={{ color: "#fff", textAlign: "center", fontSize: 20, marginTop: 6 }}>
          Confirmed: {Math.floor(confirmedBalance)} HNY
        </Text>
        <Text style={{ color: "#aaa", textAlign: "center" }}>Spendable: {Math.floor(spendableBalance)} HNY</Text>

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
            onPress={loadBalance}
            style={{ flex: 1, borderWidth: 1, borderColor: "#222", padding: 14, borderRadius: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Get Balance</Text>
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
                const title =
                  `${String(t.type).toUpperCase()} · ${t.amount}` +
                  (t.totalFee != null ? ` · fee ${fmt8(t.totalFee)}` : "") +
                  ` · ${t.status}` +
                  (t.blockHeight ? ` · block ${t.blockHeight}` : "");

                const showRbf = t.type === "send" && t.status === "pending" && wallet && t.from === wallet && t.nonce != null;

                return (
                  <View key={t.id || idx} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "#222" }}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>{title}</Text>
                    {t.failReason ? <Text style={{ color: "#ff6b6b" }}>Reason: {t.failReason}</Text> : null}
                    {t.nonce != null ? <Text style={{ color: "#aaa" }}>Nonce: {t.nonce}</Text> : null}
                    <Text style={{ color: "#aaa" }}>From: {t.from || "—"}</Text>
                    <Text style={{ color: "#aaa" }}>To: {t.to}</Text>

                    {showRbf ? (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                        <Pressable
                          onPress={() => openRbfChooser(t)}
                          disabled={sendBusy}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 10,
                            backgroundColor: "#2b6fff",
                            opacity: sendBusy ? 0.6 : 1,
                            alignSelf: "flex-start",
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900" }}>⚡ Speed Up (RBF)</Text>
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

      {/* Confirm modal (normal send) */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: "#0b0b0b", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Confirm Transaction</Text>

            <Text style={{ color: "#aaa" }}>To: {to}</Text>
            <Text style={{ color: "#aaa" }}>Amount: {amount}</Text>

            {quote ? (
              <>
                <View style={{ height: 10 }} />
                <Text style={{ color: "#fff", fontWeight: "800" }}>Fees</Text>
                <Text style={{ color: "#aaa" }}>Gas fee: {fmt8(quote.gasFee)}</Text>
                <Text style={{ color: "#aaa" }}>Service fee (0.005%): {fmt8(quote.serviceFee)}</Text>
                <Text style={{ color: "#aaa" }}>Total fee: {fmt8(quote.totalFee)}</Text>
                <Text style={{ color: "#fff", marginTop: 6, fontWeight: "900" }}>Total cost: {fmt8(quote.totalCost)} HNY</Text>
              </>
            ) : null}

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
                disabled={sendBusy}
                style={{ flex: 1, padding: 14, borderRadius: 10, backgroundColor: "#caa83c", alignItems: "center", opacity: sendBusy ? 0.6 : 1 }}
              >
                <Text style={{ color: "#000", fontWeight: "900" }}>{sendBusy ? "Submitting..." : "Sign & Submit"}</Text>
              </Pressable>
            </View>

            <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
              Your device signs this transaction locally using your stored private key.
            </Text>
          </View>
        </View>
      </Modal>

      {/* RBF Fee chooser modal */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: "#0b0b0b", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 }}>Speed Up (RBF)</Text>

            {rbfTx ? (
              <>
                <Text style={{ color: "#aaa" }}>To: {String(rbfTx.to)}</Text>
                <Text style={{ color: "#aaa" }}>Amount: {Number(rbfTx.amount)}</Text>
                <Text style={{ color: "#aaa" }}>Nonce: {rbfTx.nonce}</Text>
              </>
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
                <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={() => submitRbf(rbfMultiplier === 2.5 ? 2.0 : rbfMultiplier, rbfMultiplier === 2.5)}
                disabled={sendBusy}
                style={{ flex: 1, padding: 14, borderRadius: 10, backgroundColor: "#2b6fff", alignItems: "center", opacity: sendBusy ? 0.6 : 1 }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{sendBusy ? "Submitting..." : "Sign & Submit"}</Text>
              </Pressable>
            </View>

            <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
              This replaces your pending transaction by reusing the same nonce with a higher fee.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
