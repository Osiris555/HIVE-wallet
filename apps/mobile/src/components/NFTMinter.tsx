// apps/mobile/src/components/NFTMinter.tsx
// 7-step NFT creation wizard: Type → Files → Details → Collection → Edition → Schedule → Confirm
// Supports Expo web (web file input fallback), numbered editions, scheduling, pricing, mint fee

import React, { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// Lazy imports — app won't crash if packages aren't installed
let ImagePicker: any = null;
let DocumentPicker: any = null;
try { ImagePicker  = require("expo-image-picker");   } catch (_) {}
try { DocumentPicker = require("expo-document-picker"); } catch (_) {}

const { width: WIN_W } = Dimensions.get("window");

// ── Constants ─────────────────────────────────────────────────────────────────
const MINT_FEE_HNY  = 0.20;     // $0.20 USD at $1.00/HNY (goes to HIVE Labs)
const GAS_FEE_HNY   = 0.000001; // base gas (goes to honey treasury)
const COPY_MAX      = 30000;
const HIVE_LABS_VAULT = "HNY_HIVE_LABS_VAULT";

// ── Types ─────────────────────────────────────────────────────────────────────
export type NftCollection = { id: string; name: string; nft_count?: number };

export type NFTMinterProps = {
  visible: boolean;
  onClose: () => void;
  onMinted: (nftId: string) => void;
  serverUrl: string;
  walletAddress: string;
  /** Signs `nft_action|wallet|nft_id|timestamp` with ML-DSA-65 */
  signMessage: (message: string) => Promise<string>;
  collections?: NftCollection[];
  withChrysalis?: (title: string, fn: (setStage: (s: string) => void) => Promise<void>) => Promise<void>;
};

type MediaType       = "audio" | "video" | "document" | "photo";
type EditionType     = "unique" | "numbered";
type CollectionMode  = "none" | "create" | "existing";
type ReleaseType     = "now" | "scheduled";
type FileAsset       = { uri: string; name: string; type: string; size?: number; webFile?: File };

const MEDIA_CARDS: { type: MediaType; icon: string; label: string; desc: string }[] = [
  { type: "audio",    icon: "🎵", label: "Audio",    desc: "MP3, WAV, FLAC, AAC — up to 30 tracks" },
  { type: "video",    icon: "🎬", label: "Video",    desc: "MP4, MOV, WebM — up to 10 chapters" },
  { type: "document", icon: "📄", label: "Document", desc: "PDF, images — up to 50 pages" },
  { type: "photo",    icon: "🖼", label: "Photo",    desc: "JPG, PNG, GIF, WebP, PSD — up to 50 images" },
];

const DURATION_OPTS = [
  { days: 7,   label: "1 Wk"  },
  { days: 14,  label: "2 Wks" },
  { days: 30,  label: "1 Mo"  },
  { days: 90,  label: "3 Mo"  },
  { days: 180, label: "6 Mo"  },
];

const STEP_LABELS = ["Type", "Files", "Details", "Collection", "Edition", "Schedule", "Confirm"];

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  return (
    <View style={s.stepBar}>
      {STEP_LABELS.map((_, i) => (
        <React.Fragment key={i}>
          <View style={[s.stepDot, step >= i && s.stepDotActive]}>
            <Text style={[s.stepNum, step >= i && s.stepNumActive]}>{i + 1}</Text>
          </View>
          {i < STEP_LABELS.length - 1 && (
            <View style={[s.stepLine, step > i && s.stepLineActive]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────────
function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.pill, active && s.pillActive]}>
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NFTMinter({
  visible, onClose, onMinted, serverUrl, walletAddress, signMessage,
  collections = [], withChrysalis,
}: NFTMinterProps) {
  // Core
  const [step,      setStep]      = useState(0);
  const [mediaType, setMediaType] = useState<MediaType | null>(null);
  const [files,     setFiles]     = useState<FileAsset[]>([]);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState("");

  // Step 2 — Details
  const [name,       setName]       = useState("");
  const [description, setDesc]      = useState("");
  const [tags,        setTags]      = useState("");
  const [royaltyPct,  setRoyalty]   = useState(5);

  // Step 3 — Collection
  const [collMode,    setCollMode]  = useState<CollectionMode>("none");
  const [existingColl, setExisting] = useState<string | null>(null);
  const [newCollName,  setNewCName] = useState("");
  const [newCollDesc,  setNewCDesc] = useState("");
  const [newCollTags,  setNewCTags] = useState("");

  // Step 4 — Edition & Pricing
  const [edition,       setEdition]  = useState<EditionType>("unique");
  const [copyCount,     setCopies]   = useState("1");
  const [listNow,       setListNow]  = useState(false);
  const [listPrice,     setListPrice] = useState("");
  const [listDuration,  setListDur]  = useState(30);

  // Step 5 — Schedule
  const [releaseType, setRelType] = useState<ReleaseType>("now");
  const [releaseDate, setRelDate] = useState("");

  const MAX_FILES = mediaType === "audio" ? 30 : mediaType === "video" ? 10 : 50;
  const numCopies = edition === "unique" ? 1 : Math.min(COPY_MAX, Math.max(2, parseInt(copyCount, 10) || 2));

  function reset() {
    setStep(0); setMediaType(null); setFiles([]);
    setName(""); setDesc(""); setTags(""); setRoyalty(5);
    setCollMode("none"); setExisting(null); setNewCName(""); setNewCDesc(""); setNewCTags("");
    setEdition("unique"); setCopies("1"); setListNow(false); setListPrice(""); setListDur(30);
    setRelType("now"); setRelDate("");
    setBusy(false); setError("");
  }

  function handleClose() { reset(); onClose(); }

  // ── Web file picker (bypasses expo-image-picker for Expo web) ───────────────
  function pickFilesWeb(): Promise<FileAsset[]> {
    return new Promise((resolve) => {
      if (typeof document === "undefined") { resolve([]); return; }
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      if (mediaType === "photo") {
        input.accept = ".jpg,.jpeg,.png,.gif,.webp,.psd,.bmp,.tiff,image/*";
      } else if (mediaType === "video") {
        input.accept = "video/*,.mp4,.mov,.webm,.mkv";
      } else if (mediaType === "audio") {
        input.accept = "audio/*,.mp3,.wav,.flac,.aac,.ogg";
      } else {
        input.accept = ".pdf,.txt,.md,image/*,application/pdf";
      }
      input.onchange = () => {
        const fl = input.files;
        if (!fl || fl.length === 0) { resolve([]); return; }
        resolve(
          Array.from(fl).map((f) => ({
            uri: URL.createObjectURL(f),
            name: f.name,
            type: f.type || "image/jpeg",
            size: f.size,
            webFile: f,
          }))
        );
      };
      // Treat no selection as cancel
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        setTimeout(() => {
          if (!input.files || input.files.length === 0) resolve([]);
        }, 500);
      };
      window.addEventListener("focus", onFocus);
      input.click();
    });
  }

  // ── Pick files (native + web) ─────────────────────────────────────────────
  async function pickFiles() {
    if (!mediaType) return;
    setError("");
    try {
      let picked: FileAsset[] = [];

      // Expo web — use HTML file input directly
      if (Platform.OS === "web") {
        picked = await pickFilesWeb();
      } else if (mediaType === "photo" || mediaType === "video") {
        if (!ImagePicker) { setError("expo-image-picker not installed"); return; }
        // Skip permissions on platforms that don't need it
        if (Platform.OS !== "web") {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { setError("Media library permission denied"); return; }
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: mediaType === "video"
            ? ImagePicker.MediaTypeOptions.Videos
            : ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 1,
        });
        if (!result.canceled && result.assets) {
          picked = result.assets.map((a: any) => ({
            uri: a.uri,
            name: a.fileName || `file_${Date.now()}.${a.type === "video" ? "mp4" : "jpg"}`,
            type: a.mimeType || (a.type === "video" ? "video/mp4" : "image/jpeg"),
            size: a.fileSize,
          }));
        }
      } else {
        if (!DocumentPicker) { setError("expo-document-picker not installed"); return; }
        const mimeTypes: string[] = mediaType === "audio"
          ? ["audio/*"]
          : mediaType === "document"
          ? ["application/pdf", "image/*", "text/*"]
          : ["image/*"];
        const result = await DocumentPicker.getDocumentAsync({
          type: mimeTypes,
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (!result.canceled && result.assets) {
          picked = result.assets.map((a: any) => ({
            uri: a.uri,
            name: a.name || `file_${Date.now()}`,
            type: a.mimeType || "application/octet-stream",
            size: a.size,
          }));
        }
      }

      if (picked.length === 0) return;
      setFiles((f) => [...f, ...picked].slice(0, MAX_FILES));
    } catch (e: any) {
      setError(e.message || "File picker error");
    }
  }

  function removeFile(idx: number) { setFiles((f) => f.filter((_, i) => i !== idx)); }

  // ── Mint ──────────────────────────────────────────────────────────────────
  async function doMint(setStage?: (s: string) => void) {
    const timestamp = Date.now();
    const tempId    = `nft_preview_${timestamp}`;
    const message   = `mint|${walletAddress}|${tempId}|${timestamp}`;

    setStage?.("Signing with ML-DSA-65...");
    const signatureHex = await signMessage(message);

    const form = new FormData();
    form.append("wallet",        walletAddress);
    form.append("signatureHex",  signatureHex);
    form.append("name",          name.trim());
    form.append("description",   description.trim());
    form.append("tags",          tags.trim());
    form.append("mediaType",     mediaType!);
    form.append("royalty_bps",   String(Math.round(royaltyPct * 100)));
    form.append("timestamp",     String(timestamp));
    form.append("copy_count",    String(numCopies));
    form.append("mint_fee_hny",  String(MINT_FEE_HNY));
    form.append("labs_vault",    HIVE_LABS_VAULT);

    // Collection
    form.append("collection_mode", collMode);
    if (collMode === "existing" && existingColl) {
      form.append("collection_id", existingColl);
    } else if (collMode === "create") {
      form.append("new_coll_name", newCollName.trim());
      form.append("new_coll_desc", newCollDesc.trim());
      form.append("new_coll_tags", newCollTags.trim());
    }

    // Listing
    if (listNow && listPrice) {
      form.append("list_price_hny",    listPrice);
      form.append("list_duration_days", String(listDuration));
    }

    // Schedule
    form.append("release_type", releaseType);
    if (releaseType === "scheduled" && releaseDate.trim()) {
      const releaseMs = new Date(releaseDate.trim()).getTime();
      if (!isNaN(releaseMs)) form.append("release_at_ms", String(releaseMs));
    }

    // Files
    setStage?.("Uploading files to Honey Network...");
    for (const f of files) {
      if (Platform.OS === "web" && f.webFile) {
        form.append("files", f.webFile, f.name);
      } else {
        form.append("files", {
          uri:  Platform.OS === "ios" ? f.uri.replace("file://", "") : f.uri,
          name: f.name,
          type: f.type,
        } as any);
      }
    }

    const res  = await fetch(`${serverUrl}/nft/mint`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Mint failed");

    setStage?.("Finalizing on-chain...");
    await new Promise((r) => setTimeout(r, 600));

    reset();
    onMinted(data.nft_id);
  }

  async function handleMint() {
    if (!mediaType || files.length === 0 || !name.trim()) {
      setError("Name and at least one file are required"); return;
    }
    setError("");
    setBusy(true);
    try {
      if (withChrysalis) {
        await withChrysalis("🐝 Minting NFT", doMint);
      } else {
        await doMint();
      }
    } catch (e: any) {
      setError(e.message || "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Nav helpers ───────────────────────────────────────────────────────────
  function nextStep(cur: number) { setStep(cur + 1); setError(""); }
  function prevStep(cur: number) { setStep(cur - 1); setError(""); }

  // First photo URI for preview
  const previewUri = mediaType === "photo" && files.length > 0 ? files[0].uri : null;
  const mediaCard  = MEDIA_CARDS.find((c) => c.type === mediaType);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={s.modal}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>🐝 Mint NFT</Text>
          <Text style={s.headerStep}>{STEP_LABELS[step]}</Text>
          <Pressable onPress={handleClose} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        </View>

        <StepBar step={step} />

        <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

          {/* ─── Step 0: Media Type ─── */}
          {step === 0 && (
            <View>
              <Text style={s.sectionTitle}>What kind of NFT?</Text>
              {MEDIA_CARDS.map((c) => (
                <Pressable key={c.type} onPress={() => { setMediaType(c.type); nextStep(0); }} style={s.typeCard}>
                  <Text style={s.typeIcon}>{c.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.typeLabel}>{c.label}</Text>
                    <Text style={s.typeDesc}>{c.desc}</Text>
                  </View>
                  <Text style={s.typeArrow}>›</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* ─── Step 1: Files ─── */}
          {step === 1 && (
            <View>
              <Text style={s.sectionTitle}>
                Add {mediaType === "audio" ? "Tracks" : mediaType === "video" ? "Chapters" : mediaType === "photo" ? "Images" : "Files"}
              </Text>
              <Text style={s.hint}>Tap a file to remove • Max {MAX_FILES} files</Text>

              {files.map((f, i) => (
                <Pressable key={i} onPress={() => removeFile(i)} style={s.fileRow}>
                  {mediaType === "photo" && f.uri ? (
                    <Image source={{ uri: f.uri }} style={s.fileThumbnail} />
                  ) : (
                    <Text style={s.fileIcon}>{mediaCard?.icon}</Text>
                  )}
                  <Text style={s.fileName} numberOfLines={1}>{i + 1}. {f.name}</Text>
                  <Text style={s.fileRemove}>✕</Text>
                </Pressable>
              ))}

              {files.length < MAX_FILES && (
                <Pressable onPress={pickFiles} style={s.addBtn}>
                  <Text style={s.addBtnText}>+ Add {files.length > 0 ? "More" : ""} Files</Text>
                </Pressable>
              )}

              {error ? <Text style={s.error}>{error}</Text> : null}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(1)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable
                  onPress={() => { if (files.length > 0) nextStep(1); else setError("Add at least one file"); }}
                  style={s.nextBtn}
                >
                  <Text style={s.nextBtnText}>Next →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Step 2: Details ─── */}
          {step === 2 && (
            <View>
              <Text style={s.sectionTitle}>NFT Details</Text>

              <Text style={s.label}>Name *</Text>
              <TextInput style={s.input} value={name} onChangeText={setName}
                placeholder="My awesome NFT" placeholderTextColor="#555" maxLength={100} />

              <Text style={s.label}>Description</Text>
              <TextInput style={[s.input, { height: 80 }]} value={description} onChangeText={setDesc}
                placeholder="Describe your NFT…" placeholderTextColor="#555" multiline maxLength={500} />

              <Text style={s.label}>Tags (comma-separated)</Text>
              <TextInput style={s.input} value={tags} onChangeText={setTags}
                placeholder="art, collectible, music…" placeholderTextColor="#555" maxLength={200} />

              <Text style={s.label}>Creator Royalty: {royaltyPct}%</Text>
              <View style={s.pillRow}>
                {[0, 5, 10, 15, 20].map((pct) => (
                  <Pill key={pct} label={`${pct}%`} active={royaltyPct === pct} onPress={() => setRoyalty(pct)} />
                ))}
              </View>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(2)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable
                  onPress={() => { if (name.trim()) nextStep(2); else setError("Name is required"); }}
                  style={s.nextBtn}
                >
                  <Text style={s.nextBtnText}>Next →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Step 3: Collection ─── */}
          {step === 3 && (
            <View>
              <Text style={s.sectionTitle}>Collection</Text>
              <Text style={s.hint}>Organise your NFT into a collection (optional)</Text>

              <View style={s.pillRow}>
                <Pill label="None"        active={collMode === "none"}     onPress={() => setCollMode("none")} />
                <Pill label="Create New"  active={collMode === "create"}   onPress={() => setCollMode("create")} />
                {collections.length > 0 && (
                  <Pill label="Add to Existing" active={collMode === "existing"} onPress={() => setCollMode("existing")} />
                )}
              </View>

              {collMode === "create" && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.label}>Collection Name *</Text>
                  <TextInput style={s.input} value={newCollName} onChangeText={setNewCName}
                    placeholder="My Collection" placeholderTextColor="#555" maxLength={80} />

                  <Text style={s.label}>Collection Description</Text>
                  <TextInput style={[s.input, { height: 70 }]} value={newCollDesc} onChangeText={setNewCDesc}
                    placeholder="What is this collection about?" placeholderTextColor="#555"
                    multiline maxLength={300} />

                  <Text style={s.label}>Collection Tags</Text>
                  <TextInput style={s.input} value={newCollTags} onChangeText={setNewCTags}
                    placeholder="art, photography, music…" placeholderTextColor="#555" maxLength={200} />
                </View>
              )}

              {collMode === "existing" && collections.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.label}>Select Collection</Text>
                  {collections.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setExisting(c.id)}
                      style={[s.collCard, existingColl === c.id && s.collCardActive]}
                    >
                      <Text style={[s.collCardText, existingColl === c.id && s.collCardTextActive]}>
                        {c.name} {c.nft_count != null ? `(${c.nft_count})` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {error ? <Text style={s.error}>{error}</Text> : null}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(3)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable
                  onPress={() => {
                    if (collMode === "create" && !newCollName.trim()) { setError("Collection name required"); return; }
                    if (collMode === "existing" && !existingColl) { setError("Select a collection"); return; }
                    nextStep(3);
                  }}
                  style={s.nextBtn}
                >
                  <Text style={s.nextBtnText}>Next →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Step 4: Edition & Pricing ─── */}
          {step === 4 && (
            <View>
              <Text style={s.sectionTitle}>Edition & Pricing</Text>

              <Text style={s.label}>Edition Type</Text>
              <View style={s.pillRow}>
                <Pill label="1/1 Unique"         active={edition === "unique"}   onPress={() => { setEdition("unique");   setCopies("1"); }} />
                <Pill label="Numbered Edition"   active={edition === "numbered"} onPress={() => setEdition("numbered")} />
              </View>

              {edition === "numbered" && (
                <View>
                  <Text style={s.label}>Number of Copies (max {COPY_MAX.toLocaleString()})</Text>
                  <TextInput
                    style={s.input}
                    value={copyCount}
                    onChangeText={(v) => setCopies(v.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder="e.g. 100"
                    placeholderTextColor="#555"
                    maxLength={6}
                  />
                  {parseInt(copyCount, 10) > COPY_MAX && (
                    <Text style={s.error}>Maximum {COPY_MAX.toLocaleString()} copies</Text>
                  )}
                </View>
              )}

              <Text style={[s.label, { marginTop: 20 }]}>Listing</Text>
              <View style={s.pillRow}>
                <Pill label="List for Sale"   active={listNow}  onPress={() => setListNow(true)} />
                <Pill label="Don't List Yet"  active={!listNow} onPress={() => setListNow(false)} />
              </View>

              {listNow && (
                <View>
                  <Text style={s.label}>Price (HNY)</Text>
                  <TextInput
                    style={s.input}
                    value={listPrice}
                    onChangeText={(v) => setListPrice(v.replace(/[^0-9.]/g, ""))}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 10.00"
                    placeholderTextColor="#555"
                  />
                  {listPrice ? (
                    <Text style={s.hint}>≈ ${(parseFloat(listPrice) * 1.00).toFixed(2)} USD</Text>
                  ) : null}

                  <Text style={s.label}>Listing Duration</Text>
                  <View style={s.pillRow}>
                    {DURATION_OPTS.map((d) => (
                      <Pill key={d.days} label={d.label} active={listDuration === d.days} onPress={() => setListDur(d.days)} />
                    ))}
                  </View>
                </View>
              )}

              {error ? <Text style={s.error}>{error}</Text> : null}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(4)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable
                  onPress={() => {
                    const n = parseInt(copyCount, 10);
                    if (edition === "numbered" && (isNaN(n) || n < 2)) { setError("Enter at least 2 copies"); return; }
                    if (edition === "numbered" && n > COPY_MAX) { setError(`Max ${COPY_MAX.toLocaleString()} copies`); return; }
                    if (listNow && !listPrice) { setError("Enter a price or choose Don't List Yet"); return; }
                    nextStep(4);
                  }}
                  style={s.nextBtn}
                >
                  <Text style={s.nextBtnText}>Next →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Step 5: Schedule ─── */}
          {step === 5 && (
            <View>
              <Text style={s.sectionTitle}>Release Schedule</Text>

              <View style={s.pillRow}>
                <Pill label="Release Immediately" active={releaseType === "now"}       onPress={() => setRelType("now")} />
                <Pill label="Schedule Release"    active={releaseType === "scheduled"} onPress={() => setRelType("scheduled")} />
              </View>

              {releaseType === "scheduled" && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.label}>Release Date & Time</Text>
                  {Platform.OS === "web" ? (
                    /* Native HTML datetime-local input on web */
                    <input
                      type="datetime-local"
                      value={releaseDate}
                      onChange={(e) => setRelDate(e.target.value)}
                      style={{
                        background: "#111318",
                        border: "1px solid #333",
                        borderRadius: 8,
                        color: "#fff",
                        padding: 12,
                        fontSize: 14,
                        width: "100%",
                        boxSizing: "border-box",
                        marginTop: 4,
                      } as any}
                    />
                  ) : (
                    <TextInput
                      style={s.input}
                      value={releaseDate}
                      onChangeText={setRelDate}
                      placeholder="YYYY-MM-DD HH:MM"
                      placeholderTextColor="#555"
                    />
                  )}
                  <Text style={s.hint}>
                    NFT will be minted now but only visible in the marketplace at the scheduled time.
                  </Text>
                </View>
              )}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(5)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable
                  onPress={() => {
                    if (releaseType === "scheduled" && !releaseDate.trim()) {
                      setError("Enter a release date or choose Release Immediately"); return;
                    }
                    nextStep(5);
                  }}
                  style={s.nextBtn}
                >
                  <Text style={s.nextBtnText}>Review →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Step 6: Confirm & Mint ─── */}
          {step === 6 && mediaType && (
            <View>
              <Text style={s.sectionTitle}>Ready to Mint</Text>

              {/* Preview */}
              <View style={s.summaryCard}>
                {previewUri ? (
                  <Image source={{ uri: previewUri }} style={s.previewImage} />
                ) : (
                  <Text style={s.summaryIcon}>{mediaCard?.icon}</Text>
                )}
                <Text style={s.summaryName}>{name}</Text>
                <Text style={s.summaryMeta}>
                  {mediaType.toUpperCase()} • {files.length} file{files.length !== 1 ? "s" : ""}
                  {edition === "numbered" ? ` • ${numCopies} copies` : " • 1/1 Unique"}
                </Text>
                {tags ? <Text style={s.summaryMeta}>🏷 {tags}</Text> : null}
                {description ? <Text style={s.summaryDesc}>{description}</Text> : null}
                {collMode === "create" && newCollName ? (
                  <Text style={s.summaryMeta}>📁 New: {newCollName}</Text>
                ) : collMode === "existing" && existingColl ? (
                  <Text style={s.summaryMeta}>📁 {collections.find((c) => c.id === existingColl)?.name}</Text>
                ) : null}
                {listNow && listPrice ? (
                  <Text style={s.summaryMeta}>💰 Listed at {listPrice} HNY for {listDuration}d</Text>
                ) : null}
                {releaseType === "scheduled" && releaseDate ? (
                  <Text style={s.summaryMeta}>🕐 Scheduled: {releaseDate}</Text>
                ) : null}
                <View style={s.summaryPill}>
                  <Text style={s.summaryPillText}>Royalty: {royaltyPct}%</Text>
                </View>
              </View>

              {/* Fee breakdown */}
              <View style={s.feeCard}>
                <Text style={s.feeTitle}>Fee Breakdown</Text>
                <View style={s.feeRow}>
                  <Text style={s.feeLabel}>Mint Fee (HIVE Labs)</Text>
                  <Text style={s.feeValue}>{MINT_FEE_HNY.toFixed(2)} HNY</Text>
                </View>
                <View style={s.feeRow}>
                  <Text style={s.feeLabel}>Network Gas Fee</Text>
                  <Text style={s.feeValue}>{GAS_FEE_HNY.toFixed(6)} HNY</Text>
                </View>
                {numCopies > 1 && (
                  <View style={s.feeRow}>
                    <Text style={s.feeLabel}>× {numCopies} copies</Text>
                    <Text style={s.feeValue}>{(MINT_FEE_HNY * numCopies).toFixed(2)} HNY total</Text>
                  </View>
                )}
                <View style={[s.feeRow, { borderTopWidth: 1, borderTopColor: "#333", marginTop: 6, paddingTop: 6 }]}>
                  <Text style={[s.feeLabel, { color: "#fff" }]}>Total</Text>
                  <Text style={[s.feeValue, { color: GOLD }]}>
                    {((MINT_FEE_HNY * numCopies) + GAS_FEE_HNY).toFixed(6)} HNY
                  </Text>
                </View>
              </View>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <View style={s.navRow}>
                <Pressable onPress={() => prevStep(6)} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>
                <Pressable onPress={handleMint} style={[s.mintBtn, busy && { opacity: 0.6 }]} disabled={busy}>
                  {busy
                    ? <ActivityIndicator color="#000" />
                    : <Text style={s.mintBtnText}>🐝 Mint NFT</Text>}
                </Pressable>
              </View>
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const GOLD = "#FFD700";
const BG   = "#040507";
const CARD = "#111318";

const s = StyleSheet.create({
  modal:       { flex: 1, backgroundColor: BG },
  header:      {
    flexDirection: "row", alignItems: "center", padding: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: "#222",
  },
  headerTitle: { flex: 1, color: "#fff", fontSize: 17, fontWeight: "700" },
  headerStep:  { color: GOLD, fontSize: 13, marginRight: 12 },
  closeBtn:    { padding: 8 },
  closeText:   { color: "#888", fontSize: 18 },

  stepBar:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12 },
  stepDot:       { width: 22, height: 22, borderRadius: 11, backgroundColor: "#222", alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: GOLD },
  stepNum:       { color: "#666", fontSize: 10, fontWeight: "700" },
  stepNumActive: { color: "#000" },
  stepLine:      { flex: 1, height: 2, backgroundColor: "#222" },
  stepLineActive:{ backgroundColor: GOLD },

  body:         { flex: 1, padding: 20 },
  sectionTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  hint:         { color: "#666", fontSize: 12, marginBottom: 10, lineHeight: 18 },

  // Type cards
  typeCard:  { flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#222" },
  typeIcon:  { fontSize: 30, marginRight: 14 },
  typeLabel: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 2 },
  typeDesc:  { color: "#888", fontSize: 12 },
  typeArrow: { color: GOLD, fontSize: 24, marginLeft: 8 },

  // Files
  fileRow:       { flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: 8, padding: 10, marginBottom: 6 },
  fileIcon:      { fontSize: 18, marginRight: 10 },
  fileThumbnail: { width: 36, height: 36, borderRadius: 6, marginRight: 10 },
  fileName:      { flex: 1, color: "#ccc", fontSize: 13 },
  fileRemove:    { color: "#555", fontSize: 16, paddingLeft: 8 },
  addBtn:        { borderWidth: 1, borderColor: GOLD, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  addBtnText:    { color: GOLD, fontWeight: "600" },

  // Inputs
  label: { color: "#aaa", fontSize: 12, marginBottom: 4, marginTop: 12 },
  input: { backgroundColor: CARD, borderWidth: 1, borderColor: "#333", borderRadius: 8, color: "#fff", padding: 12, fontSize: 14 },

  // Pills
  pillRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: CARD, borderWidth: 1, borderColor: "#333" },
  pillActive:     { backgroundColor: "#1a1200", borderColor: GOLD },
  pillText:       { color: "#888", fontSize: 13 },
  pillTextActive: { color: GOLD },

  // Collection select
  collCard:        { backgroundColor: CARD, borderRadius: 8, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: "#333" },
  collCardActive:  { borderColor: GOLD, backgroundColor: "#1a1200" },
  collCardText:    { color: "#ccc", fontSize: 14 },
  collCardTextActive: { color: GOLD },

  // Confirm / Summary
  summaryCard:    { backgroundColor: CARD, borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 16, borderWidth: 1, borderColor: "#333" },
  previewImage:   { width: 140, height: 140, borderRadius: 12, marginBottom: 12 },
  summaryIcon:    { fontSize: 48, marginBottom: 12 },
  summaryName:    { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  summaryMeta:    { color: GOLD, fontSize: 12, marginBottom: 4, textAlign: "center" },
  summaryDesc:    { color: "#888", fontSize: 12, textAlign: "center", marginBottom: 10 },
  summaryPill:    { backgroundColor: "#1a1200", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  summaryPillText:{ color: GOLD, fontSize: 12 },

  // Fee card
  feeCard:   { backgroundColor: CARD, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#333" },
  feeTitle:  { color: "#fff", fontSize: 14, fontWeight: "700", marginBottom: 10 },
  feeRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  feeLabel:  { color: "#888", fontSize: 13 },
  feeValue:  { color: "#ccc", fontSize: 13, fontWeight: "600" },

  // Nav
  navRow:     { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  backBtn:    { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: "#333" },
  backBtnText:{ color: "#888", fontWeight: "600" },
  nextBtn:    { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: GOLD },
  nextBtnText:{ color: "#000", fontWeight: "700" },
  mintBtn:    { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, backgroundColor: GOLD, flexDirection: "row", alignItems: "center" },
  mintBtnText:{ color: "#000", fontWeight: "700", fontSize: 16 },

  error: { color: "#ff6b6b", fontSize: 12, marginTop: 8 },
});
