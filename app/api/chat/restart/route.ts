import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { createChatSession, getPresetRoleByCode } from "@/lib/chat-store";

type RestartBody = {
  presetRoleCode?: string;
  initialContext?: string;
};

export async function POST(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: "未登录或 token 无效。" }, { status: 401 });
  }

  let body: RestartBody;
  try {
    body = (await request.json()) as RestartBody;
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

    return NextResponse.json({
      session: {
        id: session.id,
        title: session.title,
        initialContext: session.initialContext,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重启上下文失败";
    return NextResponse.json({ error: `重启失败：${message}` }, { status: 500 });
  }
}
