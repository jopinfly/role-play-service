import { ensureSchema, getSql } from "@/lib/db";

export type ChatRole = "system" | "user" | "assistant";

type PresetRoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  system_prompt: string;
  is_active: boolean;
};

type ChatSessionRow = {
  id: string;
  user_id: string;
  preset_role_id: string;
  title: string | null;
  initial_context: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type ChatMessageRow = {
  id: string;
  role: ChatRole;
  content: string;
  seq_no: number;
  created_at: string;
};

export type PresetRole = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  isActive: boolean;
};

export type ChatSession = {
  id: string;
  userId: string;
  presetRoleId: string;
  title: string | null;
  initialContext: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  seqNo: number;
  createdAt: string;
};

function mapPresetRole(row: PresetRoleRow): PresetRole {
  return {
    id: String(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
  };
}

function mapChatSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    userId: String(row.user_id),
    presetRoleId: String(row.preset_role_id),
    title: row.title,
    initialContext: row.initial_context,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content,
    seqNo: row.seq_no,
    createdAt: row.created_at,
  };
}

export async function createPresetRole(input: {
  code: string;
  name: string;
  description?: string;
  systemPrompt: string;
  isActive?: boolean;
}) {
  await ensureSchema();
  const sql = getSql();
  const inserted = await sql<PresetRoleRow[]>`
    INSERT INTO preset_roles (code, name, description, system_prompt, is_active, updated_at)
    VALUES (
      ${input.code},
      ${input.name},
      ${input.description ?? null},
      ${input.systemPrompt},
      ${input.isActive ?? true},
      NOW()
    )
    RETURNING id, code, name, description, system_prompt, is_active
  `;
  return mapPresetRole(inserted[0]);
}

export async function getPresetRoleByCode(code: string, includeInactive = false) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<PresetRoleRow[]>`
    SELECT id, code, name, description, system_prompt, is_active
    FROM preset_roles
    WHERE code = ${code}
      AND (${includeInactive}::boolean = TRUE OR is_active = TRUE)
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapPresetRole(row) : null;
}

export async function listPresetRoles() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<PresetRoleRow[]>`
    SELECT id, code, name, description, system_prompt, is_active
    FROM preset_roles
    WHERE is_active = TRUE
    ORDER BY created_at ASC
  `;
  return rows.map(mapPresetRole);
}

export async function createChatSession(input: {
  userId: string;
  presetRoleId: string;
  initialContext?: string;
  title?: string;
}) {
  await ensureSchema();
  const sql = getSql();
  const id = crypto.randomUUID();
  const inserted = await sql<ChatSessionRow[]>`
    INSERT INTO chat_sessions (id, user_id, preset_role_id, initial_context, title, status, updated_at)
    VALUES (
      ${id},
      ${input.userId},
      ${input.presetRoleId},
      ${input.initialContext ?? null},
      ${input.title ?? null},
      'active',
      NOW()
    )
    RETURNING id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
  `;
  return mapChatSession(inserted[0]);
}

export async function listSessionsByRole(input: {
  userId: string;
  presetRoleId: string;
  limit?: number;
}) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ChatSessionRow[]>`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE user_id = ${input.userId}
      AND preset_role_id = ${input.presetRoleId}
    ORDER BY updated_at DESC
    LIMIT ${input.limit ?? 20}
  `;
  return rows.map(mapChatSession);
}

export async function getSessionById(input: { sessionId: string; userId: string }) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ChatSessionRow[]>`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE id = ${input.sessionId}
      AND user_id = ${input.userId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapChatSession(row) : null;
}

export async function getLatestSessionByRole(input: { userId: string; presetRoleId: string }) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ChatSessionRow[]>`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE user_id = ${input.userId}
      AND preset_role_id = ${input.presetRoleId}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapChatSession(row) : null;
}

export async function listSessionMessages(sessionId: string, limit = 20) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ChatMessageRow[]>`
    SELECT id, role, content, seq_no, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY seq_no DESC
    LIMIT ${limit}
  `;
  return rows.reverse().map(mapChatMessage);
}

export async function appendChatMessage(input: {
  sessionId: string;
  role: ChatRole;
  content: string;
}) {
  await ensureSchema();
  const sql = getSql();
  const nextRows = await sql<{ next_seq: number }[]>`
    SELECT COALESCE(MAX(seq_no), 0) + 1 AS next_seq
    FROM chat_messages
    WHERE session_id = ${input.sessionId}
  `;
  const nextSeq = nextRows[0]?.next_seq ?? 1;
  const inserted = await sql<ChatMessageRow[]>`
    INSERT INTO chat_messages (session_id, role, content, seq_no)
    VALUES (${input.sessionId}, ${input.role}, ${input.content}, ${nextSeq})
    RETURNING id, role, content, seq_no, created_at
  `;
  await touchSession(input.sessionId);
  return mapChatMessage(inserted[0]);
}

export async function touchSession(sessionId: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE chat_sessions
    SET updated_at = NOW()
    WHERE id = ${sessionId}
  `;
}

export async function createMessageSummary(input: {
  messageId: string;
  summary: string;
  model: string;
}) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO message_summaries (message_id, summary, model)
    VALUES (${input.messageId}, ${input.summary}, ${input.model})
    ON CONFLICT (message_id)
    DO UPDATE SET
      summary = EXCLUDED.summary,
      model = EXCLUDED.model
  `;
}
