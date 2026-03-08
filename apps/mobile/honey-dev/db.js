// apps/mobile/honey-dev/db.js
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.HIVE_DB_PATH
  ? path.resolve(process.env.HIVE_DB_PATH)
  : path.resolve(__dirname, "hive-wallet.sqlite");

function openDb() {
  const db = new Database(DB_PATH);
  // Better concurrency + resilience for dev/test usage.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const info = db.prepare(sql).run(params);
      resolve({ changes: info.changes, lastID: Number(info.lastInsertRowid || 0) });
    } catch (err) {
      reject(err);
    }
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const row = db.prepare(sql).get(params);
      resolve(row);
    } catch (err) {
      reject(err);
    }
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const rows = db.prepare(sql).all(params);
      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

async function tableExists(db, tableName) {
  const row = await get(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  return !!row;
}

async function columnExists(db, table, column) {
  const rows = await all(db, `PRAGMA table_info(${table});`);
  return rows.some((r) => r.name === column);
}

async function initDb(db) {
  // accounts
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS accounts (
      wallet TEXT PRIMARY KEY,
      publicKeyB64 TEXT,
      balance REAL NOT NULL DEFAULT 0,
      nonce INTEGER NOT NULL DEFAULT 0,
      lastMintMs INTEGER NOT NULL DEFAULT 0,
      createdAtMs INTEGER NOT NULL
    );`
  );

  // transactions
  const txTableExists = await tableExists(db, "transactions");

  if (!txTableExists) {
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        type TEXT NOT NULL,
        fromWallet TEXT,
        toWallet TEXT NOT NULL,
        amount REAL NOT NULL,
        nonce INTEGER NOT NULL,
        gasFee REAL NOT NULL,
        serviceFee REAL NOT NULL DEFAULT 0,
        metaJson TEXT,
        status TEXT NOT NULL,
        failReason TEXT,
        expiresAtMs INTEGER,
        blockHeight INTEGER,
        blockHash TEXT,
        timestampMs INTEGER NOT NULL
      );`
    );
  } else {
    // migrations
    if (!(await columnExists(db, "transactions", "failReason"))) {
      await run(db, `ALTER TABLE transactions ADD COLUMN failReason TEXT;`);
    }
    if (!(await columnExists(db, "transactions", "expiresAtMs"))) {
      await run(db, `ALTER TABLE transactions ADD COLUMN expiresAtMs INTEGER;`);
    }
    if (!(await columnExists(db, "transactions", "serviceFee"))) {
      await run(db, `ALTER TABLE transactions ADD COLUMN serviceFee REAL NOT NULL DEFAULT 0;`);
    }
    if (!(await columnExists(db, "transactions", "metaJson"))) {
      await run(db, `ALTER TABLE transactions ADD COLUMN metaJson TEXT;`);
    }
  }

  // staking positions
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS staking_positions (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      principal REAL NOT NULL,
      lockDays INTEGER NOT NULL,
      startMs INTEGER NOT NULL,
      unlockAtMs INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'staked',
      rewardPaid REAL NOT NULL DEFAULT 0,
      unstakedAtMs INTEGER,
      stakeTxId TEXT,
      unstakeTxId TEXT,
      createdAtMs INTEGER NOT NULL
    );`
  );

  // migrations for staking positions (unlocking / claim)
  const stakeCols = await all(db, "PRAGMA table_info(staking_positions);");
  const have = new Set((stakeCols || []).map((c) => String(c.name)));
  async function addCol(name, ddl) {
    if (have.has(name)) return;
    await run(db, `ALTER TABLE staking_positions ADD COLUMN ${ddl};`);
    have.add(name);
  }
  await addCol("unlockingAtMs", "unlockingAtMs INTEGER");
  await addCol("withdrawAtMs", "withdrawAtMs INTEGER");
  await addCol("rewardsFrozenAtMs", "rewardsFrozenAtMs INTEGER");
  await addCol("unlockTxId", "unlockTxId TEXT");
  await addCol("lastClaimTxId", "lastClaimTxId TEXT");

  await run(db, `CREATE INDEX IF NOT EXISTS idx_stake_wallet ON staking_positions(wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_stake_status ON staking_positions(status);`);

  // blocks
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS blocks (
      height INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      prevHash TEXT NOT NULL,
      timestampMs INTEGER NOT NULL,
      txCount INTEGER NOT NULL,
      txRoot TEXT NOT NULL,
      txIdsJson TEXT NOT NULL
    );`
  );

  // indexes (after migrations)
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_to ON transactions(toWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_from ON transactions(fromWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_status_ts ON transactions(status, timestampMs);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_blockHeight ON transactions(blockHeight);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_nonce_from ON transactions(fromWallet, nonce);`);

  const hasExpiresAtNow = await columnExists(db, "transactions", "expiresAtMs");
  if (hasExpiresAtNow) {
    await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_expiry ON transactions(expiresAtMs);`);
  }

  await run(db, `CREATE INDEX IF NOT EXISTS idx_blocks_ts ON blocks(timestampMs);`);

  // ========== MULTI-TOKEN SUPPORT ==========
  
  // Token registry - defines all supported tokens
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS tokens (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 8,
      isNative INTEGER NOT NULL DEFAULT 0,
      mockPriceUSD REAL NOT NULL DEFAULT 1.0,
      iconUrl TEXT,
      createdAtMs INTEGER NOT NULL
    );`
  );

  // Token balances - tracks each wallet's balance for each token
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS token_balances (
      wallet TEXT NOT NULL,
      tokenSymbol TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      createdAtMs INTEGER NOT NULL,
      PRIMARY KEY (wallet, tokenSymbol),
      FOREIGN KEY (tokenSymbol) REFERENCES tokens(symbol)
    );`
  );

  // Liquidity pools - AMM-style constant product pools
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS liquidity_pools (
      id TEXT PRIMARY KEY,
      tokenA TEXT NOT NULL,
      tokenB TEXT NOT NULL,
      reserveA REAL NOT NULL DEFAULT 0,
      reserveB REAL NOT NULL DEFAULT 0,
      totalLpShares REAL NOT NULL DEFAULT 0,
      feeRate REAL NOT NULL DEFAULT 0.001,
      createdAtMs INTEGER NOT NULL,
      FOREIGN KEY (tokenA) REFERENCES tokens(symbol),
      FOREIGN KEY (tokenB) REFERENCES tokens(symbol)
    );`
  );

  // LP positions - tracks liquidity provider shares
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS lp_positions (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      poolId TEXT NOT NULL,
      lpShares REAL NOT NULL DEFAULT 0,
      createdAtMs INTEGER NOT NULL,
      FOREIGN KEY (poolId) REFERENCES liquidity_pools(id)
    );`
  );

  // Indexes for token tables
  await run(db, `CREATE INDEX IF NOT EXISTS idx_token_balances_wallet ON token_balances(wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_token_balances_symbol ON token_balances(tokenSymbol);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_positions_wallet ON lp_positions(wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_positions_pool ON lp_positions(poolId);`);

  // Initialize default tokens if not exists
  const tokenCount = await get(db, `SELECT COUNT(*) as count FROM tokens`);
  if (!tokenCount || tokenCount.count === 0) {
    const now = Date.now();
    // Pyth price feed IDs (mainnet)
    const defaultTokens = [
      { symbol: 'HNY', name: 'Honey', decimals: 8, isNative: 1, price: 1.00, pythId: null },
      { symbol: 'stHNY', name: 'Staked Honey', decimals: 8, isNative: 0, price: 1.05, pythId: null },
      { 
        symbol: 'ETH', 
        name: 'Ethereum', 
        decimals: 8, 
        isNative: 0, 
        price: 3500.00,
        pythId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' // ETH/USD
      },
      { 
        symbol: 'BTC', 
        name: 'Bitcoin', 
        decimals: 8, 
        isNative: 0, 
        price: 65000.00,
        pythId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' // BTC/USD
      },
      { 
        symbol: 'SOL', 
        name: 'Solana', 
        decimals: 8, 
        isNative: 0, 
        price: 145.00,
        pythId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' // SOL/USD
      },
      { 
        symbol: 'USDT', 
        name: 'Tether USD', 
        decimals: 8, 
        isNative: 0, 
        price: 1.00,
        pythId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b' // USDT/USD
      },
      { 
        symbol: 'USDC', 
        name: 'USD Coin', 
        decimals: 8, 
        isNative: 0, 
        price: 1.00,
        pythId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' // USDC/USD
      },
      { 
        symbol: 'XRP', 
        name: 'Ripple', 
        decimals: 8, 
        isNative: 0, 
        price: 2.50,
        pythId: '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8' // XRP/USD
      },
    ];

    for (const token of defaultTokens) {
      await run(
        db,
        `INSERT INTO tokens (symbol, name, decimals, isNative, mockPriceUSD, iconUrl, createdAtMs)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [token.symbol, token.name, token.decimals, token.isNative, token.price, token.pythId, now]
      );
    }

    // Initialize default liquidity pools
    // Direct pools for ALL major pairs — no multi-hop needed for common trades
    // Reserves balanced at ~$10M per side using mock prices:
    // HNY=$1, ETH=$3500, BTC=$65000, SOL=$145, USDT=$1, USDC=$1, XRP=$2.50, stHNY=$1.05
    const defaultPools = [
      // HNY pairs
      { tokenA: 'HNY', tokenB: 'ETH', reserveA: 10000000, reserveB: 2857.14 },
      { tokenA: 'HNY', tokenB: 'BTC', reserveA: 10000000, reserveB: 153.85 },
      { tokenA: 'HNY', tokenB: 'SOL', reserveA: 10000000, reserveB: 68965.52 },
      { tokenA: 'HNY', tokenB: 'USDT', reserveA: 10000000, reserveB: 10000000 },
      { tokenA: 'HNY', tokenB: 'USDC', reserveA: 10000000, reserveB: 10000000 },
      { tokenA: 'HNY', tokenB: 'XRP', reserveA: 10000000, reserveB: 4000000 },
      // Cross pairs (direct pools — no multi-hop needed)
      { tokenA: 'ETH', tokenB: 'BTC', reserveA: 2857.14, reserveB: 153.85 },
      { tokenA: 'ETH', tokenB: 'SOL', reserveA: 2857.14, reserveB: 68965.52 },
      { tokenA: 'ETH', tokenB: 'USDT', reserveA: 2857.14, reserveB: 10000000 },
      { tokenA: 'ETH', tokenB: 'USDC', reserveA: 2857.14, reserveB: 10000000 },
      { tokenA: 'ETH', tokenB: 'XRP', reserveA: 2857.14, reserveB: 4000000 },
      { tokenA: 'BTC', tokenB: 'SOL', reserveA: 153.85, reserveB: 68965.52 },
      { tokenA: 'BTC', tokenB: 'USDT', reserveA: 153.85, reserveB: 10000000 },
      { tokenA: 'BTC', tokenB: 'USDC', reserveA: 153.85, reserveB: 10000000 },
      { tokenA: 'BTC', tokenB: 'XRP', reserveA: 153.85, reserveB: 4000000 },
      { tokenA: 'SOL', tokenB: 'USDT', reserveA: 68965.52, reserveB: 10000000 },
      { tokenA: 'SOL', tokenB: 'USDC', reserveA: 68965.52, reserveB: 10000000 },
      { tokenA: 'SOL', tokenB: 'XRP', reserveA: 68965.52, reserveB: 4000000 },
      { tokenA: 'USDT', tokenB: 'USDC', reserveA: 10000000, reserveB: 10000000 },
      { tokenA: 'USDT', tokenB: 'XRP', reserveA: 10000000, reserveB: 4000000 },
      { tokenA: 'USDC', tokenB: 'XRP', reserveA: 10000000, reserveB: 4000000 },
      // stHNY pairs
      { tokenA: 'stHNY', tokenB: 'HNY', reserveA: 5000000, reserveB: 5250000 },
      { tokenA: 'stHNY', tokenB: 'USDT', reserveA: 5000000, reserveB: 5250000 },
      { tokenA: 'stHNY', tokenB: 'ETH', reserveA: 5000000, reserveB: 1500 },
      { tokenA: 'stHNY', tokenB: 'BTC', reserveA: 5000000, reserveB: 80.77 },
    ];

    for (const pool of defaultPools) {
      const poolId = `${pool.tokenA}-${pool.tokenB}`;
      await run(
        db,
        `INSERT INTO liquidity_pools (id, tokenA, tokenB, reserveA, reserveB, totalLpShares, feeRate, createdAtMs)
         VALUES (?, ?, ?, ?, ?, ?, 0.001, ?)`,
        [poolId, pool.tokenA, pool.tokenB, pool.reserveA, pool.reserveB, Math.sqrt(pool.reserveA * pool.reserveB), now]
      );
    }
  }

  // Add pythPriceId column if it doesn't exist (migration)
  const tokenCols = await all(db, "PRAGMA table_info(tokens);");
  const hasIconUrl = tokenCols.some(c => c.name === 'iconUrl');
  if (hasIconUrl) {
    // iconUrl was repurposed to store pythId, rename it
    const hasPythId = tokenCols.some(c => c.name === 'pythPriceId');
    if (!hasPythId) {
      await run(db, `ALTER TABLE tokens ADD COLUMN pythPriceId TEXT`);
      // Copy iconUrl to pythPriceId for existing tokens
      await run(db, `UPDATE tokens SET pythPriceId = iconUrl WHERE iconUrl IS NOT NULL AND LENGTH(iconUrl) > 50`);
    }
  }

  // Migration: reduce pool fees from 0.3% to 0.1% for better UX
  await run(db, `UPDATE liquidity_pools SET feeRate = 0.001 WHERE feeRate >= 0.003`);

  // ── Chrysalis Security Framework migrations ───────────────────────────────
  // Adds post-quantum key storage and consent token table to the accounts layer.

  const acctCols = await all(db, "PRAGMA table_info(accounts);");
  const acctHave = new Set((acctCols || []).map(c => String(c.name)));

  if (!acctHave.has("chrysalis_kem_pubkey")) {
    await run(db, `ALTER TABLE accounts ADD COLUMN chrysalis_kem_pubkey TEXT DEFAULT NULL`);
  }
  if (!acctHave.has("chrysalis_dsa_pubkey")) {
    await run(db, `ALTER TABLE accounts ADD COLUMN chrysalis_dsa_pubkey TEXT DEFAULT NULL`);
  }
  if (!acctHave.has("chrysalis_id")) {
    await run(db, `ALTER TABLE accounts ADD COLUMN chrysalis_id TEXT DEFAULT NULL`);
  }
  if (!acctHave.has("chrysalis_registered_at")) {
    await run(db, `ALTER TABLE accounts ADD COLUMN chrysalis_registered_at INTEGER DEFAULT NULL`);
  }
  // ML-DSA-65 primary signing key — replaces Ed25519 publicKeyB64 for new wallets
  if (!acctHave.has("mldsa_public_key")) {
    await run(db, `ALTER TABLE accounts ADD COLUMN mldsa_public_key TEXT DEFAULT NULL`);
  }

  // Consent token registry — stores signed CCTs on-chain (Chrysalis CR-V1)
  await run(db, `CREATE TABLE IF NOT EXISTS chrysalis_consent_tokens (
    id                   TEXT PRIMARY KEY,
    session_id           TEXT NOT NULL,
    viewer_wallet        TEXT NOT NULL,
    creator_wallet       TEXT NOT NULL,
    consent              INTEGER NOT NULL DEFAULT 0,
    consent_hash         TEXT NOT NULL,
    dsa_signature_hex    TEXT NOT NULL,
    signer_pubkey_hex    TEXT NOT NULL,
    chrysalis_id         TEXT NOT NULL,
    version              TEXT NOT NULL DEFAULT '1.0',
    issued_at            INTEGER NOT NULL,
    revoked_at           INTEGER DEFAULT NULL,
    is_revocable         INTEGER NOT NULL DEFAULT 1,
    scope                TEXT NOT NULL DEFAULT 'FULL',
    createdAtMs          INTEGER NOT NULL
  );`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_cct_viewer   ON chrysalis_consent_tokens(viewer_wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_cct_creator  ON chrysalis_consent_tokens(creator_wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_cct_session  ON chrysalis_consent_tokens(session_id);`);

  // Distributed Recovery Shard Storage (DRSS) — encrypted shards stored on-network.
  // Server sees only ciphertext; passphrase never leaves the device.
  await run(db, `CREATE TABLE IF NOT EXISTS chrysalis_shards (
    id           TEXT PRIMARY KEY,
    chrysalis_id TEXT NOT NULL,
    wallet       TEXT NOT NULL,
    shard_part   TEXT NOT NULL,
    shard_data   TEXT NOT NULL,
    version      TEXT NOT NULL DEFAULT '1.0',
    uploaded_at  INTEGER NOT NULL,
    rotated_at   INTEGER DEFAULT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_drss_wallet  ON chrysalis_shards(wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_drss_chid    ON chrysalis_shards(chrysalis_id);`);

  // ── BNB token migration ──────────────────────────────────────────────────

  const bnbExists = await get(db, `SELECT symbol FROM tokens WHERE symbol='BNB'`);
  if (!bnbExists) {
    await run(
      db,
      `INSERT INTO tokens (symbol, name, decimals, isNative, mockPriceUSD, iconUrl, createdAtMs)
       VALUES ('BNB', 'BNB', 8, 0, 684.00, null, ?)`,
      [Date.now()]
    );
  }

  // ── LP token migrations ──────────────────────────────────────────────────

  // Ensure LPHNY (Honey LP Token) exists in the token registry
  const lphnyExists = await get(db, `SELECT symbol FROM tokens WHERE symbol='LPHNY'`);
  if (!lphnyExists) {
    await run(
      db,
      `INSERT INTO tokens (symbol, name, decimals, isNative, mockPriceUSD, iconUrl, createdAtMs)
       VALUES ('LPHNY', 'Honey LP Token', 8, 0, 1.00, null, ?)`,
      [Date.now()]
    );
  }

  // Ensure a LPHNY-HNY pool exists so LP tokens can be swapped
  const lphnyPool = await get(db, `SELECT id FROM liquidity_pools WHERE id='LPHNY-HNY'`);
  if (!lphnyPool) {
    const rA = 500000, rB = 500000;
    await run(
      db,
      `INSERT INTO liquidity_pools (id, tokenA, tokenB, reserveA, reserveB, totalLpShares, feeRate, createdAtMs)
       VALUES ('LPHNY-HNY', 'LPHNY', 'HNY', ?, ?, ?, 0.001, ?)`,
      [rA, rB, Math.sqrt(rA * rB), Date.now()]
    );
  }

  // lp_positions table: createdAtMs tracks when the position was opened (for APR calc)
  // Column already exists from initial schema — add any missing columns here.
  const lpCols = await all(db, "PRAGMA table_info(lp_positions);");
  const lpHave = new Set((lpCols || []).map(c => String(c.name)));
  if (!lpHave.has("createdAtMs")) {
    await run(db, `ALTER TABLE lp_positions ADD COLUMN createdAtMs INTEGER NOT NULL DEFAULT 0`);
  }
  if (!lpHave.has("rewardPaidHNY")) {
    await run(db, `ALTER TABLE lp_positions ADD COLUMN rewardPaidHNY REAL NOT NULL DEFAULT 0`);
  }

  // ── NFT System ────────────────────────────────────────────────────────────

  await run(db, `CREATE TABLE IF NOT EXISTS nfts (
    id                TEXT PRIMARY KEY,
    creator_wallet    TEXT NOT NULL,
    owner_wallet      TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    media_type        TEXT NOT NULL CHECK(media_type IN ('audio','video','document','photo')),
    royalty_bps       INTEGER NOT NULL DEFAULT 0,
    listed_price_hny  REAL,
    listed_at         TEXT,
    minted_at         TEXT NOT NULL DEFAULT (datetime('now')),
    transfer_count    INTEGER NOT NULL DEFAULT 0
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS nft_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nft_id      TEXT NOT NULL REFERENCES nfts(id),
    file_index  INTEGER NOT NULL,
    file_name   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_size   INTEGER NOT NULL DEFAULT 0
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS security_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet      TEXT NOT NULL,
    tx_type     TEXT NOT NULL,
    tx_data     TEXT NOT NULL,
    alert_level TEXT NOT NULL CHECK(alert_level IN ('SAFE','CAUTION','ALERT')),
    reason      TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.5,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed   INTEGER NOT NULL DEFAULT 0
  );`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_nfts_owner   ON nfts(owner_wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_nfts_creator ON nfts(creator_wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_nfts_listed  ON nfts(listed_at);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_nft_files    ON nft_files(nft_id, file_index);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_alerts_wallet ON security_alerts(wallet, created_at);`);

  // Ensure nft-media directory exists
  const fs = require('fs');
  const nftMediaDir = path.join(__dirname, 'nft-media');
  if (!fs.existsSync(nftMediaDir)) fs.mkdirSync(nftMediaDir, { recursive: true });

  // ── Phase 7B: nfts column migrations ─────────────────────────────────────
  const nftCols = await all(db, "PRAGMA table_info(nfts);");
  const nftHave = new Set((nftCols || []).map(c => String(c.name)));
  if (!nftHave.has("ai_description")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN ai_description TEXT DEFAULT ''`);
  }
  if (!nftHave.has("collection_id")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN collection_id TEXT DEFAULT NULL`);
  }
  if (!nftHave.has("auction_id")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN auction_id TEXT DEFAULT NULL`);
  }
  // ── Phase H8: nfts column migrations ──────────────────────────────────────
  if (!nftHave.has("tags")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
  }
  if (!nftHave.has("copy_count")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 1`);
  }
  if (!nftHave.has("copy_index")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN copy_index INTEGER NOT NULL DEFAULT 1`);
  }
  if (!nftHave.has("release_at_ms")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN release_at_ms INTEGER NOT NULL DEFAULT 0`);
  }
  if (!nftHave.has("list_duration_days")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN list_duration_days INTEGER NOT NULL DEFAULT 0`);
  }
  if (!nftHave.has("list_expires_at_ms")) {
    await run(db, `ALTER TABLE nfts ADD COLUMN list_expires_at_ms INTEGER NOT NULL DEFAULT 0`);
  }

  // ── Collections: add tags column if missing ────────────────────────────────
  const collCols = await all(db, "PRAGMA table_info(nft_collections);");
  const collHave = new Set((collCols || []).map(c => String(c.name)));
  if (!collHave.has("tags")) {
    await run(db, `ALTER TABLE nft_collections ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
  }

  // ── Collections ────────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS nft_collections (
    id           TEXT PRIMARY KEY,
    creator_wallet TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    cover_nft_id TEXT DEFAULT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_collections_creator ON nft_collections(creator_wallet);`);

  // ── Auctions ───────────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS nft_auctions (
    id                  TEXT PRIMARY KEY,
    nft_id              TEXT NOT NULL REFERENCES nfts(id),
    seller_wallet       TEXT NOT NULL,
    reserve_price_hny   REAL NOT NULL DEFAULT 0,
    min_increment_hny   REAL NOT NULL DEFAULT 1,
    current_bid_hny     REAL DEFAULT NULL,
    current_bidder      TEXT DEFAULT NULL,
    starts_at           TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at             TEXT NOT NULL,
    settled             INTEGER NOT NULL DEFAULT 0,
    settled_at          TEXT DEFAULT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE TABLE IF NOT EXISTS nft_bids (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id    TEXT NOT NULL REFERENCES nft_auctions(id),
    bidder_wallet TEXT NOT NULL,
    bid_hny       REAL NOT NULL,
    bid_at        TEXT NOT NULL DEFAULT (datetime('now')),
    refunded      INTEGER NOT NULL DEFAULT 0
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auctions_nft    ON nft_auctions(nft_id);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auctions_seller ON nft_auctions(seller_wallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auctions_ends   ON nft_auctions(ends_at, settled);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_bids_auction    ON nft_bids(auction_id);`);

  // ── Offers ─────────────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS nft_offers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nft_id        TEXT NOT NULL REFERENCES nfts(id),
    buyer_wallet  TEXT NOT NULL,
    offer_hny     REAL NOT NULL,
    expires_at    TEXT NOT NULL,
    accepted      INTEGER NOT NULL DEFAULT 0,
    cancelled     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_offers_nft    ON nft_offers(nft_id, accepted, cancelled);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_offers_buyer  ON nft_offers(buyer_wallet);`);

  // ── Phase H3: Perpetual Futures ────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS futures_markets (
    id                      TEXT PRIMARY KEY,
    base_symbol             TEXT NOT NULL,
    quote_symbol            TEXT NOT NULL DEFAULT 'USD',
    max_leverage            INTEGER NOT NULL DEFAULT 20,
    min_size_usd            REAL NOT NULL DEFAULT 1.0,
    maker_fee_rate          REAL NOT NULL DEFAULT 0.0002,
    taker_fee_rate          REAL NOT NULL DEFAULT 0.0006,
    maintenance_margin_rate REAL NOT NULL DEFAULT 0.025,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS futures_positions (
    id                    TEXT PRIMARY KEY,
    wallet                TEXT NOT NULL,
    market_id             TEXT NOT NULL REFERENCES futures_markets(id),
    side                  TEXT NOT NULL CHECK(side IN ('long','short')),
    size_usd              REAL NOT NULL,
    collateral_hny        REAL NOT NULL,
    leverage              INTEGER NOT NULL,
    entry_price_usd       REAL NOT NULL,
    mark_price_usd        REAL NOT NULL,
    liquidation_price_usd REAL NOT NULL,
    unrealized_pnl_hny    REAL NOT NULL DEFAULT 0,
    funding_paid_hny      REAL NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','liquidated')),
    close_price_usd       REAL,
    realized_pnl_hny      REAL,
    opened_at             TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at             TEXT
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS futures_funding_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id     TEXT NOT NULL,
    funding_rate  REAL NOT NULL,
    mark_price_usd REAL NOT NULL,
    applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_fpos_wallet  ON futures_positions(wallet, status);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fpos_market  ON futures_positions(market_id, status);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_ffund_market ON futures_funding_history(market_id, applied_at);`);

  // Seed default futures markets
  const fmktCount = await get(db, `SELECT COUNT(*) as n FROM futures_markets`, []);
  if (Number(fmktCount?.n || 0) === 0) {
    const defaultMarkets = [
      ['HNY-USD', 'HNY', 20, 1.0],
      ['BTC-USD', 'BTC', 20, 10.0],
      ['ETH-USD', 'ETH', 20, 1.0],
      ['SOL-USD', 'SOL', 20, 1.0],
      ['BNB-USD', 'BNB', 20, 1.0],
    ];
    for (const [id, base, maxLev, minSize] of defaultMarkets) {
      await run(db,
        `INSERT OR IGNORE INTO futures_markets (id, base_symbol, max_leverage, min_size_usd) VALUES (?, ?, ?, ?)`,
        [id, base, maxLev, minSize]
      );
    }
  }

  // ── Phase H4: Token Launchpad ──────────────────────────────────────────────
  // Pump-style bonding curve token launches on Honey Network
  await run(db, `CREATE TABLE IF NOT EXISTS launchpad_tokens (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    image_emoji         TEXT NOT NULL DEFAULT '🍯',
    creator_wallet      TEXT NOT NULL,
    -- Bonding curve state (virtual + real reserves)
    virtual_hny         REAL NOT NULL DEFAULT 1000.0,
    virtual_supply      REAL NOT NULL DEFAULT 1000000000.0,
    real_hny_raised     REAL NOT NULL DEFAULT 0.0,
    tokens_sold         REAL NOT NULL DEFAULT 0.0,
    total_supply        REAL NOT NULL DEFAULT 1000000000.0,
    -- Graduation (moves to AMM when real_hny_raised >= graduation_threshold)
    graduation_threshold REAL NOT NULL DEFAULT 100.0,
    graduated           INTEGER NOT NULL DEFAULT 0,
    graduated_at        TEXT,
    -- Metadata
    website             TEXT,
    twitter             TEXT,
    telegram            TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_trade_at       TEXT
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS launchpad_trades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id      TEXT NOT NULL REFERENCES launchpad_tokens(id),
    wallet        TEXT NOT NULL,
    type          TEXT NOT NULL CHECK(type IN ('buy','sell')),
    hny_amount    REAL NOT NULL,
    token_amount  REAL NOT NULL,
    price_hny     REAL NOT NULL,
    fee_hny       REAL NOT NULL NOT NULL DEFAULT 0,
    traded_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS launchpad_holdings (
    wallet       TEXT NOT NULL,
    token_id     TEXT NOT NULL REFERENCES launchpad_tokens(id),
    balance      REAL NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (wallet, token_id)
  );`);

  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_tokens_created  ON launchpad_tokens(created_at DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_tokens_raised   ON launchpad_tokens(real_hny_raised DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_trades_token    ON launchpad_trades(token_id, traded_at DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_trades_wallet   ON launchpad_trades(wallet, traded_at DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_lp_holdings_wallet ON launchpad_holdings(wallet);`);

  // ── Order Book ──────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS limit_orders (
    id          TEXT PRIMARY KEY,
    wallet      TEXT NOT NULL,
    pair        TEXT NOT NULL,
    side        TEXT NOT NULL CHECK(side IN ('buy','sell')),
    price_hny   REAL NOT NULL,
    size_hny    REAL NOT NULL,
    filled_hny  REAL NOT NULL DEFAULT 0,
    locked_hny  REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','filled','cancelled','expired')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE TABLE IF NOT EXISTS orderbook_trades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pair          TEXT NOT NULL,
    buy_order_id  TEXT NOT NULL,
    sell_order_id TEXT NOT NULL,
    price_hny     REAL NOT NULL,
    size_hny      REAL NOT NULL,
    traded_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_orders_pair_side   ON limit_orders(pair, side, status, price_hny);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_orders_wallet       ON limit_orders(wallet, status);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_ob_trades_pair      ON orderbook_trades(pair, traded_at DESC);`);

  // ── Trading Bots ─────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS trading_bots (
    id          TEXT PRIMARY KEY,
    wallet      TEXT NOT NULL,
    type        TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    config      TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','deleted')),
    state_json  TEXT NOT NULL DEFAULT '{}',
    total_pnl   TEXT NOT NULL DEFAULT '0',
    last_run_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE TABLE IF NOT EXISTS bot_trades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id     TEXT NOT NULL,
    action     TEXT NOT NULL,
    amount_hny REAL NOT NULL,
    price_hny  REAL NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    traded_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_bots_wallet    ON trading_bots(wallet, status);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_bot_trades_bot ON bot_trades(bot_id, traded_at DESC);`);

  // ── Phase H6a: Cross-chain Bridge ────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS bridge_transactions (
    id           TEXT PRIMARY KEY,
    wallet       TEXT NOT NULL,
    direction    TEXT NOT NULL CHECK(direction IN ('hny_to_evm','evm_to_hny')),
    from_chain   TEXT NOT NULL,
    to_chain     TEXT NOT NULL,
    from_token   TEXT NOT NULL,
    to_token     TEXT NOT NULL,
    amount       REAL NOT NULL,
    fee_amount   REAL NOT NULL,
    net_amount   REAL NOT NULL,
    from_address TEXT NOT NULL,
    to_address   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','confirmed','completed','failed','refunded')),
    evm_chain_id INTEGER,
    evm_tx_hash  TEXT,
    hny_tx_id    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT,
    completed_at TEXT,
    failed_at    TEXT,
    fail_reason  TEXT,
    created_at_ms INTEGER NOT NULL DEFAULT 0
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_bridge_wallet ON bridge_transactions(wallet, created_at_ms DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_bridge_status ON bridge_transactions(status, created_at_ms);`);

  // ── DAO Governance (Phase H6b) ───────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS dao_proposals (
    id TEXT PRIMARY KEY,
    proposer_wallet TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('parameter_change','treasury_allocation','protocol_upgrade','emergency')),
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','active','timelocked','executed','rejected','cancelled')),
    bond_hny REAL NOT NULL DEFAULT 50000,
    yes_vp REAL NOT NULL DEFAULT 0,
    no_vp REAL NOT NULL DEFAULT 0,
    abstain_vp REAL NOT NULL DEFAULT 0,
    total_vp_snapshot REAL NOT NULL DEFAULT 0,
    metadata_json TEXT,
    draft_at_ms INTEGER NOT NULL,
    submitted_at_ms INTEGER,
    voting_ends_at_ms INTEGER,
    timelock_ends_at_ms INTEGER,
    executed_at_ms INTEGER,
    cancelled_at_ms INTEGER,
    fail_reason TEXT
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dao_proposals_status ON dao_proposals(status, draft_at_ms DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dao_proposals_proposer ON dao_proposals(proposer_wallet);`);

  await run(db, `CREATE TABLE IF NOT EXISTS dao_votes (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    voter_wallet TEXT NOT NULL,
    vote TEXT NOT NULL CHECK(vote IN ('yes','no','abstain')),
    voting_power REAL NOT NULL,
    voted_at_ms INTEGER NOT NULL,
    UNIQUE(proposal_id, voter_wallet)
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dao_votes_proposal ON dao_votes(proposal_id);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dao_votes_voter ON dao_votes(voter_wallet);`);

  await run(db, `CREATE TABLE IF NOT EXISTS dao_treasury_txs (
    id TEXT PRIMARY KEY,
    proposal_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal','bond_received','bond_burned')),
    wallet TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    created_at_ms INTEGER NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dao_treasury ON dao_treasury_txs(created_at_ms DESC);`);

  // ── Copy Trading (Phase H6c) ──────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS copy_leaders (
    wallet TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    bio TEXT DEFAULT '',
    strategy_description TEXT DEFAULT '',
    fee_pct REAL NOT NULL DEFAULT 10.0,
    is_public INTEGER NOT NULL DEFAULT 1,
    registered_at_ms INTEGER NOT NULL
  );`);

  await run(db, `CREATE TABLE IF NOT EXISTS copy_subscriptions (
    id TEXT PRIMARY KEY,
    follower_wallet TEXT NOT NULL,
    leader_wallet TEXT NOT NULL,
    per_trade_limit_hny REAL NOT NULL DEFAULT 10,
    used_hny REAL NOT NULL DEFAULT 0,
    total_pnl_hny REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active','paused','cancelled')),
    subscribed_at_ms INTEGER NOT NULL,
    last_copy_at_ms INTEGER,
    UNIQUE(follower_wallet, leader_wallet)
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_copy_subs_leader   ON copy_subscriptions(leader_wallet, status);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_copy_subs_follower ON copy_subscriptions(follower_wallet, status);`);

  await run(db, `CREATE TABLE IF NOT EXISTS copy_trades (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    follower_wallet TEXT NOT NULL,
    leader_wallet TEXT NOT NULL,
    leader_bot_id TEXT NOT NULL,
    bot_trade_sig TEXT NOT NULL,
    action TEXT NOT NULL,
    copy_amount_hny REAL NOT NULL,
    fee_hny REAL NOT NULL,
    leader_price REAL NOT NULL,
    executed_at_ms INTEGER NOT NULL,
    UNIQUE(subscription_id, bot_trade_sig)
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_copy_trades_follower ON copy_trades(follower_wallet, executed_at_ms DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_copy_trades_leader   ON copy_trades(leader_wallet,   executed_at_ms DESC);`);

  // ── H7a: Portfolio Snapshots ─────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet         TEXT NOT NULL,
    snapshot_ms    INTEGER NOT NULL,
    net_worth_hny  REAL NOT NULL DEFAULT 0,
    breakdown_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(wallet, snapshot_ms)
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_snapshots_wallet ON portfolio_snapshots(wallet, snapshot_ms DESC);`);

  // ── H7b: Vault State ──────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vault_state (
    vault_id         TEXT PRIMARY KEY,
    total_shares     REAL NOT NULL DEFAULT 0,
    total_hny        REAL NOT NULL DEFAULT 0,
    last_compound_ms INTEGER NOT NULL DEFAULT 0,
    apr_pct          REAL NOT NULL DEFAULT 5.0
  );`);

  // ── H7b: Vault Deposits ───────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS vault_deposits (
    id              TEXT PRIMARY KEY,
    wallet          TEXT NOT NULL,
    vault_id        TEXT NOT NULL,
    hny_deposited   REAL NOT NULL,
    shares_issued   REAL NOT NULL,
    deposited_at_ms INTEGER NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_vault_dep_wallet ON vault_deposits(wallet, deposited_at_ms DESC);`);

  // ── H7b: HNY Time-Locks ───────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS hny_locks (
    id                 TEXT PRIMARY KEY,
    wallet             TEXT NOT NULL,
    amount_hny         REAL NOT NULL,
    lock_days          INTEGER NOT NULL,
    multiplier         REAL NOT NULL,
    locked_at_ms       INTEGER NOT NULL,
    unlock_at_ms       INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'locked'
      CHECK(status IN ('locked','unlocked','early_unlocked')),
    reward_accrued_hny REAL NOT NULL DEFAULT 0,
    penalty_hny        REAL NOT NULL DEFAULT 0
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_locks_wallet ON hny_locks(wallet, status);`);

  // ── H7c: Notifications ────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS notifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet        TEXT NOT NULL,
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    link_href     TEXT,
    read          INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_notifs_wallet ON notifications(wallet, read, created_at_ms DESC);`);

  // ── H7d: User Profiles ────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS user_profiles (
    wallet         TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL DEFAULT '',
    bio            TEXT DEFAULT '',
    avatar_emoji   TEXT DEFAULT '🐝',
    avatar_photo   TEXT DEFAULT NULL,
    banner_data    TEXT DEFAULT NULL,
    website        TEXT DEFAULT '',
    twitter_handle TEXT DEFAULT '',
    is_public      INTEGER NOT NULL DEFAULT 1,
    created_at_ms  INTEGER NOT NULL,
    updated_at_ms  INTEGER NOT NULL
  );`);
  // Migrations for existing DBs
  await run(db, `ALTER TABLE user_profiles ADD COLUMN avatar_photo TEXT DEFAULT NULL`).catch(() => {});
  await run(db, `ALTER TABLE user_profiles ADD COLUMN banner_data TEXT DEFAULT NULL`).catch(() => {});

  // ── H7d: Social Posts ─────────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS social_posts (
    id            TEXT PRIMARY KEY,
    wallet        TEXT NOT NULL,
    content       TEXT NOT NULL,
    encrypted     INTEGER NOT NULL DEFAULT 0,
    cipher_json   TEXT,
    reply_to_id   TEXT,
    like_count    INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    mldsa_pub_key TEXT NOT NULL,
    signature_hex TEXT NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_posts_wallet ON social_posts(wallet, created_at_ms DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_posts_feed   ON social_posts(created_at_ms DESC);`);

  // ── H7d: Social Follows ───────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS social_follows (
    follower_wallet  TEXT NOT NULL,
    following_wallet TEXT NOT NULL,
    followed_at_ms   INTEGER NOT NULL,
    PRIMARY KEY (follower_wallet, following_wallet)
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_follows_following ON social_follows(following_wallet);`);

  // ── H7d: Direct Messages ─────────────────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS social_dms (
    id              TEXT PRIMARY KEY,
    from_wallet     TEXT NOT NULL,
    to_wallet       TEXT NOT NULL,
    cipher_json     TEXT NOT NULL,
    preview_text    TEXT NOT NULL DEFAULT '[Encrypted]',
    read            INTEGER NOT NULL DEFAULT 0,
    created_at_ms   INTEGER NOT NULL,
    mldsa_pub_key   TEXT NOT NULL,
    signature_hex   TEXT NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dms_to   ON social_dms(to_wallet,   created_at_ms DESC);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_dms_from ON social_dms(from_wallet, created_at_ms DESC);`);

  // ── Auth Users (Platform Accounts) ───────────────────────────────────────────
  await run(db, `CREATE TABLE IF NOT EXISTS auth_users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE,
    phone           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    salt            TEXT NOT NULL,
    hny_wallet      TEXT NOT NULL UNIQUE,
    mldsa_pub_key   TEXT NOT NULL,
    encrypted_priv_key TEXT NOT NULL,
    encrypted_backup   TEXT,
    chrysalis_registered INTEGER NOT NULL DEFAULT 0,
    display_name    TEXT NOT NULL DEFAULT '',
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auth_email ON auth_users(email);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auth_phone ON auth_users(phone);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auth_wallet ON auth_users(hny_wallet);`);
  // migrations for existing auth_users
  await run(db, `ALTER TABLE auth_users ADD COLUMN encrypted_backup TEXT`).catch(() => {});

  await run(db, `CREATE TABLE IF NOT EXISTS auth_sessions (
    token              TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES auth_users(id),
    wallet             TEXT NOT NULL,
    session_priv_key   TEXT,
    created_at_ms      INTEGER NOT NULL,
    expires_at_ms      INTEGER NOT NULL
  );`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);`);
  // migration for existing auth_sessions
  await run(db, `ALTER TABLE auth_sessions ADD COLUMN session_priv_key TEXT`).catch(() => {});

  // Seed a few demo launchpad tokens so the page isn't empty on first run
  const lpCount = await get(db, `SELECT COUNT(*) as n FROM launchpad_tokens`, []);
  if (Number(lpCount?.n || 0) === 0) {
    const demoTokens = [
      ['BUZZ', 'BuzzCoin',   '🐝', 'The official meme of the Honey Network hive. To the moon!',       'HNY_DEMO_CREATOR_1', 1000, 1000000000, 45.0,  45000000],
      ['COMB', 'HoneyComb',  '🍯', 'Building the comb block by block. Liquidity honeypot.',           'HNY_DEMO_CREATOR_2', 1000, 1000000000, 72.5,  72500000],
      ['STING','StingToken', '💥', 'Sting before you get stung. High-volatility HIVE meme.',          'HNY_DEMO_CREATOR_3', 1000, 1000000000, 12.3,  12300000],
      ['POLLEN','Pollenator','🌸', 'Cross-pollinating liquidity across the Honey Network ecosystem.', 'HNY_DEMO_CREATOR_4', 1000, 1000000000, 5.1,   5100000],
      ['QUEEN','QueenBee',   '👑', 'Backed by the Queen Bee AI oracle. Royalty on every trade.',      'HNY_DEMO_CREATOR_5', 1000, 1000000000, 88.8,  88800000],
    ];
    for (const [ticker, name, emoji, desc, creator, vhny, vsupply, raised, sold] of demoTokens) {
      const id = `${ticker.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      await run(db,
        `INSERT OR IGNORE INTO launchpad_tokens
           (id, name, ticker, description, image_emoji, creator_wallet,
            virtual_hny, virtual_supply, real_hny_raised, tokens_sold, total_supply)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, name, ticker, desc, emoji, creator, vhny, vsupply, raised, sold, vsupply]
      );
    }
  }
}

module.exports = {
  DB_PATH,
  openDb,
  initDb,
  run,
  get,
  all,
};
