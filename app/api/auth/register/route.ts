import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  AUTH_TOKEN_MAX_AGE_SECONDS,
  createAuthSession,
  createAuthToken,
  getClientInfo,
  setAuthCookie,
} from "@/lib/auth";
import { ensureUsersTable, getSql, toRows } from "@/lib/db";

type RegisterBody = {
  username?: string;
  email?: string;
  password?: string;
};

type UserRecord = {
  id: string;
  username: string;
  email: string;
};

export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const username = body.username?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (username.length < 3 || username.length > 50) {
    return NextResponse.json(
      { error: "用户名长度需在 3 到 50 个字符之间。" },
      { status: 400 },
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "邮箱格式不正确。" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位。" }, { status: 400 });
  }

  try {
    await ensureUsersTable();
    const sql = getSql();
    const existingResult = await sql`
      SELECT id
      FROM users
      WHERE email = ${email} OR username = ${username}
      LIMIT 1
    `;
    const existing = toRows<{ id: number }>(existingResult);
    if (existing.length > 0) {
      return NextResponse.json({ error: "用户名或邮箱已存在。" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertedResult = await sql`
      INSERT INTO users (username, email, password_hash)
      VALUES (${username}, ${email}, ${passwordHash})
      RETURNING id, username, email
    `;
    const inserted = toRows<UserRecord>(insertedResult);
    const user = inserted[0];

    const clientInfo = getClientInfo(request);
    const sessionId = await createAuthSession(
      user.id,
      clientInfo.ipAddress,
      clientInfo.userAgent,
    );

    const token = await createAuthToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      sessionId,
    });

    const response = NextResponse.json({
      user,
      token,
      expiresIn: AUTH_TOKEN_MAX_AGE_SECONDS,
    });
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ error: `注册失败：${message}` }, { status: 500 });
  }
}
