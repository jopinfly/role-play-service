import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  AUTH_TOKEN_MAX_AGE_SECONDS,
  createAuthSession,
  createAuthToken,
  getClientInfo,
  setAuthCookie,
} from "@/lib/auth";
import { ensureUsersTable, getSql } from "@/lib/db";
import {
  assertLoginAllowed,
  clearLoginFailures,
  getClientIpFromRequest,
  recordLoginFailure,
} from "@/lib/login-throttle";

type LoginBody = {
  account?: string;
  password?: string;
};

type UserLoginRecord = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const account = body.account?.trim() ?? "";
  const password = body.password ?? "";

  if (!account || !password) {
    return NextResponse.json({ error: "账号和密码不能为空。" }, { status: 400 });
  }

  try {
    const clientIp = getClientIpFromRequest(request);
    const guard = await assertLoginAllowed(account, clientIp);
    if (!guard.allowed) {
      return NextResponse.json(
        {
          error: `尝试次数过多，请在 ${guard.retryAfter} 秒后重试。`,
          retryAfter: guard.retryAfter,
        },
        { status: 429 },
      );
    }

    await ensureUsersTable();
    const sql = getSql();
    const emailCandidate = account.toLowerCase();
    const rows = await sql<UserLoginRecord[]>`
      SELECT id, username, email, password_hash
      FROM users
      WHERE email = ${emailCandidate} OR username = ${account}
      LIMIT 1
    `;
    const user = rows[0];

    if (!user) {
      await recordLoginFailure(account, clientIp);
      return NextResponse.json({ error: "账号或密码错误。" }, { status: 401 });
    }

    const passwordMatched = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatched) {
      await recordLoginFailure(account, clientIp);
      return NextResponse.json({ error: "账号或密码错误。" }, { status: 401 });
    }

    await clearLoginFailures(account, clientIp);

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
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      token,
      expiresIn: AUTH_TOKEN_MAX_AGE_SECONDS,
    });
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return NextResponse.json({ error: `登录失败：${message}` }, { status: 500 });
  }
}
