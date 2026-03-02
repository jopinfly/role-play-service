import { neon } from "@neondatabase/serverless";

let neonClient: ReturnType<typeof neon> | null = null;
let schemaReady = false;

type RowLike = Record<string, unknown>;

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL，请在 .env.local 中配置 Neon 连接串。");
  }

  if (!neonClient) {
    neonClient = neon(databaseUrl);
  }

  return neonClient;
}

export function toRows<T extends RowLike>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  return [];
}

export async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      scope_key TEXT PRIMARY KEY,
      failed_count INT NOT NULL DEFAULT 0,
      first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS preset_roles (
      id BIGSERIAL PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset_role_id BIGINT NOT NULL REFERENCES preset_roles(id) ON DELETE CASCADE,
      title VARCHAR(255),
      initial_context TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_role_status_updated
    ON chat_sessions (user_id, preset_role_id, status, updated_at DESC);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      seq_no INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_session_seq
    ON chat_messages (session_id, seq_no);
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
    ON chat_messages (session_id, created_at);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS message_summaries (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      model VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  schemaReady = true;
}

export async function ensureUsersTable() {
  await ensureSchema();
}
