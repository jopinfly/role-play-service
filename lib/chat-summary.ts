import { ChatOpenAI } from "@langchain/openai";
import { createMessageSummary } from "@/lib/chat-store";

function getSummaryModelName() {
  return process.env.SUMMARY_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export async function summarizeMessage(content: string) {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: getSummaryModelName(),
    temperature: 0,
  });

  const response = await model.invoke([
    {
      role: "system",
      content:
        "你是对话摘要助手。请将消息压缩为 1-2 句中文摘要，保留核心意图与实体信息，不添加原文没有的新事实。",
    },
    {
      role: "user",
      content,
    },
  ]);

  const text =
    typeof response.content === "string"
      ? response.content
      : response.content
          .map((part) => {
            if (typeof part === "string") {
              return part;
            }
            if (part && typeof part === "object" && "text" in part) {
              const value = (part as { text?: unknown }).text;
              return typeof value === "string" ? value : "";
            }
            return "";
          })
          .join("");

  return {
    summary: text.trim().slice(0, 800) || content.trim().slice(0, 800),
    model: getSummaryModelName(),
  };
}

export async function summarizeAndStoreMessage(messageId: string, content: string) {
  const { summary, model } = await summarizeMessage(content);
  await createMessageSummary({
    messageId,
    summary,
    model,
  });
}
