var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.js
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
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
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === void 0) process.env[key] = value;
  }
}
function loadCookies() {
  const raw = process.env.MIMO_COOKIES || process.env.MIMO_COOKIE || "";
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function loadAccounts() {
  const raw = process.env.MIMO_ACCOUNTS || "";
  if (!raw.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`MIMO_ACCOUNTS \u4E0D\u662F\u5408\u6CD5 JSON: ${err.message}`);
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
    console.warn("[config] \u5FFD\u7565\u65E0\u6CD5\u8BC6\u522B\u7684\u8D26\u53F7\u914D\u7F6E\u9879\uFF08\u7F3A\u5C11 cookie \u6216 userId+passToken\uFF09");
  }
  return accounts;
}
function loadPoolEntries() {
  return [
    ...loadCookies().map((cookie) => ({ type: "cookie", cookie })),
    ...loadAccounts()
  ];
}
var __dirname, PROJECT_ROOT, int, config, isFastchatModel, MODEL_LIST;
var init_config = __esm({
  "src/config.js"() {
    __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    PROJECT_ROOT = path.resolve(__dirname, "..");
    loadEnvFile();
    int = (v, fallback) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    };
    config = {
      PROJECT_ROOT,
      host: process.env.HOST || "0.0.0.0",
      port: int(process.env.PORT, 8e3),
      // 反代自身的访问密钥（Bearer），逗号分隔可配置多个；留空则不鉴权
      apiKey: (process.env.API_KEY || process.env.API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean),
      // 兼容旧字段：纯 Cookie 列表
      cookies: loadCookies(),
      // 账号池（Cookie 模式 + AT/RT passToken 模式统一条目）
      poolEntries: loadPoolEntries(),
      // AT/RT 会话保活周期（小时），0 = 关闭；会话失效时也会在 401 后即时换发
      sessionRefreshHours: int(process.env.SESSION_REFRESH_HOURS, 6),
      upstreamBase: process.env.UPSTREAM_BASE || "https://aistudio.xiaomimimo.com",
      defaultModel: process.env.DEFAULT_MODEL || "mimo-v2.6-pro",
      contextMode: (process.env.MIMO_CONTEXT_MODE || "chain").toLowerCase(),
      // chain | last
      requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 3e5),
      keepAliveIntervalMs: int(process.env.KEEPALIVE_INTERVAL_MS, 15e3),
      logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
      timezone: process.env.X_TIMEZONE || "Asia/Shanghai",
      userAgent: process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    };
    isFastchatModel = (model) => /ultraspeed/i.test(model);
    MODEL_LIST = [
      { id: "mimo-v2.6-pro-ultraspeed-studio", name: "MiMo V2.6 Pro UltraSpeed\uFF08\u9AD8\u901F\u901A\u9053\uFF09" },
      { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
      { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
      { id: "mimo-v2.5", name: "MiMo V2.5" },
      { id: "mimo-v2.1-pro", name: "MiMo V2.1 Pro" },
      { id: "mimo-v2.1-pro-preview", name: "MiMo V2.1 Pro Preview" },
      { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
      { id: "mimo-v2-flash", name: "MiMo V2 Flash" }
    ];
  }
});

// src/logger.js
function fmt(args) {
  return args.map((a) => {
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }).join(" ");
}
var LEVELS, threshold, logger;
var init_logger = __esm({
  "src/logger.js"() {
    init_config();
    LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
    threshold = LEVELS[config.logLevel] ?? LEVELS.info;
    logger = {
      debug: (...args) => {
        if (threshold <= LEVELS.debug)
          console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] [DEBUG]`, fmt(args));
      },
      info: (...args) => {
        if (threshold <= LEVELS.info)
          console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] [INFO] `, fmt(args));
      },
      warn: (...args) => {
        if (threshold <= LEVELS.warn)
          console.warn(`[${(/* @__PURE__ */ new Date()).toISOString()}] [WARN] `, fmt(args));
      },
      error: (...args) => {
        if (threshold <= LEVELS.error)
          console.error(`[${(/* @__PURE__ */ new Date()).toISOString()}] [ERROR]`, fmt(args));
      }
    };
  }
});

// src/thinking.js
function mergePieces(pieces) {
  let reasoning = "";
  let content = "";
  for (const p of pieces) {
    if (p.type === "reasoning") reasoning += p.text;
    else content += p.text;
  }
  return { reasoning, content };
}
var THINK_OPEN, THINK_CLOSE, ThinkingSplitter;
var init_thinking = __esm({
  "src/thinking.js"() {
    THINK_OPEN = "<think>";
    THINK_CLOSE = "</think>";
    ThinkingSplitter = class {
      constructor() {
        this.buf = "";
        this.state = "outside";
      }
      #emit(type, text, out) {
        if (text) out.push({ type, text });
      }
      /**
       * 输入一段增量文本，返回本次拆出的片段数组（可能为空）。
       * @returns {Array<{type:'reasoning'|'content', text:string}>}
       */
      push(delta) {
        if (!delta) return [];
        this.buf += delta.replace(/\u0000/g, "");
        const out = [];
        for (; ; ) {
          if (this.state === "answer") {
            const open2 = this.buf.indexOf(THINK_OPEN);
            if (open2 !== -1) {
              this.#emit("content", this.buf.slice(0, open2), out);
              this.buf = this.buf.slice(open2 + THINK_OPEN.length);
              this.state = "thinking";
              continue;
            }
            const keep2 = Math.min(this.buf.length, THINK_OPEN.length - 1);
            const emitLen2 = this.buf.length - keep2;
            if (emitLen2 > 0) {
              this.#emit("content", this.buf.slice(0, emitLen2), out);
              this.buf = this.buf.slice(emitLen2);
            }
            break;
          }
          if (this.state === "thinking") {
            const close = this.buf.indexOf(THINK_CLOSE);
            if (close !== -1) {
              this.#emit("reasoning", this.buf.slice(0, close), out);
              this.buf = this.buf.slice(close + THINK_CLOSE.length);
              this.state = "answer";
              continue;
            }
            const keep2 = Math.min(this.buf.length, THINK_CLOSE.length - 1);
            const emitLen2 = this.buf.length - keep2;
            if (emitLen2 > 0) {
              this.#emit("reasoning", this.buf.slice(0, emitLen2), out);
              this.buf = this.buf.slice(emitLen2);
            }
            break;
          }
          const open = this.buf.indexOf(THINK_OPEN);
          if (open !== -1) {
            this.#emit("content", this.buf.slice(0, open), out);
            this.buf = this.buf.slice(open + THINK_OPEN.length);
            this.state = "thinking";
            continue;
          }
          const keep = Math.min(this.buf.length, THINK_OPEN.length - 1);
          const emitLen = this.buf.length - keep;
          if (emitLen > 0) {
            this.#emit("content", this.buf.slice(0, emitLen), out);
            this.buf = this.buf.slice(emitLen);
          }
          break;
        }
        return out;
      }
      /** 流结束时调用：把缓冲区剩余内容按当前状态输出 */
      flush() {
        const out = [];
        if (!this.buf) return out;
        if (this.state === "thinking") {
          const close = this.buf.indexOf(THINK_CLOSE);
          if (close !== -1) {
            this.#emit("reasoning", this.buf.slice(0, close), out);
            this.#emit("content", this.buf.slice(close + THINK_CLOSE.length), out);
          } else {
            this.#emit("reasoning", this.buf, out);
          }
        } else {
          this.#emit("content", this.buf, out);
        }
        this.buf = "";
        return out;
      }
    };
  }
});

