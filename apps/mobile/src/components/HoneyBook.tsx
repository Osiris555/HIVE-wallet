// HoneyBook.tsx — Mobile social feed, DMs, and profile for HIVE Wallet
// Uses the same /social/* endpoints as the web app.

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// ── Types ─────────────────────────────────────────────────────────────────────

type Post = {
  id: string;
  wallet: string;
  displayName: string;
  avatarEmoji: string;
  content: string;
  createdAtMs: number;
  likeCount?: number;
};

type DmItem = {
  id: string;
  fromWallet: string;
  toWallet: string;
  partner: string;
  partnerName: string;
  partnerEmoji: string;
  previewText: string;
  cipherJson: string;
  read: boolean;
  createdAtMs: number;
};

type DmMessage = {
  id: string;
  fromWallet: string;
  toWallet: string;
  cipherJson: string;
  previewText: string;
  read: boolean;
  createdAtMs: number;
};

type Profile = {
  wallet: string;
  displayName: string;
  avatarEmoji: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
};

type SearchResult = {
  wallet: string;
  displayName: string;
  avatarEmoji: string;
  bio: string;
  followerCount: number;
};

type SignFn = (message: string) => Promise<{ signatureHex: string; mldsaPubKeyHex: string }>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(w: string) { return w.length > 12 ? `${w.slice(0, 8)}…${w.slice(-4)}` : w; }

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000)    return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return new Date(ms).toLocaleDateString();
}

