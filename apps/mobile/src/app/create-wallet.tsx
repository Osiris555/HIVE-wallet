// apps/mobile/src/app/create-wallet.tsx
// New wallet creation screen — shows 12-word seed phrase, requires confirmation,
// then runs the full ML-DSA-65 + Chrysalis registration ceremony before entering the app.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { generateMnemonic } from "../chain/bip39";
import { importFromMnemonic, getChrysalisKeypairForIndex, getActiveHiveMLDSAKeypair } from "../chain/wallet-manager";
import { registerWallet, getApiBase } from "../chain/transactions";
import { chrysalisFingerprint } from "../chain/chrysalis";
import { ChrysalisModal } from "../components/ChrysalisModal";

const BG = "#040507";
const NEON = "#39ff14";
const SUB = "rgba(255,255,255,0.55)";
const BORDER = "rgba(57,255,20,0.22)";
const GLASS = "rgba(255,255,255,0.04)";
const WARN = "rgba(255,191,47,0.9)";

export default function CreateWalletScreen() {
  const [mnemonic, setMnemonic] = useState<string>("");
  const [words, setWords]       = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [loading, setLoading]   = useState(false);

  // Chrysalis ceremony state
  const [chrysalisOpen,  setChrysalisOpen]  = useState(false);
  const [chrysalisStage, setChrysalisStage] = useState("");
  const [chrysalisDone,  setChrysalisDone]  = useState(false);
  const [chrysalisId,    setChrysalisId]    = useState<string | undefined>();
  const navigated = useRef(false);

  useEffect(() => {
    const phrase = generateMnemonic();
    setMnemonic(phrase);
    setWords(phrase.split(" "));
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mnemonic]);

  const handleFinish = useCallback(async () => {
    if (!confirmed) {
      Alert.alert("Please confirm", "Check the box to confirm you have saved your seed phrase.");
      return;
    }
    setLoading(true);

    // Open Chrysalis ceremony modal immediately
    setChrysalisStage("📝 Initializing master seed…");
    setChrysalisDone(false);
    setChrysalisId(undefined);
    setChrysalisOpen(true);

    try {
      // Step 1: Import mnemonic → sets master seed in SecureStore
      await importFromMnemonic(mnemonic);

      // Step 2: Derive ML-DSA-65 wallet keypair
      setChrysalisStage("⚡ Deriving ML-DSA-65 wallet keypair…");
      await new Promise(r => setTimeout(r, 120));

      // Step 3: Register ML-DSA-65 public key on Honey Network
      setChrysalisStage("🌐 Registering on Honey Network…");
      const reg = await registerWallet();
      const walletAddress = reg.wallet;

      // Step 4: Derive Chrysalis keys (ML-KEM-768 + ML-DSA-65 identity layer)
      setChrysalisStage("🔑 Deriving ML-KEM-768 identity keys…");
      await new Promise(r => setTimeout(r, 120));
      const bundle = await getChrysalisKeypairForIndex(0); // index 0 = primary wallet
      setChrysalisId(bundle.chrysalisId);

      // Step 5: Register Chrysalis on server
      setChrysalisStage("🛡️ Registering Chrysalis post-quantum protection…");
      const res = await fetch(`${getApiBase()}/chrysalis/register`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          wallet         : walletAddress,
          chrysalisId    : bundle.chrysalisId,
          kemPublicKeyHex: bundle.kemPublicKeyHex,
          dsaPublicKeyHex: bundle.dsaPublicKeyHex,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Chrysalis registration failed");

      // Done!
      setChrysalisStage(`✅ Wallet created — quantum-resistant from genesis\n${chrysalisFingerprint(bundle.chrysalisId)}`);
      setChrysalisDone(true);

    } catch (e: any) {
      setChrysalisStage(`❌ ${e?.message || "Setup failed"}`);
      setChrysalisDone(true);
    } finally {
      setLoading(false);
    }
  }, [confirmed, mnemonic]);

  // Navigate when user taps Continue on the ceremony modal
  function handleCeremonyClose() {
    if (navigated.current) return;
    navigated.current = true;
    setChrysalisOpen(false);
    router.replace("/");
  }

  if (!words.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={NEON} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Chrysalis ceremony modal — shown during wallet setup */}
      <ChrysalisModal
        visible={chrysalisOpen}
        stage={chrysalisStage}
        done={chrysalisDone}
        title="Wallet Creation"
        chrysalisId={chrysalisId}
        onClose={handleCeremonyClose}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Your Secret Phrase</Text>
          <Text style={styles.subtitle}>
            Write these 12 words down in order and store them somewhere safe.{"\n"}
            Anyone with this phrase can access your wallet.
          </Text>
        </View>

        {/* Warning banner */}
        <View style={styles.warnBanner}>
          <Text style={styles.warnIcon}>⚠️</Text>
          <Text style={styles.warnText}>
            Never share this phrase with anyone. HIVE will never ask for it.
          </Text>
        </View>

        {/* 3×4 word grid */}
        <View style={styles.grid}>
          {words.map((word, i) => (
            <View key={i} style={styles.wordCell}>
              <Text style={styles.wordNum}>{i + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>

        {/* Copy button */}
        <Pressable
          style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.7 }]}
          onPress={handleCopy}
        >
          <Text style={styles.copyBtnText}>{copied ? "✓ Copied!" : "Copy to Clipboard"}</Text>
        </Pressable>

        {/* Confirmation checkbox */}
        <Pressable
          style={styles.checkRow}
          onPress={() => setConfirmed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
            {confirmed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            I have written down my seed phrase and stored it safely.
          </Text>
        </Pressable>

        {/* Chrysalis notice */}
        <View style={styles.chrysalisBanner}>
          <Text style={styles.chrysalisText}>
            🔐 After confirmation, Chrysalis will automatically secure your wallet with ML-DSA-65 + ML-KEM-768 post-quantum cryptography.
          </Text>
        </View>

        {/* Finish button */}
        <Pressable
          style={({ pressed }) => [
            styles.btn,
            !confirmed && styles.btnDisabled,
            pressed && confirmed && { opacity: 0.8 },
          ]}
          onPress={handleFinish}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.btnText}>Finish Setup</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  scroll: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: NEON,
    fontSize: 26,
    fontWeight: "800",
  },
  subtitle: {
    color: SUB,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  warnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,191,47,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,191,47,0.3)",
    borderRadius: 12,
    padding: 12,
  },
  warnIcon: { fontSize: 18 },
  warnText: {
    color: WARN,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
  },
  wordCell: {
    width: "30%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(57,255,20,0.06)",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  wordNum: {
    color: "rgba(57,255,20,0.5)",
    fontSize: 11,
    fontWeight: "700",
    width: 16,
    textAlign: "right",
  },
  wordText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  copyBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: GLASS,
  },
  copyBtnText: {
    color: NEON,
    fontSize: 14,
    fontWeight: "600",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: NEON,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: NEON,
  },
  checkmark: {
    color: "#000",
    fontSize: 13,
    fontWeight: "900",
  },
  checkLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  chrysalisBanner: {
    backgroundColor: "rgba(100,180,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(100,180,255,0.25)",
    borderRadius: 12,
    padding: 12,
  },
  chrysalisText: {
    color: "rgba(100,180,255,0.8)",
    fontSize: 12,
    lineHeight: 18,
  },
  btn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: NEON,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnDisabled: {
    backgroundColor: "rgba(57,255,20,0.25)",
  },
  btnText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
  backBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  backBtnText: {
    color: SUB,
    fontSize: 14,
  },
});