// src/xiaomi-login.js
var xiaomi_login_exports = {};
__export(xiaomi_login_exports, {
  CAPTCHA_APP_KEY: () => CAPTCHA_APP_KEY,
  CAPTCHA_SDK_URL: () => CAPTCHA_SDK_URL,
  checkPhone: () => checkPhone,
  createLoginContext: () => createLoginContext,
  encryptParams: () => encryptParams,
  loginWithPassword: () => loginWithPassword,
  sendLoginSms: () => sendLoginSms,
  verifyLoginSms: () => verifyLoginSms
});
import crypto3 from "node:crypto";
function randomKey16() {
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += KEY_CHARSET[crypto3.randomInt(KEY_CHARSET.length)];
  }
  return s;
}
function rsaEncryptBase64(plain) {
  const pem = "-----BEGIN PUBLIC KEY-----\n" + RSA_PUBLIC_KEY_DER + "\n-----END PUBLIC KEY-----";
  const encrypted = crypto3.publicEncrypt(
    { key: pem, padding: crypto3.constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, "utf8")
  );
  return encrypted.toString("base64");
}
function encryptParams(params) {
  const key = randomKey16();
  const fieldNames = Object.keys(params).join(",");
  const eui = rsaEncryptBase64(Buffer.from(key, "utf8").toString("base64")) + "." + Buffer.from(fieldNames, "utf8").toString("base64");
  const encryptedParams = {};
  for (const [name, value] of Object.entries(params)) {
    const cipher = crypto3.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(AES_IV, "utf8"));
    encryptedParams[name] = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
  }
  return { EUI: eui, encryptedParams };
}
function parsePassportJson2(text) {
  const cleaned = text.replace(/^[\s/(]*(?:&&&START&&&)?/, "");
  return JSON.parse(cleaned);
}
function assertHost(raw, hostnames) {
  const url2 = new URL(raw);
  if (url2.protocol !== "https:" || !hostnames.includes(url2.hostname)) {
    throw new Error(`\u62D2\u7EDD\u8BF7\u6C42\u975E\u5B98\u65B9\u5730\u5740: ${raw.slice(0, 80)}`);
  }
  return url2;
}
async function passportPost(pathname, form, headers = {}, jar = {}) {
  const url2 = assertHost(ACCOUNT_HOST + pathname, ["account.xiaomi.com"]);
  const resp = await fetch(url2, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": config.userAgent,
      Referer: ACCOUNT_HOST + "/",
      ...headers,
      Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ")
    },
    body: new URLSearchParams(form).toString()
  });
  for (const sc of resp.headers.getSetCookie?.() || []) {
    const head = sc.split(";")[0];
    const eq = head.indexOf("=");
    if (eq > 0) {
      const name = head.slice(0, eq).trim();
      const value = head.slice(eq + 1).trim();
      if (value && value !== '""') jar[name] = value;
    }
  }
  const text = await resp.text();
  let json;
  try {
    json = parsePassportJson2(text);
  } catch {
    throw new Error(`passport \u54CD\u5E94\u89E3\u6790\u5931\u8D25\uFF08HTTP ${resp.status}\uFF09: ${text.slice(0, 120)}`);
  }
  return { resp, json, jar };
}
async function createLoginContext(sid = "xiaomichatbot") {
  const probeUrl = assertHost(
    `${config.upstreamBase}/open-apis/user/mi/get`,
    [new URL(config.upstreamBase).hostname]
  );
  const r = await fetch(probeUrl, {
    headers: { "User-Agent": config.userAgent },
    redirect: "manual"
  });
  const body = await r.text().catch(() => "");
  let loginUrl = null;
  try {
    loginUrl = JSON.parse(body)?.loginUrl || null;
  } catch {
    loginUrl = null;
  }
  if (!loginUrl) {
    throw new Error("\u672A\u80FD\u4ECE\u4E0A\u6E38\u83B7\u53D6\u767B\u5F55\u5730\u5740\uFF08loginUrl\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
  const u = assertHost(loginUrl, ["account.xiaomi.com"]);
  return {
    loginUrl: u.toString(),
    callback: u.searchParams.get("callback") || "",
    sid: u.searchParams.get("sid") || sid,
    qs: u.searchParams.get("qs") || "",
    sign: u.searchParams.get("_sign") || "",
    serviceParam: u.searchParams.get("serviceParam") || "",
    group: u.searchParams.get("_group") || "DEFAULT"
  };
}
async function checkPhone({ phone, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ phone });
  const { json } = await passportPost(
    "/pass/phoneInfo",
    { phone: encryptedParams.phone },
    { EUI }
  );
  return json;
}
async function sendLoginSms({ phone, captCode, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ user: phone });
  const { json } = await passportPost(
    "/pass/sendServiceLoginTicket",
    {
      sid: ctx.sid,
      user: encryptedParams.user,
      captCode: captCode || "",
      type: "ticket",
      _json: "true"
    },
    { EUI }
  );
  return json;
}
async function verifyLoginSms({ phone, code, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ user: phone });
  const jar = {};
  const { resp, json } = await passportPost(
    "/pass/serviceLoginTicketAuth",
    {
      sid: ctx.sid,
      user: encryptedParams.user,
      ticket: code,
      _json: "true",
      qs: ctx.qs || "%3Fsid%3D" + ctx.sid,
      callback: ctx.callback,
      _sign: ctx.sign,
      serviceParam: ctx.serviceParam,
      _group: ctx.group
    },
    { EUI },
    jar
  );
  return finalizeLogin({ resp, json, jar, ctx });
}
async function loginWithPassword({ account, password, captCode, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ user: account });
  const jar = {};
  const { resp, json } = await passportPost(
    "/pass/serviceLoginAuth2",
    {
      _json: "true",
      callback: ctx.callback,
      sid: ctx.sid,
      qs: ctx.qs,
      _sign: ctx.sign,
      serviceParam: ctx.serviceParam,
      user: encryptedParams.user,
      hash: crypto3.createHash("md5").update(password, "utf8").digest("hex").toUpperCase(),
      policyName: "miaccount",
      captCode: captCode || "",
      _group: ctx.group
    },
    { EUI },
    jar
  );
  return finalizeLogin({ resp, json, jar, ctx });
}
async function finalizeLogin({ resp, json, jar, ctx }) {
  if (json.code !== 0) {
    const err = new Error(json.description || `\u767B\u5F55\u5931\u8D25\uFF08code=${json.code}\uFF09`);
    err.code = json.code;
    err.captchaUrl = json.captchaUrl || null;
    throw err;
  }
  const userId = String(json.userId ?? jar.userId ?? "");
  const passToken = jar.passToken || null;
  if (!userId || !passToken) {
    throw new Error("\u767B\u5F55\u54CD\u5E94\u4E2D\u7F3A\u5C11 userId/passToken\uFF0C\u534F\u8BAE\u53EF\u80FD\u5DF2\u53D8\u5316");
  }
  let sessionCookie = null;
  if (json.location) {
    const upstreamHost = new URL(config.upstreamBase).hostname;
    const loc = assertHost(json.location, [upstreamHost, "account.xiaomi.com"]);
    const stsResp = await fetch(loc, {
      headers: { "User-Agent": config.userAgent },
      redirect: "manual"
    });
    const pairs = [];
    for (const sc of stsResp.headers.getSetCookie?.() || []) {
      const head = sc.split(";")[0];
      const eq = head.indexOf("=");
      if (eq > 0) {
        const name = head.slice(0, eq).trim();
        const value = head.slice(eq + 1).trim();
        if (value && value !== '""') pairs.push(`${name}=${value}`);
      }
    }
    if (pairs.length > 0) sessionCookie = pairs.join("; ");
  }
  const passportCookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  logger.info(`[login] \u8D26\u53F7 ${userId} \u767B\u5F55\u6210\u529F\uFF08AT/RT \u5DF2\u81EA\u52A8\u83B7\u53D6\uFF09`);
  return {
    type: "account",
    userId,
    passToken,
    passportCookie,
    sessionCookie,
    label: `account:${userId}`,
    addedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var ACCOUNT_HOST, RSA_PUBLIC_KEY_DER, CAPTCHA_APP_KEY, CAPTCHA_SDK_URL, AES_IV, KEY_CHARSET;
var init_xiaomi_login = __esm({
  "src/xiaomi-login.js"() {
    init_config();
    init_logger();
    ACCOUNT_HOST = "https://account.xiaomi.com";
    RSA_PUBLIC_KEY_DER = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCYEVrK/4Mahiv0pUJgTybx4J9P5dUT/Y0PuwMbk+gMU+jrZnBiXGv6/hCH1avIhoBcE535F8nJQQN3UavZdFkYidsoXuEnat3+eVTp3FslyhRwIBDF09v4vDhRtxFOT+R7uH7h/mzmyA2/+lfIMWGIrffXprYizbV76+YQKhoqFQIDAQAB";
    CAPTCHA_APP_KEY = "8027422fb0eb42fbac1b521ec4a7961f";
    CAPTCHA_SDK_URL = "https://captcha-cdn01.infosec.xiaomi.com/mcfe--captcha-static-sdk/prod/v3/static/js/v.js";
    AES_IV = "0102030405060708";
    KEY_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  }
});

// src/server.js
init_config();
init_logger();
import http from "node:http";

// src/utils.js
import crypto from "node:crypto";
function uuid32() {
  return crypto.randomUUID().replace(/-/g, "");
}
function chatcmplId() {
  return `chatcmpl-${crypto.randomUUID()}`;
}
function extractPhToken(cookie) {
  const m = cookie.match(/(?:^|;\s*)xiaomichatbot_ph="?([^";]+)"?/);
  return m ? m[1] : null;
}
var CookiePool = class {
  constructor(entries = []) {
    this.entries = entries.map((entry, index) => {
      const type = entry.type === "account" ? "account" : "cookie";
      return {
        index,
        type,
        cookie: entry.cookie || null,
        userId: entry.userId || null,
        passToken: entry.passToken || null,
        ph: entry.cookie ? extractPhToken(entry.cookie) : null,
        source: "env",
        raw: entry,
        failCount: 0,
        cooldownUntil: 0
      };
    });
    this.cursor = 0;
  }
  get size() {
    return this.entries.length;
  }
  accountEntries() {
    return this.entries.filter((e) => e.type === "account");
  }
  pick() {
    if (this.entries.length === 0) return null;
    const now = Date.now();
    const healthy = this.entries.filter((e) => e.cooldownUntil <= now);
    if (healthy.length === 0) {
      const e = this.entries[this.cursor % this.entries.length];
      this.cursor += 1;
      return e;
    }
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[(this.cursor + i) % this.entries.length];
      if (e.cooldownUntil <= now) {
        this.cursor = (this.cursor + i + 1) % this.entries.length;
        return e;
      }
    }
    return null;
  }
  /** 新增账号条目（面板添加），返回新下标 */
  addEntry(raw) {
    const entry = {
      type: raw.type === "account" ? "account" : "cookie",
      cookie: raw.cookie || null,
      userId: raw.userId || null,
      passToken: raw.passToken || null,
      ph: raw.cookie ? extractPhToken(raw.cookie) : null,
      source: raw.source || "panel",
      raw,
      failCount: 0,
      cooldownUntil: 0
    };
    entry.label = entry.type === "account" ? `account:${entry.userId}` : `cookie#${this.entries.length}`;
    this.entries.push(entry);
    return this.entries.length - 1;
  }
  /** 移除账号条目（面板添加） */
  removeEntry(index) {
    if (typeof index !== "number" || index < 0 || index >= this.entries.length) return false;
    this.entries.splice(index, 1);
    this.cursor = 0;
    return true;
  }
  markFailure(entry, cooldownMs = 6e4) {
    if (!entry) return;
    entry.failCount += 1;
    const ms = Math.min(cooldownMs * 2 ** Math.min(entry.failCount - 1, 5), 6e5);
    entry.cooldownUntil = Date.now() + ms;
  }
  markSuccess(entry) {
    if (!entry) return;
    entry.failCount = 0;
    entry.cooldownUntil = 0;
  }
  status() {
    const now = Date.now();
    return this.entries.map((e) => ({
      index: e.index,
      type: e.type,
      userId: e.type === "account" ? String(e.userId).replace(/[^0-9]/g, "") : null,
      healthy: e.cooldownUntil <= now,
      failCount: e.failCount,
      cooldownSeconds: e.cooldownUntil > now ? Math.ceil((e.cooldownUntil - now) / 1e3) : 0,
      hasPhToken: !!e.ph
    }));
  }
};

