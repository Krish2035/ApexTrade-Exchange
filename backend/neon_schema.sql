-- =====================================================================
-- ApexTrade Institutional Exchange — Production PostgreSQL Schema
-- Target: Neon.tech (Serverless PostgreSQL)
-- =====================================================================

-- 1. Users & IAM
CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR(64) PRIMARY KEY,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  role           VARCHAR(32) NOT NULL DEFAULT 'trader',
  token_version  INTEGER NOT NULL DEFAULT 1,
  kyc_status     VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  kyc_tier       INTEGER NOT NULL DEFAULT 0,
  two_fa_secret  TEXT,
  two_fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Refresh Tokens (JWT Rotation)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token          VARCHAR(255) PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_family   VARCHAR(64) NOT NULL,
  expires_at     BIGINT NOT NULL,
  revoked        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

-- 3. KYC Verifications & AML Compliance
CREATE TABLE IF NOT EXISTS kyc_verifications (
  id             VARCHAR(64) PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name      VARCHAR(255),
  date_of_birth  DATE,
  nationality    VARCHAR(8),
  id_type        VARCHAR(32),
  id_number      VARCHAR(64),
  id_expiry      DATE,
  address        JSONB,
  selfie_hash    TEXT,
  doc_hash       TEXT,
  status         VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  tier           INTEGER NOT NULL DEFAULT 0,
  risk_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
  reviewed_by    VARCHAR(64),
  reviewed_at    TIMESTAMP WITH TIME ZONE,
  submitted_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_verifications(status);

-- 4. Ledger Accounts (Atomic Balance Management)
CREATE TABLE IF NOT EXISTS accounts (
  id             VARCHAR(64) PRIMARY KEY,
  user_id        VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency       VARCHAR(16) NOT NULL,
  type           VARCHAR(32) NOT NULL DEFAULT 'ASSET',
  available      NUMERIC(24, 8) NOT NULL DEFAULT 0,
  locked         NUMERIC(24, 8) NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_account_user_currency UNIQUE (user_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

-- 5. Double-Entry Journal Entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id              VARCHAR(64) PRIMARY KEY,
  type            VARCHAR(64) NOT NULL,
  debit_account   VARCHAR(64) NOT NULL REFERENCES accounts(id),
  credit_account  VARCHAR(64) NOT NULL REFERENCES accounts(id),
  amount          NUMERIC(24, 8) NOT NULL,
  currency        VARCHAR(16) NOT NULL,
  reference_id    VARCHAR(64),
  reference_type  VARCHAR(64),
  metadata        JSONB,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(reference_id);
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);

-- 6. Orders
CREATE TABLE IF NOT EXISTS orders (
  id              VARCHAR(64) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL REFERENCES users(id),
  symbol          VARCHAR(32) NOT NULL,
  side            VARCHAR(8) NOT NULL,
  type            VARCHAR(16) NOT NULL,
  price           NUMERIC(24, 8),
  amount          NUMERIC(24, 8) NOT NULL,
  filled          NUMERIC(24, 8) NOT NULL DEFAULT 0,
  remaining       NUMERIC(24, 8) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'NEW',
  time_in_force   VARCHAR(8) NOT NULL DEFAULT 'GTC',
  stop_price      NUMERIC(24, 8),
  take_profit     NUMERIC(24, 8),
  stop_loss       NUMERIC(24, 8),
  leverage        INTEGER NOT NULL DEFAULT 1,
  idempotency_key VARCHAR(128) UNIQUE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 7. Trades (Matched Executions)
CREATE TABLE IF NOT EXISTS trades (
  id              VARCHAR(64) PRIMARY KEY,
  symbol          VARCHAR(32) NOT NULL,
  buy_order_id    VARCHAR(64) REFERENCES orders(id),
  sell_order_id   VARCHAR(64) REFERENCES orders(id),
  buyer_id        VARCHAR(64) NOT NULL,
  seller_id       VARCHAR(64) NOT NULL,
  price           NUMERIC(24, 8) NOT NULL,
  amount          NUMERIC(24, 8) NOT NULL,
  taker_fee       NUMERIC(24, 8) NOT NULL DEFAULT 0,
  maker_fee       NUMERIC(24, 8) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

-- 8. Payment Rails & Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id               VARCHAR(64) PRIMARY KEY,
  user_id          VARCHAR(64) NOT NULL REFERENCES users(id),
  type             VARCHAR(16) NOT NULL,
  currency         VARCHAR(16) NOT NULL,
  amount           NUMERIC(24, 8) NOT NULL,
  fee              NUMERIC(24, 8) NOT NULL DEFAULT 0,
  net_amount       NUMERIC(24, 8) NOT NULL,
  rail             VARCHAR(32) NOT NULL,
  status           VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  external_ref     VARCHAR(128),
  stripe_pi_id     VARCHAR(128),
  blockchain_hash  VARCHAR(128),
  confirmations    INTEGER NOT NULL DEFAULT 0,
  aml_score        NUMERIC(5,2) NOT NULL DEFAULT 0,
  saga_id          VARCHAR(64),
  metadata         JSONB,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

-- 9. Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             VARCHAR(128) PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 10. AML Alerts
CREATE TABLE IF NOT EXISTS aml_alerts (
  id              VARCHAR(64) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL REFERENCES users(id),
  transaction_id  VARCHAR(64),
  alert_type      VARCHAR(64) NOT NULL,
  risk_score      NUMERIC(5,2) NOT NULL,
  description     TEXT,
  status          VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP WITH TIME ZONE
);

-- 11. Seed Default System & Institutional Users
INSERT INTO users (id, email, password_hash, password_salt, role, kyc_status, kyc_tier)
VALUES
  ('system-treasury', 'treasury@apextrade.internal', 'SYSTEM', 'SYSTEM', 'system', 'VERIFIED', 3),
  ('trader-alice', 'alice@apextrade.io', '3c9909afec25354d551dae21590bb26e38d53f2173b8d3dc3eee4c047e7ab1c1eb8b85103e3be7ba613b31bb5c9c36214dc9f14a42fd7a2fdb84856bca5c44c2', 'e1f8a846e913a8a3a0e633d3bb7a049e', 'trader', 'VERIFIED', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, user_id, currency, type, available)
VALUES
  ('acc-treasury-fee-usd', 'system-treasury', 'USD', 'EQUITY', 10000000),
  ('acc-trader-alice-usd', 'trader-alice', 'USD', 'ASSET', 100000),
  ('acc-trader-alice-btc', 'trader-alice', 'BTC', 'ASSET', 5.0),
  ('acc-trader-alice-eth', 'trader-alice', 'ETH', 'ASSET', 25.0),
  ('acc-trader-alice-sol', 'trader-alice', 'SOL', 'ASSET', 150.0)
ON CONFLICT (user_id, currency) DO NOTHING;
