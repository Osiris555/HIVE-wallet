// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  Platform,
  ImageBackground,
} from "react-native";

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
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0.00000000";
  return x.toFixed(8);
}

const ONE_SAT = 0.00000001;

export default function Index() {
  const [wallet, setWallet] = useState<string>("");

  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);

  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);

  // ✅ fee vault balance (collected fees)
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);

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

  // ✅ gas picker for confirm modal
  const [gasPreset, setGasPreset] = useState<"slow" | "normal" | "fast" | "custom">("normal");
  const [customGasStr, setCustomGasStr] = useState<string>("");

  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  async function refreshStatus() {
    const s = await getChainStatus();
    setChainHeight(Number(s.chainHeight || 0));
    setMsUntilNextBlock(Number(s.msUntilNextBlock || 0));

    // ✅ pull vault balance if server provides it
    if (s.feeVaultBalance != null) {
      setFeeVaultBalance(Number(s.feeVaultBalance || 0));
    } else if (s.vaultBalance != null) {
      // fallback if you named it differently
      setFeeVaultBalance(Number(s.vaultBalance || 0));
    }

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
      setMessage(`Balance fetch failed: ${e?.message || "Unknown error"}`);
    }
  }

  async function loadTxs() {
    if (!wallet) return;
    try {
      const list = await getTransactions(wallet);
      setTxs(list || []);
    } catch (e: any) {
      console.error("Tx fetch failed:", e?.message || e);
      setMessage(`Tx fetch failed: ${e?.message || "Unknown error"}`);
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

      // reset gas chooser
      setGasPreset("normal");
      setCustomGasStr("");

      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  function clampGas(g: number, minGas: number) {
    const x = Number(g);
    if (!Number.isFinite(x)) return minGas;
    return Math.max(minGas, Number(x.toFixed(8)));
  }

  const computedConfirmFees = useMemo(() => {
    if (!quote) return null;

    const minGas = Number(quote.minGasFee || quote.minGas || 0);
    const baseGas = Number(quote.gasFee || 0);
    const serviceFee = Number(quote.serviceFee || 0);

    // If quote didn’t provide minGas, fall back to a tiny floor
    const effectiveMinGas = minGas > 0 ? minGas : ONE_SAT;

    let gasFee = baseGas;

    if (gasPreset === "slow") gasFee = clampGas(baseGas * 0.8, effectiveMinGas);
    if (gasPreset === "normal") gasFee = clampGas(baseGas * 1.0, effectiveMinGas);
    if (gasPreset === "fast") gasFee = clampGas(baseGas * 1.5, effectiveMinGas);

    if (gasPreset === "custom") {
      gasFee = clampGas(Number(customGasStr || 0), effectiveMinGas);
    }

    const totalFee = Number((gasFee + serviceFee).toFixed(8));
    const totalCost = Number((Number(quote.amount || amount) + totalFee).toFixed(8));

    return { minGas: effectiveMinGas, gasFee, serviceFee, totalFee, totalCost };
  }, [quote, gasPreset, customGasStr, amount]);

  async function handleSendSignedSubmit() {
    if (!quote || !computedConfirmFees) return;
    setSendBusy(true);
    setMessage("");

    try {
      const res = await send({
        to,
        amount,
        gasFee: computedConfirmFees.gasFee,
        serviceFee: computedConfirmFees.serviceFee,
      });

      setConfirmOpen(false);
      setMessage(
        res?.isReplacement
          ? "Send replaced a pending tx with higher fee (RBF) ✅"
          : "Send submitted (pending until next block) ✅"
      );

      await loadBalance();
      await loadTxs();
      await refreshStatus();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return mintBusy ? "Minting..." : "Mint";
  }, [mintCooldown, mintBusy]);

  // --- UI ---
  return (
    <ImageBackground
      source={require("./honeycomb-bg.png")}
      resizeMode="cover"
      style={{ flex: 1 }}
    >
      {/* dark overlay for readability */}
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }}>
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            gap: 14,
            maxWidth: 950,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontSize: 34,
              textAlign: "center",
              fontWeight: "800",
              marginTop: 6,
            }}
          >
            HIVE Wallet
          </Text>

          <Text style={{ color: "#aaa", textAlign: "center" }}>
            Chain height: {chainHeight} · Next block: ~{Math.ceil(msUntilNextBlock / 1000)}s
          </Text>

          {wallet ? (
            <Text style={{ color: "#aaa", textAlign: "center" }}>
              Wallet: {wallet}
            </Text>
          ) : null}

          <Text style={{ color: "#fff", textAlign: "center", fontSize: 20, marginTop: 6 }}>
            Confirmed: {fmt8(confirmedBalance)} HNY
          </Text>
          <Text style={{ color: "#aaa", textAlign: "center" }}>
            Spendable: {fmt8(spendableBalance)} HNY
          </Text>

          {/* ✅ Fee vault */}
          <Text style={{ color: "#aaa", textAlign: "center" }}>
            Fee vault: {fmt8(feeVaultBalance)} HNY
          </Text>

          {message ? (
            <Text
              style={{
                color: message.toLowerCase().includes("failed") ? "#ff6b6b" : "#9dff9d",
                textAlign: "center",
              }}
            >
              {message}
            </Text>
          ) : null}

          {cooldownText ? (
            <Text style={{ color: "#ff6b6b", textAlign: "center" }}>
              {cooldownText}
            </Text>
          ) : null}

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

          {/* ✅ Get Balance + History toggle */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={loadBalance}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: "#222",
                padding: 14,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: "rgba(0,0,0,0.25)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Get Balance</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowHistory((v) => !v)}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: "#222",
                padding: 14,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: "rgba(0,0,0,0.25)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {showHistory ? "Hide History" : "Transaction History"}
              </Text>
            </Pressable>
          </View>

          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18, marginTop: 10 }}>
            Send
          </Text>

          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Recipient address (HNY_...)"
            placeholderTextColor="#666"
            style={{
              backgroundColor: "rgba(17,17,17,0.85)",
              borderRadius: 10,
              padding: 14,
              color: "#fff",
              borderWidth: 1,
              borderColor: "#222",
            }}
          />

          <TextInput
            value={amountStr}
            onChangeText={setAmountStr}
            placeholder="Amount"
            placeholderTextColor="#666"
            keyboardType={Platform.OS === "web" ? "text" : "numeric"}
            style={{
              backgroundColor: "rgba(17,17,17,0.85)",
              borderRadius: 10,
              padding: 14,
              color: "#fff",
              borderWidth: 1,
              borderColor: "#222",
            }}
          />

          <Pressable
            onPress={openSendConfirm}
            disabled={sendBusy}
            style={{
              backgroundColor: "#caa83c",
              opacity: sendBusy ? 0.6 : 1,
              padding: 18,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 18 }}>
              {sendBusy ? "Working..." : "Send"}
            </Text>
          </Pressable>

          {/* ✅ History list restored */}
          {showHistory ? (
            <View
              style={{
                marginTop: 6,
                borderWidth: 1,
                borderColor: "#222",
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "rgba(0,0,0,0.25)",
              }}
            >
              {txs.length === 0 ? (
                <Text style={{ color: "#aaa", padding: 14 }}>No transactions yet.</Text>
              ) : (
                txs.map((t, idx) => {
                  const gasFee = Number(t.gasFee || 0);
                  const serviceFee = Number(t.serviceFee || 0);
                  const totalFee = t.totalFee != null ? Number(t.totalFee) : Number((gasFee + serviceFee).toFixed(8));

                  const title =
                    `${String(t.type).toUpperCase()} · ${t.amount}` +
                    ` · fee ${fmt8(totalFee)}` +
                    ` · ${t.status}` +
                    (t.blockHeight ? ` · block ${t.blockHeight}` : "");

                  return (
                    <View
                      key={t.id || idx}
                      style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "#222" }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800" }}>{title}</Text>

                      {/* ✅ fee breakdown */}
                      <Text style={{ color: "#aaa" }}>Gas: {fmt8(gasFee)} · Service: {fmt8(serviceFee)}</Text>

                      {t.failReason ? <Text style={{ color: "#ff6b6b" }}>Reason: {t.failReason}</Text> : null}
                      {t.nonce != null ? <Text style={{ color: "#aaa" }}>Nonce: {t.nonce}</Text> : null}
                      <Text style={{ color: "#aaa" }}>From: {t.from || "—"}</Text>
                      <Text style={{ color: "#aaa" }}>To: {t.to}</Text>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}
        </ScrollView>

        {/* ✅ Confirm modal with gas options */}
        <Modal
          transparent
          visible={confirmOpen}
          animationType="fade"
          onRequestClose={() => setConfirmOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
            <View style={{ backgroundColor: "#0b0b0b", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 16 }}>
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 }}>
                Confirm Transaction
              </Text>

              <Text style={{ color: "#aaa" }}>To: {to}</Text>
              <Text style={{ color: "#aaa" }}>Amount: {amount}</Text>

              {quote && computedConfirmFees ? (
                <>
                  <View style={{ height: 10 }} />
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Gas</Text>

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    {[
                      { k: "slow", label: "Slow" },
                      { k: "normal", label: "Normal" },
                      { k: "fast", label: "Fast" },
                      { k: "custom", label: "Custom" },
                    ].map((b) => (
                      <Pressable
                        key={b.k}
                        onPress={() => setGasPreset(b.k as any)}
                        style={{
                          flex: 1,
                          padding: 10,
                          borderRadius: 10,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: gasPreset === b.k ? "#caa83c" : "#333",
                          backgroundColor: gasPreset === b.k ? "#1a1405" : "transparent",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900" }}>{b.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {gasPreset === "custom" ? (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: "#aaa", marginBottom: 6 }}>
                        Custom gas (min {fmt8(computedConfirmFees.minGas)})
                      </Text>
                      <TextInput
                        value={customGasStr}
                        onChangeText={setCustomGasStr}
                        placeholder={`e.g. ${fmt8(computedConfirmFees.gasFee)}`}
                        placeholderTextColor="#666"
                        keyboardType={Platform.OS === "web" ? "text" : "numeric"}
                        style={{
                          backgroundColor: "rgba(17,17,17,0.85)",
                          borderRadius: 10,
                          padding: 12,
                          color: "#fff",
                          borderWidth: 1,
                          borderColor: "#222",
                        }}
                      />
                    </View>
                  ) : null}

                  <View style={{ height: 10 }} />
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Fees</Text>
                  <Text style={{ color: "#aaa" }}>Gas fee: {fmt8(computedConfirmFees.gasFee)}</Text>
                  <Text style={{ color: "#aaa" }}>Service fee (0.005%): {fmt8(computedConfirmFees.serviceFee)}</Text>
                  <Text style={{ color: "#aaa" }}>Total fee: {fmt8(computedConfirmFees.totalFee)}</Text>
                  <Text style={{ color: "#fff", marginTop: 6, fontWeight: "900" }}>
                    Total cost: {fmt8(computedConfirmFees.totalCost)} HNY
                  </Text>
                </>
              ) : (
                <Text style={{ color: "#666" }}>Loading quote…</Text>
              )}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Pressable
                  onPress={() => setConfirmOpen(false)}
                  disabled={sendBusy}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#333",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={handleSendSignedSubmit}
                  disabled={sendBusy || !computedConfirmFees}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 10,
                    backgroundColor: "#caa83c",
                    alignItems: "center",
                    opacity: sendBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "900" }}>
                    {sendBusy ? "Submitting..." : "Sign & Submit"}
                  </Text>
                </Pressable>
              </View>

              <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
                Your device signs this transaction locally using your stored private key.
              </Text>
            </View>
          </View>
        </Modal>
      </View>
    </ImageBackground>
  );
}
