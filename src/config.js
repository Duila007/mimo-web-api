import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// 固定加载项目根目录下的 .env（轻量实现，不覆盖已存在的真实环境变量）
function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const bool = (v, fallback = false) => {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};

const int = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 读取 Cookie 模式账号（完整 Cookie 串，短期有效）。
 * MIMO_COOKIES：多账号用换行分隔。
 * Cookie 必须是浏览器请求 aistudio.xiaomimimo.com 时携带的完整 Cookie 串
 * （包含 httpOnly 的 serviceToken 等，因此需要从 DevTools 的 Network 面板复制）。
 */
function loadCookies() {
  const raw = process.env.MIMO_COOKIES || process.env.MIMO_COOKIE || "";
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 解析 AT/RT 账号配置（passToken 模式，服务端自动换发会话，长期免维护）。
 * 来源：MIMO_ACCOUNTS，JSON 数组（多账号）或单个对象，字段：
 *   cookie 模式：{ "cookie": "完整Cookie串" }
 *   account 模式：{ "userId": "...", "passToken": "..." }
 * 兼容字段名：userId/user_id，passToken/pass_token/rt/refresh_token。
 */
function loadAccounts() {
  const raw = process.env.MIMO_ACCOUNTS || "";
  if (!raw.trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`MIMO_ACCOUNTS 不是合法 JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  const accounts = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const cookie = item.cookie || item.Cookie;
    if (typeof cookie === "string" && cookie.trim()) {
      accounts.push({ type: "cookie", cookie: cookie.trim() });
      continue;
    }
    const userId = String(item.userId ?? item.user_id ?? "").trim();
    const passToken = String(
      item.passToken ?? item.pass_token ?? item.rt ?? item.refresh_token ?? ""
    ).trim();
    if (userId && passToken) {
      accounts.push({ type: "account", userId, passToken });
      continue;
    }
    // 不能 import logger（logger 依赖本模块，会循环导入）
    console.warn("[config] 忽略无法识别的账号配置项（缺少 cookie 或 userId+passToken）");
  }
  return accounts;
}

/** 组装账号池：Cookie 条目 + AT/RT 账号条目 */
function loadPoolEntries() {
  return [
    ...loadCookies().map((cookie) => ({ type: "cookie", cookie })),
    ...loadAccounts(),
  ];
}

export const config = {
  PROJECT_ROOT,
  host: process.env.HOST || "0.0.0.0",
  port: int(process.env.PORT, 8000),

  // 反代自身的访问密钥（Bearer），逗号分隔可配置多个；留空则不鉴权
  apiKey: (process.env.API_KEY || process.env.API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // 兼容旧字段：纯 Cookie 列表
  cookies: loadCookies(),

  // 账号池（Cookie 模式 + AT/RT passToken 模式统一条目）
  poolEntries: loadPoolEntries(),

  // AT/RT 会话保活周期（小时），0 = 关闭；会话失效时也会在 401 后即时换发
  sessionRefreshHours: int(process.env.SESSION_REFRESH_HOURS, 6),

  upstreamBase: process.env.UPSTREAM_BASE || "https://aistudio.xiaomimimo.com",
  defaultModel: process.env.DEFAULT_MODEL || "mimo-v2.6-pro",
  contextMode: (process.env.MIMO_CONTEXT_MODE || "chain").toLowerCase(), // chain | last
  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 300000),
  keepAliveIntervalMs: int(process.env.KEEPALIVE_INTERVAL_MS, 15000),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  timezone: process.env.X_TIMEZONE || "Asia/Shanghai",
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

// 名称包含 ultraspeed 的模型走 fastchat 通道，其余走普通通道
export const isFastchatModel = (model) => /ultraspeed/i.test(model);

export const MODEL_LIST = [
  { id: "mimo-v2.6-pro-ultraspeed-studio", name: "MiMo V2.6 Pro UltraSpeed（高速通道）" },
  { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
  { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
  { id: "mimo-v2.5", name: "MiMo V2.5" },
  { id: "mimo-v2.1-pro", name: "MiMo V2.1 Pro" },
  { id: "mimo-v2.1-pro-preview", name: "MiMo V2.1 Pro Preview" },
  { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
  { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
];
