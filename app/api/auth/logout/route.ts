import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  getAuthFromRequest,
  revokeAllSessionsByUserId,
  revokeSessionById,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  const allSessions = request.nextUrl.searchParams.get("all") === "1";

  if (authUser) {
    if (allSessions) {
      await revokeAllSessionsByUserId(authUser.userId);
    } else {
      await revokeSessionById(authUser.sessionId);
    }
  }

  const response = NextResponse.json({ success: true });
  clearAuthCookie(response);
  return response;
}
