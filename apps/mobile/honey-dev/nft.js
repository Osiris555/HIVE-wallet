// apps/mobile/honey-dev/nft.js
// NFT router — mint, media streaming, marketplace, buy/sell/send,
//              collections, auctions, offers (Phase 7A + 7B)
"use strict";

const express  = require("express");
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");
const { sha3_256 } = require("@noble/hashes/sha3");

const { openDb, run, get, all } = require("./db");
const queenBeeAI = require("./queen-bee-ai");

const router = express.Router();

// ── Storage ─────────────────────────────────────────────────────────────────
const NFT_MEDIA_DIR = path.join(__dirname, "nft-media");
if (!fs.existsSync(NFT_MEDIA_DIR)) fs.mkdirSync(NFT_MEDIA_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(NFT_MEDIA_DIR, req.nftId || "tmp");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const idx  = req.fileIndex = (req.fileIndex ?? -1) + 1;
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${idx}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 30, fileSize: 500 * 1024 * 1024 },
});

// ── MIME helpers ─────────────────────────────────────────────────────────────
const EXT_MIME = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown",
};

function mimeFromName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return EXT_MIME[ext] || "application/octet-stream";
}

// ── DB helpers ───────────────────────────────────────────────────────────────
function db() { return openDb(); }
async function withDb(fn) {
  const d = db();
  try { return await fn(d); } finally { d.close(); }
}

// ── ML-DSA-65 verification ───────────────────────────────────────────────────
async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  if (!mldsaPubKeyHex) return { ok: false, error: "Wallet not registered (missing ML-DSA-65 key)" };
  if (!signatureHex)   return { ok: false, error: "Missing signatureHex" };
  try {
    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa");
    const pubKey   = Buffer.from(mldsaPubKeyHex, "hex");
    const sig      = Buffer.from(signatureHex,   "hex");
    const msgBytes = Buffer.from(message, "utf8");
    const ok = ml_dsa65.verify(pubKey, msgBytes, sig);
    return ok ? { ok: true } : { ok: false, error: "Invalid ML-DSA-65 signature" };
  } catch (e) {
    return { ok: false, error: `ML-DSA-65 verify error: ${e.message}` };
  }
}

