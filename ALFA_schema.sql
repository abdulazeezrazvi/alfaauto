-- ============================================================
-- ALFA Platform — Full PostgreSQL Schema
-- File: database/init.sql
-- Run via Docker or: psql -U alfa_user -d alfa_db -f init.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Full-text search

-- ─── TENANTS ─────────────────────────────────────────────────
CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name         VARCHAR(200)  NOT NULL,
  owner_email           VARCHAR(200)  NOT NULL UNIQUE,
  owner_name            VARCHAR(100),
  business_type         VARCHAR(50),   -- restaurant, clinic, salon, ecommerce, etc.
  wa_phone_number_id    VARCHAR(50),   -- From Meta Developer Console
  wa_access_token_enc   TEXT,          -- Encrypted with ENCRYPTION_KEY
  wa_business_acct_id   VARCHAR(50),
  wa_phone_display      VARCHAR(20),   -- Display number e.g. +91 98765 43210
  google_sheet_id       VARCHAR(200),
  chroma_collection     VARCHAR(200),  -- e.g. tenant_abc123
  is_active             BOOLEAN DEFAULT TRUE,
  wa_connected          BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TENANT AI CONFIG ────────────────────────────────────────
CREATE TABLE tenant_ai_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_prompt         TEXT,          -- Business-specific instructions
  model_name            VARCHAR(50) DEFAULT 'llama3',
  temperature           FLOAT DEFAULT 0.7,
  max_context_messages  INT DEFAULT 10,
  language              VARCHAR(20) DEFAULT 'auto', -- auto, hindi, english, etc.
  business_hours        JSONB,         -- {"mon":{"open":"9:00","close":"18:00"}...}
  fallback_message      TEXT DEFAULT 'I am unable to help with that right now.',
  human_takeover_keyword VARCHAR(50) DEFAULT 'agent',
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- ─── GOOGLE CREDENTIALS (per tenant) ─────────────────────────
CREATE TABLE google_credentials (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_email          VARCHAR(200) NOT NULL,
  private_key_enc       TEXT NOT NULL,  -- Encrypted
  sheet_id              VARCHAR(200),
  drive_folder_id       VARCHAR(200),
  connected_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- ─── SUBSCRIPTIONS / BILLING ─────────────────────────────────
CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                  VARCHAR(20) NOT NULL DEFAULT 'starter', -- starter, professional, business
  razorpay_sub_id       VARCHAR(100),
  razorpay_customer_id  VARCHAR(100),
  amount                INT NOT NULL,  -- in paise
  status                VARCHAR(20) DEFAULT 'trial', -- trial, active, cancelled, past_due
  trial_ends_at         TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- ─── KNOWLEDGE DOCUMENTS ─────────────────────────────────────
CREATE TABLE knowledge_docs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                 VARCHAR(200) NOT NULL,
  source_type           VARCHAR(20) NOT NULL, -- pdf, text, sheets, url
  raw_content           TEXT,
  chunk_count           INT DEFAULT 0,
  status                VARCHAR(20) DEFAULT 'pending', -- pending, indexing, indexed, failed
  drive_file_id         VARCHAR(200),
  file_size_bytes       INT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  indexed_at            TIMESTAMPTZ
);

-- ─── CONVERSATIONS / MESSAGES ────────────────────────────────
CREATE TABLE messages (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_message_id         VARCHAR(100) UNIQUE, -- Meta's message ID (dedup)
  customer_phone        VARCHAR(20) NOT NULL,
  content               TEXT NOT NULL,
  role                  VARCHAR(10) NOT NULL, -- user, bot, agent
  message_type          VARCHAR(20) DEFAULT 'text', -- text, image, document, audio
  media_url             TEXT,
  intent                VARCHAR(50),
  flow_data             JSONB,
  delivery_status       VARCHAR(20), -- sent, delivered, read, failed
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_tenant_phone ON messages(tenant_id, customer_phone);
CREATE INDEX idx_messages_created      ON messages(created_at DESC);

-- ─── CRM CONTACTS ────────────────────────────────────────────
CREATE TABLE crm_contacts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone                 VARCHAR(20) NOT NULL,
  name                  VARCHAR(100),
  email                 VARCHAR(200),
  city                  VARCHAR(100),
  tags                  TEXT[] DEFAULT '{}',
  notes                 TEXT,
  total_orders          INT DEFAULT 0,
  total_spent           DECIMAL(10,2) DEFAULT 0,
  message_count         INT DEFAULT 0,
  last_message          TEXT,
  last_seen             TIMESTAMPTZ,
  opted_in_broadcast    BOOLEAN DEFAULT TRUE,
  first_contact_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone)
);
CREATE INDEX idx_crm_tenant ON crm_contacts(tenant_id);

