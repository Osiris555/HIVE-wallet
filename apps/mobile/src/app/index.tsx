// apps/mobile/src/app/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  Platform,
  ImageBackground,
  Animated,
  Easing,
  Switch,
} from "react-native";
import * as SecureStore from "expo-secure-store";

import {
  ensureWalletId,
  getBalance,
  getTransactions,
  getChainStatus,
  quoteSend,
  mint,
  send,
  computeServiceFee,
  rbfReplacePending,
  cancelPending,
  ONE_SAT,
  fmt8,
  type Transaction as TxLike,
} from "../chain/transactions";

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
async function kvGet(key: string): Promise<string | null> {
  try {
    if (isWeb()) return window.localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function kvSet(key: string, value: string): Promise<void> {
  try {
    if (isWeb()) window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {}
}

type ThemeKey = "cosmic" | "noir" | "honey";
function themeFor(t: ThemeKey) {
  const neon = "#39ff14";
  if (t === "noir") {
    return {
      text: "#f6f6f6",
      sub: "rgba(255,255,255,0.70)",
      border: "rgba(57,255,20,0.22)",
      glass: "rgba(0,0,0,0.55)",
      glass2: "rgba(0,0,0,0.35)",
      purple: "#6a2cff",
      gold: "#caa83c",
      green: neon,
      danger: "rgba(255,90,90,0.96)",
      blue: "#1f78ff",
    };
  }
  if (t === "honey") {
    return {
      text: "#fff5db",
      sub: "rgba(255,245,219,0.72)",
      border: "rgba(255,191,47,0.20)",
      glass: "rgba(12,6,18,0.58)",
      glass2: "rgba(12,6,18,0.38)",
      purple: "#6a2cff",
      gold: "#ffbf2f",
      green: neon,
      danger: "rgba(255,90,90,0.96)",
      blue: "#2b7cff",
    };
  }
  return {
    text: "#ffffff",
    sub: "rgba(255,255,255,0.70)",
    border: "rgba(57,255,20,0.18)",
    glass: "rgba(0,0,0,0.45)",
    glass2: "rgba(0,0,0,0.30)",
    purple: "#7b2cff",
    gold: "#caa83c",
    green: neon,
    danger: "rgba(255,90,90,0.96)",
    blue: "#2b7cff",
  };
}

type SkinKey = "matrix-honeycomb" | "solid-noir";
function skinKeyForChain(chainId: string) {
  return `hive:skin:${chainId || "default"}`;
}
function themeKeyForChain(chainId: string) {
  return `hive:theme:${chainId || "default"}`;
}

function GlassCard(props: { children: React.ReactNode; style?: any }) {
  const webBlur =
    Platform.OS === "web"
      ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any)
      : null;

  return (
    <View style={[{ borderRadius: 18, overflow: "hidden" }, webBlur, props.style]}>
      {props.children}
    </View>
  );
}

function shortAddr(a: string) {
  if (!a) return "";
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}
function formatTime(ms: number) {
  if (!ms || ms <= 0) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${s}s`;
}

export default function Index() {
  const [chainId, setChainId] = useState<string>("");
  const [theme, setTheme] = useState<ThemeKey>("cosmic");
  const T = useMemo(() => themeFor(theme), [theme]);
  const [skin, setSkin] = useState<SkinKey>("matrix-honeycomb");
  const [prefsLoadedForChain, setPrefsLoadedForChain] = useState<string>("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [cooldownText, setCooldownText] = useState<string>("");

  // ✅ this prevents focus loss from background polling
  const [liveRefresh, setLiveRefresh] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const [wallet, setWallet] = useState<string>("");
  const [chainHeight, setChainHeight] = useState<number>(0);
  const [msUntilNextBlock, setMsUntilNextBlock] = useState<number>(0);
  const [serviceFeeRate, setServiceFeeRate] = useState<number>(0);
  const [minGasFee, setMinGasFee] = useState<number>(ONE_SAT);

  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [spendableBalance, setSpendableBalance] = useState<number>(0);
  const [feeVaultBalance, setFeeVaultBalance] = useState<number>(0);

  const [to, setTo] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const amount = useMemo(() => Number(amountStr || 0), [amountStr]);

  const [mintBusy, setMintBusy] = useState<boolean>(false);
  const [mintCooldown, setMintCooldown] = useState<number>(0);

  const [txs, setTxs] = useState<TxLike[]>([]);

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [quote, setQuote] = useState<any>(null);
  const [sendBusy, setSendBusy] = useState<boolean>(false);

  const [rbfOpen, setRbfOpen] = useState(false);
  const [rbfTx, setRbfTx] = useState<any>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTx, setCancelTx] = useState<any>(null);

  // ✅ Send glow pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sendGlowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.45] });
  const sendGlowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  async function loadWallet() {
    const w = await ensureWalletId();
    setWallet(w);
  }

  async function refreshStatus() {
    const st: any = await getChainStatus();
    setChainId(String(st?.chainId || ""));
    setChainHeight(Number(st?.chainHeight || st?.height || 0));
    setMsUntilNextBlock(Number(st?.msUntilNextBlock || 0));
    setServiceFeeRate(Number(st?.serviceFeeRate || 0));
    setMinGasFee(Number(st?.minGasFee || ONE_SAT));
  }

  async function loadBalance() {
    if (!wallet) return;
    const b: any = await getBalance(wallet);
    setConfirmedBalance(Number(b?.confirmed || 0));
    setSpendableBalance(Number(b?.spendable || 0));
    setFeeVaultBalance(Number(b?.feeVault || 0));
  }

  async function loadTxs() {
    if (!wallet) return;
    const list = await getTransactions(wallet);
    setTxs(list || []);
  }

  async function hardRefreshAll() {
    setMessage("");
    try {
      await refreshStatus();
      await loadBalance();
      await loadTxs();
    } catch (e: any) {
      setMessage(e?.message || "Refresh failed");
    }
  }

  useEffect(() => {
    (async () => {
      await loadWallet();
      await refreshStatus();
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet) return;
    hardRefreshAll();
  }, [wallet]);

  useEffect(() => {
    (async () => {
      if (!chainId) return;
      if (prefsLoadedForChain === chainId) return;

      const savedTheme = await kvGet(themeKeyForChain(chainId));
      if (savedTheme === "cosmic" || savedTheme === "noir" || savedTheme === "honey") setTheme(savedTheme);

      const savedSkin = await kvGet(skinKeyForChain(chainId));
      if (savedSkin === "matrix-honeycomb" || savedSkin === "solid-noir") setSkin(savedSkin);

      setPrefsLoadedForChain(chainId);
    })().catch(() => {});
  }, [chainId, prefsLoadedForChain]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(themeKeyForChain(chainId), theme).catch(() => {});
  }, [theme, chainId]);

  useEffect(() => {
    if (!chainId) return;
    kvSet(skinKeyForChain(chainId), skin).catch(() => {});
  }, [skin, chainId]);

  // ✅ Poll only when liveRefresh is ON and user is NOT editing
  useEffect(() => {
    if (!wallet) return;
    if (!liveRefresh) return;

    const i = setInterval(async () => {
      if (isEditing) return;
      try {
        await refreshStatus();
        await loadBalance();
        await loadTxs();
      } catch {}
    }, 2500);

    return () => clearInterval(i);
  }, [wallet, liveRefresh, isEditing]);

  useEffect(() => {
    if (mintCooldown <= 0) return;
    const t = setInterval(() => setMintCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [mintCooldown]);

  useEffect(() => {
    if (mintCooldown > 0) setCooldownText(`Cooldown active (${mintCooldown}s)`);
    else setCooldownText("");
  }, [mintCooldown]);

  async function handleMint() {
    if (mintBusy || mintCooldown > 0) return;
    setMessage("");
    setMintBusy(true);
    try {
      const res = await mint();
      setMessage("Mint submitted ✅");
      await hardRefreshAll();
      const cd = Number(res?.cooldownSeconds || 60);
      setMintCooldown(cd);
    } catch (e: any) {
      if (e?.status === 429) {
        const cd = Number(e.cooldownSeconds || 60);
        setMintCooldown(cd);
        setMessage(`Mint cooldown active (${cd}s)`);
      } else {
        setMessage(`Mint failed: ${e?.message || "Unknown error"}`);
      }
    } finally {
      setMintBusy(false);
    }
  }

  async function openSendConfirm() {
    setMessage("");
    if (!to || to.length < 8) return setMessage("Enter a recipient address.");
    if (!Number.isFinite(amount) || amount <= 0) return setMessage("Enter a valid amount.");

    try {
      const q = await quoteSend(to, amount);
      setQuote(q);
      setConfirmOpen(true);
    } catch (e: any) {
      setMessage(`Quote failed: ${e?.message || "Unknown error"}`);
    }
  }

  async function handleSendSubmit() {
    if (!quote) return;
    if (sendBusy) return;

    setSendBusy(true);
    setMessage("");
    try {
      const gasFee = Number(quote.gasFee || minGasFee || ONE_SAT);
      const serviceFee = Number(quote.serviceFee || computeServiceFee(amount, serviceFeeRate));

      await send({ to, amount, gasFee, serviceFee });
      setConfirmOpen(false);
      setMessage("Send submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Send failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  function isMyPendingSend(t: any) {
    return t && t.type === "send" && t.status === "pending" && wallet && t.from === wallet && t.nonce != null;
  }

  async function doRbf(multiplier: number) {
    if (!rbfTx) return;
    setSendBusy(true);
    setMessage("");
    try {
      const baseGas = Number(rbfTx.gasFee || minGasFee || ONE_SAT);
      const gasFee = Math.max(minGasFee || ONE_SAT, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(Number(rbfTx.amount || 0), serviceFeeRate);

      await rbfReplacePending({
        to: String(rbfTx.to),
        amount: Number(rbfTx.amount),
        gasFee,
        serviceFee: svc,
      });

      setRbfOpen(false);
      setMessage("Boost submitted (RBF) ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`RBF failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  async function doCancel(multiplier: number) {
    if (!cancelTx) return;
    setSendBusy(true);
    setMessage("");
    try {
      const baseGas = Number(cancelTx.gasFee || minGasFee || ONE_SAT);
      const gasFee = Math.max(minGasFee || ONE_SAT, Number((baseGas * multiplier).toFixed(8)));
      const svc = computeServiceFee(ONE_SAT, serviceFeeRate);

      await cancelPending({ gasFee, serviceFee: svc });

      setCancelOpen(false);
      setMessage("Cancel submitted ✅");
      await hardRefreshAll();
    } catch (e: any) {
      setMessage(`Cancel failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSendBusy(false);
    }
  }

  const mintLabel = useMemo(() => {
    if (mintBusy) return "Minting…";
    if (mintCooldown > 0) return `Mint (${mintCooldown}s)`;
    return "Mint";
  }, [mintCooldown, mintBusy]);

  const matrixBg = useMemo(() => require("./assets/skins/matrix-honeycomb.png"), []);
  const bgSource = skin === "matrix-honeycomb" ? matrixBg : null;
  const bgOverlayOpacity = Platform.OS === "web" ? 0.55 : 0.32;

  function Card(props: { children: React.ReactNode }) {
    return (
      <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
        <View style={{ padding: 14 }}>{props.children}</View>
      </GlassCard>
    );
  }

  function Button(props: { label: string; onPress: () => void; disabled?: boolean; variant?: "green" | "purple" | "outline" | "danger" | "blue" }) {
    const v = props.variant || "green";
    const bg =
      v === "green" ? T.green :
      v === "purple" ? T.purple :
      v === "danger" ? T.danger :
      v === "blue" ? T.blue :
      "transparent";

    const fg =
      v === "green" ? "#041006" :
      v === "outline" ? T.text :
      "#fff";

    const border = v === "outline" ? T.border : "transparent";

    return (
      <Pressable
        onPress={props.onPress}
        disabled={props.disabled}
        style={{
          paddingVertical: 12,
          borderRadius: 12,
          alignItems: "center",
          backgroundColor: bg,
          borderWidth: v === "outline" ? 1 : 0,
          borderColor: border,
          opacity: props.disabled ? 0.55 : 1,
        }}
      >
        <Text style={{ color: fg, fontWeight: "900", fontSize: 16 }}>{props.label}</Text>
      </Pressable>
    );
  }

  const Body = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontSize: 28, fontWeight: "900" }}>HIVE Wallet</Text>
          <Text style={{ color: T.sub, marginTop: 2 }}>
            Height: {chainHeight} • Next block: {formatTime(msUntilNextBlock)}
          </Text>
        </View>

        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: T.border,
            backgroundColor: T.glass2,
          }}
        >
          <Text style={{ color: T.text, fontWeight: "900" }}>⚙️</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <Card>
          <Text style={{ color: T.sub, marginBottom: 6 }}>Wallet</Text>
          <Text style={{ color: T.text, fontWeight: "900" }}>{shortAddr(wallet)}</Text>

          {message ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: "#ffd56a" }}>{message}</Text>
            </View>
          ) : null}

          {cooldownText ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: T.sub }}>{cooldownText}</Text>
            </View>
          ) : null}

          <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: T.sub, fontWeight: "900" }}>Live Refresh</Text>
            <Switch value={liveRefresh} onValueChange={setLiveRefresh} />
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
  {[1.25, 1.5, 2.0].map((m) => (
    <Pressable
      key={String(m)}
      onPress={() => setRbfMultiplier(m)}
      style={{
        flex: 1,
        padding: 12,
        borderRadius: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: rbfMultiplier === m ? T.gold : "rgba(255,255,255,0.14)",
        backgroundColor: rbfMultiplier === m ? "rgba(202,168,60,0.12)" : "transparent",
      }}
    >
      <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
    </Pressable>
  ))}
</View>
        </Card>

        <View style={{ height: 14 }} />

        <Card>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Balances</Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: T.text, fontWeight: "900" }}>Confirmed</Text>
            <Text style={{ color: T.text, fontWeight: "900" }}>{fmt8(confirmedBalance)}</Text>
          </View>

          <View style={{ height: 6 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: T.text, fontWeight: "900" }}>Spendable</Text>
            <Text style={{ color: T.text, fontWeight: "900" }}>{fmt8(spendableBalance)}</Text>
          </View>

          <View style={{ height: 6 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: T.sub }}>Fee Vault</Text>
            <Text style={{ color: T.sub }}>{fmt8(feeVaultBalance)}</Text>
          </View>

          <View style={{ height: 12 }} />
          <Button label={mintLabel} onPress={handleMint} disabled={mintBusy || mintCooldown > 0} variant="purple" />
        </Card>

        <View style={{ height: 14 }} />

        <Card>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Send</Text>

          <Text style={{ color: T.sub, marginBottom: 6 }}>To</Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
            <TextInput
              value={to}
              onChangeText={setTo}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
              placeholder="Recipient address"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={{ color: T.text, paddingVertical: 10, paddingHorizontal: 12 }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={{ height: 10 }} />

          <Text style={{ color: T.sub, marginBottom: 6 }}>Amount</Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.glass2 }}>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
              placeholder="0.0"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="decimal-pad"
              style={{ color: T.text, paddingVertical: 10, paddingHorizontal: 12 }}
            />
          </View>

          <View style={{ height: 12 }} />

          {/* ✅ Pulsing neon glow behind Send */}
          <View style={{ position: "relative" }}>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: -8,
                right: -8,
                top: -8,
                bottom: -8,
                borderRadius: 16,
                borderWidth: 2,
                borderColor: T.green,
                opacity: sendGlowOpacity,
                transform: [{ scale: sendGlowScale }],
              }}
            />
            <Button label="Send" onPress={openSendConfirm} disabled={sendBusy} variant="green" />
          </View>

          <Text style={{ color: T.sub, marginTop: 10 }}>
            Service fee (est): {fmt8(computeServiceFee(amount, serviceFeeRate))}
          </Text>
        </Card>

        <View style={{ height: 14 }} />

        <Card>
          <Text style={{ color: T.sub, marginBottom: 8 }}>Recent Transactions</Text>
          {txs.length === 0 ? (
            <Text style={{ color: T.sub }}>No transactions yet.</Text>
          ) : (
            txs.slice(0, 6).map((t: any, idx: number) => {
              const pending = t?.status === "pending";
              const minePending = isMyPendingSend(t);
              return (
                <View
                  key={`${t?.id || idx}`}
                  style={{
                    paddingVertical: 10,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: T.text, fontWeight: "900" }}>
                      {t?.type === "mint" ? "Mint" : "Send"}{" "}
                      <Text style={{ color: pending ? "#ffd56a" : T.sub }}>
                        {pending ? "(pending)" : "(confirmed)"}
                      </Text>
                    </Text>
                    <Text style={{ color: T.sub }}>{fmt8(Number(t?.amount || 0))}</Text>
                  </View>

                  {t?.type === "send" ? (
                    <Text style={{ color: T.sub, marginTop: 4 }}>
                      To: {shortAddr(String(t?.to || ""))} • Nonce: {String(t?.nonce ?? "—")}
                    </Text>
                  ) : (
                    <Text style={{ color: T.sub, marginTop: 4 }}>Nonce: {String(t?.nonce ?? "—")}</Text>
                  )}

                  {minePending ? (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button label="⚡ Boost" onPress={() => { setRbfTx(t); setRbfOpen(true); }} disabled={sendBusy} variant="blue" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button label="✖ Cancel" onPress={() => { setCancelTx(t); setCancelOpen(true); }} disabled={sendBusy} variant="danger" />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
          <View style={{ marginTop: 10 }}>
            <Button label="Open Full History" onPress={() => setHistoryOpen(true)} variant="outline" />
          </View>
        </Card>
      </ScrollView>

      {/* Confirm Send */}
      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", flex: 1 }}>Confirm Transaction</Text>
                <Pressable onPress={() => setConfirmOpen(false)}>
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <View style={{ height: 10 }} />
              <Text style={{ color: T.sub }}>To: {to}</Text>
              <Text style={{ color: T.sub }}>Amount: {fmt8(amount)}</Text>

              <View style={{ height: 12 }} />
              {quote ? (
                <>
                  <Text style={{ color: T.sub }}>Gas: {fmt8(Number(quote.gasFee || minGasFee))}</Text>
                  <Text style={{ color: T.sub }}>Service: {fmt8(Number(quote.serviceFee || computeServiceFee(amount, serviceFeeRate)))}</Text>
                </>
              ) : (
                <Text style={{ color: T.sub }}>Loading quote…</Text>
              )}

              <View style={{ height: 14 }} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Back" onPress={() => setConfirmOpen(false)} disabled={sendBusy} variant="outline" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label={sendBusy ? "Sending…" : "Confirm"} onPress={handleSendSubmit} disabled={sendBusy || !quote} variant="green" />
                </View>
              </View>
            </View>
          </GlassCard>
        </View>
      </Modal>

      {/* RBF Modal */}
      <Modal transparent visible={rbfOpen} animationType="fade" onRequestClose={() => setRbfOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <GlassCard style={{ borderWidth: 1, borderColor: T.border, backgroundColor: T.glass }}>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: T.text, fontSize: 20, fontWeight: "900", flex: 1 }}>Boost Pending Tx</Text>
                <Pressable onPress={() => setRbfOpen(false)}>
                  <Text style={{ color: T.sub, fontWeight: "900", fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>

              <View style={{ height: 12 }} />
              <Text style={{ color: T.sub }}>
                If you see “nonce mismatch”, the tx is already confirmed or no longer replaceable.
              </Text>

              <View style={{ height: 12 }} />
<Text style={{ color: T.text, fontWeight: "900" }}>Bump</Text>

<View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
  {[1.25, 1.5, 2.0].map((m) => (
    <Pressable
      key={`rbf-m-${m}`}
      onPress={() => setRbfMultiplier(m)}
      style={{
        flex: 1,
        padding: 12,
        borderRadius: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: rbfMultiplier === m ? T.gold : "rgba(255,255,255,0.14)",
        backgroundColor: rbfMultiplier === m ? "rgba(202,168,60,0.12)" : "transparent",
      }}
    >
      <Text style={{ color: T.text, fontWeight: "900" }}>{m}×</Text>
    </Pressable>
  ))}
</View>