function nftMessage(action, wallet, nftId, timestamp) {
  return `${action}|${wallet}|${nftId || ""}|${timestamp || ""}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const NFT_SELECT = `
  SELECT n.id, n.creator_wallet, n.owner_wallet, n.name, n.description,
         n.ai_description, n.media_type, n.royalty_bps,
         n.listed_price_hny, n.listed_at, n.minted_at, n.transfer_count,
         n.collection_id, n.auction_id,
         COUNT(f.id) AS file_count
    FROM nfts n
    LEFT JOIN nft_files f ON f.nft_id = n.id`;

// ── HIVE Labs vault for mint fees ─────────────────────────────────────────────
const HIVE_LABS_VAULT = "HNY_HIVE_LABS_VAULT";
// Flat fee tiers — same total cost regardless of copy count within the tier
function getMintFee(copies) {
  if (copies >= 20000) return 1.00;  // 20k–30k edition
  if (copies >= 10000) return 0.55;  // 10k–19,999 edition
  return 0.20;                       // 1–9,999 copies (including 1/1)
}

// ── POST /nft/mint ────────────────────────────────────────────────────────────
router.post("/mint", (req, res, next) => {
  req.nftId = `nft_${crypto.randomBytes(16).toString("hex")}`;
  req.fileIndex = -1;
  next();
}, upload.array("files", 30), async (req, res) => {
  try {
    const {
      wallet, signatureHex, name, description, tags, mediaType,
      royalty_bps, timestamp,
      collection_id, collection_mode, new_coll_name, new_coll_desc, new_coll_tags,
      copy_count, list_price_hny, list_duration_days,
      release_type, release_at_ms,
      client_nft_id,
    } = req.body;

    if (!wallet || !name || !mediaType || !signatureHex) {
      return res.status(400).json({ error: "Missing required fields: wallet, name, mediaType, signatureHex" });
    }
    if (!["audio", "video", "document", "photo"].includes(mediaType)) {
      return res.status(400).json({ error: "mediaType must be audio, video, document, or photo" });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    const royaltyBps  = Math.min(2000, Math.max(0, parseInt(royalty_bps || "0", 10)));
    const numCopies   = Math.min(30000, Math.max(1, parseInt(copy_count || "1", 10)));
    // Allow client to provide the nftId so the signature can be verified correctly
    const nftId       = (client_nft_id && /^nft_[0-9a-f]{32}$/.test(client_nft_id)) ? client_nft_id : req.nftId;
    const ts          = timestamp || Date.now();
    const listPrice   = parseFloat(list_price_hny || "0") || 0;
    const listDays    = parseInt(list_duration_days || "0", 10) || 0;
    const releaseMs   = parseInt(release_at_ms || "0", 10) || 0;
    const nowMs       = Date.now();
    const isScheduled = release_type === "scheduled" && releaseMs > nowMs;

    // ── Auth ────────────────────────────────────────────────────────────────
    const acct = await withDb(d => get(d, `SELECT mldsa_public_key, balance FROM accounts WHERE wallet=?`, [wallet]));
    if (!acct?.mldsa_public_key) {
      return res.status(401).json({ error: "Wallet not registered on HIVE network" });
    }
    const msg = nftMessage("mint", wallet, nftId, ts);
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // ── Mint fee check ───────────────────────────────────────────────────────
    const totalMintFee = getMintFee(numCopies);
    if ((acct.balance || 0) < totalMintFee) {
      return res.status(400).json({ error: `Insufficient balance for mint fee (need ${totalMintFee.toFixed(2)} HNY)` });
    }

    // ── Resolve collection ───────────────────────────────────────────────────
    let resolvedCollId = null;
    if (collection_mode === "existing" && collection_id) {
      const coll = await withDb(d => get(d, `SELECT creator_wallet FROM nft_collections WHERE id=?`, [collection_id]));
      if (!coll || coll.creator_wallet !== wallet) {
        return res.status(403).json({ error: "Collection not found or not owned by wallet" });
      }
      resolvedCollId = collection_id;
    } else if (collection_mode === "create" && new_coll_name) {
      resolvedCollId = `coll_${crypto.randomBytes(12).toString("hex")}`;
      await withDb(d => run(d,
        `INSERT INTO nft_collections (id, creator_wallet, name, description, tags)
         VALUES (?, ?, ?, ?, ?)`,
        [resolvedCollId, wallet, new_coll_name.trim(), (new_coll_desc || "").trim(), (new_coll_tags || "").trim()]
      ));
    }

    // ── Listing params ───────────────────────────────────────────────────────
    const listedPriceHny = listPrice > 0 && !isScheduled ? listPrice : null;
    const listedAt       = listedPriceHny ? new Date().toISOString() : null;
    const listExpiresMs  = listedPriceHny && listDays > 0 ? nowMs + listDays * 86400000 : 0;

    // ── Insert NFT(s) + files ────────────────────────────────────────────────
    const nftIds = [];
    await withDb(async d => {
      for (let copyIdx = 1; copyIdx <= numCopies; copyIdx++) {
        const thisId = copyIdx === 1 ? nftId : `nft_${crypto.randomBytes(16).toString("hex")}`;
        nftIds.push(thisId);

        await run(d,
          `INSERT INTO nfts
             (id, creator_wallet, owner_wallet, name, description, tags,
              media_type, royalty_bps, collection_id,
              copy_count, copy_index,
              listed_price_hny, listed_at, list_duration_days, list_expires_at_ms,
              release_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            thisId, wallet, wallet,
            numCopies > 1 ? `${name} #${copyIdx}` : name,
            description || "", tags || "",
            mediaType, royaltyBps, resolvedCollId,
            numCopies, copyIdx,
            listedPriceHny, listedAt,
            listDays, listExpiresMs,
            releaseMs,
          ]
        );

        // Files are shared: copy 1 gets real files; others reference copy 1's files
        if (copyIdx === 1) {
          for (let i = 0; i < req.files.length; i++) {
            const f = req.files[i];
            await run(d,
              `INSERT INTO nft_files (nft_id, file_index, file_name, file_path, mime_type, file_size)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [thisId, i, f.originalname, f.path, mimeFromName(f.originalname), f.size]
            );
          }
        } else {
          // Copy additional editions: share file records pointing to copy 1's paths
          const srcFiles = await all(d,
            `SELECT * FROM nft_files WHERE nft_id=? ORDER BY file_index`, [nftId]);
          for (const f of srcFiles) {
            await run(d,
              `INSERT INTO nft_files (nft_id, file_index, file_name, file_path, mime_type, file_size)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [thisId, f.file_index, f.file_name, f.file_path, f.mime_type, f.file_size]
            );
          }
        }
      }

      // Deduct mint fee from wallet balance
      await run(d,
        `UPDATE accounts SET balance = balance - ? WHERE wallet = ?`,
        [totalMintFee, wallet]
      );
      // Credit HIVE Labs vault
      await run(d,
        `INSERT INTO accounts (wallet, balance, nonce, createdAtMs)
           VALUES (?, ?, 0, ?)
         ON CONFLICT(wallet) DO UPDATE SET balance = balance + excluded.balance`,
        [HIVE_LABS_VAULT, totalMintFee, nowMs]
      );
    });

    // Fire-and-forget: AI description for primary NFT
    queenBeeAI.describeNft({ name, mediaType, description: description || "", fileCount: req.files.length })
      .then(async aiDesc => {
        if (aiDesc) {
          await withDb(d => run(d, `UPDATE nfts SET ai_description=? WHERE id=?`, [aiDesc, nftId])).catch(() => {});
        }
      }).catch(() => {});

    return res.json({
      success: true,
      nft_id: nftId,
      nft_ids: nftIds,
      name,
      mediaType,
      fileCount: req.files.length,
      copyCount: numCopies,
      collectionId: resolvedCollId,
      mintFeeCharged: totalMintFee,
    });
  } catch (e) {
    console.error("NFT mint error:", e);
    return res.status(500).json({ error: e.message || "mint failed" });
  }
});

