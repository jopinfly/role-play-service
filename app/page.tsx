"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是基于 LangChain 的聊天机器人。你可以直接问我问题。",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSubmit = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userInput = input.trim();

    if (!userInput || isLoading) {
      return;
    }

    setError("");
    setInput("");
    setIsLoading(true);

    const nextMessages = [...messages, { role: "user" as const, content: userInput }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "服务暂时不可用，请稍后再试。");
      }

      if (!response.body) {
        throw new Error("浏览器不支持流式读取，或服务未返回流。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const splitIndex = buffer.indexOf("\n\n");
          if (splitIndex === -1) {
            break;
          }

          const rawEvent = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);

          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) {
            continue;
          }

          const payload = JSON.parse(dataLine.slice(6)) as {
            type: "token" | "done" | "error";
            content?: string;
            error?: string;
          };

          if (payload.type === "token" && payload.content) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") {
                return prev;
              }

              next[next.length - 1] = {
                ...last,
                content: `${last.content}${payload.content}`,
              };
              return next;
            });
          }

          if (payload.type === "error") {
            throw new Error(payload.error ?? "模型流式输出失败。");
          }
        }
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "请求失败，请检查网络或配置。";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-white px-4 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">LangChain Chatbot</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          前端基于 Next.js，后端通过 LangChain 调用大模型。
        </p>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto scroll-smooth rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`animate-chat-pop max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm transition-all duration-300 ${
              message.role === "user"
                ? "ml-auto bg-blue-600 text-white"
                : "bg-white text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {message.content || (
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <form onSubmit={handleSubmit} className="mt-4 space-y-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入你的问题，按发送即可对话"
          className="min-h-28 w-full resize-y rounded-xl border border-zinc-300 p-3 text-sm outline-none ring-blue-500 transition focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center justify-between">
          {error ? <p className="text-sm text-red-500">{error}</p> : <span />}
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {isLoading ? "发送中..." : "发送"}
          </button>
        </div>
      </form>
    </div>
  );
}
