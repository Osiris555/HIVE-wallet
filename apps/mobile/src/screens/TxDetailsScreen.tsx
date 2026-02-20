// apps/mobile/src/screens/TxDetailsScreen.tsx
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { getTransactionById } from "../chain/transactions";

type Props = { txid: string };

function fmt8(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00000000";
  return v.toFixed(8);
}

function fmtNum(n: number, dec = 4): string {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

export default function TxDetailsScreen({ txid }: Props) {
  const insets = useSafeAreaInsets();
  const id = String(txid || "").trim();
  const [tx, setTx] = useState<any>(null);
  const [copied, setCopied] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  function Row({ label, value }: { label: string; value: any }) {
    const v = value == null ? "" : String(value);
    return (
      <Pressable
        hitSlop={8}
        onPress={async () => {
          if (!v) return;
          try {
            await Clipboard.setStringAsync(v);
            setCopied(`${label} copied ✅`);
            setTimeout(() => setCopied(""), 1800);
          } catch {}
        }}
        style={styles.row}
      >
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} selectable>
          {v || "—"}
        </Text>
      </Pressable>
    );
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setErr(null);
        const r: any = await getTransactionById(id);
        if (!dead) setTx(r?.tx ?? r);
      } catch (e: any) {
        if (!dead) setErr(String(e?.message || e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [id]);

  // Parse metaJson for token-specific details
  let meta: any = null;
  try {
    meta = tx?.metaJson ? JSON.parse(tx.metaJson) : null;
  } catch {}

  const txType = String(tx?.type || "").toLowerCase();
  const gasFee = Number(tx?.gasFee || 0);
  const svcFee = Number(tx?.serviceFee || 0);
  const totalFee = gasFee + svcFee;

  // Determine display info based on tx type
  let typeLabel = tx?.type || "—";
  if (txType === "swap" && meta) {
    typeLabel = "Swap";
  } else if (txType === "token_send" && meta) {
    typeLabel = `Token Send (${meta.tokenSymbol || "?"})`;
  } else if (txType === "stake") {
    typeLabel = "Stake HNY";
  } else if (txType === "unstake") {
    typeLabel = "Unstake HNY";
  } else if (txType === "claim") {
    typeLabel = "Claim Rewards";
  } else if (txType === "mint") {
    typeLabel = "Faucet Mint (HNY)";
  } else if (txType === "token_faucet" && meta) {
    typeLabel = `Faucet Mint (${meta.tokenSymbol || "?"})`;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000", paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Pressable hitSlop={10} onPress={() => router.back()}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Tx Details</Text>
        </View>

        {copied ? <Text style={styles.copied}>{copied}</Text> : null}

        {err ? <Text style={styles.error}>{err}</Text> : null}

        {!tx ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Row label="TxID" value={tx.id || tx.txid} />
            <Row label="Hash" value={tx.hash} />
            <Row label="Type" value={typeLabel} />
            <Row label="Status" value={tx.status} />

            {/* Swap-specific details */}
            {txType === "swap" && meta && (
              <>
                <Row label="Swap" value={`${fmtNum(Number(meta.amountIn || tx.amount || 0))} ${meta.tokenIn || "?"} → ${fmtNum(Number(meta.expectedAmountOut || meta.amountOut || 0))} ${meta.tokenOut || "?"}`} />
                {meta.poolId && (
                  <Row label="Route" value={String(meta.poolId).includes("|") ? `${meta.tokenIn} → HNY → ${meta.tokenOut}` : "Direct"} />
                )}
              </>
            )}

            {/* Token send details */}
            {txType === "token_send" && meta && (
              <Row label="Token amount" value={`${fmtNum(Number(meta.amount || tx.amount || 0))} ${meta.tokenSymbol || "?"}`} />
            )}

            {/* Token faucet mint */}
            {txType === "token_faucet" && meta && (
              <Row label="Minted" value={`+${fmtNum(Number(meta.amount || tx.amount || 0))} ${meta.tokenSymbol || "?"}`} />
            )}

            {/* Standard HNY send/stake/mint amount */}
            {txType !== "swap" && txType !== "token_send" && txType !== "token_faucet" && (
              <Row label="Amount" value={`${fmtNum(Number(tx.amount || 0))} HNY`} />
            )}

            <Row label="From" value={tx.fromWallet || tx.from} />
            <Row label="To" value={tx.toWallet || tx.to} />
            <Row label="Nonce" value={tx.nonce} />
            <Row label="Gas fee" value={`${fmt8(gasFee)} HNY`} />
            <Row label="Service fee" value={`${fmt8(svcFee)} HNY`} />
            <Row label="Total fees" value={`${fmt8(totalFee)} HNY`} />
            <Row label="Block height" value={tx.blockHeight} />
            <Row label="Block hash" value={tx.blockHash} />
            <Row
              label="Timestamp"
              value={(() => {
                const t = tx.timestampMs || tx.timestamp || tx.timeMs || tx.time;
                return t ? new Date(Number(t)).toLocaleString() : null;
              })()}
            />
            {tx.failReason ? <Row label="Fail reason" value={tx.failReason} /> : null}
          </View>
        )}

        <Text style={styles.hint}>Tap any row to copy its value.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: "#111", flexGrow: 1 },
  back: { color: "#60a5fa", fontWeight: "900", marginRight: 12 },
  title: { color: "#fff", fontSize: 20, fontWeight: "900" },
  copied: {
    marginBottom: 10,
    fontSize: 14,
    fontWeight: "800",
    color: "#39ff14",
  },
  loading: { color: "#aaa", fontWeight: "800", marginTop: 10 },
  error: { color: "#f87171", fontWeight: "900", marginBottom: 10 },
  row: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  label: { color: "#aaa", fontWeight: "900", marginBottom: 4 },
  value: { color: "#fff", fontWeight: "800" },
  hint: { color: "#aaa", marginTop: 16, fontWeight: "700" },
});