// src/upstream.js
init_config();
init_logger();
var UpstreamError = class extends Error {
  constructor(message, { status = 500, code = null, loginUrl = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.code = code;
    this.loginUrl = loginUrl;
  }
};
function buildHeaders(cookie) {
  return {
    "Content-Type": "application/json",
    "Accept-Language": "zh-CN",
    "x-timeZone": config.timezone,
    Origin: config.upstreamBase,
    Referer: config.upstreamBase + "/",
    "User-Agent": config.userAgent,
    Cookie: cookie
  };
}
function withPh(urlBase, cookie) {
  const m = cookie.match(/(?:^|;\s*)xiaomichatbot_ph="?([^";]+)"?/);
  if (!m) return urlBase;
  const sep = urlBase.includes("?") ? "&" : "?";
  return `${urlBase}${sep}xiaomichatbot_ph=${encodeURIComponent(m[1])}`;
}
async function checkSession(cookie) {
  try {
    const r = await fetch(withPh(`${config.upstreamBase}/open-apis/user/mi/get`, cookie), {
      headers: buildHeaders(cookie)
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
    }
    if (dataLines.length === 0 && event === "message") return;
    const dataRaw = dataLines.join("\n");
    let data = dataRaw;
    try {
      data = JSON.parse(dataRaw);
    } catch {
    }
    yield { event, data, raw: dataRaw };
  };
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const match = buffer.slice(idx).match(/^\r?\n\r?\n/);
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + match[0].length);
        yield* yieldBlock(block);
      }
    }
    const rest = buffer.trim();
    if (rest) yield* yieldBlock(rest);
  } finally {
    try {
      reader.cancel();
    } catch {
    }
  }
}
async function* botChat({
  cookie,
  model,
  query,
  conversationId,
  previousDialogueId = null,
  enableThinking = false,
  webSearchStatus = "disabled",
  signal
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
      webSearchStatus: webSearchStatus || "disabled"
    },
    multiMedias: []
  };
  const path5 = isFastchatModel(model) ? "/fastchat/open-apis/bot/chat" : "/open-apis/bot/chat";
  const target = withPh(`${config.upstreamBase}${path5}`, cookie);
  let resp;
  try {
    resp = await fetch(target, {
      method: "POST",
      headers: buildHeaders(cookie),
      body: JSON.stringify(payload),
      signal
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new UpstreamError(`\u4E0A\u6E38\u8FDE\u63A5\u5931\u8D25: ${err?.message || err}`, { status: 502 });
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
    }
    if (resp.status === 401 || resp.status === 302) {
      message = `\u4E0A\u6E38\u4F1A\u8BDD\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF08HTTP ${resp.status}\uFF09\u3002\u8BF7\u66F4\u65B0 MIMO_COOKIES \u914D\u7F6E\u3002`;
    } else if (resp.status === 451 || resp.status === 461) {
      message = `\u4E0A\u6E38\u8D26\u53F7\u88AB\u9650\u5236\uFF08HTTP ${resp.status}\uFF09\u3002`;
    } else if (resp.status === 429) {
      message = "\u4E0A\u6E38\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF08HTTP 429\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
    }
    logger.warn("[upstream] bot/chat \u5931\u8D25:", resp.status, message.slice(0, 200));
    throw new UpstreamError(message, { status: resp.status, code, loginUrl });
  }
  const contentType = resp.headers.get("content-type") || "";
  if (!resp.body) {
    throw new UpstreamError("\u4E0A\u6E38\u672A\u8FD4\u56DE\u6D41\u5F0F\u54CD\u5E94\u4F53", { status: 502 });
  }
  if (!contentType.includes("text/event-stream")) {
    const text = await resp.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      message = j?.message || j?.msg || message;
    } catch {
    }
    throw new UpstreamError(`\u4E0A\u6E38\u54CD\u5E94\u7C7B\u578B\u5F02\u5E38(${contentType}): ${message}`, { status: 502 });
  }
  yield* parseSseStream(resp.body);
}

// src/session.js
init_config();
init_logger();
import fs2 from "node:fs";
import path2 from "node:path";
var DATA_DIR = path2.join(config.PROJECT_ROOT, "data");
var CACHE_FILE = path2.join(DATA_DIR, "session-cache.json");
var AUTH_HOSTS = /* @__PURE__ */ new Set(["account.xiaomi.com"]);
var UPSTREAM_HOSTS = /* @__PURE__ */ new Set([new URL(config.upstreamBase).hostname]);
function assertOfficialUrl(raw, allowedHosts) {
  let url2;
  try {
    url2 = new URL(raw);
  } catch {
    throw new Error("\u975E\u6CD5 URL");
  }
  if (url2.protocol !== "https:") {
    throw new Error(`\u4EC5\u5141\u8BB8 https \u8BF7\u6C42\uFF0C\u6536\u5230: ${url2.protocol}`);
  }
  if (!allowedHosts.has(url2.hostname)) {
    throw new Error(`\u62D2\u7EDD\u8BF7\u6C42\u975E\u5B98\u65B9\u4E3B\u673A: ${url2.hostname}`);
  }
  return url2;
}
function parsePassportJson(text) {
  const cleaned = text.replace(/^[\s/(]*(?:&&&START&&&)?/, "");
  return JSON.parse(cleaned);
}
function collectCookies(setCookies) {
  const pairs = [];
  for (const sc of setCookies || []) {
    const head = sc.split(";")[0];
    const eq = head.indexOf("=");
    if (eq <= 0) continue;
    const name = head.slice(0, eq).trim();
    const value = head.slice(eq + 1).trim();
    if (!value || value === '""') continue;
    pairs.push([name, value]);
  }
  return pairs;
}
var SessionManager = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
    this.#loadDisk();
  }
  #loadDisk() {
    try {
      if (fs2.existsSync(CACHE_FILE)) {
        const j = JSON.parse(fs2.readFileSync(CACHE_FILE, "utf8"));
        for (const [userId, session] of Object.entries(j || {})) {
          if (session?.cookie) this.cache.set(userId, session);
        }
        if (this.cache.size > 0) {
          logger.info(`[session] \u5DF2\u4ECE\u78C1\u76D8\u6062\u590D ${this.cache.size} \u4E2A\u8D26\u53F7\u7684\u4F1A\u8BDD\u7F13\u5B58`);
        }
      }
    } catch (err) {
      logger.warn("[session] \u4F1A\u8BDD\u7F13\u5B58\u8BFB\u53D6\u5931\u8D25:", err?.message || err);
    }
  }
  #saveDisk() {
    try {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
      const obj = Object.fromEntries(this.cache);
      fs2.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (err) {
      logger.warn("[session] \u4F1A\u8BDD\u7F13\u5B58\u5199\u5165\u5931\u8D25:", err?.message || err);
    }
  }
  /**
   * 解析某个账号条目当前应使用的 Cookie。
   * cookie 型条目原样返回；account 型条目优先用缓存，无缓存则立即换发。
   */
  async resolveCookie(entry) {
    if (entry.type === "cookie") return entry.cookie;
    const cached = this.cache.get(entry.userId);
    if (cached?.cookie) return cached.cookie;
    logger.info(`[session] \u8D26\u53F7 ${entry.userId} \u65E0\u7F13\u5B58\u4F1A\u8BDD\uFF0C\u5F00\u59CB passToken \u6362\u53D1...`);
    return this.refreshSession(entry);
  }
  /** 会话失效（上游 401）后调用：清除缓存，下次重新换发 */
  invalidate(entry) {
    if (entry.type !== "account") return;
    this.cache.delete(entry.userId);
    this.#saveDisk();
    logger.info(`[session] \u5DF2\u6E05\u9664\u8D26\u53F7 ${entry.userId} \u7684\u7F13\u5B58\u4F1A\u8BDD`);
  }
  /** 通过 passToken 换发新的 serviceToken 会话 */
  async refreshSession(entry) {
    if (entry.type !== "account") {
      throw new Error("\u8BE5\u8D26\u53F7\u4E0D\u662F AT/RT \u6A21\u5F0F\uFF0C\u65E0\u6CD5\u81EA\u52A8\u6362\u53D1");
    }
    const authCookie = `userId=${entry.userId}; passToken=${entry.passToken}`;
    let loginUrl = null;
    try {
      const probe = await fetch(`${config.upstreamBase}/open-apis/user/mi/get`, {
        headers: {
          "Accept-Language": "zh-CN",
          "User-Agent": config.userAgent,
          Cookie: `userId=${entry.userId};`
        },
        redirect: "manual"
      });
      const body = await probe.text().catch(() => "");
      try {
        loginUrl = JSON.parse(body)?.loginUrl || null;
      } catch {
        loginUrl = null;
      }
    } catch (err) {
      logger.debug("[session] loginUrl \u63A2\u6D4B\u8BF7\u6C42\u5931\u8D25\uFF0C\u5C06\u4F7F\u7528\u6784\u9020\u7684\u6362\u53D1\u5730\u5740:", err?.message || err);
    }
    if (!loginUrl) {
      loginUrl = `https://account.xiaomi.com/pass/serviceLogin?callback=${encodeURIComponent(
        `${config.upstreamBase}/sts?sign=%2FKuvzNMEPYoLWPMSl3fRtWQeN%2Bo%3D&followup=${encodeURIComponent(config.upstreamBase + "/")}`
      )}&sid=xiaomichatbot&_group=DEFAULT`;
    }
    assertOfficialUrl(loginUrl, AUTH_HOSTS);
    const passportUrl = new URL(loginUrl);
    passportUrl.searchParams.set("_json", "true");
    const passportResp = await fetch(passportUrl, {
      headers: {
        "User-Agent": config.userAgent,
        Cookie: authCookie
      },
      redirect: "manual"
    });
    const passportText = await passportResp.text();
    let passport;
    try {
      passport = parsePassportJson(passportText);
    } catch {
      throw new Error(`passport \u54CD\u5E94\u89E3\u6790\u5931\u8D25: ${passportText.slice(0, 120)}`);
    }
    if (passport.code !== 0 || !passport.location) {
      throw new Error(
        `passToken \u6362\u53D1\u5931\u8D25\uFF08code=${passport.code}\uFF0C${passport.description || "\u672A\u63CF\u8FF0"}\uFF09\u3002passToken \u53EF\u80FD\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6\u3002`
      );
    }
    assertOfficialUrl(passport.location, UPSTREAM_HOSTS);
    const stsResp = await fetch(passport.location, {
      headers: { "User-Agent": config.userAgent },
      redirect: "manual"
    });
    if (stsResp.status >= 400) {
      throw new Error(`sts \u6362\u53D1\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${stsResp.status}\uFF09`);
    }
    const pairs = collectCookies(stsResp.headers.getSetCookie());
    const cookieMap = new Map(pairs);
    cookieMap.set("userId", String(entry.userId));
    if (!cookieMap.has("xiaomichatbot_serviceToken")) {
      throw new Error("sts \u54CD\u5E94\u672A\u4E0B\u53D1 serviceToken\uFF0C\u6362\u53D1\u6D41\u7A0B\u5F02\u5E38");
    }
    const cookie = [...cookieMap].map(([k, v]) => `${k}=${v}`).join("; ");
    const ph = cookieMap.get("xiaomichatbot_ph") || null;
    this.cache.set(entry.userId, { cookie, ph, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.#saveDisk();
    logger.info(`[session] \u8D26\u53F7 ${entry.userId} \u6362\u53D1\u6210\u529F\uFF0C\u4F1A\u8BDD\u5DF2\u7F13\u5B58`);
    return cookie;
  }
  /** 周期性保活：校验各账号缓存会话，失效则换发 */
  async keepAlive(accountEntries) {
    const results = [];
    for (const entry of accountEntries) {
      if (entry.type !== "account") continue;
      const cached = this.cache.get(entry.userId);
      let ok = false;
      if (cached?.cookie) {
        try {
          ok = (await checkSession(cached.cookie)).ok;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        try {
          await this.refreshSession(entry);
          results.push({ userId: entry.userId, refreshed: true, ok: true });
        } catch (err) {
          logger.warn(`[session] \u8D26\u53F7 ${entry.userId} \u4FDD\u6D3B\u5931\u8D25:`, err?.message || err);
          results.push({ userId: entry.userId, refreshed: false, ok: false, error: String(err?.message || err) });
        }
      } else {
        results.push({ userId: entry.userId, refreshed: false, ok: true });
      }
    }
    return results;
  }
  status() {
    return [...this.cache.entries()].map(([userId, s]) => ({
      userId: String(userId).replace(/[^0-9]/g, ""),
      hasCookie: !!s.cookie,
      hasPh: !!s.ph,
      fetchedAt: s.fetchedAt
    }));
  }
};
var sessionManager = new SessionManager();

// src/openai.js
init_config();
init_logger();
init_thinking();

// src/toolcall.js
init_logger();
import crypto2 from "node:crypto";
var TOOL_MARKER_OPEN = "<tool_call>";
var TOOL_MARKER_CLOSE = "</tool_call>";
function toolPassthroughEnabled(body) {
  const global = ["1", "true", "yes", "on"].includes(String(process.env.TOOL_PASSTHROUGH ?? "true").toLowerCase());
  if (typeof body.tool_passthrough === "boolean") return body.tool_passthrough;
  return global;
}
function renderToolSpec(tools) {
  const lines = [];
  lines.push("You have access to the following tools (functions):");
  lines.push("");
  for (const tool of tools) {
    if (tool?.type !== "function" || !tool.function) continue;
    const fn = tool.function;
    lines.push(`- name: ${fn.name}`);
    if (fn.description) lines.push(`  description: ${fn.description}`);
    if (fn.parameters) {
      try {
        lines.push(`  parameters(JSON Schema): ${JSON.stringify(fn.parameters)}`);
      } catch {
      }
    }
  }
  lines.push("");
  lines.push(
    "When you decide to call one or more tools, reply with ONLY tool-call blocks and nothing else, each wrapped exactly like:\n" + TOOL_MARKER_OPEN + '{"name":"<tool name>","arguments":{<json arguments>}}' + TOOL_MARKER_CLOSE + "\nMultiple calls use multiple consecutive blocks. If no tool call is needed, answer the user normally in plain text without the blocks."
  );
  return lines.join("\n");
}
function renderToolChoice(toolChoice) {
  if (!toolChoice || toolChoice === "auto") return "";
  if (toolChoice === "none") return "Do NOT call any tools; answer in plain text.";
  if (toolChoice === "required") return "You MUST call at least one tool this turn.";
  if (typeof toolChoice === "object" && toolChoice.function?.name) {
    return `You MUST call the tool named "${toolChoice.function.name}" this turn.`;
  }
  return "";
}
function buildToolInstruction(body) {
  if (!toolPassthroughEnabled(body)) return null;
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => t?.type === "function" && t.function?.name) : [];
  if (tools.length === 0) return null;
  const spec = renderToolSpec(tools);
  const choice = renderToolChoice(body.tool_choice);
  return ["[Tool Passthrough / \u5DE5\u5177\u900F\u4F20\u5DF2\u5F00\u542F]", spec, choice].filter(Boolean).join("\n");
}
function newCallId() {
  return `call_${crypto2.randomBytes(8).toString("hex")}`;
}
function parseToolCalls(content) {
  const calls = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  for (const match of content.matchAll(re)) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function?.name;
      if (!name) continue;
      const args = obj.arguments ?? obj.function?.arguments ?? {};
      calls.push({
        id: newCallId(),
        type: "function",
        function: {
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args)
        }
      });
    } catch (err) {
      logger.debug("[toolcall] \u5DE5\u5177\u8C03\u7528\u5757\u89E3\u6790\u5931\u8D25:", err?.message || err);
    }
  }
  const remaining = content.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "").trim();
  return { calls, remaining };
}

