"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";

  const getSafeRedirect = () => {
    if (!redirect.startsWith("/")) {
      return "/";
    }
    if (redirect.startsWith("/login") || redirect.startsWith("/register")) {
      return "/";
    }
    return redirect;
  };

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account.trim() || !password) {
      setError("账号和密码不能为空。");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim(), password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "登录失败。");
      }

      window.location.assign(getSafeRedirect());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-2xl font-semibold">登录</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          登录后可使用聊天机器人。
        </p>

        <div className="mt-6 space-y-3">
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="用户名或邮箱"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>

        {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "登录中..." : "登录"}
        </button>

        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          还没有账号？{" "}
          <Link className="text-blue-600 hover:underline" href="/register">
            去注册
          </Link>
        </p>
      </form>
    </div>
  );
}
