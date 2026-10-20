/**
 * database.js
 * SQLite persistent storage layer — production drop-in for in-memory Maps.
 * Uses better-sqlite3 (synchronous, zero-config, embedded, crash-safe WAL mode).
 * (#26 Database Indexing, #31 Partitioning, #36 Migrations, #25 Query Optimization)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR    = path.resolve(__dirname, '../../../data');
const DB_PATH   = path.join(DB_DIR, 'apextrade.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH, { verbose: null });

// ─────────────────────────────────────────────────────
// WAL Mode for concurrent reads + crash safety (#33 WAL)
// ─────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');   // 64MB page cache
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456'); // 256MB mmap
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────
// Schema bootstrap (idempotent — safe to re-run)
// ─────────────────────────────────────────────────────
db.exec(`
  -- ── Users & IAM ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    password_salt  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'trader',
    token_version  INTEGER NOT NULL DEFAULT 1,
    kyc_status     TEXT NOT NULL DEFAULT 'PENDING',
    kyc_tier       INTEGER NOT NULL DEFAULT 0,
    two_fa_secret  TEXT,
    two_fa_enabled INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- ── Refresh Tokens (JWT Rotation) ─────────────────────
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token          TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_family   TEXT NOT NULL,
    expires_at     INTEGER NOT NULL,
    revoked        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

  -- ── KYC Verifications ────────────────────────────────
  CREATE TABLE IF NOT EXISTS kyc_verifications (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name      TEXT,
    date_of_birth  TEXT,
    nationality    TEXT,
    id_type        TEXT,
    id_number      TEXT,
    id_expiry      TEXT,
    address        TEXT,
    selfie_hash    TEXT,
    doc_hash       TEXT,
    status         TEXT NOT NULL DEFAULT 'PENDING',
    tier           INTEGER NOT NULL DEFAULT 0,
    risk_score     REAL NOT NULL DEFAULT 0,
    reviewed_by    TEXT,
    reviewed_at    TEXT,
    submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),
    notes          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_verifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_verifications(status);

  -- ── Ledger Accounts ──────────────────────────────────
  CREATE TABLE IF NOT EXISTS accounts (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency       TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'ASSET',
    available      REAL NOT NULL DEFAULT 0,
    locked         REAL NOT NULL DEFAULT 0,
    version        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, currency)
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

  -- ── Double-Entry Journal Ledger ───────────────────────
  CREATE TABLE IF NOT EXISTS journal_entries (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    debit_account   TEXT NOT NULL REFERENCES accounts(id),
    credit_account  TEXT NOT NULL REFERENCES accounts(id),
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL,
    reference_id    TEXT,
    reference_type  TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(reference_id);
  CREATE INDEX IF NOT EXISTS idx_journal_debit  ON journal_entries(debit_account);
  CREATE INDEX IF NOT EXISTS idx_journal_credit ON journal_entries(credit_account);
  CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);

  -- ── Orders ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    type            TEXT NOT NULL,
    price           REAL,
    amount          REAL NOT NULL,
    filled          REAL NOT NULL DEFAULT 0,
    remaining       REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'NEW',
    time_in_force   TEXT NOT NULL DEFAULT 'GTC',
    stop_price      REAL,
    take_profit     REAL,
    stop_loss       REAL,
    leverage        INTEGER NOT NULL DEFAULT 1,
    idempotency_key TEXT UNIQUE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

  -- ── Trades (Executed Matches) ─────────────────────────
  CREATE TABLE IF NOT EXISTS trades (
    id              TEXT PRIMARY KEY,
    symbol          TEXT NOT NULL,
    buy_order_id    TEXT REFERENCES orders(id),
    sell_order_id   TEXT REFERENCES orders(id),
    buyer_id        TEXT NOT NULL,
    seller_id       TEXT NOT NULL,
    price           REAL NOT NULL,
    amount          REAL NOT NULL,
    taker_fee       REAL NOT NULL DEFAULT 0,
    maker_fee       REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_trades_symbol  ON trades(symbol);
  CREATE INDEX IF NOT EXISTS idx_trades_buyer   ON trades(buyer_id);
  CREATE INDEX IF NOT EXISTS idx_trades_seller  ON trades(seller_id);
  CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);

  -- ── Deposit / Withdrawal Transactions ────────────────
  CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL,
    currency        TEXT NOT NULL,
    amount          REAL NOT NULL,
    fee             REAL NOT NULL DEFAULT 0,
    net_amount      REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    rail            TEXT NOT NULL DEFAULT 'INTERNAL',
    external_ref    TEXT,
    blockchain_hash TEXT,
    stripe_pi_id    TEXT,
    bank_ref        TEXT,
    address         TEXT,
    confirmations   INTEGER NOT NULL DEFAULT 0,
    required_confirmations INTEGER NOT NULL DEFAULT 3,
    aml_flag        INTEGER NOT NULL DEFAULT 0,
    aml_score       REAL NOT NULL DEFAULT 0,
    saga_id         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user    ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_tx_status  ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_tx_stripe  ON transactions(stripe_pi_id);
  CREATE INDEX IF NOT EXISTS idx_tx_hash    ON transactions(blockchain_hash);
  CREATE INDEX IF NOT EXISTS idx_tx_saga    ON transactions(saga_id);

  -- ── Idempotency Keys (Persistent) ────────────────────
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT PRIMARY KEY,
    response_status INTEGER NOT NULL,
    response_body   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Saga Log ──────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS saga_log (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'STARTED',
    steps           TEXT NOT NULL DEFAULT '[]',
    compensations   TEXT NOT NULL DEFAULT '[]',
    transaction_id  TEXT,
    error           TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_saga_user ON saga_log(user_id);

  -- ── AML Alerts ───────────────────────────────────────
  CREATE TABLE IF NOT EXISTS aml_alerts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    transaction_id  TEXT,
    alert_type      TEXT NOT NULL,
    risk_score      REAL NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'OPEN',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_aml_user   ON aml_alerts(user_id);
  CREATE INDEX IF NOT EXISTS idx_aml_status ON aml_alerts(status);
`);

// Seed system treasury user and accounts
db.prepare(`
  INSERT INTO users (id, email, password_hash, password_salt, role, kyc_status, kyc_tier)
  VALUES ('system-treasury', 'treasury@apextrade.internal', 'SYSTEM', 'SYSTEM', 'system', 'VERIFIED', 3)
  ON CONFLICT(id) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO accounts (id, user_id, currency, type, available)
  VALUES ('acc-treasury-fee-usd', 'system-treasury', 'USD', 'EQUITY', 10000000)
  ON CONFLICT(id) DO NOTHING
`).run();

console.log(`[DB] SQLite database initialized at ${DB_PATH} (WAL mode)`);

export default db;
