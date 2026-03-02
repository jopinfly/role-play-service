import { JWTPayload, SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { ensureUsersTable, getSql, toRows } from "@/lib/db";

export const AUTH_COOKIE_NAME = "auth_token";
export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  userId: string;
  username: string;
  email: string;
  sessionId: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("缺少 JWT_SECRET，请在 .env.local 中配置。");
  }
  return new TextEncoder().encode(secret);
}

function parseJwtPayload(payload: JWTPayload): AuthUser | null {
  if (
    (typeof payload.userId !== "number" && typeof payload.userId !== "string") ||
    typeof payload.username !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.sessionId !== "string"
  ) {
    return null;
  }

  return {
    userId: String(payload.userId),
    username: payload.username,
    email: payload.email,
    sessionId: payload.sessionId,
  };
}

export function getClientInfo(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");
  return {
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  };
}

export async function createAuthSession(
  userId: string,
  ipAddress: string | null,
  userAgent: string | null,
) {
  await ensureUsersTable();
  const sql = getSql();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_MAX_AGE_SECONDS * 1000).toISOString();
  await sql`
    INSERT INTO auth_sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (${sessionId}, ${userId}, ${expiresAt}, ${ipAddress}, ${userAgent})
  `;
  return sessionId;
}

export async function createAuthToken(user: AuthUser) {
  return new SignJWT({
    userId: user.userId,
    username: user.username,
    email: user.email,
    sessionId: user.sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_TOKEN_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());
}

async function isSessionActive(sessionId: string, userId: string) {
  await ensureUsersTable();
  const sql = getSql();
  const result = await sql`
    SELECT id
    FROM auth_sessions
    WHERE id = ${sessionId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  const rows = toRows<{ id: string }>(result);
  return rows.length > 0;
}

export async function verifyAuthToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const parsed = parseJwtPayload(payload);
    if (!parsed) {
      return null;
    }
    const active = await isSessionActive(parsed.sessionId, parsed.userId);
    return active ? parsed : null;
  } catch {
    return null;
  }
}

export async function verifyAuthTokenStateless(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return parseJwtPayload(payload);
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  return request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function getAuthFromRequest(request: NextRequest) {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return null;
  }
  return verifyAuthToken(token);
}

export async function revokeSessionById(sessionId: string) {
  await ensureUsersTable();
  const sql = getSql();
  await sql`
    UPDATE auth_sessions
    SET revoked_at = NOW()
    WHERE id = ${sessionId}
      AND revoked_at IS NULL
  `;
}

export async function revokeAllSessionsByUserId(userId: string) {
  await ensureUsersTable();
  const sql = getSql();
  await sql`
    UPDATE auth_sessions
    SET revoked_at = NOW()
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
  `;
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_TOKEN_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
