import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import {
  ChatMessage,
  createChatSession,
  getPresetRoleByCode,
  getSessionById,
  listSessionMessages,
  listSessionsByRole,
} from "@/lib/chat-store";

type CreateSessionBody = {
  presetRoleCode?: string;
  initialContext?: string;
};

function toClientMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    mode: message.messageType,
    audioUrl: message.messageType === "audio" ? message.mediaUrl : null,
    imageUrl: message.messageType === "image" ? message.mediaUrl : null,
    createdAt: message.createdAt,
  };
}

export async function GET(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: "未登录或 token 无效。" }, { status: 401 });
  }

  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
    if (sessionId) {
      const session = await getSessionById({ sessionId, userId: authUser.userId });
      if (!session) {
        return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
      }
      const messages = await listSessionMessages(session.id, 100);
      return NextResponse.json({ messages: messages.map(toClientMessage) });
    }

    const presetRoleCode = request.nextUrl.searchParams.get("presetRoleCode")?.trim() ?? "";
    if (!presetRoleCode) {
      return NextResponse.json({ error: "缺少 presetRoleCode 参数。" }, { status: 400 });
    }

    const preset = await getPresetRoleByCode(presetRoleCode);
    if (!preset) {
      return NextResponse.json({ error: "预设角色不存在。" }, { status: 404 });
    }

    const sessions = await listSessionsByRole({
      userId: authUser.userId,
      presetRoleId: preset.id,
      limit: 30,
    });

    return NextResponse.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        initialContext: session.initialContext,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取会话失败";
    return NextResponse.json({ error: `获取失败：${message}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: "未登录或 token 无效。" }, { status: 401 });
  }

  let body: CreateSessionBody;
  try {
    body = (await request.json()) as CreateSessionBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const presetRoleCode = body.presetRoleCode?.trim() ?? "";
  const initialContext = body.initialContext?.trim();
  if (!presetRoleCode) {
    return NextResponse.json({ error: "presetRoleCode 不能为空。" }, { status: 400 });
  }

  try {
    const preset = await getPresetRoleByCode(presetRoleCode);
    if (!preset) {
      return NextResponse.json({ error: "预设角色不存在。" }, { status: 404 });
    }

    const session = await createChatSession({
      userId: authUser.userId,
      presetRoleId: preset.id,
      initialContext,
    });

    return NextResponse.json(
      {
        session: {
          id: session.id,
          title: session.title,
          initialContext: session.initialContext,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建会话失败";
    return NextResponse.json({ error: `创建失败：${message}` }, { status: 500 });
  }
}

