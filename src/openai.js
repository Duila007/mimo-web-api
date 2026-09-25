import { config, MODEL_LIST, isFastchatModel } from "./config.js";
import { logger } from "./logger.js";
import { chatcmplId, uuid32 } from "./utils.js";
import { ThinkingSplitter, mergePieces } from "./thinking.js";
import { botChat, UpstreamError } from "./upstream.js";
import { buildToolInstruction, parseToolCalls } from "./toolcall.js";
import { stats } from "./stats.js";

/** OpenAI 风格错误响应体 */
export function errorBody(status, message, code = null) {
  return {
    error: {
      message,
      type:
        status === 401
          ? "invalid_request_error"
          : status === 429
            ? "rate_limit_error"
            : status >= 500
              ? "api_error"
              : "invalid_request_error",
      code: code ?? status,
    },
  };
}

function is401(err) {
  return err?.name === "UpstreamError" && err.status === 401;
}

/** AT/RT 账号模式才支持 401 后自动换发重试 */
function canAutoRefresh(entry) {
  return entry?.type === "account";
}

function pickTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

/**
 * 把 OpenAI messages 数组转换为待发送的用户消息序列。
 * - system 消息被忽略（上游无对应字段，首条系统提示由服务端注入）
 * - assistant 历史不回放：多轮上下文通过上游 previousDialogueId 续链
 */
export function extractUserQueries(messages) {
  const queries = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "user") {
      const text = pickTextContent(msg.content).trim();
      if (text) queries.push(text);
    } else if (msg.role === "system" || msg.role === "developer") {
      logger.debug("[openai] 忽略 system/developer 消息（上游无对应字段）");
    }
  }
  return queries;
}

function mapUsage(usage) {
  if (!usage) return undefined;
  return {
    prompt_tokens: usage.promptTokens ?? 0,
    completion_tokens: usage.completionTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
  };
}

function baseChunk(id, model, extra) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    ...extra,
  };
}

/**
 * 单轮上游调用：401 且为 AT/RT 账号时，自动清除会话缓存、换发新会话并重试一次。
 * 401 必然发生在首个事件之前（HTTP 状态码阶段），因此重试是安全的。
 */
async function* turnStream(params, acquireCookie, reportCookie, invalidateSession) {
  for (let attempt = 0; ; attempt++) {
    const picked = await acquireCookie();
    if (!picked) {
      throw new UpstreamError("未配置上游账号（MIMO_COOKIES 或 MIMO_ACCOUNTS）", { status: 500 });
    }
    let iterator = null;
    try {
      const gen = botChat({ ...params, cookie: picked.cookie });
      iterator = gen[Symbol.asyncIterator]();
      const first = await iterator.next(); // 401 在此抛出
      try {
        yield first.value;
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) {
            reportCookie(picked.entry, true);
            return;
          }
          yield value;
        }
      } finally {
        // 消费方中断时关闭上游流
        await iterator.return?.().catch?.(() => {});
      }
    } catch (err) {
      reportCookie(picked.entry, false);
      if (is401(err) && canAutoRefresh(picked.entry) && attempt === 0) {
        logger.info(`[openai] 账号 ${picked.entry.label} 会话失效，自动换发后重试`);
        await invalidateSession(picked.entry);
        continue;
      }
      throw err;
    }
  }
}

/**
 * 处理 /v1/chat/completions
 * @param {object} params
 * @param {import('node:http').ServerResponse} params.res
 * @param {object} params.body 请求体
 * @param {() => Promise<{cookie: string, entry: object}|null>} params.acquireCookie 异步解析账号可用 Cookie
 * @param {(entry: object, ok: boolean) => void} params.reportCookie
 * @param {(entry: object) => Promise<void>} params.invalidateSession 清除 AT/RT 缓存会话
 */
