// apps/mobile/honey-dev/auth.js
// Platform Account Auth — email/phone registration with custodial HNY wallet.
// Every account gets a server-side ML-DSA-65 keypair. The private key is
// encrypted with PBKDF2+AES-256-GCM using the user's password, then stored.
// Sessions are token-based (random 32-byte hex stored in auth_sessions).
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

// ── ML-DSA-65 lazy import ─────────────────────────────────────────────────
let _mlDsa65;
async function getMlDsa() {
  if (!_mlDsa65) {
    const mod = await import("@noble/post-quantum/ml-dsa");
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}

// ── SHA3-256 for address derivation ───────────────────────────────────────
const { sha3_256 } = require("@noble/hashes/sha3");

// ── Constants ─────────────────────────────────────────────────────────────
const SESSION_TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS   = 310_000;
const PBKDF2_KEY_LEN      = 32; // bytes → 256-bit AES key

// ── Crypto helpers ────────────────────────────────────────────────────────

/** Derive a 32-byte key from password + salt via PBKDF2-HMAC-SHA256 */
function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, "sha256");
}

/** AES-256-GCM encrypt arbitrary bytes → "iv:authTag:ciphertext" (all hex) */
function aesEncrypt(keyBuf, plainBuf) {
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const ct  = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** AES-256-GCM decrypt "iv:authTag:ciphertext" → Buffer */
function aesDecrypt(keyBuf, encrypted) {
  const [ivHex, tagHex, ctHex] = encrypted.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
}

/** bcrypt-style password hash using PBKDF2 with embedded salt */
function hashPassword(password) {
  const salt     = crypto.randomBytes(16).toString("hex");
  const derived  = deriveKey(password, salt);
  return { hash: derived.toString("hex"), salt };
}

function verifyPassword(password, storedHash, storedSalt) {
  const derived = deriveKey(password, storedSalt);
  return crypto.timingSafeEqual(derived, Buffer.from(storedHash, "hex"));
}

/** Derive a HNY_ address from an ML-DSA-65 public key */
function pubKeyToAddress(pubKeyBytes) {
  const hash = sha3_256(pubKeyBytes);
  return `HNY_${Buffer.from(hash).toString("hex").slice(0, 40)}`;
}

/**
 * Generate a 128-bit recovery phrase formatted as 8 groups of 4 hex chars.
 * e.g. "a1b2-c3d4-e5f6-a7b8-c9d0-e1f2-a3b4-c5d6"
 */
function generateBackupPhrase() {
  const entropy = crypto.randomBytes(16);
  const hex = entropy.toString("hex"); // 32 hex chars
  return hex.match(/.{4}/g).join("-"); // 8 groups × 4 chars
}

/** Generate a new ML-DSA-65 keypair + encrypted private key + backup phrase */
async function generateCustodialKeypair(password) {
  const mlDsa = await getMlDsa();

  // Generate backup phrase and derive master seed from it
  const backupPhrase = generateBackupPhrase();
  const seedHex      = backupPhrase.replace(/-/g, "");
  // Expand 16-byte entropy to 32-byte master seed via PBKDF2
  const masterSeed   = crypto.pbkdf2Sync(Buffer.from(seedHex, "hex"), "HIVE_NETWORK_SEED_v1", 100_000, 32, "sha256");
  // Derive ML-DSA-65 keypair deterministically from master seed
  const kp = mlDsa.keygen(masterSeed);

  const address        = pubKeyToAddress(kp.publicKey);
  const mldsaPubKeyHex = Buffer.from(kp.publicKey).toString("hex");

  // Encrypt secret key with user password
  const salt       = crypto.randomBytes(16).toString("hex");
  const aesKey     = deriveKey(password, salt);
  const encPrivKey = aesEncrypt(aesKey, Buffer.from(kp.secretKey));

  // Encrypt backup phrase with user password for later export
  const encBackup  = aesEncrypt(aesKey, Buffer.from(backupPhrase, "utf8"));

  return { address, mldsaPubKeyHex, encPrivKey, encBackup, salt, backupPhrase };
}

/** Sign a message on behalf of an auth user (server-side signing) */
async function signForUser(encPrivKey, encSalt, password, message) {
  const mlDsa  = await getMlDsa();
  const aesKey = deriveKey(password, encSalt);
  const privKeyBuf = aesDecrypt(aesKey, encPrivKey);
  const msgBuf = Buffer.from(message, "utf8");
  const sig = mlDsa.sign(privKeyBuf, msgBuf);
  return Buffer.from(sig).toString("hex");
}

/**
 * Derive a session-specific AES key from the token.
 * This allows signing without re-entering password.
 */
function sessionAesKey(token) {
  return crypto.createHash('sha256').update(token).digest();
}

/** Issue a new session token; stores a session-encrypted copy of the private key */
async function createSession(db, userId, wallet, encPrivKey, keySalt, password) {
  const token      = crypto.randomBytes(32).toString("hex");
  const now        = Date.now();
  const expiresAt  = now + SESSION_TTL_MS;

  let sessionPrivKey = null;
  if (encPrivKey && keySalt && password) {
    try {
      // Decrypt private key with user password, then re-encrypt with session key
      const aesKey     = deriveKey(password, keySalt);
      const privKeyBuf = aesDecrypt(aesKey, encPrivKey);
      sessionPrivKey   = aesEncrypt(sessionAesKey(token), privKeyBuf);
    } catch { /* non-fatal */ }
  }

  await run(db,
    `INSERT INTO auth_sessions (token, user_id, wallet, session_priv_key, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?,?)`,
    [token, userId, wallet, sessionPrivKey, now, expiresAt]
  );
  return token;
}

/** Validate a session token → { userId, wallet } or null */
async function validateSession(db, token) {
  if (!token) return null;
  const row = await get(db,
    `SELECT user_id, wallet, expires_at_ms FROM auth_sessions WHERE token=?`,
    [token]
  );
  if (!row || row.expires_at_ms < Date.now()) return null;
  return { userId: row.user_id, wallet: row.wallet };
}

// ── Validation helpers ────────────────────────────────────────────────────

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidPhone(p) {
  return typeof p === "string" && /^\+?[0-9]{7,15}$/.test(p.replace(/[\s\-().]/g, ""));
}

function normalisePhone(p) {
  return p.replace(/[\s\-().]/g, "");
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /auth/register
 * Body: { email?, phone?, password, displayName? }
 * Response: { ok, token, wallet, userId }
 */
router.post("/register", async (req, res) => {
  try {
    const { email, phone, password, displayName = "" } = req.body || {};

    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone number is required" });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    const normEmail = email ? email.toLowerCase().trim() : null;
    const normPhone = phone ? normalisePhone(phone) : null;

    const db = openDb();
    try {
      // Check uniqueness
      if (normEmail) {
        const existing = await get(db, `SELECT id FROM auth_users WHERE email=?`, [normEmail]);
        if (existing) return res.status(409).json({ error: "Email already registered" });
      }
      if (normPhone) {
        const existing = await get(db, `SELECT id FROM auth_users WHERE phone=?`, [normPhone]);
        if (existing) return res.status(409).json({ error: "Phone number already registered" });
      }

      // Generate custodial wallet + backup phrase
      const { address, mldsaPubKeyHex, encPrivKey, encBackup, salt: keySalt, backupPhrase } = await generateCustodialKeypair(password);

      // Hash password
      const { hash: passHash, salt: passSalt } = hashPassword(password);

      const userId  = crypto.randomUUID();
      const nowMs   = Date.now();

      // Combined salt: passSalt|keySalt  (both stored together in `salt` column)
      const combinedSalt = `${passSalt}|${keySalt}`;

      await run(db, `INSERT INTO accounts (wallet, balance, nonce, lastMintMs, createdAtMs, mldsa_public_key)
                     VALUES (?,0,0,0,?,?)`,
        [address, nowMs, mldsaPubKeyHex]
      );

      await run(db,
        `INSERT INTO auth_users
           (id, email, phone, password_hash, salt, hny_wallet, mldsa_pub_key, encrypted_priv_key, encrypted_backup, display_name, created_at_ms, updated_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [userId, normEmail, normPhone, passHash, combinedSalt, address, mldsaPubKeyHex, encPrivKey, encBackup, displayName, nowMs, nowMs]
      );

      // Auto-register Chrysalis (server calls /chrysalis/register on behalf of user)
      try {
        const mlDsa = await getMlDsa();
        const [passSaltPart, keySaltPart] = combinedSalt.split("|");
        const aesKey = deriveKey(password, keySaltPart);
        const privKeyBuf = aesDecrypt(aesKey, encPrivKey);
        const regMsg = `chrysalis_register:${address}`;
        const regSig = Buffer.from(mlDsa.sign(privKeyBuf, Buffer.from(regMsg, "utf8"))).toString("hex");

        const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
        fetch(`${BASE_URL}/chrysalis/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, mldsaPubKeyHex, kemPubKeyHex: mldsaPubKeyHex, signatureHex: regSig }),
        })
          .then(() => run(db, `UPDATE auth_users SET chrysalis_registered=1 WHERE id=?`, [userId]))
          .catch(() => {}); // non-fatal
      } catch { /* skip if ML-DSA unavailable */ }

      // Mint starting balance via internal transfer
      try {
        await run(db, `UPDATE accounts SET balance = balance + 100 WHERE wallet=?`, [address]);
      } catch { /* non-fatal */ }

      const token = await createSession(db, userId, address, encPrivKey, keySalt, password);

      return res.json({ ok: true, token, wallet: address, userId, displayName, backupPhrase });
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[auth/register]", e);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /auth/login
 * Body: { email?, phone?, password }
 * Response: { ok, token, wallet, userId, displayName }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, phone, password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Password required" });

    const db = openDb();
    try {
      let user;
      if (email) {
        user = await get(db, `SELECT * FROM auth_users WHERE email=?`, [email.toLowerCase().trim()]);
      } else if (phone) {
        user = await get(db, `SELECT * FROM auth_users WHERE phone=?`, [normalisePhone(phone)]);
      } else {
        return res.status(400).json({ error: "Email or phone required" });
      }

      if (!user) return res.status(401).json({ error: "Invalid credentials" });

      const [passSalt, keySalt] = user.salt.split("|");
      if (!verifyPassword(password, user.password_hash, passSalt)) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = await createSession(db, user.id, user.hny_wallet, user.encrypted_priv_key, keySalt, password);
      return res.json({
        ok: true, token,
        wallet: user.hny_wallet,
        userId: user.id,
        displayName: user.display_name,
        chrysalisRegistered: !!user.chrysalis_registered,
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[auth/login]", e);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * GET /auth/me
 * Header: Authorization: Bearer <token>
 * Response: { ok, wallet, userId, displayName, chrysalisRegistered }
 */
router.get("/me", async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const db = openDb();
    try {
      const session = await validateSession(db, token);
      if (!session) return res.status(401).json({ error: "Not authenticated" });

      const user = await get(db, `SELECT * FROM auth_users WHERE id=?`, [session.userId]);
      if (!user) return res.status(401).json({ error: "User not found" });

      return res.json({
        ok: true,
        wallet: user.hny_wallet,
        userId: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
        chrysalisRegistered: !!user.chrysalis_registered,
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[auth/me]", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <token>
 */
router.post("/logout", async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.json({ ok: true });
    const db = openDb();
    try {
      await run(db, `DELETE FROM auth_sessions WHERE token=?`, [token]);
      return res.json({ ok: true });
    } finally {
      db.close();
    }
  } catch {
    res.json({ ok: true });
  }
});

/**
 * POST /auth/sign-tx
 * Header: Authorization: Bearer <token>
 * Body: { message }
 * Uses session key (no password needed after login).
 * Response: { ok, signatureHex, mldsaPubKeyHex, wallet }
 */
router.post("/sign-tx", async (req, res) => {
  try {
    const token   = (req.headers.authorization || "").replace("Bearer ", "");
    const { message } = req.body || {};
    if (!token || !message) {
      return res.status(400).json({ error: "Authorization header and message required" });
    }
    const db = openDb();
    try {
      const session = await get(db,
        `SELECT s.*, u.mldsa_pub_key, u.hny_wallet
         FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
         WHERE s.token=? AND s.expires_at_ms > ?`,
        [token, Date.now()]
      );
      if (!session) return res.status(401).json({ error: "Not authenticated" });
      if (!session.session_priv_key) {
        return res.status(401).json({ error: "Session signing key not available. Please log in again." });
      }

      const mlDsa  = await getMlDsa();
      const sessKey = sessionAesKey(token);
      const privKeyBuf = aesDecrypt(sessKey, session.session_priv_key);
      const sig = mlDsa.sign(privKeyBuf, Buffer.from(message, "utf8"));

      return res.json({
        ok: true,
        signatureHex: Buffer.from(sig).toString("hex"),
        mldsaPubKeyHex: session.mldsa_pub_key,
        wallet: session.hny_wallet,
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[auth/sign-tx]", e);
    res.status(500).json({ error: "Signing failed" });
  }
});

/**
 * POST /auth/reveal-backup
 * Header: Authorization: Bearer <token>
 * Body: { password }
 * Verifies the user's password, then decrypts and returns the backup phrase.
 * Response: { ok, backupPhrase }
 */
router.post("/reveal-backup", async (req, res) => {
  try {
    const token    = (req.headers.authorization || "").replace("Bearer ", "");
    const { password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Authorization header and password required" });
    }
    const db = openDb();
    try {
      const session = await validateSession(db, token);
      if (!session) return res.status(401).json({ error: "Not authenticated" });

      const user = await get(db,
        `SELECT password_hash, salt, encrypted_backup FROM auth_users WHERE id=?`,
        [session.userId]
      );
      if (!user) return res.status(401).json({ error: "User not found" });

      const [passSalt, keySalt] = user.salt.split("|");
      if (!verifyPassword(password, user.password_hash, passSalt)) {
        return res.status(401).json({ error: "Incorrect password" });
      }

      const aesKey = deriveKey(password, keySalt);

      let backupPhrase;
      if (!user.encrypted_backup) {
        // Pre-migration account: encrypted_backup was not stored. Generate a deterministic
        // recovery code from the private key (sha3-256 of secret key → 16 bytes → hex groups).
        // This serves as a unique account recovery token (not a seed phrase).
        try {
          const privKeyBuf = aesDecrypt(aesKey, user.encrypted_priv_key);
          const entropy = Buffer.from(sha3_256(privKeyBuf)).slice(0, 16);
          backupPhrase = entropy.toString("hex").match(/.{4}/g).join("-") + " (recovery-token)";
          // Store for next time so we always return the same code
          const encBackup = aesEncrypt(aesKey, Buffer.from(backupPhrase, "utf8"));
          await run(db, `UPDATE auth_users SET encrypted_backup=? WHERE id=?`, [encBackup, session.userId]);
        } catch {
          return res.status(404).json({ error: "No backup phrase stored for this account. Please reset your password to generate one." });
        }
      } else {
        const backupBuf  = aesDecrypt(aesKey, user.encrypted_backup);
        backupPhrase = backupBuf.toString("utf8");
      }

      return res.json({ ok: true, backupPhrase });
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[auth/reveal-backup]", e);
    res.status(500).json({ error: "Failed to reveal backup phrase" });
  }
});

// ── Cleanup expired sessions periodically ─────────────────────────────────
setInterval(() => {
  try {
    const db = openDb();
    run(db, `DELETE FROM auth_sessions WHERE expires_at_ms < ?`, [Date.now()])
      .catch(() => {})
      .finally(() => db.close());
  } catch { /* ignore */ }
}, 60 * 60 * 1000); // hourly

module.exports = { router, validateSession };
