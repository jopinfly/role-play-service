import { NextRequest, NextResponse } from "next/server";
import { createPresetRole, getPresetRoleByCode } from "@/lib/chat-store";

type CreatePresetBody = {
  code?: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  isActive?: boolean;
};

function normalizeCode(code: string) {
  return code.trim().toLowerCase().replace(/\s+/g, "-");
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    throw new Error("缺少 INTERNAL_API_KEY，请先在环境变量中配置。");
  }
  const provided = request.headers.get("x-internal-api-key")?.trim();
  return provided === expected;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "无效的内部 API Key。" }, { status: 401 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "鉴权失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let body: CreatePresetBody;
  try {
    body = (await request.json()) as CreatePresetBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const rawCode = body.code?.trim() ?? "";
  const code = normalizeCode(rawCode);
  const name = body.name?.trim() ?? "";
  const systemPrompt = body.systemPrompt?.trim() ?? "";
  const description = body.description?.trim();

  if (!code || !/^[a-z0-9-]{2,64}$/.test(code)) {
    return NextResponse.json(
      { error: "code 必须是 2-64 位小写字母/数字/短横线。" },
      { status: 400 },
    );
  }

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "name 长度需在 2-100 个字符之间。" }, { status: 400 });
  }

  if (!systemPrompt) {
    return NextResponse.json({ error: "systemPrompt 不能为空。" }, { status: 400 });
  }

  try {
    const existing = await getPresetRoleByCode(code, true);
    if (existing) {
      return NextResponse.json({ error: "该 code 的预设角色已存在。" }, { status: 409 });
    }

    const preset = await createPresetRole({
      code,
      name,
      description,
      systemPrompt,
      isActive: body.isActive ?? true,
    });

    return NextResponse.json(
      {
        preset: {
          id: preset.id,
          code: preset.code,
          name: preset.name,
          description: preset.description,
          isActive: preset.isActive,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建预设角色失败";
    return NextResponse.json({ error: `创建失败：${message}` }, { status: 500 });
  }
}
