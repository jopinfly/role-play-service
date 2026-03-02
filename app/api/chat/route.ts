import { ChatOpenAI } from "@langchain/openai";
import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import {
  appendChatMessage,
  ChatMessageType,
  createChatSession,
  getLatestSessionByRole,
  getPresetRoleByCode,
  getSessionById,
  listSessionMessages,
} from "@/lib/chat-store";
import { summarizeAndStoreMessage } from "@/lib/chat-summary";
import { synthesizeSpeechByMiniMax } from "@/lib/minimax-tts";
import { generateImageByStability } from "@/lib/stability-image";
import { uploadMediaToBlob } from "@/lib/blob-store";

type ChatRole = "system" | "user" | "assistant";

type ChatRequestBody = {
  presetRoleCode?: string;
  sessionId?: string;
  content?: string;
  responseMode?: "text" | "audio";
  allowImageReply?: boolean;
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

async function saveAssistantMessageAndSummary(input: {
  sessionId: string;
  assistantText: string;
  messageType?: ChatMessageType;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
}) {
  const assistantMessage = await appendChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    messageType: input.messageType ?? "text",
    content: input.assistantText,
    mediaUrl: input.mediaUrl,
    mediaMimeType: input.mediaMimeType,
  });
  try {
    await summarizeAndStoreMessage(assistantMessage.id, assistantMessage.content);
  } catch (summaryError) {
    console.error("assistant message summary failed", summaryError);
  }
}

type ImageDecision = {
  useImage: boolean;
  imagePrompt: string;
};

function shouldForceImageByUserInput(userContent: string) {
  const text = userContent.toLowerCase();
  const keywords = [
    "图片",
    "照片",
    "头像",
    "海报",
    "插画",
    "画一张",
    "生成图",
    "配图",
    "封面图",
    "看下你",
    "长什么样",
    "look like",
    "photo",
    "image",
    "picture",
    "portrait",
    "draw",
    "illustration",
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

async function decideImageReply(input: {
  userContent: string;
  assistantText: string;
  modelName: string;
}) {
  if (shouldForceImageByUserInput(input.userContent)) {
    return {
      useImage: true,
      imagePrompt: `请根据下面需求生成一张高质量图片：${input.userContent}。若用户让你展示“你自己”的照片，请生成为“一个友好、专业的 AI 助手形象肖像”，写实风格，柔和光线，半身构图，干净背景。`,
    };
  }

  const decisionModel = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: input.modelName,
    temperature: 0,
  });

  const decision = await decisionModel.invoke([
    {
      role: "system",
      content:
        "你是回复模态决策器。请严格输出 JSON：{\"useImage\": boolean, \"imagePrompt\": string}。当用户表达“想看图片/照片/长相/样子/插画/海报/配图/封面”等视觉诉求时，必须 useImage=true。即使候选文本里说“我没有照片”，也要改为生成一张符合请求的示意图。imagePrompt 需为可直接用于文生图的中文提示词，包含主体、风格、构图、光线、画质。",
    },
    {
      role: "user",
      content: `用户输入：${input.userContent}\n文本回复候选：${input.assistantText}`,
    },
  ]);

  const raw = chunkToText(decision.content).trim();
  try {
    const parsed = JSON.parse(raw) as Partial<ImageDecision>;
    return {
      useImage: parsed.useImage === true,
      imagePrompt: (parsed.imagePrompt ?? "").trim(),
    };
  } catch {
    return { useImage: false, imagePrompt: "" };
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
  const allowImageReply = body.allowImageReply === true;
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
      messageType: "text",
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

    if (allowImageReply || responseMode === "audio") {
      const invokeResult = await model.invoke(parsedMessages);
      const assistantText = chunkToText(invokeResult.content).trim();
      if (!assistantText) {
        throw new Error("模型未生成可用回复。");
      }

      if (allowImageReply) {
        try {
          const decision = await decideImageReply({
            userContent,
            assistantText,
            modelName: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          });
          if (decision.useImage) {
            const image = await generateImageByStability({
              prompt: decision.imagePrompt || userContent,
            });
            const imageMessageId = crypto.randomUUID();
            const imageUrl = await uploadMediaToBlob({
              folder: "image",
              sessionId: session.id,
              messageId: imageMessageId,
              data: image.buffer,
              extension: image.extension,
              contentType: image.mimeType,
            });
            await saveAssistantMessageAndSummary({
              sessionId: session.id,
              assistantText,
              messageType: "image",
              mediaUrl: imageUrl,
              mediaMimeType: image.mimeType,
            });
            return NextResponse.json({
              type: "image",
              sessionId: session.id,
              content: assistantText,
              image: {
                url: imageUrl,
                mimeType: image.mimeType,
              },
            });
          }
        } catch (imageError) {
          console.error("image reply decision/generation failed", imageError);
        }
      }

      if (responseMode === "audio") {
        const audio = await synthesizeSpeechByMiniMax({ text: assistantText });
        const audioMessageId = crypto.randomUUID();
        const audioUrl = await uploadMediaToBlob({
          folder: "audio",
          sessionId: session.id,
          messageId: audioMessageId,
          data: audio.buffer,
          extension: audio.extension,
          contentType: audio.mimeType,
        });
        await saveAssistantMessageAndSummary({
          sessionId: session.id,
          assistantText,
          messageType: "audio",
          mediaUrl: audioUrl,
          mediaMimeType: audio.mimeType,
        });
        return NextResponse.json({
          type: "audio",
          sessionId: session.id,
          content: assistantText,
          audio: {
            url: audioUrl,
            mimeType: audio.mimeType,
          },
        });
      }

      await saveAssistantMessageAndSummary({
        sessionId: session.id,
        assistantText,
        messageType: "text",
      });
      return NextResponse.json({
        type: "text",
        sessionId: session.id,
        content: assistantText,
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
            await saveAssistantMessageAndSummary({
              sessionId: session.id,
              assistantText: trimmedAssistant,
              messageType: "text",
            });
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