-- ─── ORDERS ──────────────────────────────────────────────────
CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number          VARCHAR(50) NOT NULL,
  customer_phone        VARCHAR(20) NOT NULL,
  customer_name         VARCHAR(100),
  items_summary         TEXT,
  items_json            JSONB,
  total_amount          DECIMAL(10,2),
  status                VARCHAR(30) DEFAULT 'confirmed', -- confirmed, preparing, shipped, delivered, cancelled
  delivery_addr         TEXT,
  notes                 TEXT,
  sheet_row             INT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_number)
);

-- ─── APPOINTMENTS ────────────────────────────────────────────
CREATE TABLE appointments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appt_number           VARCHAR(50) NOT NULL,
  customer_phone        VARCHAR(20) NOT NULL,
  customer_name         VARCHAR(100),
  service               VARCHAR(200),
  appt_date             TIMESTAMPTZ NOT NULL,
  duration_minutes      INT DEFAULT 60,
  status                VARCHAR(20) DEFAULT 'confirmed', -- confirmed, completed, cancelled, no-show
  notes                 TEXT,
  reminder_24h_sent     BOOLEAN DEFAULT FALSE,
  reminder_1h_sent      BOOLEAN DEFAULT FALSE,
  sheet_row             INT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, appt_number)
);
CREATE INDEX idx_appts_date ON appointments(tenant_id, appt_date);

-- ─── ECOMMERCE PRODUCTS ──────────────────────────────────────
CREATE TABLE products (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  VARCHAR(200) NOT NULL,
  description           TEXT,
  price                 DECIMAL(10,2) NOT NULL,
  category              VARCHAR(100),
  image_url             TEXT,
  stock_quantity        INT DEFAULT -1, -- -1 = unlimited
  is_available          BOOLEAN DEFAULT TRUE,
  sku                   VARCHAR(100),
  sort_order            INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BROADCASTS ──────────────────────────────────────────────
CREATE TABLE broadcasts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                 VARCHAR(200),
  message_content       TEXT NOT NULL,
  media_url             TEXT,
  template_name         VARCHAR(100),
  audience_filter       JSONB,      -- {tags: ["vip"], min_orders: 3}
  recipient_count       INT DEFAULT 0,
  sent_count            INT DEFAULT 0,
  failed_count          INT DEFAULT 0,
  estimated_cost        DECIMAL(10,4),
  actual_cost           DECIMAL(10,4),
  status                VARCHAR(20) DEFAULT 'draft', -- draft, scheduled, sending, sent, cancelled
  scheduled_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LEARNING ENTRIES (Auto-learning AI) ─────────────────────
CREATE TABLE learning_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_message          TEXT NOT NULL,
  bot_reply             TEXT,
  correction            TEXT,
  source                VARCHAR(30), -- human_correction, auto_positive
  indexed               BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TEAM MEMBERS (Business plan) ────────────────────────────
CREATE TABLE team_members (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email                 VARCHAR(200) NOT NULL,
  name                  VARCHAR(100),
  role                  VARCHAR(20) DEFAULT 'agent', -- owner, manager, agent
  password_hash         TEXT,
  is_active             BOOLEAN DEFAULT TRUE,
  last_login            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- ─── AUDIT LOG ───────────────────────────────────────────────
CREATE TABLE audit_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_id              UUID,
  action                VARCHAR(100) NOT NULL,
  resource              VARCHAR(100),
  resource_id           UUID,
  metadata              JSONB,
  ip_address            INET,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- ─── FUNCTIONS ───────────────────────────────────────────────
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated    BEFORE UPDATE ON tenants    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ai_config_updated  BEFORE UPDATE ON tenant_ai_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