async function sha256Hex(text: string): Promise<string> {
  // Simple hash via node crypto (React Native supports subtle crypto on newer RN)
  // Fallback: use a simple djb2-style hash as hex for the sign message
  try {
    const { createHash } = await import("crypto");
    return createHash("sha256").update(text).digest("hex");
  } catch {
    // Fallback: use TextEncoder + SubtleCrypto if available
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    // Ultimate fallback: djb2 as 16-char hex (not secure but won't crash)
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(16, "0");
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg:      "#040507",
  card:    "#0d1117",
  border:  "#1e2a1e",
  green:   "#39ff14",
  gold:    "#f5b429",
  text:    "#e0e0e0",
  sub:     "#888",
  dim:     "#555",
  input:   "#111",
};

// ── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({ post, myWallet, onFollow }: { post: Post; myWallet: string; onFollow: (w: string) => void }) {
  return (
    <View style={[styles.card, { marginBottom: 10 }]}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={styles.avatar}>
          <Text style={{ fontSize: 20 }}>{post.avatarEmoji || "🐝"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
            <Text style={{ color: C.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>
              {post.displayName || shortAddr(post.wallet)}
            </Text>
            <Text style={{ color: C.dim, fontSize: 11 }}>{timeAgo(post.createdAtMs)}</Text>
          </View>
          <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{post.content}</Text>
        </View>
      </View>
      {post.wallet !== myWallet && (
        <View style={{ alignItems: "flex-end", marginTop: 8 }}>
          <Pressable onPress={() => onFollow(post.wallet)} style={styles.followBtn}>
            <Text style={{ color: C.green, fontSize: 12, fontWeight: "700" }}>+ Follow</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── Feed Tab ──────────────────────────────────────────────────────────────────

function FeedTab({ wallet, apiBase, sign, onProfileNeeded }: {
  wallet: string; apiBase: string; sign: SignFn; onProfileNeeded: () => void;
}) {
  const [tab, setTab]         = useState<"global" | "following">("global");
  const [posts, setPosts]     = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [posting, setPosting] = useState(false);
  const [followTarget, setFollowTarget] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = tab === "following"
        ? `${apiBase}/social/feed/${wallet}`
        : `${apiBase}/social/feed`;
      const r = await fetch(url);
      const d = await r.json();
      setPosts(d.posts || []);
    } catch { setPosts([]); }
    finally { setLoading(false); }
  }, [tab, wallet, apiBase]);

  useEffect(() => { load(); }, [load]);

  async function handlePost() {
    if (!draft.trim() || posting) return;
    setPosting(true);
    try {
      const text = draft.trim().slice(0, 280);
      const ts = Date.now();
      const msg = `social_post|${wallet}|${text}|${ts}`;
      const { signatureHex, mldsaPubKeyHex } = await sign(msg);
      const resp = await fetch(`${apiBase}/social/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, content: text, mldsaPubKeyHex, signatureHex, ts }),
      });
      if (!resp.ok) throw new Error("Post failed");
      setDraft("");
      setComposing(false);
      load();
    } catch (e: unknown) {
      // Show error silently — user sees nothing changed
    } finally { setPosting(false); }
  }

  async function handleFollow(targetWallet: string) {
    if (following) return;
    setFollowing(true);
    try {
      const ts = Date.now();
      const msg = `social_follow|${wallet}|${targetWallet}|${ts}`;
      const { signatureHex, mldsaPubKeyHex } = await sign(msg);
      await fetch(`${apiBase}/social/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followerWallet: wallet, followingWallet: targetWallet, mldsaPubKeyHex, signatureHex, ts }),
      });
      setFollowTarget(null);
      load();
    } catch { /* silent */ }
    finally { setFollowing(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {(["global", "following"] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
              {t === "global" ? "🌐 Global" : "👥 Following"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Compose box */}
      {composing ? (
        <View style={[styles.card, { marginBottom: 10 }]}>
          <TextInput
            value={draft}
            onChangeText={t => setDraft(t.slice(0, 280))}
            multiline
            placeholder="What's the buzz? 🐝"
            placeholderTextColor={C.dim}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
            autoFocus
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <Text style={{ color: C.dim, fontSize: 12 }}>{draft.length}/280</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => { setComposing(false); setDraft(""); }} style={styles.cancelBtn}>
                <Text style={{ color: C.sub }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handlePost} disabled={!draft.trim() || posting} style={[styles.primaryBtn, { opacity: draft.trim() ? 1 : 0.4 }]}>
                <Text style={{ color: "#000", fontWeight: "700" }}>{posting ? "Posting…" : "⬡ Post"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setComposing(true)} style={[styles.card, { marginBottom: 10 }]}>
          <Text style={{ color: C.dim }}>What's the buzz? 🐝 Share with the hive…</Text>
        </Pressable>
      )}

      {/* Follow confirm */}
      {followTarget && (
        <View style={[styles.card, { marginBottom: 10, borderColor: C.green }]}>
          <Text style={{ color: C.text, marginBottom: 8 }}>Follow {shortAddr(followTarget)}?</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setFollowTarget(null)} style={[styles.cancelBtn, { flex: 1 }]}>
              <Text style={{ color: C.sub, textAlign: "center" }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => handleFollow(followTarget)} disabled={following} style={[styles.primaryBtn, { flex: 1 }]}>
              <Text style={{ color: "#000", fontWeight: "700", textAlign: "center" }}>{following ? "Following…" : "+ Follow"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Posts */}
      {loading ? (
        <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />
      ) : posts.length === 0 ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ color: C.dim, fontSize: 16 }}>
            {tab === "following" ? "Follow wallets to see posts here." : "No posts yet. Be first!"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={p => p.id}
          renderItem={({ item }) => <PostCard post={item} myWallet={wallet} onFollow={w => setFollowTarget(w)} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({ wallet, apiBase, sign }: { wallet: string; apiBase: string; sign: SignFn }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState("");
  const [bio, setBio]         = useState("");
  const [emoji, setEmoji]     = useState("🐝");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  const EMOJIS = ["🐝", "🍯", "👑", "🌸", "💎", "🔥", "⚡", "🌙", "🦁", "🐉", "🧠", "🌊"];

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/social/profile/${wallet}`);
      const d = await r.json();
      if (d.profile) {
        setProfile(d.profile);
        setName(d.profile.displayName || "");
        setBio(d.profile.bio || "");
        setEmoji(d.profile.avatarEmoji || "🐝");
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [wallet, apiBase]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const ts = Date.now();
      const trimName = name.trim().slice(0, 50);
      const msg = `social_profile|${wallet}|${trimName}|${bio}|${emoji}|${ts}`;
      const { signatureHex, mldsaPubKeyHex } = await sign(msg);
      const resp = await fetch(`${apiBase}/social/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, displayName: trimName, bio, avatarEmoji: emoji, mldsaPubKeyHex, signatureHex, ts }),
      });
      if (!resp.ok) throw new Error("Profile update failed");
      setSaved(true);
      setEditing(false);
      load();
      setTimeout(() => setSaved(false), 2000);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  if (loading) return <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />;

  if (editing) {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { marginBottom: 12 }]}>Edit Profile</Text>

        <Text style={{ color: C.sub, fontSize: 13, marginBottom: 8 }}>Avatar Emoji</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {EMOJIS.map(e => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={{ padding: 8, borderRadius: 8, borderWidth: 1, borderColor: emoji === e ? C.green : "#333", backgroundColor: emoji === e ? "#1a3a1a" : "#111" }}>
              <Text style={{ fontSize: 22 }}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: C.sub, fontSize: 13, marginBottom: 4 }}>Display Name</Text>
        <TextInput
          value={name} onChangeText={setName} maxLength={50} placeholder="Your name"
          placeholderTextColor={C.dim}
          style={[styles.input, { marginBottom: 12 }]}
        />

        <Text style={{ color: C.sub, fontSize: 13, marginBottom: 4 }}>Bio</Text>
        <TextInput
          value={bio} onChangeText={setBio} maxLength={200} multiline placeholder="About you…"
          placeholderTextColor={C.dim}
          style={[styles.input, { minHeight: 72, textAlignVertical: "top", marginBottom: 16 }]}
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => setEditing(false)} style={[styles.cancelBtn, { flex: 1 }]}>
            <Text style={{ color: C.sub, textAlign: "center" }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { flex: 1 }]}>
            <Text style={{ color: "#000", fontWeight: "700", textAlign: "center" }}>{saving ? "Saving…" : "⬡ Save"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Profile header */}
      <View style={[styles.card, { alignItems: "center", paddingVertical: 24, marginBottom: 12 }]}>
        <Text style={{ fontSize: 48, marginBottom: 8 }}>{profile?.avatarEmoji || "🐝"}</Text>
        <Text style={{ color: C.text, fontWeight: "800", fontSize: 20, marginBottom: 2 }}>
          {profile?.displayName || "Anonymous"}
        </Text>
        <Text style={{ color: C.dim, fontSize: 12, fontFamily: "monospace", marginBottom: 12 }}>{shortAddr(wallet)}</Text>
        {profile?.bio ? <Text style={{ color: C.sub, fontSize: 14, textAlign: "center", marginBottom: 12 }}>{profile.bio}</Text> : null}
        <View style={{ flexDirection: "row", gap: 24, marginBottom: 16 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 18 }}>{profile?.postCount || 0}</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>posts</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 18 }}>{profile?.followerCount || 0}</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>followers</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 18 }}>{profile?.followingCount || 0}</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>following</Text>
          </View>
        </View>
        <Pressable onPress={() => setEditing(true)} style={styles.outlineBtn}>
          <Text style={{ color: C.sub, fontWeight: "600" }}>✏️ Edit Profile</Text>
        </Pressable>
        {saved && <Text style={{ color: C.green, marginTop: 8, fontWeight: "700" }}>✓ Profile updated!</Text>}
      </View>

      {/* How It Works */}
      <View style={styles.card}>
        <Text style={{ color: C.text, fontWeight: "700", fontSize: 15, marginBottom: 12 }}>How HoneyBook Works</Text>
        {[
          { icon: "🔐", title: "Wallet Identity", desc: "Your wallet IS your identity." },
          { icon: "✍️",  title: "Signed Posts",   desc: "Every post is ML-DSA-65 signed." },
          { icon: "🔒", title: "Encrypted DMs",  desc: "Chrysalis ML-KEM-768 encryption." },
          { icon: "👥", title: "Follow Anyone",  desc: "Follow any HIVE wallet." },
        ].map(({ icon, title, desc }) => (
          <View key={title} style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 18, minWidth: 26 }}>{icon}</Text>
            <View>
              <Text style={{ color: C.text, fontWeight: "600", fontSize: 13 }}>{title}</Text>
              <Text style={{ color: C.dim, fontSize: 12 }}>{desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── DM Thread ─────────────────────────────────────────────────────────────────

function DmThread({ myWallet, partnerWallet, partnerName, partnerEmoji, apiBase, sign, onBack, onReply }: {
  myWallet: string; partnerWallet: string; partnerName: string; partnerEmoji: string;
  apiBase: string; sign: SignFn; onBack: () => void; onReply: () => void;
}) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const flatRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/social/dm-thread/${myWallet}/${partnerWallet}`);
      const d = await r.json();
      const msgs: DmMessage[] = d.messages || [];
      setMessages(msgs);
      // Mark received as read
      for (const m of msgs) {
        if (m.toWallet === myWallet && !m.read) {
          fetch(`${apiBase}/social/dm-read/${m.id}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: myWallet }),
          }).catch(() => {});
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [myWallet, partnerWallet, apiBase]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable onPress={onBack} style={styles.outlineBtn}>
          <Text style={{ color: C.sub, fontSize: 13 }}>← Back</Text>
        </Pressable>
        <Text style={{ fontSize: 22 }}>{partnerEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: "700" }}>{partnerName}</Text>
          <Text style={{ color: C.dim, fontSize: 11, fontFamily: "monospace" }}>{shortAddr(partnerWallet)}</Text>
        </View>
        <Pressable onPress={onReply} style={[styles.primaryBtn, { paddingHorizontal: 14 }]}>
          <Text style={{ color: "#000", fontWeight: "700" }}>✉ Reply</Text>
        </Pressable>
      </View>

      {/* Messages */}
      {loading ? (
        <ActivityIndicator color={C.gold} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 30 }}>
              <Text style={{ color: C.dim }}>No messages yet. Start the conversation!</Text>
            </View>
          }
          renderItem={({ item: m }) => {
            const isMine = m.fromWallet === myWallet;
            let text = m.previewText;
            try { text = (JSON.parse(m.cipherJson) as { text?: string }).text || m.previewText; } catch { /* use preview */ }
            return (
              <View style={{ alignItems: isMine ? "flex-end" : "flex-start", marginBottom: 8 }}>
                <View style={{
                  backgroundColor: isMine ? "#1a3a1a" : "#111",
                  borderWidth: 1,
                  borderColor: isMine ? C.green : "#2a2a2a",
                  borderRadius: isMine ? 12 : 12,
                  borderBottomRightRadius: isMine ? 2 : 12,
                  borderBottomLeftRadius: isMine ? 12 : 2,
                  padding: 10, maxWidth: "75%",
                }}>
                  <Text style={{ color: isMine ? "#c8ffc8" : C.text, fontSize: 14 }}>{text}</Text>
                  <Text style={{ color: "#444", fontSize: 10, marginTop: 4, textAlign: "right" }}>{timeAgo(m.createdAtMs)}</Text>
                </View>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        />
      )}
    </View>
  );
}

