import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * 小米账号登录协议实现（逆向自 account.xiaomi.com/fe/service/login 前端）。
 *
 * 用途：管理面板内"手机号/密码登录"向导——用户在面板里直接登录小米账号，
 * 服务端自动完成协议交互并捕获 AT（xiaomichatbot_serviceToken）与
 * RT（passToken），全程无需手动复制任何 Cookie。
 *
 * 协议要点：
 *  - 参数加密 encryptAes：随机 16 位密钥；每个字段用 AES-128-CBC
 *    （key/iv 均按 UTF-8，iv 固定 "0102030405060708"，PKCS7）加密成 base64；
 *    EUI 头 = RSA_PKCS1_v1_5(base64(密钥)) + "." + base64(字段名列表逗号连接)。
 *  - 短信登录：/pass/sendServiceLoginTicket（需滑块验证码 icode）→
 *    /pass/serviceLoginTicketAuth（提交短信码）→ 响应种下 passToken 并返回 location。
 *  - 密码登录：/pass/serviceLoginAuth2（hash = MD5(密码)大写）→ 同上。
 *  - 滑块验证码：面板页面加载小米官方 SDK（initMiverify，appKey 固定），
 *    用户手动拖动滑块，SDK 回调返回 icode，服务端把它作为 captCode 提交。
 */

const ACCOUNT_HOST = "https://account.xiaomi.com";
// 生产环境 RSA 公钥（来自登录页前端，preview 环境的密钥不适用）
const RSA_PUBLIC_KEY_DER =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCYEVrK/4Mahiv0pUJgTybx4J9P5dUT/Y0PuwMbk+gMU+jrZnBiXGv6/hCH1avIhoBcE535F8nJQQN3UavZdFkYidsoXuEnat3+eVTp3FslyhRwIBDF09v4vDhRtxFOT+R7uH7h/mzmyA2/+lfIMWGIrffXprYizbV76+YQKhoqFQIDAQAB";
// 面板内嵌验证码 SDK 的固定 appKey（来自登录页前端）
export const CAPTCHA_APP_KEY = "8027422fb0eb42fbac1b521ec4a7961f";
export const CAPTCHA_SDK_URL =
  "https://captcha-cdn01.infosec.xiaomi.com/mcfe--captcha-static-sdk/prod/v3/static/js/v.js";

const AES_IV = "0102030405060708";
const KEY_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function randomKey16() {
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += KEY_CHARSET[crypto.randomInt(KEY_CHARSET.length)];
  }
  return s;
}

function rsaEncryptBase64(plain) {
  const pem =
    "-----BEGIN PUBLIC KEY-----\n" +
    RSA_PUBLIC_KEY_DER +
    "\n-----END PUBLIC KEY-----";
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, "utf8")
  );
  return encrypted.toString("base64");
}

/** 与登录页 encryptAes 等价的参数加密：返回 { EUI, encryptedParams } */
export function encryptParams(params) {
  const key = randomKey16();
  const fieldNames = Object.keys(params).join(",");
  const eui =
    rsaEncryptBase64(Buffer.from(key, "utf8").toString("base64")) +
    "." +
    Buffer.from(fieldNames, "utf8").toString("base64");

  const encryptedParams = {};
  for (const [name, value] of Object.entries(params)) {
    const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(AES_IV, "utf8"));
    encryptedParams[name] = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
  }
  return { EUI: eui, encryptedParams };
}

function parsePassportJson(text) {
  const cleaned = text.replace(/^[\s/(]*(?:&&&START&&&)?/, "");
  return JSON.parse(cleaned);
}

/** 上游请求前的 host 白名单校验（防 SSRF） */
function assertHost(raw, hostnames) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !hostnames.includes(url.hostname)) {
    throw new Error(`拒绝请求非官方地址: ${raw.slice(0, 80)}`);
  }
  return url;
}

async function passportPost(pathname, form, headers = {}, jar = {}) {
  const url = assertHost(ACCOUNT_HOST + pathname, ["account.xiaomi.com"]);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": config.userAgent,
      Referer: ACCOUNT_HOST + "/",
      ...headers,
      Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: new URLSearchParams(form).toString(),
  });
  // 收集 passport 域下发的 Cookie（passToken 等长期凭证在这里）
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
    json = parsePassportJson(text);
  } catch {
    throw new Error(`passport 响应解析失败（HTTP ${resp.status}）: ${text.slice(0, 120)}`);
  }
  return { resp, json, jar };
}

