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

async function initDb(db) {
  // accounts: wallet + optional pubkey + balance + nonce + lastMint
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

  // transactions: store pending + confirmed + block linkage
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
      blockHeight INTEGER,
      blockHash TEXT,
      timestampMs INTEGER NOT NULL
    );`
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_to ON transactions(toWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_from ON transactions(fromWallet);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_status_ts ON transactions(status, timestampMs);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_txs_blockHeight ON transactions(blockHeight);`);

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
