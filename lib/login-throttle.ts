import { ensureUsersTable, getSql, toRows } from "@/lib/db";

export const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
export const LOGIN_ATTEMPT_WINDOW_SECONDS = Number(
  process.env.LOGIN_ATTEMPT_WINDOW_SECONDS ?? 15 * 60,
);
export const LOGIN_LOCK_SECONDS = Number(process.env.LOGIN_LOCK_SECONDS ?? 30 * 60);

type LoginLimitRow = {
  scope_key: string;
  failed_count: number;
  first_failed_at: string;
  locked_until: string | null;
};

function getNow() {
  return new Date();
}

function buildScopes(account: string, ip: string | null) {
  const scopes = [`acct:${account.toLowerCase()}`];
  if (ip) {
    scopes.push(`ip:${ip}`);
  }
  return scopes;
}

function getIpFromHeaders(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  const realIp = headers.get("x-real-ip");
  return realIp?.trim() || null;
}

export function getClientIpFromRequest(request: Request) {
  return getIpFromHeaders(request.headers);
}

function getRemainingLockSeconds(lockedUntil: string) {
  const leftMs = new Date(lockedUntil).getTime() - getNow().getTime();
  if (leftMs <= 0) {
    return 0;
  }
  return Math.ceil(leftMs / 1000);
}

export async function assertLoginAllowed(account: string, ip: string | null) {
  await ensureUsersTable();
  const sql = getSql();
  const scopes = buildScopes(account, ip);

  for (const scope of scopes) {
    const result = await sql`
      SELECT scope_key, failed_count, first_failed_at, locked_until
      FROM login_rate_limits
      WHERE scope_key = ${scope}
      LIMIT 1
    `;
    const rows = toRows<LoginLimitRow>(result);
    const row = rows[0];
    if (!row?.locked_until) {
      continue;
    }

    const remain = getRemainingLockSeconds(row.locked_until);
    if (remain > 0) {
      return { allowed: false as const, retryAfter: remain };
    }
  }

  return { allowed: true as const, retryAfter: 0 };
}

export async function recordLoginFailure(account: string, ip: string | null) {
  await ensureUsersTable();
  const sql = getSql();
  const scopes = buildScopes(account, ip);
  const now = getNow();

  for (const scope of scopes) {
    const result = await sql`
      SELECT scope_key, failed_count, first_failed_at, locked_until
      FROM login_rate_limits
      WHERE scope_key = ${scope}
      LIMIT 1
    `;
    const rows = toRows<LoginLimitRow>(result);

    const existing = rows[0];
    if (!existing) {
      await sql`
        INSERT INTO login_rate_limits (scope_key, failed_count, first_failed_at, locked_until, updated_at)
        VALUES (${scope}, 1, NOW(), NULL, NOW())
      `;
      continue;
    }

    const firstFailedAt = new Date(existing.first_failed_at);
    const inWindow =
      now.getTime() - firstFailedAt.getTime() <= LOGIN_ATTEMPT_WINDOW_SECONDS * 1000;
    const nextFailedCount = inWindow ? existing.failed_count + 1 : 1;
    const shouldLock = nextFailedCount >= LOGIN_MAX_ATTEMPTS;

    await sql`
      UPDATE login_rate_limits
      SET
        failed_count = ${nextFailedCount},
        first_failed_at = ${inWindow ? existing.first_failed_at : now.toISOString()},
        locked_until = ${
          shouldLock ? new Date(now.getTime() + LOGIN_LOCK_SECONDS * 1000).toISOString() : null
        },
        updated_at = NOW()
      WHERE scope_key = ${scope}
    `;
  }
}

export async function clearLoginFailures(account: string, ip: string | null) {
  await ensureUsersTable();
  const sql = getSql();
  const scopes = buildScopes(account, ip);
  for (const scope of scopes) {
    await sql`
      DELETE FROM login_rate_limits
      WHERE scope_key = ${scope}
    `;
  }
}
