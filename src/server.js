import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { CookiePool } from "./utils.js";
import { checkSession } from "./upstream.js";
import { sessionManager } from "./session.js";
import { handleChatCompletions, handleModels, errorBody } from "./openai.js";
import { loadPanelAccounts, savePanelAccounts } from "./accounts-store.js";
import { handlePanelApi } from "./panel.js";
import { servePanelPage } from "./panel-html.js";
import { CAPTCHA_APP_KEY, CAPTCHA_SDK_URL } from "./xiaomi-login.js";
import { stats } from "./stats.js";

const pool = new CookiePool([
  ...config.poolEntries,
  ...loadPanelAccounts().map((a) => ({ ...a, source: "panel" })),
]);

/** CORS 白名单：由 ALLOWED_ORIGINS 配置（逗号分隔）；缺省不开启跨域；"*" 表示显式放开 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers["origin"];
  if (!origin) return;
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    return;
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

/** 校验反代自身的 Bearer 密钥 */
function checkAuth(req) {
  if (config.apiKey.length === 0) return true;
  const header = req.headers["authorization"] || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return config.apiKey.includes(m[1].trim());
}

// HTML 上下文转义表：< > & 引号一律转为 JSON unicode 转义序列
const HTML_UNSAFE_MAP = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", '"': "\\u0022", "'": "\\u0027" };
function escapeForHtmlOutput(char) {
  return HTML_UNSAFE_MAP[char] || char;
}

/**
 * JSON 输出编码：replacer 中对所有字符串值做 HTML 上下文转义，
 * 确保管理接口响应即使被浏览器当作 HTML 解析也不会产生标签注入。
 * 对标准 JSON 解析器完全透明（\\uXXXX 解码后为原字符）。
 */
