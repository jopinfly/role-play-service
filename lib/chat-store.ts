import { ensureSchema, getSql, toRows } from "@/lib/db";

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessageType = "text" | "audio" | "image";

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
  message_type: ChatMessageType;
  content: string;
  media_url: string | null;
  media_mime_type: string | null;
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
  messageType: ChatMessageType;
  content: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
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
    messageType: row.message_type,
    content: row.content,
    mediaUrl: row.media_url,
    mediaMimeType: row.media_mime_type,
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
  const result = await sql`
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
  const inserted = toRows<PresetRoleRow>(result);
  return mapPresetRole(inserted[0]);
}

export async function getPresetRoleByCode(code: string, includeInactive = false) {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, code, name, description, system_prompt, is_active
    FROM preset_roles
    WHERE code = ${code}
      AND (${includeInactive}::boolean = TRUE OR is_active = TRUE)
    LIMIT 1
  `;
  const rows = toRows<PresetRoleRow>(result);
  const row = rows[0];
  return row ? mapPresetRole(row) : null;
}

export async function listPresetRoles(): Promise<PresetRole[]> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, code, name, description, system_prompt, is_active
    FROM preset_roles
    WHERE is_active = TRUE
    ORDER BY created_at ASC
  `;
  const rows = toRows<PresetRoleRow>(result);
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
  const result = await sql`
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
  const inserted = toRows<ChatSessionRow>(result);
  return mapChatSession(inserted[0]);
}

export async function listSessionsByRole(input: {
  userId: string;
  presetRoleId: string;
  limit?: number;
}): Promise<ChatSession[]> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE user_id = ${input.userId}
      AND preset_role_id = ${input.presetRoleId}
    ORDER BY updated_at DESC
    LIMIT ${input.limit ?? 20}
  `;
  const rows = toRows<ChatSessionRow>(result);
  return rows.map(mapChatSession);
}

export async function getSessionById(input: { sessionId: string; userId: string }) {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE id = ${input.sessionId}
      AND user_id = ${input.userId}
    LIMIT 1
  `;
  const rows = toRows<ChatSessionRow>(result);
  const row = rows[0];
  return row ? mapChatSession(row) : null;
}

export async function getLatestSessionByRole(input: { userId: string; presetRoleId: string }) {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, user_id, preset_role_id, title, initial_context, status, created_at, updated_at
    FROM chat_sessions
    WHERE user_id = ${input.userId}
      AND preset_role_id = ${input.presetRoleId}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const rows = toRows<ChatSessionRow>(result);
  const row = rows[0];
  return row ? mapChatSession(row) : null;
}

export async function listSessionMessages(sessionId: string, limit = 20): Promise<ChatMessage[]> {
  await ensureSchema();
  const sql = getSql();
  const result = await sql`
    SELECT id, role, message_type, content, media_url, media_mime_type, seq_no, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY seq_no DESC
    LIMIT ${limit}
  `;
  const rows = toRows<ChatMessageRow>(result);
  return rows.reverse().map(mapChatMessage);
}

export async function appendChatMessage(input: {
  sessionId: string;
  role: ChatRole;
  messageType?: ChatMessageType;
  content: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
}) {
  await ensureSchema();
  const sql = getSql();
  const nextResult = await sql`
    SELECT COALESCE(MAX(seq_no), 0) + 1 AS next_seq
    FROM chat_messages
    WHERE session_id = ${input.sessionId}
  `;
  const nextRows = toRows<{ next_seq: number }>(nextResult);
  const nextSeq = nextRows[0]?.next_seq ?? 1;
  const insertResult = await sql`
    INSERT INTO chat_messages (session_id, role, message_type, content, media_url, media_mime_type, seq_no)
    VALUES (
      ${input.sessionId},
      ${input.role},
      ${input.messageType ?? "text"},
      ${input.content},
      ${input.mediaUrl ?? null},
      ${input.mediaMimeType ?? null},
      ${nextSeq}
    )
    RETURNING id, role, message_type, content, media_url, media_mime_type, seq_no, created_at
  `;
  const inserted = toRows<ChatMessageRow>(insertResult);
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
