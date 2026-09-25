import { config } from "./config.js";
import { logger } from "./logger.js";
import { sendLoginSms, verifyLoginSms, loginWithPassword } from "./xiaomi-login.js";
import { loadPanelAccounts, savePanelAccounts } from "./accounts-store.js";

/**
 * 管理面板接口层：小米登录向导（手机号/密码，自动获取 AT/RT）。
 * 概览/日志/账号池管理等接口在 server.js。
 *
 * 安全约定：
 * - 上游返回的未验证字符串只写服务端日志，不进入 HTTP 响应
 * - 响应中的 userId 仅保留数字字符
 * - 面板添加的账号持久化到 data/accounts.json
 */

function safeText(value, maxLen = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, maxLen);
}

function digitsOnly(value) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** 登录上下文获取（统一日志与 host 校验） */
async function createLoginContextSafe() {
  const { createLoginContext } = await import("./xiaomi-login.js");
  return createLoginContext();
}

/** 登录成功后入库（accounts.json + 账号池），返回响应体 */
function persistAccount(account, pool) {
  const accounts = loadPanelAccounts();
  accounts.push(account);
  savePanelAccounts(accounts);
  pool.addEntry(account);
  return { ok: true, userId: digitsOnly(account.userId), total: pool.size };
}

/**
 * 登录向导接口路由（均已通过 server.js 的 Bearer 鉴权）。
 * 返回 true 表示已处理。
 */
export async function handlePanelApi(req, res, pathname, ctx) {
  const { pool } = ctx;

  if (req.method === "POST" && pathname === "/admin/login/sms/send") {
    const body = await readBody(req);
    try {
      const loginContext = await createLoginContextSafe();
      const json = await sendLoginSms({
        phone: digitsOnly(body.phone),
        captCode: String(body.captCode || ""),
        ctx: loginContext,
      });
      // 上游原始描述只写服务端日志，不进入 HTTP 响应
      if (json.code !== 0) logger.warn("[login] 短信发送失败:", json.code, json.description || "");
      sendJson(res, 200, {
        ok: json.code === 0,
        code: json.code ?? null,
        description:
          json.code === 0
            ? "短信已发送，请查收"
            : "短信发送失败（错误码 " + (json.code ?? "?") + "），详情见服务端日志",
      });
    } catch (err) {
      logger.warn("[login] 短信发送异常:", err?.message || err);
      sendJson(res, 502, { ok: false, error: safeText(err?.message || err) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/admin/login/sms/verify") {
    const body = await readBody(req);
    try {
      const loginContext = await createLoginContextSafe();
      const account = await verifyLoginSms({
        phone: digitsOnly(body.phone),
        code: digitsOnly(body.code),
        ctx: loginContext,
      });
      sendJson(res, 200, persistAccount(account, pool));
    } catch (err) {
      logger.warn("[login] 短信验证登录失败:", err?.code ?? "", err?.message || err);
      sendJson(res, 502, {
        ok: false,
        error: safeText(err?.message || err),
        code: typeof err?.code === "number" ? err.code : null,
      });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/admin/login/password") {
    const body = await readBody(req);
    try {
      const loginContext = await createLoginContextSafe();
      const account = await loginWithPassword({
        account: String(body.account || "").trim(),
        password: String(body.password || ""),
        captCode: String(body.captCode || ""),
        ctx: loginContext,
      });
      sendJson(res, 200, persistAccount(account, pool));
    } catch (err) {
      logger.warn("[login] 密码登录失败:", err?.code ?? "", err?.message || err);
      sendJson(res, 502, {
        ok: false,
        error: safeText(err?.message || err),
        code: typeof err?.code === "number" ? err.code : null,
      });
    }
    return true;
  }

  return false;
}
