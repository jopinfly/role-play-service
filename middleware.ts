import { NextRequest, NextResponse } from "next/server";
import { extractTokenFromRequest, verifyAuthTokenStateless } from "@/lib/auth";

const PUBLIC_PAGE_PATHS = new Set(["/login", "/register"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/internal")) {
    return NextResponse.next();
  }

  const token = extractTokenFromRequest(request);
  const authUser = token ? await verifyAuthTokenStateless(token) : null;

  if (pathname.startsWith("/api/")) {
    if (!authUser) {
      return NextResponse.json({ error: "未登录或 token 已过期。" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    if (authUser) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!authUser) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
