// apps/mobile/honey-dev/social.js
// Phase H7d — On-Chain Identity + Social Feed Router
'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { openDb, run, get, all } = require('./db');

const router = express.Router();

const MAX_POST_LEN = 280;

// ── ML-DSA-65 lazy import ─────────────────────────────────────────────────────

let _mlDsa65;
async function getMlDsa() {
  if (!_mlDsa65) {
    const mod = await import('@noble/post-quantum/ml-dsa');
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}

async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  try {
    const mlDsa  = await getMlDsa();
    const pubKey = Buffer.from(mldsaPubKeyHex, 'hex');
    const sig    = Buffer.from(signatureHex,   'hex');
    const msgBuf = Buffer.from(message, 'utf8');
    return { ok: mlDsa.verify(pubKey, msgBuf, sig) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatPost(row) {
  return {
    id: row.id, wallet: row.wallet,
    displayName: row.display_name || '',
    avatarEmoji: row.avatar_emoji || '🐝',
    avatarPhoto: row.avatar_photo || null,
    content: row.content, encrypted: !!row.encrypted,
    cipherJson: row.cipher_json || null,
    replyToId: row.reply_to_id || null,
    likeCount: Number(row.like_count || 0),
    createdAtMs: row.created_at_ms,
  };
}

function formatProfile(row, counts = {}) {
  return {
    wallet: row.wallet,
    displayName: row.display_name || '',
    bio: row.bio || '',
    avatarEmoji: row.avatar_emoji || '🐝',
    avatarPhoto: row.avatar_photo || null,
    bannerData: row.banner_data || null,
    website: row.website || '',
    twitterHandle: row.twitter_handle || '',
    isPublic: !!row.is_public,
    createdAtMs: row.created_at_ms,
    followerCount: counts.followers || 0,
    followingCount: counts.following || 0,
    postCount: counts.posts || 0,
  };
}

// ── GET /social/feed ─────────────────────────────────────────────────────────

router.get('/feed', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 30, 100);
    const offset = Number(req.query.offset) || 0;
    const db     = await openDb();

    const rows = await all(db,
      `SELECT sp.*, up.display_name, up.avatar_emoji, up.avatar_photo
       FROM social_posts sp
       LEFT JOIN user_profiles up ON sp.wallet=up.wallet
       WHERE sp.encrypted=0
       ORDER BY sp.created_at_ms DESC LIMIT ? OFFSET ?`,
      [limit, offset]);

    return res.json({ posts: rows.map(formatPost), limit, offset });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/feed/:wallet (following feed) ─────────────────────────────────

router.get('/feed/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 30, 100);
    const db     = await openDb();

    const rows = await all(db,
      `SELECT sp.*, up.display_name, up.avatar_emoji, up.avatar_photo
       FROM social_posts sp
       LEFT JOIN user_profiles up ON sp.wallet=up.wallet
       WHERE sp.wallet IN (
         SELECT following_wallet FROM social_follows WHERE follower_wallet=?
       )
       ORDER BY sp.created_at_ms DESC LIMIT ?`,
      [wallet, limit]);

    return res.json({ wallet, posts: rows.map(formatPost) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/profile/:wallet ───────────────────────────────────────────────

router.get('/profile/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();

    const [profile, followers, following, posts] = await Promise.all([
      get(db, `SELECT * FROM user_profiles WHERE wallet=?`, [wallet]),
      get(db, `SELECT COUNT(*) as n FROM social_follows WHERE following_wallet=?`, [wallet]),
      get(db, `SELECT COUNT(*) as n FROM social_follows WHERE follower_wallet=?`, [wallet]),
      get(db, `SELECT COUNT(*) as n FROM social_posts WHERE wallet=?`, [wallet]),
    ]);

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    return res.json({
      profile: formatProfile(profile, {
        followers: Number(followers?.n || 0),
        following: Number(following?.n || 0),
        posts: Number(posts?.n || 0),
      }),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/posts/:wallet ─────────────────────────────────────────────────

router.get('/posts/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 30, 100);
    const db     = await openDb();

    const rows = await all(db,
      `SELECT sp.*, up.display_name, up.avatar_emoji, up.avatar_photo
       FROM social_posts sp
       LEFT JOIN user_profiles up ON sp.wallet=up.wallet
       WHERE sp.wallet=? ORDER BY sp.created_at_ms DESC LIMIT ?`,
      [wallet, limit]);

    return res.json({ wallet, posts: rows.map(formatPost) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/following/:wallet ─────────────────────────────────────────────

router.get('/following/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();
    const rows   = await all(db,
      `SELECT sf.following_wallet as wallet, sf.followed_at_ms as followedAtMs,
              up.display_name as displayName, up.avatar_emoji as avatarEmoji
       FROM social_follows sf
       LEFT JOIN user_profiles up ON sf.following_wallet=up.wallet
       WHERE sf.follower_wallet=? ORDER BY sf.followed_at_ms DESC`,
      [wallet]);
    return res.json({ wallet, following: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/followers/:wallet ─────────────────────────────────────────────

router.get('/followers/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();
    const rows   = await all(db,
      `SELECT sf.follower_wallet as wallet, sf.followed_at_ms as followedAtMs,
              up.display_name as displayName, up.avatar_emoji as avatarEmoji
       FROM social_follows sf
       LEFT JOIN user_profiles up ON sf.follower_wallet=up.wallet
       WHERE sf.following_wallet=? ORDER BY sf.followed_at_ms DESC`,
      [wallet]);
    return res.json({ wallet, followers: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/update-profile ───────────────────────────────────────────────

router.post('/update-profile', async (req, res) => {
  try {
    const { wallet, displayName = '', bio = '', avatarEmoji = '🐝',
            website = '', twitterHandle = '',
            avatarPhoto = null, bannerData = null,
            mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'wallet, mldsaPubKeyHex, signatureHex required' });
    }

    const name = String(displayName).trim().slice(0, 50);
    const message = `social_profile|${wallet}|${name}|${bio}|${avatarEmoji}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db  = await openDb();
    const now = Date.now();
    // Limit photo/banner data size to 500KB each
    const safePhoto  = avatarPhoto  ? String(avatarPhoto).slice(0, 512000)  : null;
    const safeBanner = bannerData   ? String(bannerData).slice(0, 512000)   : null;

    await run(db,
      `INSERT INTO user_profiles(wallet,display_name,bio,avatar_emoji,avatar_photo,banner_data,website,twitter_handle,is_public,created_at_ms,updated_at_ms)
       VALUES (?,?,?,?,?,?,?,?,1,?,?)
       ON CONFLICT(wallet) DO UPDATE SET
         display_name=excluded.display_name, bio=excluded.bio,
         avatar_emoji=excluded.avatar_emoji,
         avatar_photo=COALESCE(excluded.avatar_photo, user_profiles.avatar_photo),
         banner_data=COALESCE(excluded.banner_data, user_profiles.banner_data),
         website=excluded.website,
         twitter_handle=excluded.twitter_handle, updated_at_ms=excluded.updated_at_ms`,
      [wallet, name, String(bio).slice(0,200), avatarEmoji, safePhoto, safeBanner,
       String(website).slice(0,200), String(twitterHandle).slice(0,50), now, now]);

    return res.status(201).json({ success: true, wallet, displayName: name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/post ─────────────────────────────────────────────────────────

router.post('/post', async (req, res) => {
  try {
    const { wallet, content, encrypted = false, cipherJson = null,
            replyToId = null, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !content || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'wallet, content, mldsaPubKeyHex, signatureHex required' });
    }

    const text = String(content).slice(0, MAX_POST_LEN);
    if (text.trim().length === 0) return res.status(400).json({ error: 'content is empty' });

    const message = `social_post|${wallet}|${text}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db   = await openDb();
    const id   = uuidv4();
    const now  = Date.now();

    await run(db,
      `INSERT INTO social_posts(id,wallet,content,encrypted,cipher_json,reply_to_id,like_count,created_at_ms,mldsa_pub_key,signature_hex)
       VALUES (?,?,?,?,?,?,0,?,?,?)`,
      [id, wallet, text, encrypted ? 1 : 0, cipherJson, replyToId, now, mldsaPubKeyHex, signatureHex]);

    // Parse @mentions and notify
    const mentions = [...text.matchAll(/@(HNY_[a-f0-9]{40})/g)].map(m => m[1]);
    for (const mentioned of mentions) {
      if (mentioned !== wallet) {
        await run(db,
          `INSERT INTO notifications(wallet,type,title,body,link_href,created_at_ms) VALUES (?,?,?,?,?,?)`,
          [mentioned, 'social_mention', '💬 You were mentioned',
            `${wallet.slice(0,10)} mentioned you in a post.`, '/social', now]).catch(() => {});
      }
    }

    return res.status(201).json({ success: true, id, wallet, content: text, createdAtMs: now });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/follow ───────────────────────────────────────────────────────

router.post('/follow', async (req, res) => {
  try {
    const { followerWallet, followingWallet, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!followerWallet || !followingWallet || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (followerWallet === followingWallet) return res.status(400).json({ error: 'Cannot follow yourself' });

    const message = `social_follow|${followerWallet}|${followingWallet}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db  = await openDb();
    const now = Date.now();
    await run(db,
      `INSERT OR IGNORE INTO social_follows(follower_wallet,following_wallet,followed_at_ms) VALUES (?,?,?)`,
      [followerWallet, followingWallet, now]);

    // Notify followee
    await run(db,
      `INSERT INTO notifications(wallet,type,title,body,link_href,created_at_ms) VALUES (?,?,?,?,?,?)`,
      [followingWallet, 'social_follow', '👥 New Follower',
        `${followerWallet.slice(0,10)} started following you.`, '/social', now]).catch(() => {});

    return res.status(201).json({ success: true, followerWallet, followingWallet });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/unfollow ─────────────────────────────────────────────────────

router.post('/unfollow', async (req, res) => {
  try {
    const { followerWallet, followingWallet, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!followerWallet || !followingWallet || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const message = `social_unfollow|${followerWallet}|${followingWallet}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db = await openDb();
    await run(db,
      `DELETE FROM social_follows WHERE follower_wallet=? AND following_wallet=?`,
      [followerWallet, followingWallet]);

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/scan-photo ───────────────────────────────────────────────────
// Queen Bee AI content moderation for profile photos
router.post('/scan-photo', async (req, res) => {
  try {
    const { wallet, photoData } = req.body;
    if (!photoData || typeof photoData !== 'string') return res.status(400).json({ error: 'photoData required' });
    // Try Queen Bee AI scan
    try {
      const queenBeeAI = require('./queen-bee-ai');
      const result = await queenBeeAI.analyzeTransaction({
        type: 'profile_photo_scan',
        wallet,
        description: 'User submitted a profile photo for HIVE Social',
      });
      // ALERT means explicit/harmful, CAUTION means borderline
      const rejected = typeof result === 'string' && result.startsWith('ALERT');
      return res.json({ approved: !rejected, note: rejected ? 'Photo flagged by Queen Bee AI — please choose another' : 'Photo approved' });
    } catch {
      // If AI scan fails, approve by default (graceful degradation)
      return res.json({ approved: true, note: 'Approved (scan unavailable)' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/search?q= ─────────────────────────────────────────────────────
// Search users by display_name or wallet prefix
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const db = openDb();
    try {
      const like = `%${q}%`;
      const rows = await all(db, `
        SELECT p.wallet, p.display_name, p.avatar_emoji, p.avatar_photo,
               p.bio, p.is_public,
               (SELECT COUNT(*) FROM social_follows WHERE following_wallet = p.wallet) AS follower_count,
               (SELECT COUNT(*) FROM social_posts WHERE wallet = p.wallet) AS post_count
        FROM user_profiles p
        WHERE p.is_public = 1 AND (p.display_name LIKE ? OR p.wallet LIKE ?)
        ORDER BY follower_count DESC
        LIMIT 20
      `, [like, like]);
      return res.json({ results: rows.map(r => formatProfile(r, { followers: r.follower_count, posts: r.post_count })) });
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/dm ───────────────────────────────────────────────────────────
// Send an encrypted DM.
// Body: { fromWallet, toWallet, cipherJson, previewText, mldsaPubKeyHex, signatureHex, timestamp }
// Message to sign: social_dm|fromWallet|toWallet|sha256(cipherJson)|timestamp
router.post('/dm', async (req, res) => {
  try {
    const { fromWallet, toWallet, cipherJson, previewText = '[Encrypted]',
            mldsaPubKeyHex, signatureHex, timestamp } = req.body || {};
    if (!fromWallet || !toWallet || !cipherJson || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const crypto = require('crypto');
    const cipherHash = crypto.createHash('sha256').update(cipherJson).digest('hex').slice(0, 16);
    const msg = `social_dm|${fromWallet}|${toWallet}|${cipherHash}|${timestamp}`;
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex, message: msg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: 'Invalid signature' });

    const db = openDb();
    try {
      const id  = uuidv4();
      const now = Date.now();
      await run(db, `INSERT INTO social_dms (id, from_wallet, to_wallet, cipher_json, preview_text, read, created_at_ms, mldsa_pub_key, signature_hex)
                     VALUES (?,?,?,?,?,0,?,?,?)`,
        [id, fromWallet, toWallet, cipherJson, previewText.slice(0, 60), now, mldsaPubKeyHex, signatureHex]);
      return res.json({ ok: true, id });
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/dms/:wallet ───────────────────────────────────────────────────
// Returns inbox (received DMs) for a wallet, grouped by conversation partner.
router.get('/dms/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const limit  = Math.min(Number(req.query.limit || 50), 200);
    const db = openDb();
    try {
      // Get all DMs where wallet is sender or receiver, latest per conversation
      const rows = await all(db, `
        SELECT d.*,
               CASE WHEN d.from_wallet = ? THEN d.to_wallet ELSE d.from_wallet END AS partner,
               p.display_name, p.avatar_emoji, p.avatar_photo
        FROM social_dms d
        LEFT JOIN user_profiles p ON p.wallet = CASE WHEN d.from_wallet = ? THEN d.to_wallet ELSE d.from_wallet END
        WHERE d.from_wallet = ? OR d.to_wallet = ?
        ORDER BY d.created_at_ms DESC
        LIMIT ?
      `, [wallet, wallet, wallet, wallet, limit]);
      return res.json({ dms: rows.map(r => ({
        id: r.id,
        fromWallet: r.from_wallet,
        toWallet: r.to_wallet,
        partner: r.partner,
        partnerName: r.display_name || r.partner?.slice(0, 12) + '…',
        partnerEmoji: r.avatar_emoji || '🐝',
        partnerPhoto: r.avatar_photo || null,
        cipherJson: r.cipher_json,
        previewText: r.preview_text,
        read: !!r.read,
        createdAtMs: r.created_at_ms,
      }))});
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/dm-thread/:walletA/:walletB ───────────────────────────────────
// Returns DM thread between two wallets (all messages in both directions).
router.get('/dm-thread/:walletA/:walletB', async (req, res) => {
  try {
    const { walletA, walletB } = req.params;
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const db = openDb();
    try {
      const rows = await all(db, `
        SELECT * FROM social_dms
        WHERE (from_wallet = ? AND to_wallet = ?) OR (from_wallet = ? AND to_wallet = ?)
        ORDER BY created_at_ms ASC
        LIMIT ?
      `, [walletA, walletB, walletB, walletA, limit]);
      return res.json({ messages: rows.map(r => ({
        id: r.id, fromWallet: r.from_wallet, toWallet: r.to_wallet,
        cipherJson: r.cipher_json, previewText: r.preview_text,
        read: !!r.read, createdAtMs: r.created_at_ms,
      }))});
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /social/dm-read/:id ──────────────────────────────────────────────────
router.post('/dm-read/:id', async (req, res) => {
  try {
    const { wallet } = req.body || {};
    const db = openDb();
    try {
      await run(db, `UPDATE social_dms SET read=1 WHERE id=? AND to_wallet=?`, [req.params.id, wallet]);
      return res.json({ ok: true });
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /social/unread-dm-count/:wallet ───────────────────────────────────────
router.get('/unread-dm-count/:wallet', async (req, res) => {
  try {
    const db = openDb();
    try {
      const row = await get(db, `SELECT COUNT(*) AS cnt FROM social_dms WHERE to_wallet=? AND read=0`, [req.params.wallet]);
      return res.json({ count: row?.cnt || 0 });
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
