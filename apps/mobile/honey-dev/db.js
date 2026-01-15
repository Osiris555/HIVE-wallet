// apps/mobile/honey-dev/db.js
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.HIVE_DB_PATH
  ? path.resolve(process.env.HIVE_DB_PATH)
  : path.resolve(__dirname, "hive-wallet.sqlite");

function openDb() {
  return new sqlite3.Database(DB_PATH);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
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
  // 1) accounts
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

  // 2) transactions (create if missing, otherwise migrate)
  const txTableExists = await tableExists(db, "transactions");

  if (!txTableExists) {
    // Fresh DB -> create with all columns
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
        status TEXT NOT NULL,
        failReason TEXT,
        expiresAtMs INTEGER,
        blockHeight INTEGER,
        blockHash TEXT,
        timestampMs INTEGER NOT NULL
      );`
    );
  } else {
    // Existing DB -> add missing columns safely
    const hasFailReason = await columnExists(db, "transactions", "failReason");
    if (!hasFailReason) {
      await run(db, `ALTER TABLE transactions ADD COLUMN failReason TEXT;`);
    }

    const hasExpiresAt = await columnExists(db, "transactions", "expiresAtMs");
    if (!hasExpiresAt) {
      await run(db, `ALTER TABLE transactions ADD COLUMN expiresAtMs INTEGER;`);
    }
  }

  // 3) blocks
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

  // 4) indexes AFTER migrations (critical)
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_to ON transactions(toWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_from ON transactions(fromWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_status_ts ON transactions(status, timestampMs);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_blockHeight ON transactions(blockHeight);`);

  // Only create expiry index if column exists (extra safety)
  const hasExpiresAtNow = await columnExists(db, "transactions", "expiresAtMs");
  if (hasExpiresAtNow) {
    await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_expiry ON transactions(expiresAtMs);`);
  }

  await run(db, `CREATE INDEX IF NOT EXISTS idx_blocks_ts ON blocks(timestampMs);`);
}

module.exports = {
  DB_PATH,
  openDb,
  initDb,
  run,
  get,
  all,
};
