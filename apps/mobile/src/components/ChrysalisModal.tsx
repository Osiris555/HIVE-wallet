// apps/mobile/src/components/ChrysalisModal.tsx
// Reusable Chrysalis operation modal — shown whenever Chrysalis does any work.
// Replaces the bespoke vault unlock modal and is used across all Chrysalis operations.

import React from "react";
import { Modal, Pressable, Text, View, StyleSheet } from "react-native";
import { chrysalisFingerprint } from "../chain/chrysalis";

type Props = {
  visible    : boolean;
  stage      : string;
  done       : boolean;
  title?     : string;          // e.g. "Vault Unlock", "Key Registration"
  chrysalisId?: string;         // shows CHRY-XXXX fingerprint when available
  onClose?   : () => void;      // only rendered when done or error
};

export function ChrysalisModal({
  visible,
  stage,
  done,
  title       = "Chrysalis",
  chrysalisId,
  onClose,
}: Props) {
  if (!visible) return null;

  const isError   = stage.startsWith("❌");
  const isWarning = stage.startsWith("⚠️");
  const stageColor = done
    ? "#39ff14"
    : isError
    ? "rgba(255,90,90,0.9)"
    : isWarning
    ? "rgba(255,200,60,0.9)"
    : "rgba(200,230,255,0.85)";

  const borderColor = done
    ? "rgba(57,255,20,0.5)"
    : isError
    ? "rgba(255,90,90,0.35)"
    : "rgba(100,180,255,0.35)";

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { borderColor }]}>

          {/* Icon + title */}
          <View style={styles.titleRow}>
            <Text style={styles.icon}>
              {done ? "🔓" : isError ? "🔐" : "🔐"}
            </Text>
            <View>
              <Text style={styles.subtitle}>CHRYSALIS SECURITY</Text>
              <Text style={[styles.title, done && { color: "#39ff14" }]}>
                {title}
              </Text>
            </View>
          </View>

          {/* Fingerprint */}
          {chrysalisId ? (
            <Text style={styles.fingerprint}>
              {chrysalisFingerprint(chrysalisId)}
            </Text>
          ) : null}

          {/* Stage text box */}
          <View style={[styles.stageBox, {
            borderColor: done
              ? "rgba(57,255,20,0.2)"
              : isError
              ? "rgba(255,90,90,0.2)"
              : "rgba(100,180,255,0.15)",
          }]}>
            <Text style={[styles.stageText, { color: stageColor }]}>
              {stage || "Initializing…"}
            </Text>
          </View>

          {/* Progress dots (while working, not done/error) */}
          {!done && !isError && (
            <View style={styles.dotsRow}>
              {[0, 1, 2].map(i => (
                <View key={i} style={styles.dot} />
              ))}
            </View>
          )}

          {/* Close button — only when done or error */}
          {(done || isError) && onClose && (
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>
                {done ? "Continue" : "Dismiss"}
              </Text>
            </Pressable>
          )}

          {/* PQ footer */}
          <Text style={styles.footer}>
            ML-KEM-768 · ML-DSA-65 · CAS-φ
          </Text>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex           : 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems     : "center",
    justifyContent : "center",
    padding        : 24,
  },
  card: {
    backgroundColor: "rgba(4,5,7,0.97)",
    borderWidth    : 1,
    borderRadius   : 20,
    padding        : 24,
    width          : "100%",
    maxWidth       : 360,
    alignItems     : "center",
    gap            : 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems   : "center",
    gap          : 14,
    alignSelf    : "flex-start",
  },
  icon: {
    fontSize: 36,
  },
  subtitle: {
    color      : "rgba(100,180,255,0.5)",
    fontSize   : 9,
    fontWeight : "900",
    letterSpacing: 2,
  },
  title: {
    color      : "rgba(100,180,255,0.9)",
    fontSize   : 16,
    fontWeight : "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  fingerprint: {
    color      : "rgba(57,255,20,0.45)",
    fontSize   : 11,
    fontFamily : "monospace",
    letterSpacing: 1.5,
    alignSelf  : "center",
  },
  stageBox: {
    backgroundColor: "rgba(100,180,255,0.04)",
    borderWidth    : 1,
    borderRadius   : 12,
    padding        : 16,
    minHeight      : 64,
    width          : "100%",
    alignItems     : "center",
    justifyContent : "center",
  },
  stageText: {
    fontSize  : 13,
    fontFamily: "monospace",
    textAlign : "center",
    lineHeight: 20,
  },
  dotsRow: {
    flexDirection: "row",
    gap          : 6,
  },
  dot: {
    width          : 6,
    height         : 6,
    borderRadius   : 3,
    backgroundColor: "rgba(100,180,255,0.4)",
  },
  closeBtn: {
    backgroundColor: "rgba(100,180,255,0.12)",
    borderWidth    : 1,
    borderColor    : "rgba(100,180,255,0.3)",
    borderRadius   : 10,
    paddingVertical: 10,
    paddingHorizontal: 32,
    alignSelf      : "center",
  },
  closeBtnText: {
    color    : "rgba(100,180,255,0.9)",
    fontSize : 14,
    fontWeight: "700",
  },
  footer: {
    color        : "rgba(100,180,255,0.4)",
    fontSize     : 9,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