// src/stats.js
init_config();
import fs3 from "node:fs";
import path3 from "node:path";
var DATA_DIR2 = path3.join(config.PROJECT_ROOT, "data");
var USAGE_FILE = path3.join(DATA_DIR2, "usage.json");
var MAX_LOGS = 200;
var Stats = class {
  constructor() {
    this.logs = [];
    this.daily = {};
    this.startedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.#load();
  }
  #load() {
    try {
      if (fs3.existsSync(USAGE_FILE)) {
        const j = JSON.parse(fs3.readFileSync(USAGE_FILE, "utf8"));
        if (j && typeof j.daily === "object") this.daily = j.daily;
      }
    } catch (err) {
    }
  }
  #save() {
    try {
      fs3.mkdirSync(DATA_DIR2, { recursive: true });
      const cutoff = new Date(Date.now() - 90 * 86400 * 1e3).toISOString().slice(0, 10);
      for (const day of Object.keys(this.daily)) {
        if (day < cutoff) delete this.daily[day];
      }
      fs3.writeFileSync(USAGE_FILE, JSON.stringify({ startedAt: this.startedAt, daily: this.daily }), "utf8");
    } catch {
    }
  }
  /** 记录一次对话补全（所有入库字符串先做白名单净化） */
  record({ model, stream, status, promptTokens = 0, completionTokens = 0, accountLabel = "", durationMs = 0, error = null }) {
    const safeModel = String(model ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "unknown";
    const safeError = error == null ? null : String(error).slice(0, 80).replace(/[^\x20-\x7e]/g, "");
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const d = this.daily[day] ||= { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0, models: {} };
    const m = d.models[safeModel] ||= { requests: 0, promptTokens: 0, completionTokens: 0 };
    d.requests += 1;
    d.promptTokens += promptTokens;
    d.completionTokens += completionTokens;
    if (status !== 200) d.errors += 1;
    m.requests += 1;
    m.promptTokens += promptTokens;
    m.completionTokens += completionTokens;
    this.logs.unshift({
      time: (/* @__PURE__ */ new Date()).toISOString(),
      model: safeModel,
      stream: !!stream,
      status,
      promptTokens,
      completionTokens,
      durationMs,
      account: typeof accountLabel === "string" && accountLabel.startsWith("account:") ? accountLabel.slice(0, 24) : null,
      error: safeError
    });
    if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
    this.#save();
  }
  summary() {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const days = Object.keys(this.daily).sort().reverse().slice(0, 14);
    return {
      startedAt: this.startedAt,
      today: this.daily[today] || { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0, models: {} },
      recentDays: days.map((day) => ({ day, ...this.summaryOfDay(day) }))
    };
  }
  summaryOfDay(day) {
    const d = this.daily[day] || { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0, models: {} };
    return {
      requests: d.requests,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
      totalTokens: d.promptTokens + d.completionTokens,
      errors: d.errors,
      models: d.models
    };
  }
  recentLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }
};
var stats = new Stats();

// src/openai.js
function errorBody(status, message, code = null) {
  return {
    error: {
      message,
      type: status === 401 ? "invalid_request_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error",
      code: code ?? status
    }
  };
}
function is401(err) {
  return err?.name === "UpstreamError" && err.status === 401;
}
function canAutoRefresh(entry) {
  return entry?.type === "account";
}
function pickTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("");
  }
  return "";
}
function extractUserQueries(messages) {
  const queries = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "user") {
      const text = pickTextContent(msg.content).trim();
      if (text) queries.push(text);
    } else if (msg.role === "system" || msg.role === "developer") {
      logger.debug("[openai] \u5FFD\u7565 system/developer \u6D88\u606F\uFF08\u4E0A\u6E38\u65E0\u5BF9\u5E94\u5B57\u6BB5\uFF09");
    }
  }
  return queries;
}
function mapUsage(usage) {
  if (!usage) return void 0;
  return {
    prompt_tokens: usage.promptTokens ?? 0,
    completion_tokens: usage.completionTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0
  };
}
function baseChunk(id, model, extra) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model,
    ...extra
  };
}
async function* turnStream(params, acquireCookie, reportCookie, invalidateSession) {
  for (let attempt = 0; ; attempt++) {
    const picked = await acquireCookie();
    if (!picked) {
      throw new UpstreamError("\u672A\u914D\u7F6E\u4E0A\u6E38\u8D26\u53F7\uFF08MIMO_COOKIES \u6216 MIMO_ACCOUNTS\uFF09", { status: 500 });
    }
    let iterator = null;
    try {
      const gen = botChat({ ...params, cookie: picked.cookie });
      iterator = gen[Symbol.asyncIterator]();
      const first = await iterator.next();
      try {
        yield first.value;
        for (; ; ) {
          const { done, value } = await iterator.next();
          if (done) {
            reportCookie(picked.entry, true);
            return;
          }
          yield value;
        }
      } finally {
        await iterator.return?.().catch?.(() => {
        });
      }
    } catch (err) {
      reportCookie(picked.entry, false);
      if (is401(err) && canAutoRefresh(picked.entry) && attempt === 0) {
        logger.info(`[openai] \u8D26\u53F7 ${picked.entry.label} \u4F1A\u8BDD\u5931\u6548\uFF0C\u81EA\u52A8\u6362\u53D1\u540E\u91CD\u8BD5`);
        await invalidateSession(picked.entry);
        continue;
      }
      throw err;
    }
  }
}
async function handleChatCompletions({
  res,
  body,
  acquireCookie,
  reportCookie,
  invalidateSession
}) {
  const model = typeof body.model === "string" && body.model ? body.model : config.defaultModel;
  const stream = body.stream === true;
  const contextMode = typeof body.context_mode === "string" && ["chain", "last"].includes(body.context_mode) ? body.context_mode : config.contextMode;
  let queries = extractUserQueries(body.messages);
  if (queries.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(errorBody(400, "messages \u4E2D\u4E0D\u5305\u542B\u53EF\u53D1\u9001\u7684 user \u6D88\u606F")));
    return;
  }
  if (contextMode === "last") {
    queries = [queries[queries.length - 1]];
  }
  const toolInstruction = buildToolInstruction(body);
  const toolMode = !!toolInstruction;
  if (toolInstruction) {
    queries[0] = toolInstruction + "\n\n---\n\n\u7528\u6237\u6D88\u606F\uFF1A" + queries[0];
  }
  const enableThinking = body.thinking !== void 0 ? !!body.thinking : false;
  let webSearchStatus = "disabled";
  if (body.web_search === true || body.web_search_options) webSearchStatus = "enabled";
  const id = chatcmplId();
  const created = Math.floor(Date.now() / 1e3);
  const conversationId = uuid32();
  const startedAt = Date.now();
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
            throw new UpstreamError("\u672A\u914D\u7F6E\u4E0A\u6E38\u8D26\u53F7\uFF08MIMO_COOKIES \u6216 MIMO_ACCOUNTS\uFF09", { status: 500 });
          }
          const turnSplitter = attempt === 0 ? splitter : new ThinkingSplitter();
          try {
            for await (const evt of botChat({
              cookie: picked.cookie,
              model,
              query: queries[i],
              conversationId,
              previousDialogueId,
              enableThinking,
              webSearchStatus
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
                turnError = typeof evt.data === "string" ? evt.data : evt.data?.content || "\u4E0A\u6E38\u8FD4\u56DE\u9519\u8BEF";
              } else if (evt.event === "sensitive_query") {
                turnError = "\u8BF7\u6C42\u5185\u5BB9\u7591\u4F3C\u89E6\u53D1\u4E0A\u6E38\u5185\u5BB9\u5BA1\u6838\uFF08sensitive_query\uFF09";
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
              logger.info(`[openai] \u8D26\u53F7 ${picked.entry.label} \u4F1A\u8BDD\u5931\u6548\uFF0C\u81EA\u52A8\u6362\u53D1\u540E\u91CD\u8BD5`);
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
        error: acc.error
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
              finish_reason: finishReason
            }
          ],
          usage: mapUsage(acc.usage) || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        })
      );
    } catch (err) {
      sendUpstreamError(res, err);
      stats.record({
        model,
        stream: false,
        status: err?.name === "UpstreamError" ? err.status === 401 ? 401 : 502 : 502,
        durationMs: Date.now() - startedAt,
        error: err?.message || "\u4E0A\u6E38\u8BF7\u6C42\u5931\u8D25"
      });
    }
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": mimo-web-api\n\n");
  const keepAlive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
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
    res.write(`data: ${JSON.stringify(obj)}

`);
  };
  const deltaChunk = (delta, finishReason = null) => sendChunk(
    baseChunk(id, model, {
      choices: [{ index: 0, delta, finish_reason: finishReason }]
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
          signal: abortController.signal
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
              contentBuffer += piece.text;
            } else {
              sentAnyContent = true;
              deltaChunk({ content: piece.text });
            }
          }
        } else if (evt.event === "usage") {
          usage = evt.data;
        } else if (evt.event === "error") {
          turnError = typeof evt.data === "string" ? evt.data : evt.data?.content || "\u4E0A\u6E38\u8FD4\u56DE\u9519\u8BEF";
        } else if (evt.event === "sensitive_query") {
          turnError = "\u8BF7\u6C42\u5185\u5BB9\u7591\u4F3C\u89E6\u53D1\u4E0A\u6E38\u5185\u5BB9\u5BA1\u6838\uFF08sensitive_query\uFF09";
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
        deltaChunk({ content: `

[\u4E0A\u6E38\u9519\u8BEF] ${streamError}` });
      } else {
        sendChunk({ error: errorBody(502, streamError).error });
      }
    }
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
          usage: mapUsage(usage)
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
      error: streamError
    });
  } catch (err) {
    logger.warn("[openai] \u6D41\u5F0F\u8BF7\u6C42\u5931\u8D25:", err?.message || err);
    stats.record({
      model,
      stream: true,
      status: err?.name === "UpstreamError" ? err.status === 401 ? 401 : 502 : 502,
      durationMs: Date.now() - startedAt,
      error: err?.message || "\u6D41\u5F0F\u8BF7\u6C42\u5931\u8D25"
    });
    if (!clientGone) {
      if (err instanceof UpstreamError || err?.name === "UpstreamError") {
        sendChunk({ error: errorBody(err.status === 401 ? 401 : 502, err.message).error });
      } else {
        sendChunk({ error: errorBody(502, `\u4E0A\u6E38\u8BF7\u6C42\u5931\u8D25: ${err?.message || err}`).error });
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
  const message = err?.name === "UpstreamError" ? err.message : `\u4E0A\u6E38\u8BF7\u6C42\u5931\u8D25: ${err?.message || err}`;
  logger.warn("[openai] \u8BF7\u6C42\u5931\u8D25:", status, message);
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" });
  }
  res.end(JSON.stringify(errorBody(status, message)));
}
function handleModels(res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      object: "list",
      data: MODEL_LIST.map((m) => ({
        id: m.id,
        object: "model",
        created: 17e8,
        owned_by: "xiaomi-mimo",
        description: m.name,
        fastchat: isFastchatModel(m.id)
      }))
    })
  );
}

