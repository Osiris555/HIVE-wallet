// apps/mobile/src/app/_layout.tsx

// ✅ MUST be first import to polyfill crypto RNG for native
import React from "react";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack 
      screenOptions={{ 
        headerShown: false, 
      }} 
    />
  );
}
