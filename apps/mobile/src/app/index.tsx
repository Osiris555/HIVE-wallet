import { View, Text, Pressable, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { fetchBalance, mintTokens } from "../chain/transactions";

const MINT_COOLDOWN_MS = 30_000;

export default function App() {
  const [address] = useState("demo-wallet");
  const [balance, setBalance] = useState<number>(0);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  /**
   * Load balance from server
   */
  async function loadBalance() {
    try {
      const b = await fetchBalance(address);
      setBalance(b);
    } catch (err) {
      console.error("Balance fetch failed", err);
    }
  }

  /**
   * Initial load
   */
  useEffect(() => {
    loadBalance();
  }, []);

  /**
   * Mint handler (async-safe)
   */
  async function handleMint() {
    const now = Date.now();
    if (now < cooldownUntil || loading) return;

    try {
      setLoading(true);
      await mintTokens(address);
      await loadBalance(); // ✅ critical fix
      setCooldownUntil(now + MINT_COOLDOWN_MS);
    } catch (err) {
      console.error("Mint failed", err);
    } finally {
      setLoading(false);
    }
  }

  const cooldownRemaining = Math.max(
    0,
    Math.ceil((cooldownUntil - Date.now()) / 1000)
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HIVE Wallet</Text>

      <Text style={styles.balance}>
        Balance: {balance} HNY
      </Text>

      <Pressable
        onPress={handleMint}
        disabled={cooldownRemaining > 0 || loading}
        style={[
          styles.mintButton,
          (cooldownRemaining > 0 || loading) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>
          {cooldownRemaining > 0
            ? `Mint (${cooldownRemaining}s)`
            : loading
            ? "Minting..."
            : "Mint"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 12,
  },
  balance: {
    fontSize: 18,
    color: "#fff",
    marginBottom: 24,
  },
  mintButton: {
    backgroundColor: "#D4AF37", // gold
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "700",
  },
});
