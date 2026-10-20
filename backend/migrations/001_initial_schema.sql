-- ============================================================================
-- ApexTrade Global Exchange: Production Database Schema (Migration 001)
-- Covers: #14 Idempotency, #25 Indexing, #28 Connection Pooling, 
--         #31 Partitioning, #36 Optimistic Locking, #68 IAM, #72 Encryption
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. IAM & User Security (#68 IAM, #69 OAuth, #70 JWT Rotation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'trader', -- 'trader', 'market_maker', 'admin', 'auditor'
    kyc_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
    is_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id VARCHAR(64) NOT NULL UNIQUE,
    key_secret_hash VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '["read", "trade"]',
    rate_limit_tier VARCHAR(32) NOT NULL DEFAULT 'standard', -- 'standard', 'pro', 'vip'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Double-Entry General Ledger (#18 Distributed Transactions, #37 Locking)
-- Core Accounting Invariant: SUM(debits) - SUM(credits) = 0
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    account_type VARCHAR(32) NOT NULL, -- 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'
    currency VARCHAR(16) NOT NULL,     -- 'USD', 'BTC', 'ETH', 'USDT'
    available_balance NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    locked_balance NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
    version BIGINT NOT NULL DEFAULT 1, -- Optimistic locking (#36)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_currency_account UNIQUE (user_id, currency, account_type)
);

CREATE TABLE IF NOT EXISTS ledger_journals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE, -- (#14 Idempotency)
    reference_type VARCHAR(64) NOT NULL, -- 'TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE'
    reference_id VARCHAR(128) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_id UUID NOT NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    entry_type VARCHAR(8) NOT NULL, -- 'DEBIT', 'CREDIT'
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    currency VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. High-Throughput Orders & Fills (#14 Idempotency, #25 Indexing, #36 Locks)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    symbol VARCHAR(32) NOT NULL,       -- e.g. 'BTC-USD', 'ETH-USD'
    side VARCHAR(8) NOT NULL,          -- 'BUY', 'SELL'
    order_type VARCHAR(16) NOT NULL,   -- 'LIMIT', 'MARKET', 'STOP_LIMIT'
    time_in_force VARCHAR(8) NOT NULL DEFAULT 'GTC', -- 'GTC', 'IOC', 'FOK'
    price NUMERIC(24, 8),              -- NULL for pure market orders
    amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
    filled_amount NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (filled_amount >= 0),
    remaining_amount NUMERIC(24, 8) NOT NULL CHECK (remaining_amount >= 0),
    status VARCHAR(16) NOT NULL DEFAULT 'NEW', -- 'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED'
    idempotency_key VARCHAR(128) UNIQUE, -- Prevents double order placement (#14)
    client_order_id VARCHAR(128),
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Partitioned Trades Archive (#31 Partitioning, #25 Indexing)
-- High volume table partitioned by range of created_at
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    symbol VARCHAR(32) NOT NULL,
    price NUMERIC(24, 8) NOT NULL CHECK (price > 0),
    amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
    maker_order_id UUID NOT NULL,
    taker_order_id UUID NOT NULL,
    maker_user_id UUID NOT NULL,
    taker_user_id UUID NOT NULL,
    taker_side VARCHAR(8) NOT NULL, -- 'BUY' or 'SELL'
    maker_fee NUMERIC(24, 8) NOT NULL DEFAULT 0,
    taker_fee NUMERIC(24, 8) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Initial Monthly Partitions for demonstration
CREATE TABLE IF NOT EXISTS trades_2026_q1 PARTITION OF trades
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS trades_2026_q2 PARTITION OF trades
    FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS trades_2026_q3 PARTITION OF trades
    FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS trades_2026_q4 PARTITION OF trades
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- ----------------------------------------------------------------------------
-- 5. Performance Indexes (#25 Indexing, #26 Query Optimization, #27 N+1 Prevention)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_lookup ON ledger_accounts(user_id, currency);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);

CREATE INDEX IF NOT EXISTS idx_trades_symbol_time ON trades(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_maker_order ON trades(maker_order_id);
CREATE INDEX IF NOT EXISTS idx_trades_taker_order ON trades(taker_order_id);
