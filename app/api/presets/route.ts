import { NextResponse } from "next/server";
import { listPresetRoles } from "@/lib/chat-store";

export async function GET() {
  try {
    const presets = await listPresetRoles();
    return NextResponse.json({
      presets: presets.map((preset) => ({
        id: preset.id,
        code: preset.code,
        name: preset.name,
        description: preset.description,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取预设角色失败";
    return NextResponse.json({ error: `获取失败：${message}` }, { status: 500 });
  }
}
