# LangChain Chatbot (Next.js + Neon Auth)

这是一个基于 Next.js App Router + LangChain 的聊天机器人项目，支持：

- 流式输出（SSE）
- 聊天气泡动画
- Neon 数据库用户体系
- 预设角色（Preset Roles）
- 按用户 + 角色独立会话存储
- 会话上下文重启（新建会话，保留历史）
- 消息级摘要存储
- 注册 / 登录 / 登出
- JWT Token 鉴权（有效期 30 天）
- 页面与 API 访问保护
- 登录失败次数限制（账号/IP 双维度）
- 可撤销会话（服务端 session + JWT 绑定）

## 1) 安装依赖

```bash
pnpm install
```

## 2) 配置环境变量

复制模板：

```bash
cp env.example .env.local
```

编辑 `.env.local`：

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
SUMMARY_MODEL=gpt-4o-mini
DATABASE_URL=your_neon_database_url
JWT_SECRET=your_jwt_secret_at_least_32_chars
INTERNAL_API_KEY=your_internal_api_key
LOGIN_MAX_ATTEMPTS=5
LOGIN_ATTEMPT_WINDOW_SECONDS=900
LOGIN_LOCK_SECONDS=1800
```

## 3) 启动项目

```bash
pnpm dev
```

访问 `http://localhost:3000`：

- 未登录会自动跳转到 `/login`
- 可在 `/register` 注册后直接登录

## 鉴权与路由保护

- 登录/注册成功后，服务端会签发 JWT（30 天）并写入 HttpOnly Cookie
- JWT 中包含 `sessionId`，每次鉴权会校验服务端 `auth_sessions` 是否有效（支持服务端强制下线）
- `POST /api/auth/logout?all=1` 可下线当前用户所有设备会话
- `middleware.ts` 会保护页面与 API：
  - 放行：`/login`、`/register`、`/api/auth/*`
  - 保护：其余页面、`/api/*`（需要有效 token）
- `POST /api/chat` 路由内部也做了二次 token 校验
- 登录失败限制：
  - 默认 15 分钟窗口内失败 5 次触发锁定
  - 锁定 30 分钟后可重试
  - 规则同时作用于账号与 IP 维度

## 认证 API

- `POST /api/auth/register`
  - body: `{ username, email, password }`
- `POST /api/auth/login`
  - body: `{ account, password }`（account 支持用户名或邮箱）
- `POST /api/auth/logout`
- `GET /api/auth/me`

## 聊天 API

- `POST /api/chat`
  - 需要登录后访问
  - 请求体：

```json
{
  "presetRoleCode": "assistant",
  "sessionId": "optional-session-id",
  "content": "你好，介绍一下你自己"
}
```

- 返回：SSE 流式事件

```json
{ "type": "token", "content": "你好" }
```

```json
{ "type": "session", "sessionId": "new-or-existing-session-id" }
```

## 预设角色与会话 API

- `POST /api/internal/presets`
  - 内部接口，请求头需要：`x-internal-api-key`
  - body: `{ code, name, description?, systemPrompt, isActive? }`
- `GET /api/presets`
  - 获取可用预设角色列表（`is_active = true`）
- `GET /api/chat/sessions?presetRoleCode=<code>`
  - 获取当前用户在该角色下的会话列表
- `POST /api/chat/sessions`
  - body: `{ presetRoleCode, initialContext? }`
  - 创建新会话
- `GET /api/chat/sessions?sessionId=<id>`
  - 获取指定会话的历史消息
- `POST /api/chat/restart`
  - body: `{ presetRoleCode, initialContext? }`
  - 针对某角色创建新会话作为“重启上下文”，旧会话保留

## 端到端验证建议

1. 用内部接口创建至少 2 个预设角色（如 `assistant`、`coach`）。
2. 同一账号分别在两个角色下各发送 2 条消息，确认会话与消息隔离。
3. 调用 `POST /api/chat/restart` 为某个角色写入新 `initialContext` 并继续对话，确认返回新 `sessionId`。
4. 用第二个账号重复步骤 2，确认不同用户之间历史隔离。
5. 在数据库检查 `chat_messages` 与 `message_summaries`，确认每条消息都有摘要记录。
