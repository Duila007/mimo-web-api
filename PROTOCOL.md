# MiMo Studio 网页端协议逆向笔记

> 本文记录 mimo-web-api 所依赖的 aistudio.xiaomimimo.com 网页端接口细节，
> 均通过对网页前端 JS 包（main.911869f9.chunk.js 等）静态分析 + 实测得到。

## 1. 鉴权

- 登录态由一组 **Xiaomi 账号 Cookie** 维持（含 httpOnly 的 `serviceToken`），作用域 `.xiaomi.com` / `aistudio.xiaomimimo.com`。
- 应用层会话令牌为 `xiaomichatbot_ph`（一个 base64 值）。
- 网页端前端 HTTP 客户端会在 **每个 POST 请求** 上自动附加查询参数 `xiaomichatbot_ph=<令牌>`（源码：post 重写中 `{[wl]: token}`），同时携带完整 Cookie（`credentials: "same-origin"`）。
- 实测：仅有 `userId + xiaomichatbot_ph`（无 httpOnly Cookie）访问 `/open-apis/*` 返回 `401` 并给出 `loginUrl`（`account.xiaomi.com/pass/serviceLogin?...&sid=xiaomichatbot`），因此 **httpOnly Cookie 是必需的**。
- 会话校验接口：`GET /open-apis/user/mi/get` → `{"code":0,"data":{"userId":"..."}}`。

## 2. 聊天接口

- 普通模型：`POST /open-apis/bot/chat`
- UltraSpeed 模型（如 `mimo-v2.6-pro-ultraspeed-studio`）：`POST /fastchat/open-apis/bot/chat`
- 请求头：`Content-Type: application/json`、`Accept-Language: zh-CN`、`x-timeZone: Asia/Shanghai`（浏览器额外带 Origin/Referer/UA，实测非必需字段但建议带上）。
- **没有独立的"创建会话"接口**：首条消息携带新的 `conversationId` 即自动建会话。

### 请求载荷

```jsonc
{
  "msgId": "<32位hex>",              // 每条消息新生成
  "conversationId": "<32位hex>",     // 同一会话内保持不变
  "query": "用户消息文本",
  "isEditedQuery": false,
  "previousDialogueId": null,        // 上一轮 SSE 返回的 dialogId，多轮续链的关键；首轮为 null
  "sceneType": null,
  "params": {},
  "modelConfig": {
    "model": "mimo-v2.6-pro-ultraspeed-studio",
    "enableThinking": false,
    "webSearchStatus": "disabled"    // disabled | auto | enabled
  },
  "multiMedias": []                  // 附件走 /open-apis/resource 上传流程，暂未支持
}
```

网页端 `viaFastchat` 判定：`model === ultraspeedModelCode` 时走 `/fastchat` 前缀端点。

## 3. 流式响应（text/event-stream）

响应为标准 SSE 变体，**冒号后无空格**：

```
id:<32位hex>
event:dialogId
data:{"type":null,"content":"479384","usage":null}

id:<32位hex>
event:message
data:{"type":"text","content":"<think>\u0000...思考增量...","usage":null}

id:<32位hex>
event:usage
data:{"promptTokens":2242,"completionTokens":78,"totalTokens":2320,"nativeUsage":{...}}

id:<32位hex>
event:finish
data:{"type":null,"content":"[DONE]","usage":null}
```

### 事件类型（与网页端消费逻辑一一对应）

| event | 含义 | data 关键字段 |
| --- | --- | --- |
| `dialogId` | 本轮对话 ID（下一轮的 `previousDialogueId`） | `content` |
| `message` | 正文/思考增量 | `type:"text"`, `content` |
| `usage` | token 统计（随流多次推送，取最后一次） | `promptTokens/completionTokens/totalTokens/nativeUsage` |
| `web_search` | 联网搜索结果 | 对象 |
| `error` | 上游错误 | `content` |
| `sensitive_query` / `sensitive_title` | 内容审核拦截 | `content` |
| `doc` | webSearch/docParse 过程开始 | `content` |
| `tip_ratio` / `tip_truncate` | 提示比例 / 截断 | - |
| `finish` | 结束 | `content:"[DONE]"` |

### 思考内容标记

思考（reasoning）直接混在 `message` 增量中，以
`<think>\u0000` 开始、`</think>\u0000` 结束（**标记后带 NUL 字符**，
前端源码常量 `O="<think>\0"`、`U="</think>\0"`）。
mimo-web-api 的 `thinking.js` 负责把混合流拆分为 `reasoning_content` 与 `content`。

## 4. 模型列表

来源 `GET /open-apis/bot/config` → `data.modelConfigListNg`。聊天可用的模型（节选）：

- `mimo-v2.6-pro-ultraspeed-studio`（UltraSpeed，走 `/fastchat`）
- `mimo-v2.6-pro`、`mimo-v2.6-flash`
- `mimo-v2.5-pro`、`mimo-v2.5`
- `mimo-v2.1-pro`、`mimo-v2.1-pro-preview`、`mimo-v2-pro`、`mimo-v2-flash`

（另有 tts / asr / omni 类模型，聊天接口不适用，未纳入。）

## 5. 其他相关接口

- `GET|POST /open-apis/chat/conversation/list`、`/fastchat/open-apis/chat/dialog/list`：历史会话列表
- `POST /open-apis/chat/conversation/genTitle`：会话标题生成
- `POST /open-apis/chat/dialog/feedback`：点赞点踩
- `POST /open-apis/resource/genUploadInfo` → `PUT <uploadUrl>`：附件上传（多模态用）
- `GET /ws/ticket` + WebSocket：语音实时通道（liveKit RTC），聊天主链路不依赖

## 6. AT/RT 自动续期（STS 换发流程）

小米账号体系中：
- **RT（长效）** = `passToken`（`.xiaomi.com` 域 Cookie，通常数月有效）
- **AT（短效）** = `xiaomichatbot_serviceToken`（`aistudio.xiaomimimo.com` 域 Cookie，会过期）

换发流程（mimo-web-api 的 `session.js` 已实现，全程无需人工）：

```
1. 不带有效 serviceToken 请求任意 open-apis 接口
   → 401，响应体含 loginUrl：
     https://account.xiaomi.com/pass/serviceLogin?callback=<aistudio/sts?sign=...>&sid=xiaomichatbot

2. 携带 { userId, passToken } Cookie 访问该 loginUrl（追加 &_json=true）
   → 200，响应体 "&&&START&&&{...}" JSON：
     成功：{ "code": 0, "location": "https://aistudio.xiaomimimo.com/sts?sign=...&auth=...&nonce=..." }
     失败：{ "code": 70016, "description": "登录验证失败" }   ← passToken 无效

3. 访问 location（一次性票据）
   → 响应 Set-Cookie 种下新的 xiaomichatbot_serviceToken / xiaomichatbot_ph / userId

4. 用新 Cookie 继续调用 API，并缓存到 data/session-cache.json
```

已在浏览器实测：登录态下访问该 loginUrl 会自动重定向回 aistudio 并种下新 Cookie，无任何人工交互。
服务端还配了周期保活（`SESSION_REFRESH_HOURS`，默认 6 小时）：先校验缓存会话，失效才换发，尽量减少对 passport 的请求。

## 7. 错误语义

| HTTP 状态 | 含义 |
| --- | --- |
| 302 / 401 | 未登录 / 会话过期（响应含 loginUrl） |
| 429 | 限流 |
| 451 / 461 | 账号被限制（461 为永久） |