/**
 * 发起登录会话：获取官方 loginUrl 并解析出 callback/_sign/qs/serviceParam 等参数。
 * 这些参数是 serviceLoginAuth2 / serviceLoginTicketAuth 的必填上下文。
 */
export async function createLoginContext(sid = "xiaomichatbot") {
  const probeUrl = assertHost(
    `${config.upstreamBase}/open-apis/user/mi/get`,
    [new URL(config.upstreamBase).hostname]
  );
  const r = await fetch(probeUrl, {
    headers: { "User-Agent": config.userAgent },
    redirect: "manual",
  });
  const body = await r.text().catch(() => "");
  let loginUrl = null;
  try {
    loginUrl = JSON.parse(body)?.loginUrl || null;
  } catch {
    loginUrl = null;
  }
  if (!loginUrl) {
    throw new Error("未能从上游获取登录地址（loginUrl），请稍后重试");
  }
  const u = assertHost(loginUrl, ["account.xiaomi.com"]);
  return {
    loginUrl: u.toString(),
    callback: u.searchParams.get("callback") || "",
    sid: u.searchParams.get("sid") || sid,
    qs: u.searchParams.get("qs") || "",
    sign: u.searchParams.get("_sign") || "",
    serviceParam: u.searchParams.get("serviceParam") || "",
    group: u.searchParams.get("_group") || "DEFAULT",
  };
}

/** 校验手机号归属（返回 type: ticket 表示支持短信登录） */
export async function checkPhone({ phone, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ phone });
  const { json } = await passportPost(
    "/pass/phoneInfo",
    { phone: encryptedParams.phone },
    { EUI }
  );
  return json; // code=0 时 data.type 通常为 "ticket"（短信登录）或 "password"
}

/** 发送短信登录验证码（captCode 为面板内滑块验证码回调返回的 icode） */
export async function sendLoginSms({ phone, captCode, ctx }) {
  const { EUI, encryptedParams } = encryptParams({ user: phone });
  const { json } = await passportPost(
    "/pass/sendServiceLoginTicket",
    {
      sid: ctx.sid,
      user: encryptedParams.user,
      captCode: captCode || "",
      type: "ticket",
      _json: "true",
    },
    { EUI }
  );
  return json;
}

/** 提交短信验证码，完成登录 */
export async function verifyLoginSms({ phone, code, ctx }) {
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
      _group: ctx.group,
    },
    { EUI },
    jar
  );
  return finalizeLogin({ resp, json, jar, ctx });
}

/** 账号密码登录 */
export async function loginWithPassword({ account, password, captCode, ctx }) {
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
      hash: crypto.createHash("md5").update(password, "utf8").digest("hex").toUpperCase(),
      policyName: "miaccount",
      captCode: captCode || "",
      _group: ctx.group,
    },
    { EUI },
    jar
  );
  return finalizeLogin({ resp, json, jar, ctx });
}

/**
 * 登录成功后的收尾：从 passport 响应里拿到 userId/passToken，
 * 再跟随 location（aistudio/sts）换发 serviceToken 会话 Cookie。
 * 返回可直接入库的 AT/RT 账号对象。
 */
async function finalizeLogin({ resp, json, jar, ctx }) {
  if (json.code !== 0) {
    const err = new Error(json.description || `登录失败（code=${json.code}）`);
    err.code = json.code;
    err.captchaUrl = json.captchaUrl || null;
    throw err;
  }
  const userId = String(json.userId ?? jar.userId ?? "");
  const passToken = jar.passToken || null;
  if (!userId || !passToken) {
    throw new Error("登录响应中缺少 userId/passToken，协议可能已变化");
  }

  // 跟随 location 换发 aistudio 会话 Cookie（serviceToken/ph）
  let sessionCookie = null;
  if (json.location) {
    const upstreamHost = new URL(config.upstreamBase).hostname;
    const loc = assertHost(json.location, [upstreamHost, "account.xiaomi.com"]);
    const stsResp = await fetch(loc, {
      headers: { "User-Agent": config.userAgent },
      redirect: "manual",
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
  logger.info(`[login] 账号 ${userId} 登录成功（AT/RT 已自动获取）`);
  return {
    type: "account",
    userId,
    passToken,
    passportCookie,
    sessionCookie,
    label: `account:${userId}`,
    addedAt: new Date().toISOString(),
  };
}
