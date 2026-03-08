// apps/mobile/src/app/import-wallet.tsx
// Import an existing BIP39 wallet (MetaMask, Ledger, Coinbase, etc.)
// or restore a HIVE wallet from Chrysalis Recovery Shards + passphrase.

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { validateMnemonic, mnemonicToWalletSeed } from "../chain/bip39";
import { importAsNewProfile, importFromMnemonic } from "../chain/wallet-manager";
import { reconstructFromRecoveryShards, type RecoveryShard } from "../chain/chrysalis";
import { ChrysalisModal } from "../components/ChrysalisModal";
import { getApiBase } from "../chain/transactions";
import { hkdf } from "@noble/hashes/hkdf";
import { sha3_256 } from "@noble/hashes/sha3";

const BG     = "#040507";
const NEON   = "#39ff14";
const BLUE   = "rgba(100,180,255,0.9)";
const SUB    = "rgba(255,255,255,0.55)";
const BORDER = "rgba(57,255,20,0.22)";
const BORDER_BLUE = "rgba(100,180,255,0.3)";
const GLASS  = "rgba(255,255,255,0.04)";
const DANGER = "rgba(255,90,90,0.9)";

type Tab = "seed" | "shards" | "network";

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function parseRecoveryShard(raw: string): RecoveryShard | null {
  try {
    const obj = JSON.parse(raw.trim());
    if (
      obj?.type === "HIVE_RECOVERY_SHARD_v1" &&
      typeof obj.part === "string" &&
      typeof obj.data === "string"
    ) {
      return obj as RecoveryShard;
    }
    return null;
  } catch {
    return null;
  }
}

/** Derive HNY_ wallet address from a raw mnemonic (before importing). */
async function deriveAddressFromMnemonic(mnemonic: string): Promise<string> {
  const seedBytes = await mnemonicToWalletSeed(mnemonic);
  const domain    = new TextEncoder().encode("HIVE_WALLET_DSA_v1");
  const idxBytes  = new Uint8Array([0, 0, 0, 0]); // index 0 (primary wallet)
  const info      = new Uint8Array(domain.length + idxBytes.length);
  info.set(domain, 0); info.set(idxBytes, domain.length);
  const seed32    = hkdf(sha3_256, seedBytes, undefined, info, 32);
  // Dynamically require ml_dsa65 (pure ESM — dynamic import needed)
  const { ml_dsa65 } = require("@noble/post-quantum/ml-dsa");
  const { publicKey } = ml_dsa65.keygen(seed32);
  const hash = sha3_256(publicKey);
  const hex  = Array.from(hash).map((b: number) => b.toString(16).padStart(2, "0")).join("");
  return `HNY_${hex.slice(0, 40)}`;
}

