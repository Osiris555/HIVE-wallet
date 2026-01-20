// apps/mobile/src/app/_layout.tsx

// ✅ MUST be the first import (gesture-handler requires it)
import "react-native-gesture-handler";

import React from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform, View } from "react-native";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* On web, GestureHandlerRootView works fine, but we also ensure a flex wrapper */}
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