export async function handleChatCompletions({
  res,
  body,
  acquireCookie,
  reportCookie,
  invalidateSession,
}) {
  const model = typeof body.model === "string" && body.model ? body.model : config.defaultModel;
  const stream = body.stream === true;

  const contextMode =
    typeof body.context_mode === "string" && ["chain", "last"].includes(body.context_mode)
      ? body.context_mode
      : config.contextMode;

  let queries = extractUserQueries(body.messages);
  if (queries.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(errorBody(400, "messages 中不包含可发送的 user 消息")));
    return;
  }
  if (contextMode === "last") {
    queries = [queries[queries.length - 1]];
  }

  // 工具透传：把 OpenAI tools 定义注入首条消息（以标记协议模拟函数调用）
  const toolInstruction = buildToolInstruction(body);
  const toolMode = !!toolInstruction;
  if (toolInstruction) {
    queries[0] = toolInstruction + "\n\n---\n\n用户消息：" + queries[0];
  }

  const enableThinking = body.thinking !== undefined ? !!body.thinking : false;
  let webSearchStatus = "disabled";
  if (body.web_search === true || body.web_search_options) webSearchStatus = "enabled";

  const id = chatcmplId();
  const created = Math.floor(Date.now() / 1000);
  const conversationId = uuid32();
  const startedAt = Date.now();

  // ---------- 非流式 ----------
  if (!stream) {
    const acc = { reasoning: "", content: "", usage: null, error: null };
    try {
      let previousDialogueId = null;
      for (let i = 0; i < queries.length; i++) {
        const splitter = new ThinkingSplitter();
        let lastDialogId = null;
        let turnUsage = null;
        let turnError = null;
        let turnContent = "";
        let turnReasoning = "";

        for (let attempt = 0; ; attempt++) {
          const picked = await acquireCookie();
          if (!picked) {
            throw new UpstreamError("未配置上游账号（MIMO_COOKIES 或 MIMO_ACCOUNTS）", { status: 500 });
          }
          // 重试时重新累积本轮内容
          const turnSplitter = attempt === 0 ? splitter : new ThinkingSplitter();
          try {
            for await (const evt of botChat({
              cookie: picked.cookie,
              model,
              query: queries[i],
              conversationId,
              previousDialogueId,
              enableThinking,
              webSearchStatus,
            })) {
              if (evt.event === "dialogId") {
                lastDialogId = evt.data?.content ?? null;
              } else if (evt.event === "message") {
                const merged = mergePieces(turnSplitter.push(evt.data?.content ?? ""));
                turnReasoning += merged.reasoning;
                turnContent += merged.content;
              } else if (evt.event === "usage") {
                turnUsage = evt.data;
              } else if (evt.event === "error") {
                turnError =
                  typeof evt.data === "string" ? evt.data : evt.data?.content || "上游返回错误";
              } else if (evt.event === "sensitive_query") {
                turnError = "请求内容疑似触发上游内容审核（sensitive_query）";
              }
            }
            const tail = mergePieces(turnSplitter.flush());
            turnReasoning += tail.reasoning;
            turnContent += tail.content;
            reportCookie(picked.entry, true);
            break;
          } catch (err) {
            reportCookie(picked.entry, false);
            if (is401(err) && canAutoRefresh(picked.entry) && attempt === 0) {
              logger.info(`[openai] 账号 ${picked.entry.label} 会话失效，自动换发后重试`);
              await invalidateSession(picked.entry);
              continue;
            }
            throw err;
          }
        }

        acc.reasoning += turnReasoning;
        acc.content += turnContent;
        if (turnUsage) acc.usage = turnUsage;
        if (turnError) acc.error = turnError;
        previousDialogueId = lastDialogId;
      }

      if (acc.error && !acc.content) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify(errorBody(502, acc.error)));
        return;
      }

      const message = { role: "assistant", content: acc.content };
      if (acc.reasoning) message.reasoning_content = acc.reasoning;
      let finishReason = "stop";
      if (toolMode) {
        const parsed = parseToolCalls(acc.content);
        if (parsed.calls.length > 0) {
          message.tool_calls = parsed.calls;
          message.content = parsed.remaining || null;
          finishReason = "tool_calls";
        }
      }
      stats.record({
        model,
        stream: false,
        status: 200,
        promptTokens: acc.usage?.promptTokens ?? 0,
        completionTokens: acc.usage?.completionTokens ?? 0,
        durationMs: Date.now() - startedAt,
        error: acc.error,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message,
              finish_reason: finishReason,
            },
          ],
          usage: mapUsage(acc.usage) || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        })
      );
    } catch (err) {
      sendUpstreamError(res, err);
      stats.record({
        model,
        stream: false,
        status: err?.name === "UpstreamError" ? (err.status === 401 ? 401 : 502) : 502,
        durationMs: Date.now() - startedAt,
        error: err?.message || "上游请求失败",
      });
    }
    return;
  }

  // ---------- 流式 ----------
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": mimo-web-api\n\n"); // 首个注释块，帮助部分代理尽早探测响应

  const keepAlive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      /* ignore */
    }
  }, config.keepAliveIntervalMs);

  let clientGone = false;
  const abortController = new AbortController();
  res.on("close", () => {
    clientGone = true;
    abortController.abort();
  });

  const sendChunk = (obj) => {
    if (clientGone) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const deltaChunk = (delta, finishReason = null) =>
    sendChunk(
      baseChunk(id, model, {
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })
    );

  try {
    deltaChunk({ role: "assistant" });

    let usage = null;
    let streamError = null;
    let previousDialogueId = null;
    let sentAnyContent = false;
    let contentBuffer = "";

    for (let i = 0; i < queries.length && !clientGone; i++) {
      const splitter = new ThinkingSplitter();
      let lastDialogId = null;
      let turnError = null;

      for await (const evt of turnStream(
        {
          model,
          query: queries[i],
          conversationId,
          previousDialogueId,
          enableThinking,
          webSearchStatus,
          signal: abortController.signal,
        },
        acquireCookie,
        reportCookie,
        invalidateSession
      )) {
        if (clientGone) break;
        if (evt.event === "dialogId") {
          lastDialogId = evt.data?.content ?? null;
        } else if (evt.event === "message") {
            for (const piece of splitter.push(evt.data?.content ?? "")) {
              if (piece.type === "reasoning") deltaChunk({ reasoning_content: piece.text });
              else if (toolMode) {
                // 工具透传模式：先缓冲正文，流结束后统一解析工具调用
                contentBuffer += piece.text;
              } else {
                sentAnyContent = true;
                deltaChunk({ content: piece.text });
              }
            }
          } else if (evt.event === "usage") {
          usage = evt.data;
        } else if (evt.event === "error") {
          turnError = typeof evt.data === "string" ? evt.data : evt.data?.content || "上游返回错误";
        } else if (evt.event === "sensitive_query") {
          turnError = "请求内容疑似触发上游内容审核（sensitive_query）";
        }
        if (turnError) break;
      }
      const tail = splitter.flush();
      for (const piece of tail) {
        if (piece.type === "reasoning") deltaChunk({ reasoning_content: piece.text });
        else if (toolMode) contentBuffer += piece.text;
        else {
          sentAnyContent = true;
          deltaChunk({ content: piece.text });
        }
      }
      previousDialogueId = lastDialogId;
      if (turnError) {
        streamError = turnError;
        break;
      }
    }

    if (streamError) {
      if (sentAnyContent) {
        // 已有部分内容：把错误信息作为正文补充，保证客户端拿到完整响应
        deltaChunk({ content: `\n\n[上游错误] ${streamError}` });
      } else {
        // 无任何内容：按 OpenAI 惯例输出 error 事件
        sendChunk({ error: errorBody(502, streamError).error });
      }
    }

    // 工具透传：解析缓冲正文中的工具调用块
    let finishReason = "stop";
    if (toolMode) {
      const parsed = parseToolCalls(contentBuffer);
      if (parsed.remaining) {
        sentAnyContent = true;
        deltaChunk({ content: parsed.remaining });
      }
      if (parsed.calls.length > 0) {
        deltaChunk({ tool_calls: parsed.calls.map((c, i) => ({ index: i, ...c })) });
        finishReason = "tool_calls";
      }
    }

    deltaChunk({}, finishReason);
    if (usage) {
      sendChunk(
        baseChunk(id, model, {
          choices: [],
          usage: mapUsage(usage),
        })
      );
    }
    if (!clientGone) res.write("data: [DONE]\n\n");
    res.end();
    stats.record({
      model,
      stream: true,
      status: 200,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      durationMs: Date.now() - startedAt,
      error: streamError,
    });
  } catch (err) {
    logger.warn("[openai] 流式请求失败:", err?.message || err);
    stats.record({
      model,
      stream: true,
      status: err?.name === "UpstreamError" ? (err.status === 401 ? 401 : 502) : 502,
      durationMs: Date.now() - startedAt,
      error: err?.message || "流式请求失败",
    });
    if (!clientGone) {
      if (err instanceof UpstreamError || err?.name === "UpstreamError") {
        sendChunk({ error: errorBody(err.status === 401 ? 401 : 502, err.message).error });
      } else {
        sendChunk({ error: errorBody(502, `上游请求失败: ${err?.message || err}`).error });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } finally {
    clearInterval(keepAlive);
  }
}

function sendUpstreamError(res, err) {
  let status = 502;
  if (err?.name === "UpstreamError") {
    status = err.status === 401 ? 401 : err.status === 429 ? 429 : err.status >= 400 && err.status < 500 ? 400 : 502;
  }
  const message =
    err?.name === "UpstreamError" ? err.message : `上游请求失败: ${err?.message || err}`;
  logger.warn("[openai] 请求失败:", status, message);
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" });
  }
  res.end(JSON.stringify(errorBody(status, message)));
}

/** GET /v1/models */
export function handleModels(res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      object: "list",
      data: MODEL_LIST.map((m) => ({
        id: m.id,
        object: "model",
        created: 1700000000,
        owned_by: "xiaomi-mimo",
        description: m.name,
        fastchat: isFastchatModel(m.id),
      })),
    })
  );
}
