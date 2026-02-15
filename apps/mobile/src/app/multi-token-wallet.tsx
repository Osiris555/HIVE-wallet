// apps/mobile/src/app/multi-token-wallet.tsx
// Enhanced Multi-Token Wallet UI with Swap, stHNY, and Real Prices

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  ensureWalletId,
  getTokenBalances,
  getTokenPrices,
  tokenFaucet,
  sendToken,
  getSwapQuote,
  swap,
  type TokenBalance,
  type SwapQuote,
} from "../chain/transactions";

// Theme colors
const COLORS = {
  bg: "#040507",
  glass: "rgba(0,0,0,0.45)",
  glassBorder: "rgba(57,255,20,0.18)",
  text: "#ffffff",
  textSub: "rgba(255,255,255,0.7)",
  green: "#39ff14",
  purple: "#7b2cff",
  blue: "#2b7cff",
  gold: "#caa83c",
  danger: "rgba(255,90,90,0.96)",
};

// Token icon emojis (you can replace with actual images later)
const TOKEN_ICONS: { [key: string]: string } = {
  HNY: "🍯",
  stHNY: "🔒",
  ETH: "💎",
  BTC: "🟡",
  SOL: "☀️",
  USDT: "💵",
  USDC: "💚",
  XRP: "🌊",
};

function GlassCard({ children, style }: { children: React.ReactNode; style?: any }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
      : null;

  return (
    <View
      style={[
        {
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: COLORS.glassBorder,
          backgroundColor: COLORS.glass,
        },
        webBlur,
        style,
      ]}
    >
      <View style={{ padding: 14 }}>{children}</View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = "purple",
  small = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: "green" | "purple" | "outline" | "danger" | "blue";
  small?: boolean;
}) {
  const bg =
    variant === "green"
      ? COLORS.green
      : variant === "purple"
      ? COLORS.purple
      : variant === "danger"
      ? COLORS.danger
      : variant === "blue"
      ? COLORS.blue
      : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: small ? 8 : 12,
        borderRadius: 12,
        alignItems: "center",
        backgroundColor: bg,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: COLORS.glassBorder,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: small ? 14 : 16 }}>{label}</Text>
    </Pressable>
  );
}