// ── GET /nft/media/:id/:index ─────────────────────────────────────────────────
router.get("/media/:id/:index", async (req, res) => {
  try {
    const nftId = req.params.id;
    const idx   = parseInt(req.params.index, 10);
    if (!Number.isFinite(idx) || idx < 0) return res.status(400).json({ error: "Invalid index" });

    const row = await withDb(d => get(d,
      `SELECT file_path, mime_type, file_name FROM nft_files WHERE nft_id=? AND file_index=?`,
      [nftId, idx]
    ));
    if (!row) return res.status(404).json({ error: "File not found" });
    if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: "File missing from disk" });

    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${row.file_name}"`);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(row.file_path).pipe(res);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /nft/wallet/:wallet ────────────────────────────────────────────────────
router.get("/wallet/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const nfts = await withDb(d => all(d,
      `${NFT_SELECT} WHERE n.owner_wallet=? GROUP BY n.id ORDER BY n.minted_at DESC`,
      [wallet]
    ));
    return res.json({ success: true, wallet, nfts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /nft/marketplace ───────────────────────────────────────────────────────
// Query params: mediaType, minPrice, maxPrice, creator, sort (price_asc|price_desc|newest|oldest)
router.get("/marketplace", async (req, res) => {
  try {
    const { mediaType, minPrice, maxPrice, creator, sort } = req.query;
    let where = "WHERE n.listed_price_hny IS NOT NULL AND n.listed_at IS NOT NULL";
    const params = [];

    if (mediaType && ["audio","video","document","photo"].includes(mediaType)) {
      where += " AND n.media_type=?"; params.push(mediaType);
    }
    if (minPrice && Number(minPrice) > 0) {
      where += " AND n.listed_price_hny >= ?"; params.push(Number(minPrice));
    }
    if (maxPrice && Number(maxPrice) > 0) {
      where += " AND n.listed_price_hny <= ?"; params.push(Number(maxPrice));
    }
    if (creator) {
      where += " AND n.creator_wallet=?"; params.push(creator);
    }

    const orderMap = {
      price_asc:  "n.listed_price_hny ASC",
      price_desc: "n.listed_price_hny DESC",
      oldest:     "n.listed_at ASC",
    };
    const order = orderMap[sort] || "n.listed_at DESC";

    const nfts = await withDb(d => all(d,
      `${NFT_SELECT} ${where} GROUP BY n.id ORDER BY ${order}`,
      params
    ));
    return res.json({ success: true, nfts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /nft/list ─────────────────────────────────────────────────────────────
router.post("/list", async (req, res) => {
  try {
    const { nft_id, price_hny, wallet, signatureHex, timestamp } = req.body;
    if (!nft_id || !wallet || !signatureHex) return res.status(400).json({ error: "Missing fields" });
    const price = Number(price_hny);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Invalid price" });

    const [nft, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet, auction_id FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner_wallet !== wallet) return res.status(403).json({ error: "Not the NFT owner" });
    if (nft.auction_id)  return res.status(400).json({ error: "NFT is in an active auction" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("list", wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(d => run(d,
      `UPDATE nfts SET listed_price_hny=?, listed_at=datetime('now') WHERE id=?`,
      [price, nft_id]
    ));
    return res.json({ success: true, nft_id, listed_price_hny: price });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /nft/delist ───────────────────────────────────────────────────────────
router.post("/delist", async (req, res) => {
  try {
    const { nft_id, wallet, signatureHex, timestamp } = req.body;
    if (!nft_id || !wallet || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const [nft, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner_wallet !== wallet) return res.status(403).json({ error: "Not the NFT owner" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("delist", wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(d => run(d,
      `UPDATE nfts SET listed_price_hny=NULL, listed_at=NULL WHERE id=?`,
      [nft_id]
    ));
    return res.json({ success: true, nft_id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /nft/buy ──────────────────────────────────────────────────────────────
router.post("/buy", async (req, res) => {
  try {
    const { nft_id, buyer_wallet, signatureHex, timestamp } = req.body;
    if (!nft_id || !buyer_wallet || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const data = await withDb(async d => {
      const nft  = await get(d, `SELECT * FROM nfts WHERE id=?`, [nft_id]);
      const acct = await get(d, `SELECT mldsa_public_key, balance FROM accounts WHERE wallet=?`, [buyer_wallet]);
      return { nft, acct };
    });

    const { nft, acct } = data;
    if (!nft)  return res.status(404).json({ error: "NFT not found" });
    if (!nft.listed_price_hny) return res.status(400).json({ error: "NFT is not listed for sale" });
    if (nft.owner_wallet === buyer_wallet) return res.status(400).json({ error: "Cannot buy your own NFT" });
    if (nft.auction_id) return res.status(400).json({ error: "NFT is in an active auction" });

    const price      = Number(nft.listed_price_hny);
    const royaltyBps = Number(nft.royalty_bps || 0);
    const royalty    = Number((price * royaltyBps / 10000).toFixed(8));
    const sellerGets = Number((price - royalty).toFixed(8));

    if (!acct || Number(acct.balance) < price) {
      return res.status(400).json({ error: "Insufficient HNY balance", required: price, balance: Number(acct?.balance || 0) });
    }

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct.mldsa_public_key,
      message: nftMessage("buy", buyer_wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(async d => {
      await run(d, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [price, buyer_wallet]);
      await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [sellerGets, nft.owner_wallet]);
      if (royalty > 0 && nft.creator_wallet !== nft.owner_wallet) {
        await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [royalty, nft.creator_wallet]);
      }
      // Cancel any open offers on this NFT (buyer won at listing price)
      await run(d,
        `UPDATE nft_offers SET cancelled=1 WHERE nft_id=? AND accepted=0 AND cancelled=0`,
        [nft_id]
      );
      await run(d,
        `UPDATE nfts SET owner_wallet=?, listed_price_hny=NULL, listed_at=NULL,
                transfer_count = transfer_count + 1 WHERE id=?`,
        [buyer_wallet, nft_id]
      );
    });

    return res.json({ success: true, nft_id, buyer: buyer_wallet, seller: nft.owner_wallet, price, royalty, sellerReceived: sellerGets });
  } catch (e) {
    console.error("NFT buy error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /nft/send ─────────────────────────────────────────────────────────────
router.post("/send", async (req, res) => {
  try {
    const { nft_id, from_wallet, to_wallet, signatureHex, timestamp } = req.body;
    if (!nft_id || !from_wallet || !to_wallet || !signatureHex) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (from_wallet === to_wallet) return res.status(400).json({ error: "Cannot send to yourself" });

    const [nft, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet, auction_id FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [from_wallet]),
    ]));

    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner_wallet !== from_wallet) return res.status(403).json({ error: "Not the NFT owner" });
    if (nft.auction_id)  return res.status(400).json({ error: "NFT is in an active auction" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("send", from_wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(async d => {
      await run(d,
        `UPDATE nfts SET owner_wallet=?, listed_price_hny=NULL, listed_at=NULL,
                transfer_count = transfer_count + 1 WHERE id=?`,
        [to_wallet, nft_id]
      );
      // Cancel any open offers on this NFT when gifted
      await run(d,
        `UPDATE nft_offers SET cancelled=1 WHERE nft_id=? AND accepted=0 AND cancelled=0`,
        [nft_id]
      );
    });
    return res.json({ success: true, nft_id, from: from_wallet, to: to_wallet });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /nft/:id ───────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const nftId = req.params.id;
    const [nft, files] = await withDb(async d => Promise.all([
      get(d, `SELECT * FROM nfts WHERE id=?`, [nftId]),
      all(d, `SELECT file_index, file_name, mime_type, file_size FROM nft_files WHERE nft_id=? ORDER BY file_index`, [nftId]),
    ]));
    if (!nft) return res.status(404).json({ error: "NFT not found" });
    return res.json({ success: true, nft, files });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ── Phase 7B: Collections ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// POST /nft/collection/create
router.post("/collection/create", async (req, res) => {
  try {
    const { wallet, name, description, cover_nft_id, signatureHex, timestamp } = req.body;
    if (!wallet || !name || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const acct = await withDb(d => get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]));
    const collId = `col_${crypto.randomBytes(12).toString("hex")}`;

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("collection_create", wallet, collId, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(d => run(d,
      `INSERT INTO nft_collections (id, creator_wallet, name, description, cover_nft_id) VALUES (?, ?, ?, ?, ?)`,
      [collId, wallet, name, description || "", cover_nft_id || null]
    ));
    return res.json({ success: true, collection_id: collId, name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /nft/collection/add — add an existing owned NFT to a collection
router.post("/collection/add", async (req, res) => {
  try {
    const { wallet, nft_id, collection_id, signatureHex, timestamp } = req.body;
    if (!wallet || !nft_id || !collection_id || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const [nft, coll, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT creator_wallet FROM nft_collections WHERE id=?`, [collection_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!nft)  return res.status(404).json({ error: "NFT not found" });
    if (!coll) return res.status(404).json({ error: "Collection not found" });
    if (nft.owner_wallet !== wallet)    return res.status(403).json({ error: "Not the NFT owner" });
    if (coll.creator_wallet !== wallet) return res.status(403).json({ error: "Not the collection owner" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("collection_add", wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(d => run(d, `UPDATE nfts SET collection_id=? WHERE id=?`, [collection_id, nft_id]));
    return res.json({ success: true, nft_id, collection_id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/collection/:id — get collection + its NFTs
router.get("/collection/:id", async (req, res) => {
  try {
    const collId = req.params.id;
    const [coll, nfts] = await withDb(async d => Promise.all([
      get(d, `SELECT * FROM nft_collections WHERE id=?`, [collId]),
      all(d, `${NFT_SELECT} WHERE n.collection_id=? GROUP BY n.id ORDER BY n.minted_at ASC`, [collId]),
    ]));
    if (!coll) return res.status(404).json({ error: "Collection not found" });
    return res.json({ success: true, collection: coll, nfts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/collections/:wallet — all collections by creator
router.get("/collections/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const collections = await withDb(d => all(d,
      `SELECT c.*, COUNT(n.id) AS nft_count
         FROM nft_collections c
         LEFT JOIN nfts n ON n.collection_id = c.id
        WHERE c.creator_wallet=?
        GROUP BY c.id
        ORDER BY c.created_at DESC`,
      [wallet]
    ));
    return res.json({ success: true, collections });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ── Phase 7B: Auctions ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// POST /nft/auction/create
// Body: { wallet, nft_id, reserve_price_hny, min_increment_hny, duration_hours, signatureHex, timestamp }
router.post("/auction/create", async (req, res) => {
  try {
    const { wallet, nft_id, reserve_price_hny, min_increment_hny, duration_hours, signatureHex, timestamp } = req.body;
    if (!wallet || !nft_id || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const reserve   = Math.max(0, Number(reserve_price_hny || 0));
    const increment = Math.max(0.01, Number(min_increment_hny || 1));
    const hours     = Math.min(168, Math.max(1, Number(duration_hours || 24))); // 1h – 7 days

    const [nft, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet, auction_id, listed_price_hny FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner_wallet !== wallet) return res.status(403).json({ error: "Not the NFT owner" });
    if (nft.auction_id)  return res.status(400).json({ error: "NFT already in auction" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("auction_create", wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    const auctionId = `auc_${crypto.randomBytes(12).toString("hex")}`;

    await withDb(async d => {
      await run(d,
        `INSERT INTO nft_auctions (id, nft_id, seller_wallet, reserve_price_hny, min_increment_hny, ends_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
        [auctionId, nft_id, wallet, reserve, increment, `+${hours} hours`]
      );
      // Lock the NFT into this auction (clear any listing)
      await run(d,
        `UPDATE nfts SET auction_id=?, listed_price_hny=NULL, listed_at=NULL WHERE id=?`,
        [auctionId, nft_id]
      );
    });

    return res.json({ success: true, auction_id: auctionId, nft_id, reserve_price_hny: reserve, ends_at: `+${hours}h from now` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /nft/auction/bid
// Body: { auction_id, bidder_wallet, bid_hny, signatureHex, timestamp }
router.post("/auction/bid", async (req, res) => {
  try {
    const { auction_id, bidder_wallet, bid_hny, signatureHex, timestamp } = req.body;
    if (!auction_id || !bidder_wallet || !bid_hny || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const bid = Number(bid_hny);
    if (!Number.isFinite(bid) || bid <= 0) return res.status(400).json({ error: "Invalid bid amount" });

    const [auction, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT * FROM nft_auctions WHERE id=?`, [auction_id]),
      get(d, `SELECT mldsa_public_key, balance FROM accounts WHERE wallet=?`, [bidder_wallet]),
    ]));

    if (!auction) return res.status(404).json({ error: "Auction not found" });
    if (auction.settled) return res.status(400).json({ error: "Auction already settled" });
    if (auction.seller_wallet === bidder_wallet) return res.status(400).json({ error: "Cannot bid on your own auction" });

    // Check auction not expired
    const now = new Date();
    const endsAt = new Date(auction.ends_at);
    if (now > endsAt) return res.status(400).json({ error: "Auction has ended" });

    // Check bid meets reserve + increment
    const minBid = auction.current_bid_hny
      ? Number(auction.current_bid_hny) + Number(auction.min_increment_hny)
      : Math.max(Number(auction.reserve_price_hny), 0.01);
    if (bid < minBid) {
      return res.status(400).json({ error: `Bid must be at least ${minBid.toFixed(2)} HNY`, minBid });
    }
    if (!acct || Number(acct.balance) < bid) {
      return res.status(400).json({ error: "Insufficient HNY balance" });
    }

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct.mldsa_public_key,
      message: nftMessage("auction_bid", bidder_wallet, auction_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(async d => {
      // Refund previous bidder
      if (auction.current_bidder && auction.current_bid_hny) {
        await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`,
          [Number(auction.current_bid_hny), auction.current_bidder]);
        await run(d, `UPDATE nft_bids SET refunded=1 WHERE auction_id=? AND bidder_wallet=? AND refunded=0`,
          [auction_id, auction.current_bidder]);
      }
      // Deduct new bid from bidder
      await run(d, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [bid, bidder_wallet]);
      // Record bid
      await run(d, `INSERT INTO nft_bids (auction_id, bidder_wallet, bid_hny) VALUES (?, ?, ?)`,
        [auction_id, bidder_wallet, bid]);
      // Update auction
      await run(d, `UPDATE nft_auctions SET current_bid_hny=?, current_bidder=? WHERE id=?`,
        [bid, bidder_wallet, auction_id]);
    });

    return res.json({ success: true, auction_id, bid_hny: bid, new_leader: bidder_wallet });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/auction/active — all active auctions
router.get("/auction/active", async (req, res) => {
  try {
    const rows = await withDb(d => all(d,
      `SELECT a.*, n.name, n.media_type, n.creator_wallet, n.royalty_bps,
              (SELECT COUNT(*) FROM nft_files f WHERE f.nft_id=a.nft_id) AS file_count
         FROM nft_auctions a
         JOIN nfts n ON n.id = a.nft_id
        WHERE a.settled=0 AND a.ends_at > datetime('now')
        ORDER BY a.ends_at ASC`,
      []
    ));
    return res.json({ success: true, auctions: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/auction/:id — single auction status + bid history
router.get("/auction/:id", async (req, res) => {
  try {
    const auctionId = req.params.id;
    const [auction, bids] = await withDb(async d => Promise.all([
      get(d, `SELECT a.*, n.name, n.media_type FROM nft_auctions a JOIN nfts n ON n.id=a.nft_id WHERE a.id=?`, [auctionId]),
      all(d, `SELECT bidder_wallet, bid_hny, bid_at, refunded FROM nft_bids WHERE auction_id=? ORDER BY bid_at DESC`, [auctionId]),
    ]));
    if (!auction) return res.status(404).json({ error: "Auction not found" });
    return res.json({ success: true, auction, bids });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ── Phase 7B: Offers ─────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// POST /nft/offer/make
// Body: { nft_id, buyer_wallet, offer_hny, expires_hours, signatureHex, timestamp }
router.post("/offer/make", async (req, res) => {
  try {
    const { nft_id, buyer_wallet, offer_hny, expires_hours, signatureHex, timestamp } = req.body;
    if (!nft_id || !buyer_wallet || !offer_hny || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const amount  = Number(offer_hny);
    const expHrs  = Math.min(168, Math.max(1, Number(expires_hours || 48)));
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid offer amount" });

    const [nft, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT owner_wallet, auction_id FROM nfts WHERE id=?`, [nft_id]),
      get(d, `SELECT mldsa_public_key, balance FROM accounts WHERE wallet=?`, [buyer_wallet]),
    ]));

    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner_wallet === buyer_wallet) return res.status(400).json({ error: "Cannot offer on your own NFT" });
    if (nft.auction_id)  return res.status(400).json({ error: "NFT is in auction — bid instead" });
    if (!acct || Number(acct.balance) < amount) return res.status(400).json({ error: "Insufficient HNY balance" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct.mldsa_public_key,
      message: nftMessage("offer_make", buyer_wallet, nft_id, timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(async d => {
      // Lock HNY in escrow (deduct from buyer)
      await run(d, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [amount, buyer_wallet]);
      await run(d,
        `INSERT INTO nft_offers (nft_id, buyer_wallet, offer_hny, expires_at)
         VALUES (?, ?, ?, datetime('now', ?))`,
        [nft_id, buyer_wallet, amount, `+${expHrs} hours`]
      );
    });

    return res.json({ success: true, nft_id, buyer_wallet, offer_hny: amount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /nft/offer/accept
// Body: { offer_id, wallet, signatureHex, timestamp }
router.post("/offer/accept", async (req, res) => {
  try {
    const { offer_id, wallet, signatureHex, timestamp } = req.body;
    if (!offer_id || !wallet || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const [offer, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT o.*, n.owner_wallet, n.creator_wallet, n.royalty_bps
                FROM nft_offers o JOIN nfts n ON n.id=o.nft_id WHERE o.id=?`, [offer_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.owner_wallet !== wallet) return res.status(403).json({ error: "Not the NFT owner" });
    if (offer.accepted || offer.cancelled) return res.status(400).json({ error: "Offer already resolved" });
    if (new Date() > new Date(offer.expires_at)) return res.status(400).json({ error: "Offer has expired" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("offer_accept", wallet, String(offer_id), timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    const price      = Number(offer.offer_hny);
    const royaltyBps = Number(offer.royalty_bps || 0);
    const royalty    = Number((price * royaltyBps / 10000).toFixed(8));
    const sellerGets = Number((price - royalty).toFixed(8));

    await withDb(async d => {
      // HNY was already locked; pay seller
      await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [sellerGets, wallet]);
      if (royalty > 0 && offer.creator_wallet !== wallet) {
        await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [royalty, offer.creator_wallet]);
      }
      // Transfer NFT
      await run(d,
        `UPDATE nfts SET owner_wallet=?, listed_price_hny=NULL, listed_at=NULL,
                transfer_count = transfer_count + 1 WHERE id=?`,
        [offer.buyer_wallet, offer.nft_id]
      );
      // Mark offer accepted, cancel others
      await run(d, `UPDATE nft_offers SET accepted=1 WHERE id=?`, [offer_id]);
      await run(d,
        `UPDATE nft_offers SET cancelled=1 WHERE nft_id=? AND id!=? AND accepted=0 AND cancelled=0`,
        [offer.nft_id, offer_id]
      );
      // Refund other (cancelled) offers — HNY was locked from each buyer
      const cancelled = await all(d,
        `SELECT buyer_wallet, offer_hny FROM nft_offers
          WHERE nft_id=? AND id!=? AND cancelled=1 AND accepted=0`,
        [offer.nft_id, offer_id]
      );
      for (const o of cancelled) {
        await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [o.offer_hny, o.buyer_wallet]);
      }
    });

    return res.json({ success: true, offer_id, nft_id: offer.nft_id, buyer: offer.buyer_wallet, seller: wallet, price });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /nft/offer/cancel
// Body: { offer_id, wallet, signatureHex, timestamp }
router.post("/offer/cancel", async (req, res) => {
  try {
    const { offer_id, wallet, signatureHex, timestamp } = req.body;
    if (!offer_id || !wallet || !signatureHex) return res.status(400).json({ error: "Missing fields" });

    const [offer, acct] = await withDb(async d => Promise.all([
      get(d, `SELECT * FROM nft_offers WHERE id=?`, [offer_id]),
      get(d, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]),
    ]));

    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.buyer_wallet !== wallet) return res.status(403).json({ error: "Not your offer" });
    if (offer.accepted || offer.cancelled) return res.status(400).json({ error: "Offer already resolved" });

    const sigOk = await verifyMLDSASignature({
      mldsaPubKeyHex: acct?.mldsa_public_key,
      message: nftMessage("offer_cancel", wallet, String(offer_id), timestamp),
      signatureHex,
    });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await withDb(async d => {
      // Refund locked HNY
      await run(d, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [offer.offer_hny, wallet]);
      await run(d, `UPDATE nft_offers SET cancelled=1 WHERE id=?`, [offer_id]);
    });

    return res.json({ success: true, offer_id, refunded_hny: offer.offer_hny });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/offers/:nft_id — all active offers on an NFT
router.get("/offers/:nft_id", async (req, res) => {
  try {
    const offers = await withDb(d => all(d,
      `SELECT id, buyer_wallet, offer_hny, expires_at, created_at
         FROM nft_offers
        WHERE nft_id=? AND accepted=0 AND cancelled=0 AND expires_at > datetime('now')
        ORDER BY offer_hny DESC`,
      [req.params.nft_id]
    ));
    return res.json({ success: true, offers });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /nft/my-offers/:wallet — offers made by a wallet
router.get("/my-offers/:wallet", async (req, res) => {
  try {
    const offers = await withDb(d => all(d,
      `SELECT o.id, o.nft_id, n.name, n.media_type, o.offer_hny, o.expires_at,
              o.accepted, o.cancelled, o.created_at
         FROM nft_offers o JOIN nfts n ON n.id=o.nft_id
        WHERE o.buyer_wallet=?
        ORDER BY o.created_at DESC LIMIT 50`,
      [req.params.wallet]
    ));
    return res.json({ success: true, offers });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = { router, NFT_MEDIA_DIR };
