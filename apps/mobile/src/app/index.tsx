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

// ✅ Put the image inside src so Metro can always resolve it
import honeycombBg from "../assets/honeycomb-bg.png";

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

  const [to, setTo] = useState("");
  const [amountStr, setAmountStr] = useState("");

  const [txs, setTxs] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  const [message, setMessage] = useState("");
  const [cooldownText, setCooldownText] = useState("");

  const [mintCooldown, setMintCooldown] = useState(0);
  const [mintBusy, setMintBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);

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

  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
    })();
  }, []);

  useEffect(() => {
    if (!wallet) return;
    loadBalance();
    loadTxs();
  }, [wallet]);

  // status poll
  useEffect(() => {
    const i = setInterval(async () => {
      try {
        await refreshStatus();
      } catch {}
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // tick down mint cooldown
  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    setCooldownText(mintCooldown > 0 ? `Cooldown active (${mintCooldown}s)` : "");
  }, [mintCooldown]);

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMintBusy(true);
    setMessage("");
    try {
      const res = await mint();
      setMessage("Mint submitted (pending until next block) ✅");
      await loadBalance();
      await loadTxs();
      setMintCooldown(Number(res?.cooldownSeconds || 60));
    } catch (e: any) {
      setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
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
      await send({
        to,
        amount,
        gasFee: quote.gasFee,
        serviceFee: quote.serviceFee,
      });

      setConfirmOpen(false);
      setMessage("Send submitted (pending until next block) ✅");
      await loadBalance();
      await loadTxs();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <ImageBackground source={honeycombBg} resizeMode="cover" style={{ flex: 1 }}>
      {/* Dark overlay for readability */}
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)" }}>
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            gap: 14,
            maxWidth: 950,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 34, textAlign: "center", fontWeight: "800", marginTop: 6 }}>
            HIVE Wallet
          </Text>

          <Text style={{ color: "#aaa", textAlign: "center" }}>
            Chain height: {chainHeight} · Next block: ~{Math.ceil(msUntilNextBlock / 1000)}s
          </Text>

          {wallet ? <Text style={{ color: "#aaa", textAlign: "center" }}>Wallet: {wallet}</Text> : null}

          <Text style={{ color: "#fff", textAlign: "center", fontSize: 20, marginTop: 6 }}>
            Confirmed: {fmt8(confirmedBalance)} HNY
          </Text>
          <Text style={{ color: "#aaa", textAlign: "center" }}>
            Spendable: {fmt8(spendableBalance)} HNY
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
            <Text style={{ fontWeight: "800", fontSize: 18 }}>
              {mintCooldown > 0 ? `Mint (${mintCooldown}s)` : mintBusy ? "Minting..." : "Mint"}
            </Text>
          </Pressable>

          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18, marginTop: 10 }}>Send</Text>

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

          {/* Minimal history container (your full history UI can be re-added on top of this background safely) */}
          {showHistory ? (
            <View style={{ marginTop: 6, borderWidth: 1, borderColor: "#222", borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.55)" }}>
              {txs.length === 0 ? (
                <Text style={{ color: "#aaa", padding: 14 }}>No transactions yet.</Text>
              ) : (
                txs.map((t, idx) => (
                  <View key={t.id || idx} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "#222" }}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>
                      {String(t.type).toUpperCase()} · {t.amount} · {t.status}
                    </Text>
                    <Text style={{ color: "#aaa" }}>To: {t.to}</Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </ScrollView>

        {/* Confirm modal */}
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
                  <Text style={{ color: "#aaa" }}>Service fee: {fmt8(quote.serviceFee)}</Text>
                  <Text style={{ color: "#aaa" }}>Total fee: {fmt8(quote.totalFee)}</Text>
                  <Text style={{ color: "#fff", marginTop: 6, fontWeight: "900" }}>
                    Total cost: {fmt8(quote.totalCost)} HNY
                  </Text>
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
      </View>
    </ImageBackground>
  );
}