// src/accounts-store.js
init_config();
init_logger();
import fs4 from "node:fs";
import path4 from "node:path";
var DATA_DIR3 = path4.join(config.PROJECT_ROOT, "data");
var ACCOUNTS_FILE = path4.join(DATA_DIR3, "accounts.json");
function loadPanelAccounts() {
  try {
    if (fs4.existsSync(ACCOUNTS_FILE)) {
      const arr = JSON.parse(fs4.readFileSync(ACCOUNTS_FILE, "utf8"));
      if (Array.isArray(arr)) return arr.filter((a) => a && typeof a === "object");
    }
  } catch (err) {
    logger.warn("[accounts] accounts.json \u8BFB\u53D6\u5931\u8D25:", err?.message || err);
  }
  return [];
}
function savePanelAccounts(accounts) {
  fs4.mkdirSync(DATA_DIR3, { recursive: true });
  fs4.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
}

// src/panel.js
init_config();
init_logger();
init_xiaomi_login();
function safeText(value, maxLen = 300) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maxLen);
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
        reject(new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
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
        reject(new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
      }
    });
    req.on("error", reject);
  });
}
async function createLoginContextSafe() {
  const { createLoginContext: createLoginContext2 } = await Promise.resolve().then(() => (init_xiaomi_login(), xiaomi_login_exports));
  return createLoginContext2();
}
function persistAccount(account, pool2) {
  const accounts = loadPanelAccounts();
  accounts.push(account);
  savePanelAccounts(accounts);
  pool2.addEntry(account);
  return { ok: true, userId: digitsOnly(account.userId), total: pool2.size };
}
async function handlePanelApi(req, res, pathname, ctx) {
  const { pool: pool2 } = ctx;
  if (req.method === "POST" && pathname === "/admin/login/sms/send") {
    const body = await readBody(req);
    try {
      const loginContext = await createLoginContextSafe();
      const json = await sendLoginSms({
        phone: digitsOnly(body.phone),
        captCode: String(body.captCode || ""),
        ctx: loginContext
      });
      if (json.code !== 0) logger.warn("[login] \u77ED\u4FE1\u53D1\u9001\u5931\u8D25:", json.code, json.description || "");
      sendJson(res, 200, {
        ok: json.code === 0,
        code: json.code ?? null,
        description: json.code === 0 ? "\u77ED\u4FE1\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u6536" : "\u77ED\u4FE1\u53D1\u9001\u5931\u8D25\uFF08\u9519\u8BEF\u7801 " + (json.code ?? "?") + "\uFF09\uFF0C\u8BE6\u60C5\u89C1\u670D\u52A1\u7AEF\u65E5\u5FD7"
      });
    } catch (err) {
      logger.warn("[login] \u77ED\u4FE1\u53D1\u9001\u5F02\u5E38:", err?.message || err);
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
        ctx: loginContext
      });
      sendJson(res, 200, persistAccount(account, pool2));
    } catch (err) {
      logger.warn("[login] \u77ED\u4FE1\u9A8C\u8BC1\u767B\u5F55\u5931\u8D25:", err?.code ?? "", err?.message || err);
      sendJson(res, 502, {
        ok: false,
        error: safeText(err?.message || err),
        code: typeof err?.code === "number" ? err.code : null
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
        ctx: loginContext
      });
      sendJson(res, 200, persistAccount(account, pool2));
    } catch (err) {
      logger.warn("[login] \u5BC6\u7801\u767B\u5F55\u5931\u8D25:", err?.code ?? "", err?.message || err);
      sendJson(res, 502, {
        ok: false,
        error: safeText(err?.message || err),
        code: typeof err?.code === "number" ? err.code : null
      });
    }
    return true;
  }
  return false;
}