function sendJson(res, status, obj) {
  const json = JSON.stringify(obj, (key, value) =>
    typeof value === "string" ? value.replace(/[<>&"']/g, escapeForHtmlOutput) : value
  );
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  }
  res.end(json);
}

function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ---------- 公开路由 ----------
    if (req.method === "GET" && pathname === "/panel") {
      servePanelPage(res, {
        captchaAppKey: CAPTCHA_APP_KEY,
        captchaSdkUrl: CAPTCHA_SDK_URL,
      });
      return;
    }
    if (req.method === "GET" && pathname === "/") {
      sendJson(res, 200, {
        name: "mimo-web-api",
        version: "1.2.0",
        description: "小米 MiMo Studio 网页端 OpenAI 兼容反代（AT/RT 自动续期 + 管理面板）",
        panel: "/panel",
        endpoints: [
          "/panel",
          "/v1/models",
          "/v1/chat/completions",
          "/session/check",
          "/session/refresh",
          "/ping",
        ],
        defaultModel: config.defaultModel,
        accounts: {
          cookieMode: pool.entries.filter((e) => e.type === "cookie").length,
          accountMode: pool.entries.filter((e) => e.type === "account").length,
        },
      });
      return;
    }
    if (req.method === "GET" && pathname === "/ping") {
      sendJson(res, 200, { pong: true, time: Date.now() });
      return;
    }

    // ---------- 鉴权路由 ----------
    if (!checkAuth(req)) {
      sendJson(res, 401, errorBody(401, "无效的 API Key，请配置 Authorization: Bearer <API_KEY>"));
      return;
    }

    // ---------- 管理面板数据接口 ----------
    if (pathname.startsWith("/admin/")) {
      // 概览 / 日志（数据已在写入时净化，仅含结构化安全字段）
      if (req.method === "GET" && pathname === "/admin/summary") {
        sendJson(res, 200, {
          pool: pool.status(),
          sessions: sessionManager.status(),
          stats: stats.summary(),
          config: {
            defaultModel: config.defaultModel,
            contextMode: config.contextMode,
            toolPassthrough: ["1", "true", "yes", "on"].includes(
              String(process.env.TOOL_PASSTHROUGH ?? "true").toLowerCase()
            ),
            sessionRefreshHours: config.sessionRefreshHours,
          },
        });
        return;
      }
      if (req.method === "GET" && pathname === "/admin/logs") {
        sendJson(res, 200, { logs: stats.recentLogs(200) });
        return;
      }
      // 账号增删（面板添加的账号持久化到 accounts.json）
      if (req.method === "POST" && pathname === "/admin/accounts/add") {
        let body;
        try {
          body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
              try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
              catch { reject(new Error("请求体不是合法 JSON")); }
            });
            req.on("error", reject);
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
        let entry = null;
        if (typeof body.cookie === "string" && body.cookie.trim()) {
          entry = { type: "cookie", cookie: body.cookie.trim() };
        } else if (body.userId && body.passToken) {
          entry = {
            type: "account",
            userId: String(body.userId).replace(/[^0-9]/g, ""),
            passToken: String(body.passToken).trim(),
            passportCookie: body.passportCookie || null,
            sessionCookie: body.sessionCookie || null,
          };
        }
        if (!entry) {
          sendJson(res, 400, { ok: false, error: "缺少 cookie 或 userId+passToken" });
          return;
        }
        const accounts = loadPanelAccounts();
        accounts.push(entry);
        savePanelAccounts(accounts);
        pool.addEntry(entry);
        sendJson(res, 200, { ok: true, total: pool.size });
        return;
      }
      if (req.method === "POST" && pathname === "/admin/accounts/remove") {
        let body = {};
        try {
          body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
              try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
              catch { reject(new Error("请求体不是合法 JSON")); }
            });
            req.on("error", reject);
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
          return;
        }
        const idx = Number(body.index);
        const entry = pool.entries[idx];
        if (!entry) {
          sendJson(res, 404, { ok: false, error: "账号不存在" });
          return;
        }
        if (entry.source === "env") {
          sendJson(res, 400, { ok: false, error: "环境变量配置的账号不能在面板中删除" });
          return;
        }
        const accounts = loadPanelAccounts();
        const fileIdx = accounts.findIndex(
          (a) => a === entry.raw || (a.userId && a.userId === entry.userId && a.passToken && a.passToken === entry.passToken)
        );
        if (fileIdx !== -1) {
          accounts.splice(fileIdx, 1);
          savePanelAccounts(accounts);
        }
        pool.removeEntry(idx);
        sendJson(res, 200, { ok: true, total: pool.size });
        return;
      }
      // 其余面板接口（登录向导等）
      const handled = await handlePanelApi(req, res, pathname, { pool, sessionManager });
      if (handled) return;
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      handleModels(res);
      return;
    }

    if (req.method === "GET" && pathname === "/session/check") {
      const results = [];
      for (const entry of pool.entries) {
        if (entry.type === "account") {
          try {
            const cookie = await sessionManager.resolveCookie(entry);
            const r = await checkSession(cookie);
            results.push({
              index: entry.index,
              mode: "account(AT/RT)",
              userId: entry.userId,
              ok: r.ok,
              httpStatus: r.status ?? null,
              error: r.error ?? null,
            });
          } catch (err) {
            results.push({
              index: entry.index,
              mode: "account(AT/RT)",
              userId: entry.userId,
              ok: false,
              error: String(err?.message || err),
            });
          }
        } else {
          const r = await checkSession(entry.cookie);
          results.push({
            index: entry.index,
            mode: "cookie",
            ok: r.ok,
            userId: r.userId ?? null,
            httpStatus: r.status ?? null,
            error: r.error ?? null,
          });
        }
      }
      sendJson(res, 200, { total: results.length, results, sessions: sessionManager.status() });
      return;
    }

    if (req.method === "POST" && pathname === "/session/refresh") {
      const results = [];
      for (const entry of pool.accountEntries()) {
        try {
          await sessionManager.refreshSession(entry);
          results.push({ userId: entry.userId, ok: true });
        } catch (err) {
          results.push({ userId: entry.userId, ok: false, error: String(err?.message || err) });
        }
      }
      const refreshed = results.length;
      sendJson(res, 200, {
        refreshed,
        results,
        note:
          refreshed === 0
            ? "当前没有 AT/RT 账号（passToken 模式）；cookie 模式的账号无法自动换发"
            : undefined,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, errorBody(400, err.message));
        return;
      }
      logger.info(
        `[chat] model=${body.model || config.defaultModel} stream=${body.stream === true} messages=${(body.messages || []).length}`
      );
      if (pool.size === 0) {
        sendJson(
          res,
          500,
          errorBody(
            500,
            "服务端未配置上游账号：请设置 MIMO_COOKIES（Cookie 模式）或 MIMO_ACCOUNTS（AT/RT 模式）后重启"
          )
        );
        return;
      }
      await handleChatCompletions({
        res,
        body,
        acquireCookie: async () => {
          const entry = pool.pick();
          if (!entry) return null;
          const cookie = await sessionManager.resolveCookie(entry);
          return { cookie, entry };
        },
        reportCookie: (entry, ok) => (ok ? pool.markSuccess(entry) : pool.markFailure(entry)),
        invalidateSession: (entry) => sessionManager.invalidate(entry),
      });
      return;
    }

    // 不回显请求路径，避免反射未经验证的输入
    logger.warn(`[server] 404: ${req.method} ${pathname}`);
    sendJson(res, 404, errorBody(404, "未知路由，可用端点见 GET /"));
  } catch (err) {
    logger.error("[server] 未处理异常:", err?.stack || err);
    if (!res.headersSent) sendJson(res, 500, errorBody(500, "服务器内部错误"));
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  const cookieCount = pool.entries.filter((e) => e.type === "cookie").length;
  const accountCount = pool.entries.filter((e) => e.type === "account").length;
  logger.info(`mimo-web-api 已启动: http://${config.host}:${config.port}`);
  logger.info(`上游: ${config.upstreamBase} | 默认模型: ${config.defaultModel}`);
  logger.info(
    `账号池: ${pool.size} 个（Cookie 模式 ${cookieCount} 个 / AT-RT 模式 ${accountCount} 个）${pool.size === 0 ? "（未配置！请设置 MIMO_COOKIES 或 MIMO_ACCOUNTS）" : ""}`
  );
  logger.info(`访问鉴权: ${config.apiKey.length > 0 ? "已启用 Bearer Key" : "未启用（API_KEY 为空）"}`);
  if (accountCount > 0 && config.sessionRefreshHours > 0) {
    logger.info(`AT/RT 会话保活: 每 ${config.sessionRefreshHours} 小时检查一次（失效自动换发）`);
  }
});

// AT/RT 账号周期性保活：校验缓存会话，失效自动换发
if (config.sessionRefreshHours > 0 && pool.accountEntries().length > 0) {
  const timer = setInterval(async () => {
    try {
      const results = await sessionManager.keepAlive(pool.accountEntries());
      for (const r of results) {
        logger.info(
          `[session] 保活: 账号 ${r.userId} ${r.ok ? (r.refreshed ? "已换发新会话" : "会话有效") : "换发失败"}`
        );
      }
    } catch (err) {
      logger.warn("[session] 保活任务异常:", err?.message || err);
    }
  }, config.sessionRefreshHours * 3600 * 1000);
  timer.unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    logger.info(`收到 ${sig}，正在关闭...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
