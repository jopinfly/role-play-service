import { ChatOpenAI } from "@langchain/openai";
import { NextResponse } from "next/server";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
};

const systemPrompt =
  "你是一个专业、友好、简洁的中文 AI 助手。回答时尽量先给结论，再给必要解释。";

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

export async function POST(request: Request) {
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

  const incomingMessages = body.messages ?? [];
  if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) {
    return NextResponse.json({ error: "messages 不能为空。" }, { status: 400 });
  }

  const parsedMessages: Array<{ role: ChatRole; content: string }> = [
    { role: "system", content: systemPrompt },
  ];
  for (const message of incomingMessages) {
    if (!message?.content?.trim()) {
      continue;
    }

    parsedMessages.push({ role: message.role, content: message.content });
  }

  try {
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.7,
    });

    const stream = await model.stream(parsedMessages);
    const encoder = new TextEncoder();
    const output = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunkToText(chunk.content);
            if (!text) {
              continue;
            }

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", content: text })}\n\n`),
            );
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