// src/panel-html.js
function servePanelPage(res, { captchaAppKey, captchaSdkUrl }) {
  const html = PANEL_HTML.replace("__CAPTCHA_APP_KEY__", captchaAppKey).replace(
    "__CAPTCHA_SDK_URL__",
    captchaSdkUrl
  );
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}
var PANEL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mimo-web-api \u7BA1\u7406\u9762\u677F</title>
<style>
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --text:#e6e9ef; --sub:#8b93a5; --acc:#4f8cff; --ok:#3fb96f; --bad:#e5604c; --warn:#e0a13d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 20px; margin: 6px 0 16px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  .kpi { flex:1; min-width:150px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 14px; }
  .kpi b { display:block; font-size:20px; }
  .kpi span { color:var(--sub); font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--sub); font-weight:500; }
  input, select, textarea, button { font:inherit; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  input:focus, textarea:focus { outline:1px solid var(--acc); }
  button { cursor:pointer; }
  button.pri { background:var(--acc); border-color:var(--acc); color:#fff; }
  button.mini { padding:3px 8px; font-size:12px; border-radius:6px; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .tag { display:inline-block; padding:1px 8px; border-radius:20px; font-size:12px; }
  .tag.ok { background:rgba(63,185,111,.15); color:var(--ok); }
  .tag.warn { background:rgba(224,161,61,.15); color:var(--warn); }
  .muted { color:var(--sub); font-size:12px; }
  .tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
  .tabs button { border-radius:8px 8px 0 0; border-bottom:none; }
  .tabs button.on { background:var(--acc); color:#fff; border-color:var(--acc); }
  .section { display:none; } .section.on { display:block; }
  #play { min-height:120px; max-height:320px; overflow:auto; white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; margin-top:8px; }
  .think { color:var(--sub); font-style:italic; }
  .err { color:var(--bad); }
  #captchaBox { margin:8px 0; min-height:20px; }
  details summary { cursor:pointer; color:var(--sub); }
</style>
</head>
<body>
<div class="wrap">
  <h1>mimo-web-api \u7BA1\u7406\u9762\u677F</h1>

  <div class="card">
    <div class="row">
      <span class="muted">API Key</span>
      <input id="apiKey" type="password" placeholder="\u586B\u5165 API_KEY\uFF08Bearer\uFF09" style="flex:1; min-width:220px">
      <button class="pri" id="saveKey">\u4FDD\u5B58\u5E76\u52A0\u8F7D</button>
      <span id="keyHint" class="muted"></span>
    </div>
  </div>

  <div class="tabs">
    <button data-tab="overview" class="on">\u6982\u89C8</button>
    <button data-tab="accounts">\u8D26\u53F7\u6C60</button>
    <button data-tab="addaccount">\u6DFB\u52A0\u8D26\u53F7</button>
    <button data-tab="usage">\u7EDF\u8BA1</button>
    <button data-tab="logs">\u65E5\u5FD7</button>
    <button data-tab="playground">\u5BF9\u8BDD\u6D4B\u8BD5</button>
  </div>

  <div class="section on" id="sec-overview">
    <div class="card">
      <h2>\u670D\u52A1\u6982\u89C8</h2>
      <div class="row" id="kpis"></div>
      <p class="muted" id="cfgInfo"></p>
    </div>
  </div>

  <div class="section" id="sec-accounts">
    <div class="card">
      <h2>\u8D26\u53F7\u6C60
        <button class="mini" id="btnReload" style="margin-left:8px">\u5237\u65B0</button>
        <button class="mini pri" id="btnRefreshAll">\u5168\u90E8\u7ACB\u5373\u6362\u53D1</button>
      </h2>
      <table><thead><tr>
        <th>#</th><th>\u6A21\u5F0F</th><th>\u6807\u8BC6</th><th>\u5065\u5EB7</th><th>\u5931\u8D25</th><th>\u51B7\u5374</th><th>\u6700\u8FD1\u6362\u53D1</th><th>\u64CD\u4F5C</th>
      </tr></thead><tbody id="accRows"></tbody></table>
      <p class="muted">AT/RT \u8D26\u53F7\u5728\u4F1A\u8BDD\u5931\u6548\u65F6\u4F1A\u81EA\u52A8\u6362\u53D1\uFF0C\u65E0\u9700\u624B\u52A8\u7EF4\u62A4\uFF1B"\u51B7\u5374"\u8868\u793A\u8FD1\u671F\u5931\u8D25\u540E\u7684\u6682\u505C\u79D2\u6570\u3002</p>
    </div>
  </div>

  <div class="section" id="sec-addaccount">
    <div class="card">
      <h2>\u5C0F\u7C73\u8D26\u53F7\u767B\u5F55\uFF08\u81EA\u52A8\u83B7\u53D6 AT/RT\uFF09</h2>
      <p class="muted">\u5728\u9762\u677F\u5185\u5B8C\u6210\u5C0F\u7C73\u5B98\u65B9\u767B\u5F55\uFF08\u624B\u673A\u77ED\u4FE1 / \u5BC6\u7801\uFF09\uFF0C\u670D\u52A1\u7AEF\u81EA\u52A8\u62FF\u5230 passToken \u4E0E serviceToken \u5E76\u52A0\u5165\u8D26\u53F7\u6C60\uFF0C\u5168\u7A0B\u65E0\u9700\u590D\u5236 Cookie\u3002\u9A8C\u8BC1\u65F6\u5982\u5F39\u51FA\u6ED1\u5757\uFF0C\u8BF7\u5728\u5F39\u5C42\u4E2D\u624B\u52A8\u62D6\u52A8\u5B8C\u6210\u3002</p>
      <div class="row">
        <input id="loginPhone" placeholder="\u624B\u673A\u53F7\uFF08\u77ED\u4FE1\u767B\u5F55\uFF09" style="width:180px">
        <button class="pri" id="btnSendSms">\u83B7\u53D6\u9A8C\u8BC1\u7801</button>
        <input id="loginSmsCode" placeholder="\u77ED\u4FE1\u9A8C\u8BC1\u7801" style="width:120px">
        <button id="btnVerifySms">\u767B\u5F55\u5E76\u6DFB\u52A0\u8D26\u53F7</button>
      </div>
      <div class="row" style="margin-top:10px">
        <input id="loginAccount" placeholder="\u5C0F\u7C73\u8D26\u53F7\uFF08\u624B\u673A/\u90AE\u7BB1/ID\uFF09" style="width:180px">
        <input id="loginPassword" type="password" placeholder="\u5BC6\u7801\uFF08\u5BC6\u7801\u767B\u5F55\uFF09" style="width:160px">
        <button id="btnLoginPwd">\u5BC6\u7801\u767B\u5F55\u5E76\u6DFB\u52A0</button>
      </div>
      <div id="captchaBox" class="muted"></div>
      <div id="loginMsg" class="muted"></div>
    </div>
    <div class="card">
      <details>
        <summary>\u624B\u52A8\u6DFB\u52A0\uFF08passToken / \u5B8C\u6574 Cookie \u5907\u7528\u65B9\u5F0F\uFF09</summary>
        <div class="row" style="margin-top:10px">
          <input id="mUserId" placeholder="userId" style="width:140px">
          <input id="mPassToken" placeholder="passToken\uFF08RT\uFF09" style="flex:1; min-width:200px">
          <button id="btnAddManual">\u6DFB\u52A0</button>
        </div>
        <div class="row" style="margin-top:8px">
          <input id="mCookie" placeholder="\u6216\u7C98\u8D34\u5B8C\u6574 Cookie \u4E32" style="flex:1; min-width:260px">
          <button id="btnAddCookie">\u6DFB\u52A0 Cookie \u8D26\u53F7</button>
        </div>
      </details>
    </div>
  </div>

  <div class="section" id="sec-usage">
    <div class="card">
      <h2>\u4ECA\u65E5\u7528\u91CF</h2>
      <div class="row" id="usageKpis"></div>
      <h2 style="margin-top:16px">\u8FD1 14 \u5929</h2>
      <table><thead><tr><th>\u65E5\u671F</th><th>\u8BF7\u6C42\u6570</th><th>Prompt Tokens</th><th>Completion Tokens</th><th>\u603B Tokens</th><th>\u9519\u8BEF</th></tr></thead>
      <tbody id="usageRows"></tbody></table>
      <p class="muted" id="modelUsage"></p>
    </div>
  </div>

  <div class="section" id="sec-logs">
    <div class="card">
      <h2>\u6700\u8FD1\u8BF7\u6C42 <button class="mini" id="btnLogsReload">\u5237\u65B0</button></h2>
      <table><thead><tr><th>\u65F6\u95F4</th><th>\u6A21\u578B</th><th>\u6D41\u5F0F</th><th>\u72B6\u6001</th><th>Prompt</th><th>Completion</th><th>\u8017\u65F6</th><th>\u9519\u8BEF</th></tr></thead>
      <tbody id="logRows"></tbody></table>
    </div>
  </div>

  <div class="section" id="sec-playground">
    <div class="card">
      <h2>\u5BF9\u8BDD\u6D4B\u8BD5</h2>
      <div class="row">
        <select id="playModel">
          <option value="mimo-v2.6-pro">mimo-v2.6-pro</option>
          <option value="mimo-v2.6-pro-ultraspeed-studio">mimo-v2.6-pro-ultraspeed-studio</option>
          <option value="mimo-v2.6-flash">mimo-v2.6-flash</option>
        </select>
        <label class="muted"><input type="checkbox" id="playStream" checked> \u6D41\u5F0F</label>
      </div>
      <textarea id="playInput" rows="3" placeholder="\u8F93\u5165\u6D88\u606F\u2026" style="width:100%; margin-top:8px"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="pri" id="btnPlay">\u53D1\u9001</button>
        <button id="btnPlayStop">\u4E2D\u65AD</button>
      </div>
      <div id="play"></div>
    </div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const CAPTCHA_APP_KEY = "__CAPTCHA_APP_KEY__";
const CAPTCHA_SDK_URL = "__CAPTCHA_SDK_URL__";

let controller = null;

function key() { return $("apiKey").value.trim(); }
function authHeaders(extra) { return Object.assign({ "Authorization": "Bearer " + key(), "Content-Type": "application/json" }, extra || {}); }

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: authHeaders() }, opts || {}));
  const j = await r.json().catch(() => ({ error: { message: "\u54CD\u5E94\u89E3\u6790\u5931\u8D25" } }));
  if (!r.ok) throw new Error(j.error?.message || ("HTTP " + r.status));
  return j;
}

function setMsg(id, text, isErr) {
  const el = $(id);
  el.replaceChildren();
  const s = document.createElement("span");
  s.textContent = text;
  if (isErr) s.className = "err";
  el.appendChild(s);
}

// ---------- \u6807\u7B7E\u9875 ----------
document.querySelectorAll(".tabs button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("on"));
    document.querySelectorAll(".section").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    $("sec-" + b.dataset.tab).classList.add("on");
    if (b.dataset.tab === "playground") ensureCaptchaSdk();
  });
});

$("saveKey").addEventListener("click", () => {
  localStorage.setItem("mimo_api_key", key());
  loadAll();
});
window.addEventListener("DOMContentLoaded", () => {
  $("apiKey").value = localStorage.getItem("mimo_api_key") || "";
  if ($("apiKey").value) loadAll();
});

async function loadAll() {
  try {
    const s = await api("/admin/summary");
    renderSummary(s);
    renderAccounts(s);
    renderUsage(s.stats);
    const l = await api("/admin/logs");
    renderLogs(l.logs);
    $("keyHint").textContent = "\u5DF2\u8FDE\u63A5";
  } catch (e) {
    $("keyHint").textContent = "\u52A0\u8F7D\u5931\u8D25: " + e.message;
  }
}

function renderSummary(s) {
  const today = s.stats.today || {};
  const kpis = [
    ["\u8D26\u53F7\u603B\u6570", s.pool.length],
    ["\u4ECA\u65E5\u8BF7\u6C42", today.requests ?? 0],
    ["\u4ECA\u65E5 Tokens", (today.promptTokens ?? 0) + " / " + (today.completionTokens ?? 0)],
    ["\u4ECA\u65E5\u9519\u8BEF", today.errors ?? 0],
  ];
  $("kpis").replaceChildren();
  for (const kv of kpis) {
    const d = document.createElement("div");
    d.className = "kpi";
    const b = document.createElement("b"); b.textContent = kv[1];
    const sp = document.createElement("span"); sp.textContent = kv[0];
    d.append(b, sp);
    $("kpis").appendChild(d);
  }
  const c = s.config || {};
  $("cfgInfo").textContent =
    "\u9ED8\u8BA4\u6A21\u578B: " + c.defaultModel + " \xB7 \u591A\u8F6E\u6A21\u5F0F: " + c.contextMode +
    " \xB7 \u5DE5\u5177\u900F\u4F20: " + (c.toolPassthrough ? "\u5F00" : "\u5173") +
    " \xB7 AT/RT \u4FDD\u6D3B: " + (c.sessionRefreshHours > 0 ? ("\u6BCF " + c.sessionRefreshHours + " \u5C0F\u65F6") : "\u5173");
}

function renderAccounts(s) {
  const tb = $("accRows");
  tb.replaceChildren();
  for (const a of s.pool) {
    const tr = document.createElement("tr");
    const cells = [
      String(a.index),
      a.type === "account" ? "AT/RT" : "Cookie",
      a.label || (a.userId || "-"),
      a.healthy ? "\u6B63\u5E38" : "\u51B7\u5374\u4E2D",
      String(a.failCount),
      a.cooldownSeconds > 0 ? a.cooldownSeconds + "s" : "-",
      (s.sessions || []).find(x => x.userId === a.userId)?.fetchedAt || "-",
    ];
    cells.forEach((c, ci) => {
      const td = document.createElement("td");
      if (ci === 3) {
        const tag = document.createElement("span");
        tag.className = "tag " + (c === "\u6B63\u5E38" ? "ok" : "warn");
        tag.textContent = c;
        td.appendChild(tag);
      } else td.textContent = c;
      tr.appendChild(td);
    });
    const op = document.createElement("td");
    const del = document.createElement("button");
    del.className = "mini"; del.textContent = "\u5220\u9664";
    del.addEventListener("click", async () => {
      if (!confirm("\u786E\u5B9A\u5220\u9664\u8BE5\u8D26\u53F7\uFF1F")) return;
      try { await api("/admin/accounts/remove", { method: "POST", body: JSON.stringify({ index: a.index }) }); loadAll(); }
      catch (e) { alert(e.message); }
    });
    op.appendChild(del);
    tr.appendChild(op);
    tb.appendChild(tr);
  }
  if (s.pool.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8; td.className = "muted"; td.textContent = "\u6682\u65E0\u8D26\u53F7\uFF0C\u8BF7\u5230\u300C\u6DFB\u52A0\u8D26\u53F7\u300D\u9875\u6DFB\u52A0";
    tr.appendChild(td); tb.appendChild(tr);
  }
}

