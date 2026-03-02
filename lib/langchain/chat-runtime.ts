import { ChatOpenAI } from "@langchain/openai";

export type ChatRole = "system" | "user" | "assistant";

export type ChatInputMessage = {
  role: ChatRole;
  content: string;
};

export type ImageDecision = {
  useImage: boolean;
  imagePrompt: string;
};

type ModelTask = "chat" | "imageDecision";

function getModelName(task: ModelTask) {
  if (task === "imageDecision") {
    return process.env.IMAGE_DECISION_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

function createModel(task: ModelTask, temperature: number) {
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: getModelName(task),
    temperature,
  });
}

export function chunkToText(content: unknown) {
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

export async function invokeChatResponse(messages: ChatInputMessage[]) {
  const model = createModel("chat", 0.7);
  const invokeResult = await model.invoke(messages);
  const assistantText = chunkToText(invokeResult.content).trim();
  if (!assistantText) {
    throw new Error("模型未生成可用回复。");
  }
  return assistantText;
}

export async function* streamChatResponse(messages: ChatInputMessage[]) {
  const model = createModel("chat", 0.7);
  const stream = await model.stream(messages);
  for await (const chunk of stream) {
    const text = chunkToText(chunk.content);
    if (!text) {
      continue;
    }
    yield text;
  }
}

export async function decideImageReplyByModel(input: {
  userContent: string;
  assistantText: string;
}) {
  const structuredDecisionModel = createModel("imageDecision", 0).withStructuredOutput({
    name: "image_reply_decision",
    schema: {
      type: "object",
      properties: {
        useImage: {
          type: "boolean",
          description: "是否应返回图片",
        },
        imagePrompt: {
          type: "string",
          description: "English prompt text for text-to-image generation",
        },
      },
      required: ["useImage", "imagePrompt"],
      additionalProperties: false,
    },
  });

  const parsed = (await structuredDecisionModel.invoke([
    {
      role: "system",
      content:
        "你是回复模态决策器，需要判断是否应返回图片。当用户表达“想看图片/照片/长相/样子/插画/海报/配图/封面”等视觉诉求时，必须 useImage=true。即使候选文本里说“我没有照片”，也要改为生成一张符合请求的示意图。imagePrompt 必须是可直接用于文生图的英文提示词，包含主体、风格、构图、光线、画质。",
    },
    {
      role: "user",
      content: `用户输入：${input.userContent}\n文本回复候选：${input.assistantText}`,
    },
  ])) as Partial<ImageDecision>;

  return {
    useImage: parsed.useImage === true,
    imagePrompt: (parsed.imagePrompt ?? "").trim(),
  };
}
