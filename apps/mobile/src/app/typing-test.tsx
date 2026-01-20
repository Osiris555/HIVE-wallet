// apps/mobile/src/app/typing-test.tsx
import React, { useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";

export default function TypingTest() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const aRef = useRef<TextInput | null>(null);
  const bRef = useRef<TextInput | null>(null);

  return (
    <ScrollView
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "900" }}>
        Typing Test ✅ ({Platform.OS})
      </Text>

      <Text style={{ opacity: 0.8 }}>
        If typing breaks here (1 char then blur), the bug is NOT your home screen.
        It’s global (router/layout/web wrapper / focus stealing).
      </Text>

      <View style={{ gap: 10 }}>
        <Text style={{ fontWeight: "800" }}>Field A</Text>
        <TextInput
          ref={(r) => (aRef.current = r)}
          value={a}
          onChangeText={setA}
          placeholder="Type here..."
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
          }}
        />
      </View>

      <View style={{ gap: 10 }}>
        <Text style={{ fontWeight: "800" }}>Field B</Text>
        <TextInput
          ref={(r) => (bRef.current = r)}
          value={b}
          onChangeText={setB}
          placeholder="Type here..."
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
          }}
        />
      </View>

      <Text style={{ fontWeight: "800" }}>Live values:</Text>
      <Text>A: {JSON.stringify(a)}</Text>
      <Text>B: {JSON.stringify(b)}</Text>

      <Text style={{ opacity: 0.75, marginTop: 12 }}>
        Tip: on web you can open this route directly at /typing-test
      </Text>
    </ScrollView>
  );
}