$("btnReload").addEventListener("click", loadAll);
$("btnRefreshAll").addEventListener("click", async () => {
  try {
    const r = await api("/admin/session/refresh", { method: "POST" });
    alert("\u5DF2\u6362\u53D1 " + r.refreshed + " \u4E2A\u8D26\u53F7");
    loadAll();
  } catch (e) { alert(e.message); }
});

function renderUsage(st) {
  const today = st.today || {};
  const kpis = [
    ["\u8BF7\u6C42\u6570", today.requests ?? 0],
    ["Prompt Tokens", today.promptTokens ?? 0],
    ["Completion Tokens", today.completionTokens ?? 0],
    ["\u9519\u8BEF", today.errors ?? 0],
  ];
  $("usageKpis").replaceChildren();
  for (const kv of kpis) {
    const d = document.createElement("div");
    d.className = "kpi";
    const b = document.createElement("b"); b.textContent = kv[1];
    const sp = document.createElement("span"); sp.textContent = kv[0];
    d.append(b, sp);
    $("usageKpis").appendChild(d);
  }
  const tb = $("usageRows");
  tb.replaceChildren();
  for (const d of st.recentDays || []) {
    const tr = document.createElement("tr");
    for (const v of [d.day, d.requests, d.promptTokens, d.completionTokens, d.totalTokens, d.errors]) {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  const models = Object.entries((st.today || {}).models || {});
  $("modelUsage").textContent = models.length
    ? "\u4ECA\u65E5\u5404\u6A21\u578B: " + models.map(([m, v]) => m + " \xD7 " + v.requests).join(" \xB7 ")
    : "";
}

function renderLogs(logs) {
  const tb = $("logRows");
  tb.replaceChildren();
  for (const l of logs || []) {
    const tr = document.createElement("tr");
    const cells = [
      new Date(l.time).toLocaleString(),
      l.model, l.stream ? "\u6D41\u5F0F" : "\u975E\u6D41\u5F0F", l.status,
      l.promptTokens, l.completionTokens,
      l.durationMs != null ? (l.durationMs / 1000).toFixed(1) + "s" : "-",
      l.error || "",
    ];
    cells.forEach((v, ci) => {
      const td = document.createElement("td");
      td.textContent = v;
      if (ci === 3 && l.status !== 200) td.className = "err";
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  }
  if (!logs || logs.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td"); td.colSpan = 8; td.className = "muted"; td.textContent = "\u6682\u65E0\u8BF7\u6C42";
    tr.appendChild(td); tb.appendChild(tr);
  }
}
$("btnLogsReload").addEventListener("click", async () => {
  try { renderLogs((await api("/admin/logs")).logs); } catch (e) { alert(e.message); }
});

// ---------- \u5C0F\u7C73\u767B\u5F55\u5411\u5BFC ----------
let captchaReady = false, captchaLoading = false;
function ensureCaptchaSdk() {
  if (captchaReady || captchaLoading) return Promise.resolve();
  captchaLoading = true;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = CAPTCHA_SDK_URL;
    s.async = true;
    s.onload = () => { captchaReady = true; captchaLoading = false; resolve(); };
    s.onerror = () => { captchaLoading = false; setMsg("captchaBox", "\u9A8C\u8BC1\u7801 SDK \u52A0\u8F7D\u5931\u8D25\uFF08\u53EF\u80FD\u662F\u7F51\u7EDC\u95EE\u9898\uFF09", true); resolve(); };
    document.body.appendChild(s);
  });
}

async function getCaptchaCode() {
  await ensureCaptchaSdk();
  if (!captchaReady || typeof window.initMiverify !== "function") {
    throw new Error("\u9A8C\u8BC1\u7801 SDK \u4E0D\u53EF\u7528\uFF08initMiverify \u672A\u52A0\u8F7D\uFF09");
  }
  setMsg("captchaBox", "\u5982\u51FA\u73B0\u6ED1\u5757\uFF0C\u8BF7\u5728\u5F39\u5C42\u4E2D\u62D6\u52A8\u5B8C\u6210\u9A8C\u8BC1\u2026");
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      window.initMiverify({
        k: CAPTCHA_APP_KEY,
        locale: "zh_CN",
        errorAction: true,
        bindBtn: "",
        beforeShowVerifyModal: () => {},
        onSuccess: (r) => {
          if (settled) return; settled = true;
          setMsg("captchaBox", "\u4EBA\u673A\u9A8C\u8BC1\u901A\u8FC7");
          resolve(r?.icode || "");
        },
        onClose: () => {
          if (settled) return; settled = true;
          reject(new Error("\u9A8C\u8BC1\u5DF2\u53D6\u6D88"));
        },
        onError: (e) => {
          if (settled) return; settled = true;
          reject(new Error("\u4EBA\u673A\u9A8C\u8BC1\u5931\u8D25: " + (e?.message || e || "\u672A\u77E5\u9519\u8BEF")));
        }
      }, function (start) {
        if (start && start.start) start.start();
      });
    } catch (e) {
      reject(new Error("\u9A8C\u8BC1\u7801\u521D\u59CB\u5316\u5F02\u5E38: " + e.message));
    }
  });
}

$("btnSendSms").addEventListener("click", async () => {
  const phone = $("loginPhone").value.trim();
  if (!phone) { setMsg("loginMsg", "\u8BF7\u8F93\u5165\u624B\u673A\u53F7", true); return; }
  try {
    $("btnSendSms").disabled = true;
    const captCode = await getCaptchaCode();
    const r = await api("/admin/login/sms/send", { method: "POST", body: JSON.stringify({ phone, captCode }) });
    setMsg("loginMsg", r.description || (r.ok ? "\u77ED\u4FE1\u5DF2\u53D1\u9001" : "\u53D1\u9001\u5931\u8D25"), !r.ok);
  } catch (e) {
    setMsg("loginMsg", e.message, true);
  } finally {
    $("btnSendSms").disabled = false;
  }
});