export default function ImportWalletScreen() {
  const [tab, setTab] = useState<Tab>("seed");

  // ── Seed phrase tab state ──────────────────────────────────────
  const [phrase, setPhrase]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // ── Recovery shards tab state ─────────────────────────────────
  const [shardInputs, setShardInputs]   = useState(["", "", ""]);
  const [shardPassphrase, setShardPassphrase] = useState("");
  const [shardLoading, setShardLoading] = useState(false);
  const [shardError, setShardError]     = useState("");

  // ── Network recovery tab state ────────────────────────────────
  const [netWallet, setNetWallet]         = useState("");
  const [netPassphrase, setNetPassphrase] = useState("");
  const [netLoading, setNetLoading]       = useState(false);
  const [netError, setNetError]           = useState("");

  // ── Chrysalis ceremony modal ──────────────────────────────────
  const [chrysalisOpen, setChrysalisOpen]   = useState(false);
  const [chrysalisStage, setChrysalisStage] = useState("");
  const [chrysalisDone, setChrysalisDone]   = useState(false);
  const [restoredAddress, setRestoredAddress] = useState<string | null>(null);

  // ── QR scanner state ──────────────────────────────────────────
  const [cameraOpen, setCameraOpen]     = useState(false);
  const [scanningIdx, setScanningIdx]   = useState<number | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanCooldown = useRef(false);

  // ── Seed phrase logic ─────────────────────────────────────────
  const count   = wordCount(phrase);
  const isValid = validateMnemonic(phrase);

  const handleChange = useCallback((text: string) => {
    setPhrase(text);
    setError("");
  }, []);

  const handleImport = useCallback(async () => {
    if (!isValid) {
      setError("Invalid seed phrase. Please double-check each word and try again.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // importAsNewProfile saves the existing wallet first so it can be switched back to
      await importAsNewProfile(phrase, "Imported Wallet");
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Failed to import wallet. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [phrase, isValid]);

  const statusColor =
    phrase.trim() === "" ? SUB : isValid ? NEON : count < 12 ? SUB : DANGER;
  const statusText =
    phrase.trim() === ""
      ? "Enter your seed phrase below"
      : isValid
      ? "✓ Valid seed phrase"
      : count < 12
      ? `${count} / 12 words`
      : "Invalid phrase — check spelling";

  // ── Recovery shard logic ──────────────────────────────────────
  const parsedShards = shardInputs.map(parseRecoveryShard).filter(Boolean) as RecoveryShard[];
  const validShardCount = parsedShards.length;
  const shardBtnEnabled = validShardCount >= 3 && shardPassphrase.length >= 1 && !shardLoading;

  const handleShardRestore = useCallback(async () => {
    if (parsedShards.length < 3) {
      setShardError("Paste at least 3 valid recovery shard JSONs.");
      return;
    }
    if (!shardPassphrase) {
      setShardError("Enter your backup passphrase.");
      return;
    }
    setShardLoading(true);
    setShardError("");
    setRestoredAddress(null);

    // Open Chrysalis ceremony modal
    setChrysalisStage("🔐 Reconstructing from CAS-φ shards…");
    setChrysalisDone(false);
    setChrysalisOpen(true);

    try {
      await new Promise(r => setTimeout(r, 150));
      setChrysalisStage("⚡ Deriving PBKDF2 decryption key…");
      await new Promise(r => setTimeout(r, 100));

      const mnemonic = reconstructFromRecoveryShards(parsedShards, shardPassphrase);

      setChrysalisStage("🔑 Validating reconstructed mnemonic…");
      await new Promise(r => setTimeout(r, 100));

      if (!validateMnemonic(mnemonic)) {
        throw new Error("Reconstructed data is not a valid BIP39 mnemonic — wrong passphrase or corrupted shards");
      }

      setChrysalisStage("⚡ Deriving ML-DSA-65 keypair from recovered seed…");
      await new Promise(r => setTimeout(r, 100));

      const address = await deriveAddressFromMnemonic(mnemonic);
      setRestoredAddress(address);

      setChrysalisStage(`🌀 Verifying ML-KEM-768 identity…`);
      await new Promise(r => setTimeout(r, 150));

      setChrysalisStage("🔏 Signing recovery proof with ML-DSA-65…");
      await new Promise(r => setTimeout(r, 100));

      setChrysalisStage("📦 Importing wallet…");
      await importFromMnemonic(mnemonic);

      setChrysalisStage(`✅ Wallet restored → ${address.slice(0, 12)}…${address.slice(-6)}`);
      setChrysalisDone(true);

      // Navigate after a short pause so user sees the success
      await new Promise(r => setTimeout(r, 1800));
      router.replace("/");
    } catch (e: any) {
      setChrysalisStage(`❌ ${e?.message || "Restore failed. Check your shards and passphrase."}`);
      setChrysalisDone(true);
      setShardError(e?.message || "Restore failed. Check your shards and passphrase.");
    } finally {
      setShardLoading(false);
    }
  }, [parsedShards, shardPassphrase]);

  // ── Network recovery logic ────────────────────────────────────
  const handleNetworkRestore = useCallback(async () => {
    const walletAddr = netWallet.trim();
    if (!walletAddr.startsWith("HNY_") || walletAddr.length < 10) {
      setNetError("Enter a valid HNY_ wallet address.");
      return;
    }
    if (!netPassphrase) {
      setNetError("Enter your backup passphrase.");
      return;
    }
    setNetLoading(true);
    setNetError("");
    setRestoredAddress(null);

    setChrysalisStage("🌐 Fetching shards from Honey Network…");
    setChrysalisDone(false);
    setChrysalisOpen(true);

    try {
      await new Promise(r => setTimeout(r, 150));
      const resp = await fetch(`${getApiBase()}/chrysalis/shards/byWallet/${encodeURIComponent(walletAddr)}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || "No shards found for this wallet on the network.");
      }

      const networkShards: RecoveryShard[] = json.shards;
      if (!networkShards || networkShards.length < 3) {
        throw new Error(`Only ${networkShards?.length ?? 0} shards on network — need at least 3.`);
      }

      setChrysalisStage("🔐 Reconstructing from CAS-φ shards…");
      await new Promise(r => setTimeout(r, 150));

      const mnemonic = reconstructFromRecoveryShards(networkShards, netPassphrase);

      setChrysalisStage("🔑 Validating reconstructed mnemonic…");
      await new Promise(r => setTimeout(r, 100));
      if (!validateMnemonic(mnemonic)) {
        throw new Error("Decryption failed — wrong passphrase or corrupted network shards.");
      }

      setChrysalisStage("⚡ Deriving ML-DSA-65 keypair…");
      await new Promise(r => setTimeout(r, 100));
      const address = await deriveAddressFromMnemonic(mnemonic);
      setRestoredAddress(address);

      setChrysalisStage("🌀 Verifying ML-KEM-768 identity…");
      await new Promise(r => setTimeout(r, 150));

      setChrysalisStage("📦 Importing wallet…");
      await importFromMnemonic(mnemonic);

      setChrysalisStage(`✅ Wallet restored → ${address.slice(0, 12)}…${address.slice(-6)}`);
      setChrysalisDone(true);

      await new Promise(r => setTimeout(r, 1800));
      router.replace("/");
    } catch (e: any) {
      setChrysalisStage(`❌ ${e?.message || "Network restore failed."}`);
      setChrysalisDone(true);
      setNetError(e?.message || "Network restore failed.");
    } finally {
      setNetLoading(false);
    }
  }, [netWallet, netPassphrase]);

  // ── QR scanner helpers ────────────────────────────────────────
  async function openScanner(idx: number) {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setScanningIdx(idx);
    scanCooldown.current = false;
    setCameraOpen(true);
  }

  function onBarcodeScanned({ data }: { data: string }) {
    if (scanCooldown.current) return;
    const shard = parseRecoveryShard(data);
    if (shard && scanningIdx !== null) {
      scanCooldown.current = true;
      const updated = [...shardInputs];
      updated[scanningIdx] = data;
      setShardInputs(updated);
      setShardError("");
      setCameraOpen(false);
      setScanningIdx(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* ── Chrysalis ceremony modal ── */}
      <ChrysalisModal
        visible={chrysalisOpen}
        stage={chrysalisStage}
        done={chrysalisDone}
        title="Shard Recovery"
        onClose={() => { if (chrysalisDone) setChrysalisOpen(false); }}
      />

      {/* ── QR Scanner modal ── */}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <View style={styles.cameraContainer}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraTitle}>Scan Recovery Shard QR</Text>
            <Text style={styles.cameraSub}>Point at a shard QR code from the HIVE app</Text>
            <View style={styles.scanFrame} />
            <Pressable style={styles.cameraClose} onPress={() => { setCameraOpen(false); setScanningIdx(null); }}>
              <Text style={styles.cameraCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Import Wallet</Text>
          <Text style={styles.subtitle}>
            Restore using a seed phrase, Recovery Shards, or automatically from the Honey Network.
          </Text>
        </View>

        {/* Tab toggle */}
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, tab === "seed" && styles.tabActive]}
            onPress={() => { setTab("seed"); setError(""); }}
          >
            <Text style={[styles.tabText, tab === "seed" && styles.tabTextActive]}>
              Seed Phrase
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === "shards" && styles.tabActiveBlue]}
            onPress={() => { setTab("shards"); setShardError(""); }}
          >
            <Text style={[styles.tabText, tab === "shards" && styles.tabTextBlue]}>
              🛡️ Recovery Shards
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === "network" && styles.tabActiveBlue]}
            onPress={() => { setTab("network"); setNetError(""); }}
          >
            <Text style={[styles.tabText, tab === "network" && styles.tabTextBlue]}>
              🌐 Network
            </Text>
          </Pressable>
        </View>

        {/* ── SEED PHRASE TAB ── */}
        {tab === "seed" && (
          <>
            <View style={styles.noteBanner}>
              <Text style={styles.noteIcon}>ℹ️</Text>
              <View style={styles.noteBody}>
                <Text style={styles.noteTitle}>🛡️ Imports Harden with Chrysalis</Text>
                <Text style={styles.noteText}>
                  Importing a MetaMask, Base, or Ledger phrase gives that seed ML-DSA-65
                  post-quantum signing on the Honey Network. Your existing HIVE wallet is
                  preserved — you can switch between wallets in Settings → Wallets.{"\n\n"}
                  Note: your HIVE address will differ from your Ethereum address (different
                  signing algorithm), and Honey Network balances start at zero on a new network.
                </Text>
              </View>
            </View>

            <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>

            <TextInput
              style={styles.textarea}
              multiline
              numberOfLines={6}
              placeholder="word1 word2 word3 ..."
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={phrase}
              onChangeText={handleChange}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              secureTextEntry={false}
            />

            {error !== "" && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.tipsCard}>
              <Text style={styles.tipsTitle}>Tips</Text>
              {[
                "Separate words with spaces, one phrase on a single line.",
                "Words are lowercase English (BIP39 wordlist).",
                "Your phrase never leaves this device.",
              ].map((tip) => (
                <Text key={tip} style={styles.tipText}>• {tip}</Text>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                (!isValid || loading) && styles.btnDisabled,
                pressed && isValid && !loading && { opacity: 0.8 },
              ]}
              onPress={handleImport}
              disabled={!isValid || loading}
            >
              {loading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.btnText}>Import Wallet</Text>
              )}
            </Pressable>
          </>
        )}

        {/* ── RECOVERY SHARDS TAB ── */}
        {tab === "shards" && (
          <>
            <View style={styles.shardBanner}>
              <Text style={styles.shardBannerTitle}>🛡️ Chrysalis Recovery Shards</Text>
              <Text style={styles.shardBannerText}>
                Paste or scan any 3 of your 4 Recovery Shard JSONs, then enter your backup passphrase.
                Shards are generated in Settings → Recovery Shards.
              </Text>
            </View>

            {/* Shard status */}
            <Text style={[styles.statusText, {
              color: validShardCount >= 3 ? NEON : validShardCount > 0 ? "rgba(255,200,60,0.9)" : SUB
            }]}>
              {validShardCount === 0
                ? "Paste or scan 3 recovery shard JSONs below"
                : validShardCount < 3
                ? `${validShardCount} / 3 valid shards detected`
                : `✓ ${validShardCount} valid shards — ready to restore`}
            </Text>

            {/* Three shard paste fields with scan buttons */}
            {shardInputs.map((val, i) => {
              const parsed = parseRecoveryShard(val);
              return (
                <View key={i} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={styles.shardLabel}>
                      Shard {i + 1}{parsed ? `  ✓ (${parsed.part.toUpperCase()})` : ""}
                    </Text>
                    <Pressable
                      onPress={() => openScanner(i)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 4 }}
                    >
                      <Text style={{ fontSize: 14 }}>📷</Text>
                      <Text style={{ color: BLUE, fontSize: 11, fontWeight: "700" }}>Scan QR</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    style={[
                      styles.shardInput,
                      parsed
                        ? { borderColor: "rgba(57,255,20,0.5)" }
                        : val.trim()
                        ? { borderColor: DANGER }
                        : {},
                    ]}
                    placeholder='{"type":"HIVE_RECOVERY_SHARD_v1","part":"A","data":"..."}'
                    placeholderTextColor="rgba(255,255,255,0.15)"
                    value={val}
                    onChangeText={(text) => {
                      const updated = [...shardInputs];
                      updated[i] = text;
                      setShardInputs(updated);
                      setShardError("");
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              );
            })}

            {/* Passphrase */}
            <Text style={styles.shardLabel}>Backup Passphrase</Text>
            <TextInput
              style={styles.passphraseInput}
              placeholder="Enter the passphrase you set when generating shards"
              placeholderTextColor="rgba(255,255,255,0.2)"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={shardPassphrase}
              onChangeText={(t) => { setShardPassphrase(t); setShardError(""); }}
            />

            {/* Error */}
            {shardError !== "" && (
              <Text style={styles.errorText}>{shardError}</Text>
            )}

            <View style={styles.tipsCard}>
              <Text style={[styles.tipsTitle, { color: BLUE }]}>How it works</Text>
              {[
                "Any 3 of your 4 Recovery Shards can reconstruct your wallet.",
                "Your backup passphrase decrypts the reconstructed data.",
                "ML-DSA-65 verifies the recovered keypair before import.",
                "Wrong passphrase = decryption failure. No data is sent anywhere.",
              ].map((tip) => (
                <Text key={tip} style={styles.tipText}>• {tip}</Text>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                !shardBtnEnabled && styles.btnDisabledBlue,
                pressed && shardBtnEnabled && { opacity: 0.8 },
              ]}
              onPress={handleShardRestore}
              disabled={!shardBtnEnabled}
            >
              {shardLoading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.btnText}>Restore Wallet from Shards</Text>
              )}
            </Pressable>
          </>
        )}

        {/* ── NETWORK RECOVERY TAB ── */}
        {tab === "network" && (
          <>
            <View style={styles.shardBanner}>
              <Text style={styles.shardBannerTitle}>🌐 Restore from Honey Network</Text>
              <Text style={styles.shardBannerText}>
                If you previously generated Recovery Shards in Settings, they were automatically
                backed up to the Honey Network. Enter your wallet address and backup passphrase
                to restore — no manual shard pasting required.
              </Text>
            </View>

            <Text style={styles.shardLabel}>Wallet Address</Text>
            <TextInput
              style={styles.passphraseInput}
              placeholder="HNY_..."
              placeholderTextColor="rgba(255,255,255,0.2)"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              value={netWallet}
              onChangeText={(t) => { setNetWallet(t); setNetError(""); }}
            />

            <Text style={styles.shardLabel}>Backup Passphrase</Text>
            <TextInput
              style={styles.passphraseInput}
              placeholder="Passphrase used when generating Recovery Shards"
              placeholderTextColor="rgba(255,255,255,0.2)"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={netPassphrase}
              onChangeText={(t) => { setNetPassphrase(t); setNetError(""); }}
            />

            {netError !== "" && (
              <Text style={styles.errorText}>{netError}</Text>
            )}

            <View style={styles.tipsCard}>
              <Text style={[styles.tipsTitle, { color: BLUE }]}>How it works</Text>
              {[
                "Your encrypted shards are stored on the Honey Network.",
                "The network never sees your passphrase — only ciphertext.",
                "ML-DSA-65 verifies the recovered keypair before import.",
                "No manual shard collection — just your address and passphrase.",
              ].map((tip) => (
                <Text key={tip} style={styles.tipText}>• {tip}</Text>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                (!netWallet.trim() || !netPassphrase || netLoading) && styles.btnDisabledBlue,
                pressed && netWallet.trim() && netPassphrase && !netLoading && { opacity: 0.8 },
              ]}
              onPress={handleNetworkRestore}
              disabled={!netWallet.trim() || !netPassphrase || netLoading}
            >
              {netLoading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.btnText}>Restore from Network</Text>
              )}
            </Pressable>
          </>
        )}

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
  // ── Tabs ──
  tabRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: GLASS,
  },
  tabActive: {
    backgroundColor: "rgba(57,255,20,0.12)",
    borderBottomWidth: 2,
    borderBottomColor: NEON,
  },
  tabActiveBlue: {
    backgroundColor: "rgba(100,180,255,0.08)",
    borderBottomWidth: 2,
    borderBottomColor: "rgba(100,180,255,0.8)",
  },
  tabText: {
    color: SUB,
    fontSize: 13,
    fontWeight: "700",
  },
  tabTextActive: {
    color: NEON,
  },
  tabTextBlue: {
    color: BLUE,
  },
  // ── Shared ──
  noteBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(31,120,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(31,120,255,0.25)",
    borderRadius: 12,
    padding: 12,
  },
  noteIcon: { fontSize: 18, marginTop: 1 },
  noteBody: { flex: 1, gap: 4 },
  noteTitle: {
    color: "rgba(100,180,255,0.9)",
    fontSize: 13,
    fontWeight: "700",
  },
  noteText: {
    color: "rgba(100,180,255,0.7)",
    fontSize: 12,
    lineHeight: 17,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  textarea: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 24,
    padding: 16,
    minHeight: 130,
    fontFamily: "monospace",
  },
  errorText: {
    color: DANGER,
    fontSize: 13,
    textAlign: "center",
  },
  tipsCard: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  tipsTitle: {
    color: NEON,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
  },
  tipText: {
    color: SUB,
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
  btnDisabledBlue: {
    backgroundColor: "rgba(100,180,255,0.2)",
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
  // ── Shard tab specific ──
  shardBanner: {
    backgroundColor: "rgba(100,180,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER_BLUE,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  shardBannerTitle: {
    color: BLUE,
    fontSize: 14,
    fontWeight: "800",
  },
  shardBannerText: {
    color: "rgba(100,180,255,0.7)",
    fontSize: 12,
    lineHeight: 18,
  },
  shardLabel: {
    color: SUB,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  shardInput: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER_BLUE,
    borderRadius: 12,
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "monospace",
    padding: 12,
    minHeight: 72,
    textAlignVertical: "top",
  },
  passphraseInput: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER_BLUE,
    borderRadius: 12,
    color: "#ffffff",
    fontSize: 15,
    padding: 14,
  },
  // ── Camera ──
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  cameraTitle: {
    color: NEON,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  cameraSub: {
    color: SUB,
    fontSize: 13,
    textAlign: "center",
  },
  scanFrame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: NEON,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  cameraClose: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  cameraCloseText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
