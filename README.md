# LangChain Chatbot (Next.js)

这是一个基于 Next.js App Router + LangChain 的简单聊天机器人示例，支持流式输出（SSE）与聊天气泡动画。

## 已完成内容

- 聊天页面：`app/page.tsx`
- 聊天接口：`app/api/chat/route.ts`
- 环境变量示例：`env.example`

## 1) 安装依赖

```bash
pnpm install
pnpm add langchain @langchain/openai
```

## 2) 配置环境变量

把 `env.example` 复制为 `.env.local`，并填写你的 OpenAI Key：

```bash
cp env.example .env.local
```

`.env.local` 内容示例：

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

## 3) 启动项目

```bash
pnpm dev
```

访问 `http://localhost:3000`，即可使用聊天机器人。

## 接口说明

- 路径：`POST /api/chat`
- 请求体：

```json
{
  "messages": [
    { "role": "user", "content": "你好，介绍一下你自己" }
  ]
}
```

- 返回（SSE 流式事件）：

```json
{
  "type": "token",
  "content": "你好"
}
```