$("btnVerifySms").addEventListener("click", async () => {
  const phone = $("loginPhone").value.trim();
  const code = $("loginSmsCode").value.trim();
  if (!phone || !code) { setMsg("loginMsg", "\u8BF7\u8F93\u5165\u624B\u673A\u53F7\u548C\u77ED\u4FE1\u9A8C\u8BC1\u7801", true); return; }
  try {
    $("btnVerifySms").disabled = true;
    const r = await api("/admin/login/sms/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
    setMsg("loginMsg", "\u8D26\u53F7 " + r.userId + " \u5DF2\u6DFB\u52A0\uFF08AT/RT \u81EA\u52A8\u83B7\u53D6\uFF09", false);
    loadAll();
  } catch (e) {
    setMsg("loginMsg", "\u767B\u5F55\u5931\u8D25: " + e.message, true);
  } finally {
    $("btnVerifySms").disabled = false;
  }
});

$("btnLoginPwd").addEventListener("click", async () => {
  const account = $("loginAccount").value.trim();
  const password = $("loginPassword").value;
  if (!account || !password) { setMsg("loginMsg", "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801", true); return; }
  try {
    $("btnLoginPwd").disabled = true;
    let captCode = "";
    try { captCode = await getCaptchaCode(); } catch (e) { captCode = ""; }
    const r = await api("/admin/login/password", { method: "POST", body: JSON.stringify({ account, password, captCode }) });
    setMsg("loginMsg", "\u8D26\u53F7 " + r.userId + " \u5DF2\u6DFB\u52A0\uFF08AT/RT \u81EA\u52A8\u83B7\u53D6\uFF09", false);
    loadAll();
  } catch (e) {
    setMsg("loginMsg", "\u767B\u5F55\u5931\u8D25: " + e.message, true);
  } finally {
    $("btnLoginPwd").disabled = false;
  }
});

$("btnAddManual").addEventListener("click", async () => {
  try {
    await api("/admin/accounts/add", { method: "POST", body: JSON.stringify({ userId: $("mUserId").value.trim(), passToken: $("mPassToken").value.trim() }) });
    setMsg("loginMsg", "\u5DF2\u6DFB\u52A0", false);
    loadAll();
  } catch (e) { setMsg("loginMsg", e.message, true); }
});
$("btnAddCookie").addEventListener("click", async () => {
  try {
    await api("/admin/accounts/add", { method: "POST", body: JSON.stringify({ cookie: $("mCookie").value.trim() }) });
    setMsg("loginMsg", "\u5DF2\u6DFB\u52A0", false);
    loadAll();
  } catch (e) { setMsg("loginMsg", e.message, true); }
});

// ---------- \u5BF9\u8BDD\u6D4B\u8BD5 ----------
$("btnPlay").addEventListener("click", async () => {
  const input = $("playInput").value.trim();
  if (!input) return;
  const stream = $("playStream").checked;
  const model = $("playModel").value;
  const box = $("play");
  box.replaceChildren();
  const thinkEl = document.createElement("div"); thinkEl.className = "think";
  const ansEl = document.createElement("div");
  box.append(thinkEl, ansEl);
  const setThink = (t) => { thinkEl.textContent = t; };
  const appendAns = (t) => { ansEl.textContent += t; };

  controller = new AbortController();
  $("btnPlay").disabled = true;
  const t0 = Date.now();
  try {
    const r = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: authHeaders(),
      signal: controller.signal,
      body: JSON.stringify({ model, stream, messages: [{ role: "user", content: input }] })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.error?.message || ("HTTP " + r.status));
    }
    if (!stream) {
      const j = await r.json();
      const msg = j.choices?.[0]?.message || {};
      if (msg.reasoning_content) setThink("[\u601D\u8003] " + msg.reasoning_content);
      appendAns(msg.content || "(\u7A7A)");
      appendAns("\\n\\n\u2014 \u5B8C\u6210\uFF08" + ((Date.now() - t0) / 1000).toFixed(1) + "s\uFF09");
    } else {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\\n\\n")) !== -1) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of block.split("\\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let j;
            try { j = JSON.parse(data); } catch { continue; }
            if (j.error) throw new Error(j.error.message || "\u4E0A\u6E38\u9519\u8BEF");
            const d = j.choices?.[0]?.delta || {};
            if (d.reasoning_content) setThink("[\u601D\u8003\u4E2D] " + d.reasoning_content);
            if (d.content) appendAns(d.content);
          }
        }
      }
      appendAns("\\n\\n\u2014 \u5B8C\u6210\uFF08" + ((Date.now() - t0) / 1000).toFixed(1) + "s\uFF09");
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      const s = document.createElement("span"); s.className = "err"; s.textContent = "\u9519\u8BEF: " + e.message;
      box.appendChild(s);
    }
  } finally {
    $("btnPlay").disabled = false;
    controller = null;
  }
});
$("btnPlayStop").addEventListener("click", () => { if (controller) controller.abort(); });
</script>
</body>
</html>`;

// src/server.js
init_xiaomi_login();
var pool = new CookiePool([
  ...config.poolEntries,
  ...loadPanelAccounts().map((a) => ({ ...a, source: "panel" }))
]);
var allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
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
function checkAuth(req) {
  if (config.apiKey.length === 0) return true;
  const header = req.headers["authorization"] || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return config.apiKey.includes(m[1].trim());
}
var HTML_UNSAFE_MAP = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", '"': "\\u0022", "'": "\\u0027" };
function escapeForHtmlOutput(char) {
  return HTML_UNSAFE_MAP[char] || char;
}
function sendJson2(res, status, obj) {
  const json = JSON.stringify(
    obj,
    (key, value) => typeof value === "string" ? value.replace(/[<>&"']/g, escapeForHtmlOutput) : value
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
        reject(new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
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
        reject(new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
      }
    });
    req.on("error", reject);
  });
}
var server = http.createServer(async (req, res) => {
  const url2 = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url2.pathname.replace(/\/+$/, "") || "/";
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && pathname === "/panel") {
      servePanelPage(res, {
        captchaAppKey: CAPTCHA_APP_KEY,
        captchaSdkUrl: CAPTCHA_SDK_URL
      });
      return;
    }
    if (req.method === "GET" && pathname === "/") {
      sendJson2(res, 200, {
        name: "mimo-web-api",
        version: "1.2.0",
        description: "\u5C0F\u7C73 MiMo Studio \u7F51\u9875\u7AEF OpenAI \u517C\u5BB9\u53CD\u4EE3\uFF08AT/RT \u81EA\u52A8\u7EED\u671F + \u7BA1\u7406\u9762\u677F\uFF09",
        panel: "/panel",
        endpoints: [
          "/panel",
          "/v1/models",
          "/v1/chat/completions",
          "/session/check",
          "/session/refresh",
          "/ping"
        ],
        defaultModel: config.defaultModel,
        accounts: {
          cookieMode: pool.entries.filter((e) => e.type === "cookie").length,
          accountMode: pool.entries.filter((e) => e.type === "account").length
        }
      });
      return;
    }
    if (req.method === "GET" && pathname === "/ping") {
      sendJson2(res, 200, { pong: true, time: Date.now() });
      return;
    }
    if (!checkAuth(req)) {
      sendJson2(res, 401, errorBody(401, "\u65E0\u6548\u7684 API Key\uFF0C\u8BF7\u914D\u7F6E Authorization: Bearer <API_KEY>"));
      return;
    }
    if (pathname.startsWith("/admin/")) {
      if (req.method === "GET" && pathname === "/admin/summary") {
        sendJson2(res, 200, {
          pool: pool.status(),
          sessions: sessionManager.status(),
          stats: stats.summary(),
          config: {
            defaultModel: config.defaultModel,
            contextMode: config.contextMode,
            toolPassthrough: ["1", "true", "yes", "on"].includes(
              String(process.env.TOOL_PASSTHROUGH ?? "true").toLowerCase()
            ),
            sessionRefreshHours: config.sessionRefreshHours
          }
        });
        return;
      }
      if (req.method === "GET" && pathname === "/admin/logs") {
        sendJson2(res, 200, { logs: stats.recentLogs(200) });
        return;
      }
      if (req.method === "POST" && pathname === "/admin/accounts/add") {
        let body;
        try {
          body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
              } catch {
                reject(new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
              }
            });
            req.on("error", reject);
          });
        } catch (err) {
          sendJson2(res, 400, { ok: false, error: err.message });
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
            sessionCookie: body.sessionCookie || null
          };
        }
        if (!entry) {
          sendJson2(res, 400, { ok: false, error: "\u7F3A\u5C11 cookie \u6216 userId+passToken" });
          return;
        }
        const accounts = loadPanelAccounts();
        accounts.push(entry);
        savePanelAccounts(accounts);
        pool.addEntry(entry);
        sendJson2(res, 200, { ok: true, total: pool.size });
        return;
      }
      if (req.method === "POST" && pathname === "/admin/accounts/remove") {
        let body = {};
        try {
          body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
              } catch {
                reject(new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
              }
            });
            req.on("error", reject);
          });
        } catch (err) {
          sendJson2(res, 400, { ok: false, error: err.message });
          return;
        }
        const idx = Number(body.index);
        const entry = pool.entries[idx];
        if (!entry) {
          sendJson2(res, 404, { ok: false, error: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
          return;
        }
        if (entry.source === "env") {
          sendJson2(res, 400, { ok: false, error: "\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u7684\u8D26\u53F7\u4E0D\u80FD\u5728\u9762\u677F\u4E2D\u5220\u9664" });
          return;
        }
        const accounts = loadPanelAccounts();
        const fileIdx = accounts.findIndex(
          (a) => a === entry.raw || a.userId && a.userId === entry.userId && a.passToken && a.passToken === entry.passToken
        );
        if (fileIdx !== -1) {
          accounts.splice(fileIdx, 1);
          savePanelAccounts(accounts);
        }
        pool.removeEntry(idx);
        sendJson2(res, 200, { ok: true, total: pool.size });
        return;
      }
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
              error: r.error ?? null
            });
          } catch (err) {
            results.push({
              index: entry.index,
              mode: "account(AT/RT)",
              userId: entry.userId,
              ok: false,
              error: String(err?.message || err)
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
            error: r.error ?? null
          });
        }
      }
      sendJson2(res, 200, { total: results.length, results, sessions: sessionManager.status() });
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
      sendJson2(res, 200, {
        refreshed,
        results,
        note: refreshed === 0 ? "\u5F53\u524D\u6CA1\u6709 AT/RT \u8D26\u53F7\uFF08passToken \u6A21\u5F0F\uFF09\uFF1Bcookie \u6A21\u5F0F\u7684\u8D26\u53F7\u65E0\u6CD5\u81EA\u52A8\u6362\u53D1" : void 0
      });
      return;
    }
    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson2(res, 400, errorBody(400, err.message));
        return;
      }
      logger.info(
        `[chat] model=${body.model || config.defaultModel} stream=${body.stream === true} messages=${(body.messages || []).length}`
      );
      if (pool.size === 0) {
        sendJson2(
          res,
          500,
          errorBody(
            500,
            "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u4E0A\u6E38\u8D26\u53F7\uFF1A\u8BF7\u8BBE\u7F6E MIMO_COOKIES\uFF08Cookie \u6A21\u5F0F\uFF09\u6216 MIMO_ACCOUNTS\uFF08AT/RT \u6A21\u5F0F\uFF09\u540E\u91CD\u542F"
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
        reportCookie: (entry, ok) => ok ? pool.markSuccess(entry) : pool.markFailure(entry),
        invalidateSession: (entry) => sessionManager.invalidate(entry)
      });
      return;
    }
    logger.warn(`[server] 404: ${req.method} ${pathname}`);
    sendJson2(res, 404, errorBody(404, "\u672A\u77E5\u8DEF\u7531\uFF0C\u53EF\u7528\u7AEF\u70B9\u89C1 GET /"));
  } catch (err) {
    logger.error("[server] \u672A\u5904\u7406\u5F02\u5E38:", err?.stack || err);
    if (!res.headersSent) sendJson2(res, 500, errorBody(500, "\u670D\u52A1\u5668\u5185\u90E8\u9519\u8BEF"));
    else res.end();
  }
});
server.listen(config.port, config.host, () => {
  const cookieCount = pool.entries.filter((e) => e.type === "cookie").length;
  const accountCount = pool.entries.filter((e) => e.type === "account").length;
  logger.info(`mimo-web-api \u5DF2\u542F\u52A8: http://${config.host}:${config.port}`);
  logger.info(`\u4E0A\u6E38: ${config.upstreamBase} | \u9ED8\u8BA4\u6A21\u578B: ${config.defaultModel}`);
  logger.info(
    `\u8D26\u53F7\u6C60: ${pool.size} \u4E2A\uFF08Cookie \u6A21\u5F0F ${cookieCount} \u4E2A / AT-RT \u6A21\u5F0F ${accountCount} \u4E2A\uFF09${pool.size === 0 ? "\uFF08\u672A\u914D\u7F6E\uFF01\u8BF7\u8BBE\u7F6E MIMO_COOKIES \u6216 MIMO_ACCOUNTS\uFF09" : ""}`
  );
  logger.info(`\u8BBF\u95EE\u9274\u6743: ${config.apiKey.length > 0 ? "\u5DF2\u542F\u7528 Bearer Key" : "\u672A\u542F\u7528\uFF08API_KEY \u4E3A\u7A7A\uFF09"}`);
  if (accountCount > 0 && config.sessionRefreshHours > 0) {
    logger.info(`AT/RT \u4F1A\u8BDD\u4FDD\u6D3B: \u6BCF ${config.sessionRefreshHours} \u5C0F\u65F6\u68C0\u67E5\u4E00\u6B21\uFF08\u5931\u6548\u81EA\u52A8\u6362\u53D1\uFF09`);
  }
});
if (config.sessionRefreshHours > 0 && pool.accountEntries().length > 0) {
  const timer = setInterval(async () => {
    try {
      const results = await sessionManager.keepAlive(pool.accountEntries());
      for (const r of results) {
        logger.info(
          `[session] \u4FDD\u6D3B: \u8D26\u53F7 ${r.userId} ${r.ok ? r.refreshed ? "\u5DF2\u6362\u53D1\u65B0\u4F1A\u8BDD" : "\u4F1A\u8BDD\u6709\u6548" : "\u6362\u53D1\u5931\u8D25"}`
        );
      }
    } catch (err) {
      logger.warn("[session] \u4FDD\u6D3B\u4EFB\u52A1\u5F02\u5E38:", err?.message || err);
    }
  }, config.sessionRefreshHours * 3600 * 1e3);
  timer.unref();
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    logger.info(`\u6536\u5230 ${sig}\uFF0C\u6B63\u5728\u5173\u95ED...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3e3).unref();
  });
}
