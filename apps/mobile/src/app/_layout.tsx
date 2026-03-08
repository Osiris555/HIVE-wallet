// apps/mobile/src/app/_layout.tsx

// ✅ Polyfill crypto.getRandomValues for @scure/bip39 and noble crypto libs on iOS/Android
import "react-native-get-random-values";
// ✅ MUST come after polyfill (gesture-handler requires it)
import "react-native-gesture-handler";

import React, { useEffect, useState } from "react";
import { Stack, useSegments, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

// Keep the splash screen visible while we check for existing wallets
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── MetaMask / browser-extension isolation ────────────────────────────────
// MetaMask's inpage.js runs at document_start (before any page JS) and
// installs its own window.ethereum.  When its background service worker is
// not active it polls every ~10 s and throws "Failed to connect to MetaMask"
// — which Expo's dev overlay surfaces as a full-screen error.
//
// Multi-layer suppression strategy:
//   1. If MetaMask hasn't claimed window.ethereum yet → install a silent stub.
//   2. If MetaMask beat us to it → wrap its request() to swallow connect errors.
//   3. Capture-phase "error" listener fires before Expo's overlay handler.
//   4. Patch console.error — Expo dev overlay hooks into it.
//   5. window.onerror + unhandledrejection belt-and-suspenders.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const _isMMError = (s: string) =>
    s.includes("MetaMask") || s.includes("chrome-extension://") || s.includes("Failed to connect");

  if (!(window as any).ethereum) {
    // MetaMask hasn't arrived yet — pre-install a stub so inpage.js skips injection.
    (window as any).ethereum = {
      isMetaMask: false,
      isHIVEWallet: true,
      request: (_args: unknown) => Promise.reject(new Error("Not an Ethereum DApp")),
      on: (_event: string, _handler: unknown) => {},
      removeListener: (_event: string, _handler: unknown) => {},
      send: (_method: string, _params?: unknown[]) =>
        Promise.reject(new Error("Not an Ethereum DApp")),
    };
  } else {
    // MetaMask beat us — wrap its request() to silently swallow connect errors.
    const _origReq = (window as any).ethereum.request?.bind((window as any).ethereum);
    (window as any).ethereum.request = async (args: any) => {
      try { return _origReq ? await _origReq(args) : undefined; }
      catch (e: any) {
        if (_isMMError(String(e?.message ?? ""))) return undefined;
        throw e;
      }
    };
  }

  // 3. Capture-phase error event — runs before Expo's overlay handler.
  window.addEventListener("error", (event) => {
    if (_isMMError(event.filename ?? "") || _isMMError(event.message ?? "")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // 4. Patch console.error (Expo dev overlay hooks into it).
  const _origCE = console.error;
  console.error = function (...args: any[]) {
    if (_isMMError(String(args[0] ?? ""))) return;
    return _origCE.apply(console, args);
  };

  // 5. Belt-and-suspenders: unhandledrejection + window.onerror.
  window.addEventListener("unhandledrejection", (e) => {
    const src = String(e.reason?.stack ?? e.reason?.message ?? "");
    if (_isMMError(src)) e.preventDefault();
  });
  const _origOnError = window.onerror;
  window.onerror = function (msg, src, line, col, err) {
    if (_isMMError(String(src ?? "")) || _isMMError(String(msg ?? ""))) return true;
    return _origOnError ? _origOnError(msg, src, line, col, err) : false;
  };
}

const ONBOARDING_SEGMENTS = ["onboarding", "create-wallet", "import-wallet"];

// Web-safe KV helper
async function kvGetAsync(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try {
    const SS = require("expo-secure-store");
    return await SS.getItemAsync(key);
  } catch {
    return null;
  }
}

// ── Synchronous web check ──────────────────────────────────────────────────
// On web, localStorage is synchronous. We check it here at module scope —
// before React renders ANYTHING — so the initial state is correct on the
// very first render. This prevents index.tsx from ever mounting when there
// is no wallet set up.
//
// On native this returns null (unknown), triggering the async check below.
function syncWebCheck(): boolean | null {
  if (Platform.OS !== "web") return null;
  try {
    return !!localStorage.getItem("HIVE_MASTER_SEED_B64");
  } catch {
    return false;
  }
}

const WEB_INITIAL = syncWebCheck(); // null on native, bool on web

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();

  // Web: starts with the synchronous result (never null).
  // Native: starts null until the async check completes.
  const [hasWallet, setHasWallet] = useState<boolean | null>(WEB_INITIAL);

  // Native: async check (web already has a result from the sync check above)
  useEffect(() => {
    if (Platform.OS === "web") {
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    (async () => {
      try {
        const seed = await kvGetAsync("HIVE_MASTER_SEED_B64");
        setHasWallet(!!seed);
      } catch {
        setHasWallet(false);
      } finally {
        SplashScreen.hideAsync().catch(() => {});
      }
    })();
  }, []);

  // Guard: redirect to onboarding when no wallet is found.
  // Re-verifies storage before redirecting to handle the case where the
  // user just finished the create/import flow (hasWallet is stale = false).
  useEffect(() => {
    if (hasWallet === null) return; // native still loading

    const inOnboarding = ONBOARDING_SEGMENTS.includes(segments[0] as string);
    if (inOnboarding) return; // let onboarding screens handle forward nav
    if (hasWallet) return;   // all good

    // hasWallet is false — re-read storage before redirecting
    // (covers the post-onboarding navigation case where state is stale)
    (async () => {
      const seed = await kvGetAsync("HIVE_MASTER_SEED_B64");
      if (seed) {
        setHasWallet(true);  // wallet was just created, stay put
      } else {
        router.replace("/onboarding");
      }
    })();
  }, [hasWallet, segments]);

  // On native, show a blank dark screen while the async check runs.
  // This is important: it prevents index.tsx from mounting (and calling
  // getWallets()) before we know whether to redirect.
  if (hasWallet === null) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "#040507" }} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </View>
    </GestureHandlerRootView>
  );
}
