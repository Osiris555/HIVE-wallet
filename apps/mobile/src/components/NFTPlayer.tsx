// apps/mobile/src/components/NFTPlayer.tsx
// Multi-format NFT media player: audio (CD-like), video (chapters), document/photo (paged)

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// WebView loaded lazily — react-native-webview is optional (used only for PDF/document NFTs)
let WebView: any = null;
try { WebView = require("react-native-webview").WebView; } catch (_) {}

// expo-av is loaded lazily so the import doesn't break if not installed yet
let AVModule: any = null;
try { AVModule = require("expo-av"); } catch (_) {}

const { width: WIN_W, height: WIN_H } = Dimensions.get("window");

// ── Types ─────────────────────────────────────────────────────────────────────
export type NFTPlayerProps = {
  nftId: string;
  mediaType: "audio" | "video" | "document" | "photo";
  fileCount: number;
  name: string;
  serverUrl: string;   // e.g. http://192.168.0.23:3000
  visible: boolean;
  onClose: () => void;
};

type TrackStatus = {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function mediaUrl(serverUrl: string, nftId: string, index: number) {
  return `${serverUrl}/nft/media/${nftId}/${index}`;
}

function fmtTime(ms: number) {
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

// ── Audio Player ──────────────────────────────────────────────────────────────
function AudioPlayer({ nftId, fileCount, name, serverUrl }: Pick<NFTPlayerProps, "nftId" | "fileCount" | "name" | "serverUrl">) {
  const soundRef = useRef<any>(null);
  const [track,   setTrack]   = useState(0);
  const [status,  setStatus]  = useState<TrackStatus>({ isPlaying: false, positionMs: 0, durationMs: 0 });
  const [shuffle, setShuffle] = useState(false);
  const [repeat,  setRepeat]  = useState(false);
  const [loading, setLoading] = useState(false);

  const trackNames = Array.from({ length: fileCount }, (_, i) => `Track ${i + 1}`);

  const loadTrack = useCallback(async (idx: number) => {
    if (!AVModule) return;
    setLoading(true);
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await AVModule.Audio.Sound.createAsync(
        { uri: mediaUrl(serverUrl, nftId, idx) },
        { shouldPlay: true },
        (st: any) => {
          if (st.isLoaded) {
            setStatus({ isPlaying: st.isPlaying, positionMs: st.positionMillis || 0, durationMs: st.durationMillis || 0 });
            if (st.didJustFinish) handleNext(idx);
          }
        }
      );
      soundRef.current = sound;
      setTrack(idx);
    } catch (e) {
      console.error("Audio load error:", e);
    } finally {
      setLoading(false);
    }
  }, [nftId, serverUrl, fileCount]);

  const handleNext = useCallback((current: number) => {
    if (repeat) { soundRef.current?.replayAsync(); return; }
    if (shuffle) {
      const next = Math.floor(Math.random() * fileCount);
      loadTrack(next); return;
    }
    if (current < fileCount - 1) loadTrack(current + 1);
  }, [fileCount, repeat, shuffle, loadTrack]);

  const togglePlay = async () => {
    if (!soundRef.current) { loadTrack(0); return; }
    if (status.isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  };

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const progress = status.durationMs > 0 ? status.positionMs / status.durationMs : 0;

  return (
    <View style={s.audioWrap}>
      {/* Album art placeholder */}
      <View style={s.albumArt}>
        <Text style={s.albumIcon}>🎵</Text>
        <Text style={s.albumName} numberOfLines={2}>{name}</Text>
      </View>

      {/* Track info + progress */}
      <Text style={s.trackName}>{trackNames[track]}</Text>
      <View style={s.progressBar}>
        <View style={[s.progressFill, { width: `${(progress * 100).toFixed(1)}%` as any }]} />
      </View>
      <View style={s.timeRow}>
        <Text style={s.timeText}>{fmtTime(status.positionMs)}</Text>
        <Text style={s.timeText}>{fmtTime(status.durationMs)}</Text>
      </View>

      {/* Controls */}
      <View style={s.controls}>
        <Pressable onPress={() => setShuffle(v => !v)} style={[s.ctrlBtn, shuffle && s.ctrlActive]}>
          <Text style={s.ctrlIcon}>🔀</Text>
        </Pressable>
        <Pressable onPress={() => loadTrack(Math.max(0, track - 1))} style={s.ctrlBtn}>
          <Text style={s.ctrlIcon}>⏮</Text>
        </Pressable>
        <Pressable onPress={togglePlay} style={[s.ctrlBtn, s.playBtn]}>
          {loading ? <ActivityIndicator color="#FFD700" /> : <Text style={[s.ctrlIcon, { fontSize: 28 }]}>{status.isPlaying ? "⏸" : "▶️"}</Text>}
        </Pressable>
        <Pressable onPress={() => handleNext(track)} style={s.ctrlBtn}>
          <Text style={s.ctrlIcon}>⏭</Text>
        </Pressable>
        <Pressable onPress={() => setRepeat(v => !v)} style={[s.ctrlBtn, repeat && s.ctrlActive]}>
          <Text style={s.ctrlIcon}>🔁</Text>
        </Pressable>
      </View>

      {/* Track list */}
      <ScrollView style={s.trackList} showsVerticalScrollIndicator={false}>
        {trackNames.map((t, i) => (
          <Pressable key={i} onPress={() => loadTrack(i)} style={[s.trackRow, i === track && s.trackRowActive]}>
            <Text style={[s.trackRowNum, i === track && s.trackRowTextActive]}>{i + 1}</Text>
            <Text style={[s.trackRowName, i === track && s.trackRowTextActive]}>{t}</Text>
            {i === track && status.isPlaying && <Text style={s.playingDot}>▶</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Video Player ──────────────────────────────────────────────────────────────
function VideoPlayer({ nftId, fileCount, name, serverUrl }: Pick<NFTPlayerProps, "nftId" | "fileCount" | "name" | "serverUrl">) {
  const videoRef = useRef<any>(null);
  const [chapter, setChapter] = useState(0);
  const chapterNames = Array.from({ length: fileCount }, (_, i) => `Chapter ${i + 1}`);

  const loadChapter = async (idx: number) => {
    setChapter(idx);
    if (videoRef.current) {
      await videoRef.current.unloadAsync();
      await videoRef.current.loadAsync({ uri: mediaUrl(serverUrl, nftId, idx) }, { shouldPlay: true });
    }
  };

  if (!AVModule) {
    return <Text style={s.unavail}>expo-av not available — video playback requires native build</Text>;
  }

  const { Video } = AVModule;

  return (
    <View style={s.videoWrap}>
      <Video
        ref={videoRef}
        source={{ uri: mediaUrl(serverUrl, nftId, chapter) }}
        style={s.videoEl}
        useNativeControls
        resizeMode="contain"
      />
      <Text style={s.videoTitle}>{name} — {chapterNames[chapter]}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chapterBar}>
        {chapterNames.map((c, i) => (
          <Pressable key={i} onPress={() => loadChapter(i)} style={[s.chapterBtn, i === chapter && s.chapterBtnActive]}>
            <Text style={[s.chapterBtnText, i === chapter && s.chapterBtnTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Document / Photo Viewer ───────────────────────────────────────────────────
function PagedViewer({ nftId, fileCount, name, serverUrl, mediaType }: Pick<NFTPlayerProps, "nftId" | "fileCount" | "name" | "serverUrl" | "mediaType">) {
  const [page, setPage] = useState(0);
  const listRef = useRef<FlatList<number>>(null);
  const pages = Array.from({ length: fileCount }, (_, i) => i);

  const renderPage = ({ item: idx }: { item: number }) => {
    const url = mediaUrl(serverUrl, nftId, idx);
    // Heuristic: PDFs and text files → WebView, images → Image
    const isPdf = url.match(/\.pdf($|\?)/i);
    const showWebView = (isPdf || mediaType === "document") && WebView !== null;
    return (
      <View style={[s.pageCont, { width: WIN_W }]}>
        {showWebView ? (
          <WebView source={{ uri: url }} style={s.pageWebView} startInLoadingState />
        ) : isPdf && !WebView ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={s.unavail}>📄 PDF viewer requires react-native-webview</Text>
          </View>
        ) : (
          <Image source={{ uri: url }} style={s.pageImage} resizeMode="contain" />
        )}
      </View>
    );
  };

  return (
    <View style={s.pagedWrap}>
      <FlatList
        ref={listRef}
        data={pages}
        keyExtractor={i => String(i)}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => {
          const newPage = Math.round(e.nativeEvent.contentOffset.x / WIN_W);
          setPage(newPage);
        }}
      />
      {/* Page indicator */}
      <View style={s.pageIndicator}>
        <Text style={s.pageIndicatorText}>
          {mediaType === "photo" ? "Photo" : "Page"} {page + 1} of {fileCount}
        </Text>
      </View>
      {/* Thumbnail strip */}
      <ScrollView horizontal style={s.thumbStrip} showsHorizontalScrollIndicator={false}>
        {pages.map(i => (
          <Pressable key={i} onPress={() => {
            listRef.current?.scrollToIndex({ index: i, animated: true });
            setPage(i);
          }}>
            <Image
              source={{ uri: mediaUrl(serverUrl, nftId, i) }}
              style={[s.thumb, i === page && s.thumbActive]}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Main NFTPlayer ─────────────────────────────────────────────────────────────
export default function NFTPlayer(props: NFTPlayerProps) {
  const { visible, onClose, mediaType, name } = props;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modal}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerType}>{mediaType.toUpperCase()}</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{name}</Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* Content */}
        {mediaType === "audio" && <AudioPlayer {...props} />}
        {mediaType === "video" && <VideoPlayer {...props} />}
        {(mediaType === "document" || mediaType === "photo") && <PagedViewer {...props} />}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const GOLD = "#FFD700";
const BG   = "#040507";
const CARD = "#111318";

const s = StyleSheet.create({
  modal:             { flex: 1, backgroundColor: BG },
  header:            { flexDirection: "row", alignItems: "center", padding: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: "#222" },
  headerType:        { color: GOLD, fontSize: 11, fontWeight: "700", backgroundColor: "#1a1200", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginRight: 10 },
  headerTitle:       { flex: 1, color: "#fff", fontSize: 16, fontWeight: "600" },
  closeBtn:          { padding: 8 },
  closeText:         { color: "#888", fontSize: 18 },

  // Audio
  audioWrap:         { flex: 1, padding: 20 },
  albumArt:          { width: 180, height: 180, borderRadius: 12, backgroundColor: "#1a1200", alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 20, borderWidth: 1, borderColor: "#333" },
  albumIcon:         { fontSize: 64 },
  albumName:         { color: "#ccc", fontSize: 13, textAlign: "center", marginTop: 8, paddingHorizontal: 12 },
  trackName:         { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 12 },
  progressBar:       { height: 4, backgroundColor: "#222", borderRadius: 2, overflow: "hidden", marginBottom: 6 },
  progressFill:      { height: 4, backgroundColor: GOLD, borderRadius: 2 },
  timeRow:           { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  timeText:          { color: "#666", fontSize: 11 },
  controls:          { flexDirection: "row", justifyContent: "space-around", alignItems: "center", marginBottom: 24 },
  ctrlBtn:           { padding: 10 },
  ctrlActive:        { backgroundColor: "#1a1200", borderRadius: 20 },
  playBtn:           { padding: 14 },
  ctrlIcon:          { fontSize: 22 },
  trackList:         { flex: 1 },
  trackRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8, marginBottom: 2 },
  trackRowActive:    { backgroundColor: "#1a1200" },
  trackRowNum:       { color: "#666", width: 28, fontSize: 13 },
  trackRowName:      { flex: 1, color: "#ccc", fontSize: 14 },
  trackRowTextActive:{ color: GOLD },
  playingDot:        { color: GOLD, fontSize: 12 },

  // Video
  videoWrap:         { flex: 1 },
  videoEl:           { width: WIN_W, height: WIN_W * 9 / 16 },
  videoTitle:        { color: "#ccc", fontSize: 13, padding: 12 },
  chapterBar:        { maxHeight: 48 },
  chapterBtn:        { paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 4, borderRadius: 8, backgroundColor: "#1a1a1a" },
  chapterBtnActive:  { backgroundColor: "#1a1200", borderWidth: 1, borderColor: GOLD },
  chapterBtnText:    { color: "#888", fontSize: 13 },
  chapterBtnTextActive: { color: GOLD },

  // Paged
  pagedWrap:         { flex: 1 },
  pageCont:          { flex: 1, height: WIN_H - 160 },
  pageWebView:       { flex: 1 },
  pageImage:         { flex: 1, width: WIN_W, height: WIN_H - 200 },
  pageIndicator:     { position: "absolute", bottom: 60, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  pageIndicatorText: { color: "#fff", fontSize: 13 },
  thumbStrip:        { position: "absolute", bottom: 0, height: 56, backgroundColor: "rgba(0,0,0,0.7)" },
  thumb:             { width: 48, height: 48, borderRadius: 4, margin: 4, opacity: 0.6 },
  thumbActive:       { opacity: 1, borderWidth: 2, borderColor: GOLD },

  unavail:           { color: "#888", textAlign: "center", padding: 32 },
});
