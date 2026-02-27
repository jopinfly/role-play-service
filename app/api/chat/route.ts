import { ChatOpenAI } from "@langchain/openai";
import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import {
  appendChatMessage,
  createChatSession,
  getLatestSessionByRole,
  getPresetRoleByCode,
  getSessionById,
  listSessionMessages,
} from "@/lib/chat-store";
import { summarizeAndStoreMessage } from "@/lib/chat-summary";
import { synthesizeSpeechByMiniMax } from "@/lib/minimax-tts";

type ChatRole = "system" | "user" | "assistant";

type ChatRequestBody = {
  presetRoleCode?: string;
  sessionId?: string;
  content?: string;
  responseMode?: "text" | "audio";
};

function chunkToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }

      return "";
    })
    .join("");
}

async function saveAssistantMessageAndSummary(sessionId: string, assistantText: string) {
  const assistantMessage = await appendChatMessage({
    sessionId,
    role: "assistant",
    content: assistantText,
  });
  try {
    await summarizeAndStoreMessage(assistantMessage.id, assistantMessage.content);
  } catch (summaryError) {
    console.error("assistant message summary failed", summaryError);
  }
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthFromRequest(request);
  if (!authUser) {
    return NextResponse.json({ error: "未登录或 token 无效。" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "缺少 OPENAI_API_KEY，请先在 .env.local 中配置。" },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const presetRoleCode = body.presetRoleCode?.trim() ?? "";
  const userContent = body.content?.trim() ?? "";
  const responseMode = body.responseMode === "audio" ? "audio" : "text";
  if (!presetRoleCode) {
    return NextResponse.json({ error: "presetRoleCode 不能为空。" }, { status: 400 });
  }
  if (!userContent) {
    return NextResponse.json({ error: "content 不能为空。" }, { status: 400 });
  }

  const preset = await getPresetRoleByCode(presetRoleCode);
  if (!preset) {
    return NextResponse.json({ error: "预设角色不存在。" }, { status: 404 });
  }

  try {
    let session =
      body.sessionId?.trim() && body.sessionId.trim().length > 0
        ? await getSessionById({ sessionId: body.sessionId.trim(), userId: authUser.userId })
        : null;

    if (session && session.presetRoleId !== preset.id) {
      return NextResponse.json({ error: "sessionId 与 presetRoleCode 不匹配。" }, { status: 400 });
    }

    if (!session) {
      session = await getLatestSessionByRole({
        userId: authUser.userId,
        presetRoleId: preset.id,
      });
    }
    if (!session) {
      session = await createChatSession({
        userId: authUser.userId,
        presetRoleId: preset.id,
      });
    }

    const history = await listSessionMessages(session.id, 20);
    const parsedMessages: Array<{ role: ChatRole; content: string }> = [
      { role: "system", content: preset.systemPrompt },
    ];
    if (session.initialContext?.trim()) {
      parsedMessages.push({
        role: "system",
        content: `以下是用户指定的会话上下文，请在本轮及后续对话中参考：${session.initialContext.trim()}`,
      });
    }
    for (const message of history) {
      if (!message.content.trim()) {
        continue;
      }
      parsedMessages.push({ role: message.role, content: message.content });
    }
    parsedMessages.push({ role: "user", content: userContent });

    const userMessage = await appendChatMessage({
      sessionId: session.id,
      role: "user",
      content: userContent,
    });
    try {
      await summarizeAndStoreMessage(userMessage.id, userMessage.content);
    } catch (summaryError) {
      console.error("user message summary failed", summaryError);
    }

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.7,
    });

    if (responseMode === "audio") {
      const invokeResult = await model.invoke(parsedMessages);
      const assistantText = chunkToText(invokeResult.content).trim();
      if (!assistantText) {
        throw new Error("模型未生成可用回复。");
      }

      await saveAssistantMessageAndSummary(session.id, assistantText);
      const audio = await synthesizeSpeechByMiniMax({ text: assistantText });

      return NextResponse.json({
        type: "audio",
        sessionId: session.id,
        audio,
      });
    }

    const stream = await model.stream(parsedMessages);
    const encoder = new TextEncoder();
    const output = new ReadableStream({
      async start(controller) {
        let assistantOutput = "";
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "session", sessionId: session.id })}\n\n`,
            ),
          );

          for await (const chunk of stream) {
            const text = chunkToText(chunk.content);
            if (!text) {
              continue;
            }
            assistantOutput += text;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", content: text })}\n\n`),
            );
          }

          const trimmedAssistant = assistantOutput.trim();
          if (trimmedAssistant) {
            await saveAssistantMessageAndSummary(session.id, trimmedAssistant);
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        } catch (streamError) {
          const message =
            streamError instanceof Error ? streamError.message : "模型流式输出失败";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(output, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `调用模型失败：${message}` }, { status: 500 });
  }
}
