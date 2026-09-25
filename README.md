# mimo-web-api

将**小米 MiMo Studio 网页端**（aistudio.xiaomimimo.com）逆向封装为 **OpenAI 兼容 API** 的反代服务，内置**可视化管理面板**。

参考 [deepseek-free-api](https://github.com/Vinlic/deepseek-free-api)、[grok2api](https://github.com/chenyme/grok2api) 等同类项目的思路实现。

> ⚠️ **免责声明**：本项目仅供学习研究，使用的是网页端非官方接口，存在随时失效或账号被限制的风险，请勿用于商业用途，自行承担使用风险。

---

## 管理面板

部署后浏览器打开 `http://<服务地址>:8000/panel`（输入 API_KEY 登录）：

- **概览**：账号数、今日调用量 / token 用量、服务配置
- **账号池**：每个账号的模式（AT/RT 或 Cookie）、健康度、失败/冷却、最近换发时间；支持删除面板添加的账号
- **添加账号**：
  - **小米账号登录（推荐）**：在面板内直接用 手机号+短信验证码 或 账号+密码 登录小米账号，服务端自动获取 passToken（RT）与 serviceToken（AT）并入库，**全程无需复制任何 Cookie**（登录时如弹出滑块，在页面弹层中拖动即可）
  - 手动添加 passToken / 完整 Cookie（备用）
- **统计**：今日与近 14 天的请求数 / token 用量 / 错误数（按模型聚合，持久化到 `data/usage.json`）
- **日志**：最近 200 条请求（模型、状态、耗时、token）
- **对话测试**：面板内直接发消息（流式/非流式），可视化思考与回复

## 特性

- ✅ OpenAI 兼容：`/v1/chat/completions`、`/v1/models`，可直接对接 LobeChat / NextChat /沉浸式翻译 / Dify 等客户端
- ✅ 支持流式（SSE）与非流式两种响应
- ✅ 思考内容（reasoning）拆分：以 `reasoning_content` 字段输出（DeepSeek R1 风格）
- ✅ 真多轮对话：自动用上游 `dialogId` 续链，或逐轮回放历史消息
- ✅ **AT/RT 自动续期**：用长效 `passToken`（RT）配置账号，服务端自动换发短效 `serviceToken`（AT），长期免维护；面板内手机号/密码登录可全自动获取
- ✅ **工具透传**：客户端发送 OpenAI `tools` 时模拟函数调用（注入工具协议 + 解析 `tool_calls`），请求级可开关
- ✅ 多账号池：Cookie 模式与 AT/RT 模式可混用，轮询负载均衡，失败账号指数退避冷却
- ✅ 零依赖：纯 Node.js（>= 18）实现，无需安装任何 npm 包
- ✅ Docker 一键部署

## 两种账号模式

| | AT/RT 模式（推荐） | Cookie 模式 |
| --- | --- | --- |
| 配置内容 | `userId` + `passToken` | 完整 Cookie 串 |
| 有效期 | 长期（passToken 长效） | 短期（serviceToken 过期即失效） |
| 过期处理 | **自动换发，无需人工**（401 自动重试 + 周期保活） | 需重新抓取 Cookie |
| 适用场景 | 服务器长期挂机 | 临时使用 |

对应关系：`passToken` 即 RT（Refresh Token，长效登录凭证），`xiaomichatbot_serviceToken` 即 AT（Access Token，短期访问凭证）。服务端通过小米官方 STS 流程用 RT 换新 AT，参考 [PROTOCOL.md](PROTOCOL.md)。

### 获取 passToken（AT/RT 模式）

1. 浏览器登录 [https://aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com)；
2. `F12` 打开开发者工具 → **应用（Application）** → 存储 → **Cookie** → 选择 `https://account.xiaomi.com`；
3. 找到名为 **`passToken`** 的条目，复制它的值；
4. 连同你的 `userId` 一起写入 `MIMO_ACCOUNTS`（见下方配置）。

> 找不到 account.xiaomi.com 的 Cookie？在 Network 面板筛选 `account.xiaomi.com`，点开任意请求查看请求标头里的 `Cookie:`，其中 `passToken=...` 就是。

## 准备：获取上游 Cookie（Cookie 模式）

1. 浏览器打开并登录 [https://aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com)；
2. 按 `F12` 打开开发者工具 → **Network（网络）** 面板；
3. 随便发一条消息，在请求列表中点开任意一个 `open-apis` 开头的请求；
4. 在 **Request Headers** 中找到 `Cookie:` 一行，**完整复制**它的值。

> 必须用 Network 面板复制！`document.cookie` 或 Application 面板逐个拼接容易遗漏 `httpOnly` 的 `serviceToken` 等关键 Cookie，会导致 401。

示例（不同账号字段会有差异）：

```
userId=你的数字ID; xiaomichatbot_ph="一串base64值"; xiaomichatbot_serviceToken="一串base64值"; ...
```

## 快速开始

### 方式一：Docker（推荐，适合部署到服务器）

```bash
cd mimo-web-api
cp .env.example .env
# 编辑 .env：填入 MIMO_COOKIES 与 API_KEY
docker compose up -d --build
```

### 方式二：源码运行

```bash
cd mimo-web-api
cp .env.example .env   # 编辑 .env
npm start              # 或 node src/server.js
```

启动后默认监听 `http://0.0.0.0:8000`，可用 `GET /ping` 检查存活、`GET /session/check` 验证 Cookie 有效性。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MIMO_ACCOUNTS` | （二选一） | AT/RT 账号配置，JSON 数组：`[{"userId":"...","passToken":"..."}]`，自动换发会话 |
| `MIMO_COOKIES` | （二选一） | 上游完整 Cookie，多账号用换行分隔，会话过期需手动更新 |
| `API_KEY` | 空 | 反代自身的 Bearer 密钥，逗号分隔多个；留空不鉴权；也是面板登录密钥 |
| `SESSION_REFRESH_HOURS` | `6` | AT/RT 会话保活周期（小时），0 关闭；401 时无论如何都会即时换发 |
| `TOOL_PASSTHROUGH` | `true` | 工具透传全局开关（请求级 `tool_passthrough` 字段可覆盖） |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | 监听地址与端口 |
| `DEFAULT_MODEL` | `mimo-v2.6-pro` | 客户端未指定 model 时的默认模型 |
| `MIMO_CONTEXT_MODE` | `chain` | `chain`=回放全部 user 消息续链（准确，耗配额）；`last`=只发最后一条（省配额，无上下文） |
| `REQUEST_TIMEOUT_MS` | `300000` | 单次上游请求超时 |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `ALLOWED_ORIGINS` | 空 | CORS 白名单（逗号分隔），留空禁止跨域，`*` 放开所有 |
| `X_TIMEZONE` | `Asia/Shanghai` | 上游 `x-timeZone` 请求头 |
| `UPSTREAM_BASE` | 官方地址 | 上游站点，一般无需修改 |

两种模式可同时配置，组成混合账号池（服务端会自动在两者间轮询）。AT/RT 账号换发的新会话会缓存到 `data/session-cache.json`（Docker 部署请挂载 `./data` 卷，容器重启不丢会话）。

## API

### GET /v1/models

返回可用模型列表（含 UltraSpeed 高速通道模型）。

### POST /v1/chat/completions

标准 OpenAI 请求格式，另支持以下扩展字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `thinking` | boolean | 是否向上游声明开启思考（`reasoning_content` 是否输出取决于模型本身） |
| `web_search` | boolean | 是否启用联网搜索 |
| `context_mode` | `"chain"` \| `"last"` | 覆盖全局的多轮上下文模式 |

curl 示例（流式）：

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-mimo-your-secret-key" \
  -d '{
    "model": "mimo-v2.6-pro-ultraspeed-studio",
    "stream": true,
    "messages": [
      {"role": "user", "content": "你好，介绍一下你自己"}
    ]
  }'
```

Python（openai SDK）示例：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8000/v1",
    api_key="sk-mimo-your-secret-key",
)

resp = client.chat.completions.create(
    model="mimo-v2.6-pro-ultraspeed-studio",
    messages=[{"role": "user", "content": "你好"}],
    stream=True,
)
for chunk in resp:
    delta = chunk.choices[0].delta if chunk.choices else None
    if delta and delta.content:
        print(delta.content, end="", flush=True)
```

### GET /session/check

逐个校验已配置账号的登录状态（AT/RT 账号会显示换发结果）。

### POST /session/refresh

强制对所有 AT/RT 账号立即换发新会话（无需重启服务）。

## 注意事项与 FAQ

- **401 / 会话无效**：Cookie 模式下说明 serviceToken 已过期，重新抓取并更新 `.env`；AT/RT 模式下会**自动换发重试**，若仍 401 说明 passToken 失效（例如改了密码、退出登录），需重新获取。`GET /session/check` 可快速定位，`POST /session/refresh` 可强制换发。
- **passToken 会过期吗**：通常会维持数月，但修改密码、在其他设备主动退出登录会使它失效，届时按上面步骤重新获取一次即可。
- **451 / 461**：上游账号被限制（封禁/风控），更换账号。
- **429**：请求过于频繁，服务端已对失败账号做冷却轮询，稍后重试。
- **看不到 thinking**：`reasoning_content` 是否出现取决于上游模型当轮是否输出思考块（思考内容在流中以 `<think>` 标记包裹，本项目已做拆分）。
- **system 消息被忽略**：上游协议没有独立的系统提示字段，system/developer 消息不会发送。
- **图片/文件输入暂不支持**：上游多模态需要单独的文件上传流程，当前版本仅支持纯文本。

## 目录结构

```
mimo-web-api/
├── src/
│   ├── server.js      # HTTP 服务与路由
│   ├── openai.js      # OpenAI 兼容层（chat/completions、models）
│   ├── session.js     # AT/RT 会话管理（passToken 换发、缓存、保活）
│   ├── upstream.js    # 上游客户端（bot/chat、SSE 解析）
│   ├── thinking.js    # <think> 思考内容拆分器
│   ├── config.js      # 配置加载
│   ├── utils.js       # 账号池、ID 生成
│   └── logger.js
├── data/              # 运行时生成：AT/RT 换发的会话缓存（勿提交）
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── PROTOCOL.md        # 上游协议逆向笔记（含 STS 换发流程）
```
