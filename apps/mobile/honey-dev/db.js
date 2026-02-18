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
      feeRate REAL NOT NULL DEFAULT 0.003,
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
    const defaultPools = [
      { tokenA: 'HNY', tokenB: 'ETH', reserveA: 100000, reserveB: 28.57 }, // ~$100k liquidity
      { tokenA: 'HNY', tokenB: 'BTC', reserveA: 100000, reserveB: 1.54 },
      { tokenA: 'HNY', tokenB: 'SOL', reserveA: 100000, reserveB: 689.66 },
      { tokenA: 'HNY', tokenB: 'USDT', reserveA: 100000, reserveB: 100000 },
      { tokenA: 'HNY', tokenB: 'USDC', reserveA: 100000, reserveB: 100000 },
      { tokenA: 'HNY', tokenB: 'XRP', reserveA: 100000, reserveB: 40000 },
      { tokenA: 'ETH', tokenB: 'USDT', reserveA: 28.57, reserveB: 100000 },
      { tokenA: 'BTC', tokenB: 'USDT', reserveA: 1.54, reserveB: 100000 },
      { tokenA: 'stHNY', tokenB: 'HNY', reserveA: 50000, reserveB: 52500 }, // stHNY trades at slight premium (~1.05x)
      { tokenA: 'stHNY', tokenB: 'USDT', reserveA: 50000, reserveB: 52500 },
    ];

    for (const pool of defaultPools) {
      const poolId = `${pool.tokenA}-${pool.tokenB}`;
      await run(
        db,
        `INSERT INTO liquidity_pools (id, tokenA, tokenB, reserveA, reserveB, totalLpShares, feeRate, createdAtMs)
         VALUES (?, ?, ?, ?, ?, ?, 0.003, ?)`,
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
}

module.exports = {
  DB_PATH,
  openDb,
  initDb,
  run,
  get,
  all,
};
