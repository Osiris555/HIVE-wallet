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
}

module.exports = {
  DB_PATH,
  openDb,
  initDb,
  run,
  get,
  all,
};
