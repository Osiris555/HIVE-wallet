// apps/mobile/src/app/_layout.tsx

// ✅ MUST be first import to polyfill crypto RNG for native
import "react-native-get-random-values";

import { Stack } from "expo-router";

export default function RootLayout() {
  return 
    <Stack 
      screenOptions={{ 
        headerShown: false, 
      }} 
    />
  );
}