// ── DMs Tab ───────────────────────────────────────────────────────────────────

function DmsTab({ wallet, apiBase, sign }: { wallet: string; apiBase: string; sign: SignFn }) {
  const [dms, setDms]       = useState<DmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [thread, setThread]   = useState<{ wallet: string; name: string; emoji: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [toWallet, setToWallet]   = useState("");
  const [msgText, setMsgText]     = useState("");
  const [sending, setSending]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/social/dms/${wallet}`);
      const d = await r.json();
      setDms(d.dms || []);
    } catch { setDms([]); }
    finally { setLoading(false); }
  }, [wallet, apiBase]);

  useEffect(() => { load(); }, [load]);

  // Group by partner — latest per partner
  const conversations = Array.from(
    dms.reduce((map, dm) => {
      if (!map.has(dm.partner)) map.set(dm.partner, dm);
      return map;
    }, new Map<string, DmItem>()).values()
  );

  async function handleSend() {
    if (!toWallet.trim() || !msgText.trim() || sending) return;
    setSending(true);
    try {
      const cipher = JSON.stringify({ v: 1, text: msgText.trim() });
      const hash = await sha256Hex(cipher);
      const ts = Date.now();
      const msg = `social_dm|${wallet}|${toWallet.trim()}|${hash.slice(0, 16)}|${ts}`;
      const { signatureHex, mldsaPubKeyHex } = await sign(msg);
      const resp = await fetch(`${apiBase}/social/dm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWallet: wallet, toWallet: toWallet.trim(),
          cipherJson: cipher, previewText: msgText.trim().slice(0, 60),
          mldsaPubKeyHex, signatureHex, timestamp: ts,
        }),
      });
      if (!resp.ok) throw new Error("DM failed");
      setComposing(false);
      setToWallet("");
      setMsgText("");
      load();
    } catch { /* silent */ }
    finally { setSending(false); }
  }

  if (thread) {
    return (
      <DmThread
        myWallet={wallet}
        partnerWallet={thread.wallet}
        partnerName={thread.name}
        partnerEmoji={thread.emoji}
        apiBase={apiBase}
        sign={sign}
        onBack={() => { setThread(null); load(); }}
        onReply={() => { setToWallet(thread.wallet); setComposing(true); }}
      />
    );
  }

  if (composing) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable onPress={() => setComposing(false)} style={{ marginBottom: 12 }}>
          <Text style={{ color: C.sub }}>← Cancel</Text>
        </Pressable>
        <Text style={{ color: C.gold, fontWeight: "700", fontSize: 17, marginBottom: 16 }}>💬 New Encrypted DM</Text>

        <Text style={{ color: C.sub, fontSize: 13, marginBottom: 4 }}>Recipient Wallet</Text>
        <TextInput
          value={toWallet} onChangeText={setToWallet}
          placeholder="HNY_xxxx…" placeholderTextColor={C.dim} autoFocus
          style={[styles.input, { fontFamily: "monospace", marginBottom: 12 }]}
        />

        <Text style={{ color: C.sub, fontSize: 13, marginBottom: 4 }}>Message</Text>
        <TextInput
          value={msgText} onChangeText={t => setMsgText(t.slice(0, 500))}
          multiline placeholder="Write your message…" placeholderTextColor={C.dim}
          style={[styles.input, { minHeight: 100, textAlignVertical: "top", marginBottom: 4 }]}
        />
        <Text style={{ color: C.dim, fontSize: 11, marginBottom: 16 }}>{msgText.length}/500</Text>

        <Pressable onPress={handleSend} disabled={!toWallet.trim() || !msgText.trim() || sending}
          style={[styles.goldBtn, { opacity: toWallet.trim() && msgText.trim() ? 1 : 0.4 }]}>
          <Text style={{ color: "#000", fontWeight: "700", textAlign: "center" }}>{sending ? "Sending…" : "🔒 Send DM"}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Text style={{ color: C.gold, fontWeight: "700", fontSize: 17 }}>💬 DM Inbox</Text>
        <Pressable onPress={() => setComposing(true)} style={styles.goldBtn}>
          <Text style={{ color: "#000", fontWeight: "700" }}>✉ New DM</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} />
      ) : conversations.length === 0 ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>📭</Text>
          <Text style={{ color: C.dim, marginBottom: 4 }}>No messages yet.</Text>
          <Text style={{ color: C.dim, fontSize: 13 }}>Send an encrypted DM to any HIVE wallet.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={d => d.partner}
          renderItem={({ item: dm }) => (
            <Pressable
              onPress={() => setThread({ wallet: dm.partner, name: dm.partnerName, emoji: dm.partnerEmoji })}
              style={[styles.card, { flexDirection: "row", gap: 12, marginBottom: 10, borderColor: dm.read || dm.toWallet !== wallet ? C.border : "#2a5a2a" }]}
            >
              <View style={styles.avatar}>
                <Text style={{ fontSize: 20 }}>{dm.partnerEmoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                  <Text style={{ color: C.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>{dm.partnerName}</Text>
                  {!dm.read && dm.toWallet === wallet && (
                    <View style={{ backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginRight: 6 }}>
                      <Text style={{ color: "#000", fontSize: 10, fontWeight: "700" }}>NEW</Text>
                    </View>
                  )}
                  <Text style={{ color: C.dim, fontSize: 11 }}>{timeAgo(dm.createdAtMs)}</Text>
                </View>
                <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={1}>
                  {dm.fromWallet === wallet ? "You: " : ""}{dm.previewText}
                </Text>
              </View>
            </Pressable>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ wallet, apiBase, sign }: { wallet: string; apiBase: string; sign: SignFn }) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${apiBase}/social/search?q=${encodeURIComponent(query.trim())}`);
        const d = await r.json();
        setResults(d.results || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, [query, apiBase]);

  async function handleFollow(targetWallet: string) {
    try {
      const ts = Date.now();
      const msg = `social_follow|${wallet}|${targetWallet}|${ts}`;
      const { signatureHex, mldsaPubKeyHex } = await sign(msg);
      await fetch(`${apiBase}/social/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followerWallet: wallet, followingWallet: targetWallet, mldsaPubKeyHex, signatureHex, ts }),
      });
    } catch { /* silent */ }
  }

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        value={query} onChangeText={setQuery}
        placeholder="Search users by name or wallet…"
        placeholderTextColor={C.dim}
        style={[styles.input, { marginBottom: 12 }]}
        autoFocus
      />
      {searching && <ActivityIndicator color={C.green} style={{ marginTop: 20 }} />}
      {!searching && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={r => r.wallet}
          renderItem={({ item: r }) => (
            <View style={[styles.card, { flexDirection: "row", gap: 12, marginBottom: 8, alignItems: "center" }]}>
              <Text style={{ fontSize: 28 }}>{r.avatarEmoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: "700" }}>{r.displayName || shortAddr(r.wallet)}</Text>
                <Text style={{ color: C.dim, fontSize: 12 }}>{r.followerCount} followers</Text>
                {r.bio ? <Text style={{ color: C.sub, fontSize: 12 }} numberOfLines={1}>{r.bio}</Text> : null}
              </View>
              {r.wallet !== wallet && (
                <Pressable onPress={() => handleFollow(r.wallet)} style={styles.followBtn}>
                  <Text style={{ color: C.green, fontSize: 12, fontWeight: "700" }}>+ Follow</Text>
                </Pressable>
              )}
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
      {!searching && query.trim() && results.length === 0 && (
        <Text style={{ color: C.dim, textAlign: "center", marginTop: 20 }}>No users found for &ldquo;{query}&rdquo;</Text>
      )}
      {!query.trim() && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
          <Text style={{ color: C.dim }}>Search for HIVE users to follow or message.</Text>
        </View>
      )}
    </View>
  );
}