export default function MultiTokenWallet() {
  const [wallet, setWallet] = useState("");
  const [balances, setBalances] = useState<TokenBalance>({});
  const [prices, setPrices] = useState<{ [symbol: string]: number }>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Modals
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [faucetModalOpen, setFaucetModalOpen] = useState(false);

  // Send token state
  const [sendTokenSymbol, setSendTokenSymbol] = useState("ETH");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  // Swap state
  const [swapTokenIn, setSwapTokenIn] = useState("HNY");
  const [swapTokenOut, setSwapTokenOut] = useState("ETH");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [fetchingQuote, setFetchingQuote] = useState(false);

  // Faucet state
  const [faucetToken, setFaucetToken] = useState("ETH");
  const [faucetAmount, setFaucetAmount] = useState("1000");
  const [faucetBusy, setFaucetBusy] = useState(false);

  // Load wallet and balances
  useEffect(() => {
    async function load() {
      try {
        const w = await ensureWalletId();
        setWallet(w);

        const { balances: bals, tokens: tokenInfo } = await getTokenBalances(w);
        setBalances(bals);

        const realPrices = await getTokenPrices();
        setPrices(realPrices);

        setLoading(false);
      } catch (e: any) {
        setMessage(`Error: ${e.message}`);
        setLoading(false);
      }
    }
    load();
  }, []);

  // Auto-refresh prices every minute
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const realPrices = await getTokenPrices();
        setPrices(realPrices);
      } catch {}
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Refresh balances
  async function refreshBalances() {
    try {
      const { balances: bals } = await getTokenBalances(wallet);
      setBalances(bals);
    } catch (e: any) {
      setMessage(`Refresh error: ${e.message}`);
    }
  }

  // Calculate portfolio value
  const portfolioValueUSD = Object.entries(balances).reduce((sum, [symbol, amount]) => {
    const price = prices[symbol] || 0;
    return sum + amount * price;
  }, 0);

  // Get swap quote
  useEffect(() => {
    if (!swapAmountIn || Number(swapAmountIn) <= 0) {
      setSwapQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setFetchingQuote(true);
        const quote = await getSwapQuote({
          tokenIn: swapTokenIn,
          tokenOut: swapTokenOut,
          amountIn: Number(swapAmountIn),
        });
        setSwapQuote(quote);
      } catch (e: any) {
        setSwapQuote(null);
      } finally {
        setFetchingQuote(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [swapAmountIn, swapTokenIn, swapTokenOut]);

  // Handle token send
  async function handleSendToken() {
    if (!sendTo || !sendAmount) {
      setMessage("Enter recipient and amount");
      return;
    }

    const amt = Number(sendAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage("Invalid amount");
      return;
    }

    if (balances[sendTokenSymbol] < amt) {
      setMessage(`Insufficient ${sendTokenSymbol} balance`);
      return;
    }

    setSendBusy(true);
    try {
      await sendToken({
        to: sendTo,
        tokenSymbol: sendTokenSymbol,
        amount: amt,
      });
      setMessage(`✅ ${amt} ${sendTokenSymbol} sent to ${sendTo.slice(0, 12)}...`);
      setSendTo("");
      setSendAmount("");
      setSendModalOpen(false);
      await refreshBalances();
    } catch (e: any) {
      setMessage(`Send failed: ${e.message}`);
    } finally {
      setSendBusy(false);
    }
  }

  // Handle swap
  async function handleSwap() {
    if (!swapQuote) {
      setMessage("Get a quote first");
      return;
    }

    const amt = Number(swapAmountIn);
    if (balances[swapTokenIn] < amt) {
      setMessage(`Insufficient ${swapTokenIn} balance`);
      return;
    }

    setSwapBusy(true);
    try {
      await swap({
        tokenIn: swapTokenIn,
        tokenOut: swapTokenOut,
        amountIn: amt,
        minAmountOut: swapQuote.amountOut * 0.98, // 2% slippage tolerance
      });
      setMessage(`✅ Swapped ${amt} ${swapTokenIn} for ${swapQuote.amountOut.toFixed(6)} ${swapTokenOut}`);
      setSwapAmountIn("");
      setSwapModalOpen(false);
      await refreshBalances();
    } catch (e: any) {
      setMessage(`Swap failed: ${e.message}`);
    } finally {
      setSwapBusy(false);
    }
  }

  // Handle faucet
  async function handleFaucet() {
    const amt = Number(faucetAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage("Invalid amount");
      return;
    }

    setFaucetBusy(true);
    try {
      await tokenFaucet({ tokenSymbol: faucetToken, amount: amt });
      setMessage(`✅ Minted ${amt} ${faucetToken}`);
      setFaucetModalOpen(false);
      await refreshBalances();
    } catch (e: any) {
      setMessage(`Faucet error: ${e.message}`);
    } finally {
      setFaucetBusy(false);
    }
  }

  const tokenList = ["HNY", "stHNY", "ETH", "BTC", "SOL", "USDT", "USDC", "XRP"];

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.green} />
        <Text style={styles.loadingText}>Loading wallet...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ padding: 16 }}>
          <Text style={styles.title}>Multi-Token Wallet 🐝</Text>
          <Text style={styles.subtitle}>Wallet: {wallet.slice(0, 12)}...</Text>
        </View>

        {/* Portfolio Card */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <GlassCard>
            <Text style={styles.label}>Total Portfolio Value</Text>
            <Text style={styles.portfolioValue}>${portfolioValueUSD.toFixed(2)}</Text>
            <View style={{ height: 10 }} />
            <Button label="View Details" variant="outline" onPress={() => setPortfolioOpen(true)} />
          </GlassCard>
        </View>

        {/* Token Balances */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={styles.sectionTitle}>Balances</Text>
          {tokenList.map((symbol) => {
            const balance = balances[symbol] || 0;
            const price = prices[symbol] || 0;
            const value = balance * price;
            const icon = TOKEN_ICONS[symbol] || "💰";

            return (
              <GlassCard key={symbol} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 32, marginRight: 12 }}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tokenSymbol}>{symbol}</Text>
                    <Text style={styles.tokenBalance}>{balance.toFixed(8)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.tokenPrice}>${price.toFixed(2)}</Text>
                    <Text style={styles.tokenValue}>${value.toFixed(2)}</Text>
                  </View>
                </View>
              </GlassCard>
            );
          })}
        </View>

        {/* Action Buttons */}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <Button label="💸 Send Token" variant="purple" onPress={() => setSendModalOpen(true)} />
          <Button label="🔄 Swap Tokens" variant="blue" onPress={() => setSwapModalOpen(true)} />
          <Button label="🚰 Test Faucet" variant="green" onPress={() => setFaucetModalOpen(true)} />
          <Button label="🔄 Refresh Balances" variant="outline" onPress={refreshBalances} />
        </View>

        {/* stHNY Info */}
        {balances.stHNY > 0 && (
          <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
            <GlassCard style={{ borderColor: COLORS.gold }}>
              <Text style={[styles.label, { color: COLORS.gold }]}>⚡ stHNY - Transferable!</Text>
              <Text style={styles.subtitle}>
                Your {balances.stHNY.toFixed(2)} stHNY tokens are fully transferable. Recipients can unstake and
                receive the HNY!
              </Text>
            </GlassCard>
          </View>
        )}

        {/* Message Display */}
        {message && (
          <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
            <GlassCard style={{ backgroundColor: "rgba(57,255,20,0.15)" }}>
              <Text style={{ color: COLORS.green, fontWeight: "800" }}>{message}</Text>
            </GlassCard>
          </View>
        )}
      </ScrollView>

      {/* Send Token Modal */}
      {sendModalOpen && (
        <View style={styles.modal}>
          <GlassCard style={{ maxWidth: 500, width: "100%" }}>
            <Text style={styles.modalTitle}>Send Token</Text>

            <Text style={styles.label}>Token</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {tokenList.filter((t) => t !== "HNY").map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setSendTokenSymbol(t)}
                  style={{
                    padding: 8,
                    marginRight: 8,
                    borderRadius: 8,
                    backgroundColor: sendTokenSymbol === t ? COLORS.purple : COLORS.glass,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {TOKEN_ICONS[t]} {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.label}>Recipient Address</Text>
            <TextInput
              value={sendTo}
              onChangeText={setSendTo}
              placeholder="HNY_..."
              placeholderTextColor={COLORS.textSub}
              style={styles.input}
            />

            <Text style={styles.label}>Amount</Text>
            <TextInput
              value={sendAmount}
              onChangeText={setSendAmount}
              placeholder="0.00"
              placeholderTextColor={COLORS.textSub}
              keyboardType="numeric"
              style={styles.input}
            />
            <Text style={styles.subtitle}>Balance: {(balances[sendTokenSymbol] || 0).toFixed(8)}</Text>

            <View style={{ height: 16 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="outline" onPress={() => setSendModalOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={sendBusy ? "Sending..." : "Send"} variant="purple" onPress={handleSendToken} disabled={sendBusy} />
              </View>
            </View>
          </GlassCard>
        </View>
      )}

      {/* Swap Modal */}
      {swapModalOpen && (
        <View style={styles.modal}>
          <GlassCard style={{ maxWidth: 500, width: "100%" }}>
            <Text style={styles.modalTitle}>Swap Tokens</Text>

            <Text style={styles.label}>From</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {tokenList.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setSwapTokenIn(t)}
                  style={{
                    padding: 8,
                    marginRight: 8,
                    borderRadius: 8,
                    backgroundColor: swapTokenIn === t ? COLORS.blue : COLORS.glass,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {TOKEN_ICONS[t]} {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <TextInput
              value={swapAmountIn}
              onChangeText={setSwapAmountIn}
              placeholder="0.00"
              placeholderTextColor={COLORS.textSub}
              keyboardType="numeric"
              style={styles.input}
            />
            <Text style={styles.subtitle}>Balance: {(balances[swapTokenIn] || 0).toFixed(8)}</Text>

            <View style={{ alignItems: "center", marginVertical: 12 }}>
              <Text style={{ fontSize: 24 }}>⬇️</Text>
            </View>

            <Text style={styles.label}>To</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {tokenList.filter((t) => t !== swapTokenIn).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setSwapTokenOut(t)}
                  style={{
                    padding: 8,
                    marginRight: 8,
                    borderRadius: 8,
                    backgroundColor: swapTokenOut === t ? COLORS.green : COLORS.glass,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {TOKEN_ICONS[t]} {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {fetchingQuote && <Text style={styles.subtitle}>Fetching quote...</Text>}
            {swapQuote && (
              <View style={{ padding: 12, backgroundColor: "rgba(57,255,20,0.1)", borderRadius: 8, marginBottom: 12 }}>
                <Text style={styles.subtitle}>Expected: {swapQuote.amountOut.toFixed(8)} {swapTokenOut}</Text>
                <Text style={styles.subtitle}>Rate: 1 {swapTokenIn} = {swapQuote.exchangeRate.toFixed(8)} {swapTokenOut}</Text>
                <Text style={styles.subtitle}>Price Impact: {swapQuote.priceImpact.toFixed(4)}%</Text>
                <Text style={styles.subtitle}>Fee: {(swapQuote.feeRate * 100).toFixed(2)}%</Text>
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="outline" onPress={() => setSwapModalOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={swapBusy ? "Swapping..." : "Swap"}
                  variant="green"
                  onPress={handleSwap}
                  disabled={swapBusy || !swapQuote}
                />
              </View>
            </View>
          </GlassCard>
        </View>
      )}

      {/* Faucet Modal */}
      {faucetModalOpen && (
        <View style={styles.modal}>
          <GlassCard style={{ maxWidth: 400, width: "100%" }}>
            <Text style={styles.modalTitle}>Test Token Faucet 🚰</Text>

            <Text style={styles.label}>Token</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {tokenList.filter((t) => t !== "HNY" && t !== "stHNY").map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setFaucetToken(t)}
                  style={{
                    padding: 8,
                    marginRight: 8,
                    borderRadius: 8,
                    backgroundColor: faucetToken === t ? COLORS.green : COLORS.glass,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {TOKEN_ICONS[t]} {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.label}>Amount</Text>
            <TextInput
              value={faucetAmount}
              onChangeText={setFaucetAmount}
              placeholder="1000"
              placeholderTextColor={COLORS.textSub}
              keyboardType="numeric"
              style={styles.input}
            />

            <View style={{ height: 16 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="outline" onPress={() => setFaucetModalOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={faucetBusy ? "Minting..." : "Mint"} variant="green" onPress={handleFaucet} disabled={faucetBusy} />
              </View>
            </View>
          </GlassCard>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: COLORS.textSub,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 12,
  },
  label: {
    color: COLORS.textSub,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  portfolioValue: {
    color: COLORS.green,
    fontSize: 36,
    fontWeight: "900",
    marginTop: 8,
  },
  tokenSymbol: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "900",
  },
  tokenBalance: {
    color: COLORS.textSub,
    fontSize: 14,
    fontWeight: "600",
  },
  tokenPrice: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
  },
  tokenValue: {
    color: COLORS.green,
    fontSize: 16,
    fontWeight: "900",
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 16,
    marginTop: 12,
  },
  modal: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
    padding: 16,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: COLORS.text,
    backgroundColor: COLORS.glass,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
});
