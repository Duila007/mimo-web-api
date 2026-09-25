import { config, isFastchatModel } from "./config.js";
import { logger } from "./logger.js";
import { uuid32 } from "./utils.js";

/**
 * 小米 MiMo Studio 网页端上游客户端。
 *
 * 协议要点（均为对网页端 aistudio.xiaomimimo.com 的逆向结果）：
 * - 鉴权：完整浏览器 Cookie（含 httpOnly 的 serviceToken），同时把
 *   xiaomichatbot_ph 令牌作为查询参数附加（与网页端行为一致）。
 * - 聊天：POST /open-apis/bot/chat（普通模型）或
 *   POST /fastchat/open-apis/bot/chat（UltraSpeed 模型），JSON 载荷。
 * - 响应：text/event-stream，事件行格式为 `event:<type>\ndata:<json>`，
 *   事件类型：dialogId / message / usage / web_search / error /
 *   sensitive_query / sensitive_title / doc / tip_ratio / tip_truncate / finish。
 */

export class UpstreamError extends Error {
  constructor(message, { status = 500, code = null, loginUrl = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.code = code;
    this.loginUrl = loginUrl;
  }
}

function buildHeaders(cookie) {
  return {
    "Content-Type": "application/json",
    "Accept-Language": "zh-CN",
    "x-timeZone": config.timezone,
    Origin: config.upstreamBase,
    Referer: config.upstreamBase + "/",
    "User-Agent": config.userAgent,
    Cookie: cookie,
  };
}

function withPh(urlBase, cookie) {
  // 从 Cookie 提取 ph 令牌并以查询参数附加（网页端每次请求都会带上）
  const m = cookie.match(/(?:^|;\s*)xiaomichatbot_ph="?([^";]+)"?/);
  if (!m) return urlBase;
  const sep = urlBase.includes("?") ? "&" : "?";
  return `${urlBase}${sep}xiaomichatbot_ph=${encodeURIComponent(m[1])}`;
}

/** 校验会话有效性，返回 {ok, userId?, status?} */
export async function checkSession(cookie) {
  try {
    const r = await fetch(withPh(`${config.upstreamBase}/open-apis/user/mi/get`, cookie), {
      headers: buildHeaders(cookie),
    });
    if (r.status === 401 || r.status === 302) {
      return { ok: false, status: r.status };
    }
    if (!r.ok) {
      return { ok: false, status: r.status };
    }
    const j = await r.json().catch(() => null);
    const userId = j?.data?.userId ?? j?.data?.id ?? null;
    return { ok: true, userId, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
}

/**
 * 将上游返回的字节流解析为 SSE 事件对象流。
 * 兼容 `event:xxx` / `event: xxx` 与 \n、\r\n 行尾。
 */
async function* parseSseStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const yieldBlock = function* (block) {
    const lines = block.split(/\r?\n/);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith(":") || line === "") continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      // id: / retry: 等字段忽略
    }
    if (dataLines.length === 0 && event === "message") return;
    const dataRaw = dataLines.join("\n");
    let data = dataRaw;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      /* 保持原始字符串 */
    }
    yield { event, data, raw: dataRaw };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 事件以空行分隔
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const match = buffer.slice(idx).match(/^\r?\n\r?\n/);
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + match[0].length);
        yield* yieldBlock(block);
      }
    }
    // 流结束时处理残余块
    const rest = buffer.trim();
    if (rest) yield* yieldBlock(rest);
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 发起一次上游对话补全。
 *
 * @param {object} opts
 * @param {string} opts.cookie     完整 Cookie 串
 * @param {string} opts.model      模型 ID
 * @param {string} opts.query      用户消息文本
 * @param {string} opts.conversationId 会话 ID（32 位十六进制）
 * @param {string|null} [opts.previousDialogueId] 上一轮返回的 dialogId（多轮续链）
 * @param {boolean} [opts.enableThinking]
 * @param {string} [opts.webSearchStatus] disabled | auto | enabled
 * @param {AbortSignal} [opts.signal]
 * @returns {AsyncGenerator<{event:string, data:any, raw:string}>}
 * @throws {UpstreamError}
 */
