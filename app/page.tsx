"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type PresetRole = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};

type ChatSession = {
  id: string;
  title: string | null;
  initialContext: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  mode?: "text" | "audio";
  audioUrl?: string;
};

function buildAssistantGreeting(roleName?: string) {
  if (!roleName) {
    return "请选择一个预设角色后开始对话。";
  }
  return `你正在与「${roleName}」对话。输入消息开始聊天。`;
}

export default function Home() {
  const [profile, setProfile] = useState<{ username: string; email: string } | null>(null);
  const [presets, setPresets] = useState<PresetRole[]>([]);
  const [selectedPresetCode, setSelectedPresetCode] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [restartContext, setRestartContext] = useState("");
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.code === selectedPresetCode) ?? null,
    [presets, selectedPresetCode],
  );
  const canSubmit = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const loadInitialData = async () => {
      const [profileResponse, presetResponse] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/presets"),
      ]);

      if (profileResponse.ok) {
        const profileData = (await profileResponse.json()) as {
          user?: { username?: string; email?: string };
        };
        if (profileData.user?.username && profileData.user?.email) {
          setProfile({ username: profileData.user.username, email: profileData.user.email });
        }
      }

      if (!presetResponse.ok) {
        if (presetResponse.status === 401) {
          window.location.href = "/login";
          return;
        }
        setError("获取预设角色失败，请稍后重试。");
        return;
      }

      const presetData = (await presetResponse.json()) as {
        presets?: PresetRole[];
      };
      const nextPresets = presetData.presets ?? [];
      setPresets(nextPresets);
      setSelectedPresetCode((prev) => prev || nextPresets[0]?.code || "");
      if (nextPresets.length === 0) {
        setMessages([{ role: "assistant", content: "暂无可用预设角色，请联系管理员创建。" }]);
      }
    };

    void loadInitialData();
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const loadSessionMessages = async (sessionId: string, presetName?: string) => {
    const response = await fetch(`/api/chat/sessions?sessionId=${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error("加载会话消息失败。");
    }
    const data = (await response.json()) as { messages?: ChatMessage[] };
    const loadedMessages = (data.messages ?? []).filter(
      (message) => message.role === "user" || message.role === "assistant",
    );
    if (loadedMessages.length === 0) {
      setMessages([{ role: "assistant", content: buildAssistantGreeting(presetName) }]);
      return;
    }
    setMessages(loadedMessages);
  };

  const loadSessions = async (presetRoleCode: string) => {
    if (!presetRoleCode) {
      return;
    }
    const response = await fetch(
      `/api/chat/sessions?presetRoleCode=${encodeURIComponent(presetRoleCode)}`,
    );
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      throw new Error("获取会话列表失败。");
    }
    const data = (await response.json()) as { sessions?: ChatSession[] };
    const nextSessions = data.sessions ?? [];
    setSessions(nextSessions);
    if (nextSessions.length === 0) {
      setCurrentSessionId(null);
      const presetName = presets.find((preset) => preset.code === presetRoleCode)?.name;
      setMessages([{ role: "assistant", content: buildAssistantGreeting(presetName) }]);
      return;
    }
    const firstSessionId = nextSessions[0].id;
    setCurrentSessionId(firstSessionId);
    const presetName = presets.find((preset) => preset.code === presetRoleCode)?.name;
    await loadSessionMessages(firstSessionId, presetName);
  };

  useEffect(() => {
    if (!selectedPresetCode) {
      return;
    }
    void loadSessions(selectedPresetCode).catch((loadError) => {
      const message = loadError instanceof Error ? loadError.message : "加载会话失败。";
      setError(message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetCode]);

  const refreshCurrentPresetSessions = async (presetRoleCode: string) => {
    const response = await fetch(
      `/api/chat/sessions?presetRoleCode=${encodeURIComponent(presetRoleCode)}`,
    );
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { sessions?: ChatSession[] };
    setSessions(data.sessions ?? []);
  };

  const handleSwitchSession = async (sessionId: string) => {
    if (!selectedPresetCode || isLoading) {
      return;
    }
    setError("");
    setCurrentSessionId(sessionId);
    try {
      await loadSessionMessages(sessionId, selectedPreset?.name);
    } catch (switchError) {
      const message = switchError instanceof Error ? switchError.message : "切换会话失败。";
      setError(message);
    }
  };

  const handleRestartContext = async () => {
    if (!selectedPresetCode || isLoading) {
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/chat/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetRoleCode: selectedPresetCode,
          initialContext: restartContext.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "重启上下文失败。");
      }
      const data = (await response.json()) as { session?: ChatSession };
      if (data.session?.id) {
        setCurrentSessionId(data.session.id);
      }
      setMessages([{ role: "assistant", content: buildAssistantGreeting(selectedPreset?.name) }]);
      setRestartContext("");
      await refreshCurrentPresetSessions(selectedPresetCode);
    } catch (restartError) {
      const message = restartError instanceof Error ? restartError.message : "重启上下文失败。";
      setError(message);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userInput = input.trim();

    if (!selectedPresetCode) {
      setError("请先选择预设角色。");
      return;
    }
    if (!userInput || isLoading) {
      return;
    }

    setError("");
    setInput("");
    setIsLoading(true);

    const presetCodeAtRequest = selectedPresetCode;
    setMessages((prev) => [...prev, { role: "user", content: userInput }, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetRoleCode: presetCodeAtRequest,
          sessionId: currentSessionId,
          content: userInput,
          responseMode: voiceReplyEnabled ? "audio" : "text",
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        throw new Error(data?.error ?? "服务暂时不可用，请稍后再试。");
      }

      if (voiceReplyEnabled) {
        const payload = (await response.json()) as {
          type: "audio";
          sessionId?: string;
          audio?: { base64?: string; mimeType?: string };
        };
        if (payload.sessionId) {
          setCurrentSessionId(payload.sessionId);
        }
        const mimeType = payload.audio?.mimeType ?? "audio/mpeg";
        const base64 = payload.audio?.base64 ?? "";
        if (!base64) {
          throw new Error("语音合成成功但音频为空。");
        }
        const audioUrl = `data:${mimeType};base64,${base64}`;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") {
            return prev;
          }
          next[next.length - 1] = {
            ...last,
            content: "语音回复",
            mode: "audio",
            audioUrl,
          };
          return next;
        });
        await refreshCurrentPresetSessions(presetCodeAtRequest);
        return;
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
            type: "session" | "token" | "done" | "error";
            sessionId?: string;
            content?: string;
            error?: string;
          };

          if (payload.type === "session" && payload.sessionId) {
            setCurrentSessionId(payload.sessionId);
          }

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
                mode: "text",
              };
              return next;
            });
          }

          if (payload.type === "error") {
            throw new Error(payload.error ?? "模型流式输出失败。");
          }
        }
      }
      await refreshCurrentPresetSessions(presetCodeAtRequest);
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
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">LangChain Chatbot</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            支持预设角色、独立会话、消息摘要与上下文重启。
          </p>
          {profile ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              当前用户：{profile.username} ({profile.email})
            </p>
          ) : null}
        </div>
        <button
          onClick={handleLogout}
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          退出登录
        </button>
      </header>

      <section className="mb-4 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-3">
        <div className="space-y-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">预设角色</p>
          <select
            value={selectedPresetCode}
            onChange={(event) => setSelectedPresetCode(event.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {presets.map((preset) => (
              <option key={preset.code} value={preset.code}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">会话列表</p>
          <div className="flex flex-wrap gap-2">
            {sessions.length === 0 ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">暂无历史会话</span>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void handleSwitchSession(session.id)}
                  className={`rounded-lg border px-2 py-1 text-xs ${
                    currentSessionId === session.id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  {session.id.slice(0, 8)}
                </button>
              ))
            )}
          </div>
        </div>
        <div className="space-y-1 md:col-span-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">重启上下文（可选）</p>
          <div className="flex gap-2">
            <input
              value={restartContext}
              onChange={(event) => setRestartContext(event.target.value)}
              placeholder="输入该角色新的初始上下文，然后点击“重启会话”"
              className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="button"
              onClick={() => void handleRestartContext()}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              重启会话
            </button>
          </div>
        </div>
        <div className="space-y-1 md:col-span-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={voiceReplyEnabled}
              onChange={(event) => setVoiceReplyEnabled(event.target.checked)}
            />
            语音回复（仅输出语音，不支持语音输入）
          </label>
        </div>
      </section>

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
            {message.mode === "audio" && message.audioUrl ? (
              <audio controls src={message.audioUrl} className="w-full max-w-sm">
                你的浏览器不支持 audio 标签。
              </audio>
            ) : message.content ? (
              message.content
            ) : (
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
          placeholder="输入你的问题，按发送即可对话（按角色独立存储）"
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
