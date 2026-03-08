// apps/mobile/src/app/onboarding.tsx
// Welcome / onboarding screen — shown on first launch before any wallet exists

import React from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

const BG     = "#040507";
const NEON   = "#39ff14";
const BLUE   = "rgba(100,180,255,0.9)";
const SUB    = "rgba(255,255,255,0.55)";
const BORDER = "rgba(57,255,20,0.22)";
const BORDER_BLUE = "rgba(100,180,255,0.25)";
const GLASS  = "rgba(255,255,255,0.04)";

export default function OnboardingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo / branding */}
        <View style={styles.logoArea}>
          <Text style={styles.logoEmoji}>🍯</Text>
          <Text style={styles.appName}>HIVE Wallet</Text>
          <Text style={styles.tagline}>Your gateway to the Honey Network</Text>
        </View>

        {/* Chrysalis post-quantum banner */}
        <View style={styles.chrysalisBanner}>
          <View style={styles.chrysalisHeader}>
            <Text style={styles.chrysalisIcon}>🛡️</Text>
            <View>
              <Text style={styles.chrysalisLabel}>CHRYSALIS SECURITY</Text>
              <Text style={styles.chrysalisTitle}>Post-Quantum Protected</Text>
            </View>
          </View>
          <Text style={styles.chrysalisBody}>
            Every HIVE wallet is automatically hardened with{" "}
            <Text style={styles.chrysalisHighlight}>ML-DSA-65</Text> (NIST FIPS 204) signing and{" "}
            <Text style={styles.chrysalisHighlight}>ML-KEM-768</Text> (NIST FIPS 203) key encapsulation
            — the same post-quantum standards recommended by NIST to resist attacks from quantum computers.
          </Text>
          <View style={styles.pqPillRow}>
            {["ML-DSA-65", "ML-KEM-768", "CAS-φ Sharding"].map((label) => (
              <View key={label} style={styles.pqPill}>
                <Text style={styles.pqPillText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Feature highlights */}
        <View style={styles.features}>
          {[
            { icon: "🔑", text: "12-word seed phrase — quantum-resistant from genesis" },
            { icon: "🔒", text: "Non-custodial — only you hold your keys" },
            { icon: "⚡", text: "Fast, low-fee Honey Network transactions" },
            { icon: "🌐", text: "Import any BIP39 wallet and harden it with Chrysalis" },
            { icon: "☁️", text: "Automatic encrypted shard backup on the Honey Network" },
          ].map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Action buttons */}
        <View style={styles.buttons}>
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/create-wallet")}
          >
            <Text style={styles.btnPrimaryText}>Create New Wallet</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/import-wallet")}
          >
            <Text style={styles.btnOutlineText}>Import Existing Wallet</Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          By continuing you agree that HIVE Wallet is unaudited testnet software.
          Never store large amounts of real-world value.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
  },
  chrysalisBanner: {
    width: "100%",
    backgroundColor: "rgba(100,180,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER_BLUE,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  chrysalisHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  chrysalisIcon: {
    fontSize: 28,
  },
  chrysalisLabel: {
    color: "rgba(100,180,255,0.5)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
  },
  chrysalisTitle: {
    color: BLUE,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  chrysalisBody: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 20,
  },
  chrysalisHighlight: {
    color: BLUE,
    fontWeight: "700",
  },
  pqPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pqPill: {
    backgroundColor: "rgba(100,180,255,0.1)",
    borderWidth: 1,
    borderColor: BORDER_BLUE,
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  pqPillText: {
    color: BLUE,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  logoArea: {
    alignItems: "center",
    marginTop: 20,
  },
  logoEmoji: {
    fontSize: 72,
    marginBottom: 12,
  },
  appName: {
    color: NEON,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  tagline: {
    color: SUB,
    fontSize: 15,
    textAlign: "center",
  },
  features: {
    width: "100%",
    backgroundColor: GLASS,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 14,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureIcon: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  featureText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    flex: 1,
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
  btn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: NEON,
  },
  btnPrimaryText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: NEON,
    backgroundColor: "transparent",
  },
  btnOutlineText: {
    color: NEON,
    fontSize: 16,
    fontWeight: "600",
  },
  disclaimer: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