export async function* botChat({
  cookie,
  model,
  query,
  conversationId,
  previousDialogueId = null,
  enableThinking = false,
  webSearchStatus = "disabled",
  signal,
}) {
  const payload = {
    msgId: uuid32(),
    conversationId,
    query,
    isEditedQuery: false,
    previousDialogueId: previousDialogueId || null,
    sceneType: null,
    params: {},
    modelConfig: {
      model,
      enableThinking: !!enableThinking,
      webSearchStatus: webSearchStatus || "disabled",
    },
    multiMedias: [],
  };

  const path = isFastchatModel(model)
    ? "/fastchat/open-apis/bot/chat"
    : "/open-apis/bot/chat";
  const target = withPh(`${config.upstreamBase}${path}`, cookie);

  let resp;
  try {
    resp = await fetch(target, {
      method: "POST",
      headers: buildHeaders(cookie),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new UpstreamError(`上游连接失败: ${err?.message || err}`, { status: 502 });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let code = null;
    let message = text;
    let loginUrl = null;
    try {
      const j = JSON.parse(text);
      code = j?.code ?? null;
      message = j?.message || j?.msg || text;
      loginUrl = j?.loginUrl || null;
    } catch {
      /* 非 JSON 响应体 */
    }
    if (resp.status === 401 || resp.status === 302) {
      message = `上游会话无效或已过期（HTTP ${resp.status}）。请更新 MIMO_COOKIES 配置。`;
    } else if (resp.status === 451 || resp.status === 461) {
      message = `上游账号被限制（HTTP ${resp.status}）。`;
    } else if (resp.status === 429) {
      message = "上游请求过于频繁（HTTP 429），请稍后重试。";
    }
    logger.warn("[upstream] bot/chat 失败:", resp.status, message.slice(0, 200));
    throw new UpstreamError(message, { status: resp.status, code, loginUrl });
  }

  const contentType = resp.headers.get("content-type") || "";
  if (!resp.body) {
    throw new UpstreamError("上游未返回流式响应体", { status: 502 });
  }
  if (!contentType.includes("text/event-stream")) {
    // 有些错误以 200 + JSON 返回
    const text = await resp.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      message = j?.message || j?.msg || message;
    } catch {
      /* ignore */
    }
    throw new UpstreamError(`上游响应类型异常(${contentType}): ${message}`, { status: 502 });
  }

  yield* parseSseStream(resp.body);
}

/**
 * 发送一条消息并汇总为一次完整回复（非流式场景辅助）。
 * @returns {Promise<{dialogId: string|null, reasoning: string, content: string, usage: object|null, error: string|null}>}
 */
export async function botChatCollect(opts) {
  const { ThinkingSplitter, mergePieces } = await import("./thinking.js");
  const splitter = new ThinkingSplitter();
  const result = {
    dialogId: null,
    reasoning: "",
    content: "",
    usage: null,
    error: null,
  };
  for await (const evt of botChat(opts)) {
    const { event, data } = evt;
    if (event === "dialogId") {
      result.dialogId = data?.content ?? null;
    } else if (event === "message") {
      const pieces = splitter.push(data?.content ?? "");
      const merged = mergePieces(pieces);
      result.reasoning += merged.reasoning;
      result.content += merged.content;
    } else if (event === "usage") {
      result.usage = data;
    } else if (event === "error") {
      result.error = typeof data === "string" ? data : data?.content || "上游返回错误";
    } else if (event === "sensitive_query") {
      result.error = "请求内容疑似触发上游内容审核（sensitive_query）";
    } else if (event === "finish") {
      const tail = splitter.flush();
      const merged = mergePieces(tail);
      result.reasoning += merged.reasoning;
      result.content += merged.content;
      break;
    }
  }
  // finish 事件缺失时也 flush 兜底
  if (result.error === null) {
    const tail = mergePieces(splitter.flush());
    result.reasoning += tail.reasoning;
    result.content += tail.content;
  }
  return result;
}