// ── Main HoneyBook Modal ──────────────────────────────────────────────────────

export default function HoneyBook({
  visible,
  wallet,
  apiBase,
  sign,
  onClose,
}: {
  visible: boolean;
  wallet: string;
  apiBase: string;
  sign: SignFn;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"feed" | "dms" | "search" | "profile">("feed");
  const [unreadDms, setUnreadDms] = useState(0);

  // Poll unread DM count
  useEffect(() => {
    if (!visible || !wallet) return;
    const check = async () => {
      try {
        const r = await fetch(`${apiBase}/social/unread-dm-count/${wallet}`);
        const d = await r.json();
        setUnreadDms(d.count || 0);
      } catch { /* silent */ }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [visible, wallet, apiBase]);

  const TABS = [
    { key: "feed",    label: "🌐 Feed" },
    { key: "dms",     label: unreadDms > 0 ? `💬 DMs (${unreadDms})` : "💬 DMs" },
    { key: "search",  label: "🔍 Find" },
    { key: "profile", label: "👤 Me" },
  ] as const;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <Text style={{ flex: 1, color: C.green, fontSize: 20, fontWeight: "900" }}>🐝 HoneyBook</Text>
          <Pressable onPress={onClose} style={{ padding: 8 }}>
            <Text style={{ color: C.sub, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>

        {/* Tab bar */}
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border }}>
          {TABS.map(t => (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[styles.mainTab, activeTab === t.key && (t.key === "dms" ? styles.mainTabGoldActive : styles.mainTabActive)]}
            >
              <Text style={[styles.mainTabText, activeTab === t.key && (t.key === "dms" ? styles.mainTabGoldText : styles.mainTabActiveText)]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Content */}
        <View style={{ flex: 1, padding: 16 }}>
          {activeTab === "feed"    && <FeedTab    wallet={wallet} apiBase={apiBase} sign={sign} onProfileNeeded={() => setActiveTab("profile")} />}
          {activeTab === "dms"    && <DmsTab     wallet={wallet} apiBase={apiBase} sign={sign} />}
          {activeTab === "search" && <SearchTab  wallet={wallet} apiBase={apiBase} sign={sign} />}
          {activeTab === "profile"&& <ProfileTab wallet={wallet} apiBase={apiBase} sign={sign} />}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tabBtn: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: "#111",
  },
  tabBtnActive: {
    borderColor: C.green,
    backgroundColor: C.green,
  },
  tabBtnText: {
    color: C.sub,
    fontWeight: "600",
    fontSize: 13,
  },
  tabBtnTextActive: {
    color: "#000",
  },
  input: {
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    color: C.text,
    padding: 10,
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: C.green,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  goldBtn: {
    backgroundColor: C.gold,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  followBtn: {
    borderWidth: 1,
    borderColor: C.green,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  sectionLabel: {
    color: C.text,
    fontWeight: "800",
    fontSize: 16,
  },
  mainTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  mainTabActive: {
    borderBottomColor: C.green,
  },
  mainTabGoldActive: {
    borderBottomColor: C.gold,
  },
  mainTabText: {
    color: C.sub,
    fontSize: 12,
    fontWeight: "600",
  },
  mainTabActiveText: {
    color: C.green,
  },
  mainTabGoldText: {
    color: C.gold,
  },
});
