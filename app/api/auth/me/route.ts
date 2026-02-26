import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      userId: authUser.userId,
      username: authUser.username,
      email: authUser.email,
    },
  });
}
