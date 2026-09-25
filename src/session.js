import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { checkSession } from "./upstream.js";

/**
 * AT/RT 账号会话管理。
 *
 * 小米账号体系与"AT/RT"模型的对应关系：
 *   RT（长效凭证） = passToken（.xiaomi.com 域 Cookie，长期有效）
 *   AT（短期凭证） = xiaomichatbot_serviceToken（aistudio 域 Cookie，会过期）
 *
 * 换发（STS）流程，全程无需人工：
 *   1. 不带有效 serviceToken 请求任意 open-apis 接口 → 401 并返回 loginUrl
 *      （account.xiaomi.com/pass/serviceLogin?callback=aistudio/sts?sign=...）
 *   2. 携带 {userId, passToken} 访问该 loginUrl（+_json=true）
 *      → 返回 &&&START&&& JSON，code=0 时带 location（指向 aistudio/sts，含一次性票据）
 *   3. 访问 location → 响应 Set-Cookie 种下新的 serviceToken / ph / userId
 *   4. 用新 Cookie 继续调用，并落盘缓存
 */

const DATA_DIR = path.join(config.PROJECT_ROOT, "data");
const CACHE_FILE = path.join(DATA_DIR, "session-cache.json");

// 服务端请求外部 URL 前的 host 白名单校验（防 SSRF）：仅允许小米官方域
const AUTH_HOSTS = new Set(["account.xiaomi.com"]);
const UPSTREAM_HOSTS = new Set([new URL(config.upstreamBase).hostname]);

function assertOfficialUrl(raw, allowedHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("非法 URL");
  }
  if (url.protocol !== "https:") {
    throw new Error(`仅允许 https 请求，收到: ${url.protocol}`);
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`拒绝请求非官方主机: ${url.hostname}`);
  }
  return url;
}

function parsePassportJson(text) {
  // 小米 passport 返回形如 "&&&START&&&{...}"（偶有 // 前缀）
  const cleaned = text.replace(/^[\s/(]*(?:&&&START&&&)?/, "");
  return JSON.parse(cleaned);
}

/** 从 Set-Cookie 数组提取 "name=value" 对（保留值内引号） */
function collectCookies(setCookies) {
  const pairs = [];
  for (const sc of setCookies || []) {
    const head = sc.split(";")[0];
    const eq = head.indexOf("=");
    if (eq <= 0) continue;
    const name = head.slice(0, eq).trim();
    const value = head.slice(eq + 1).trim();
    if (!value || value === '""') continue; // 忽略删除型 Set-Cookie
    pairs.push([name, value]);
  }
  return pairs;
}

export class SessionManager {
  constructor() {
    /** userId -> { cookie, ph, fetchedAt } */
    this.cache = new Map();
    this.#loadDisk();
  }

  #loadDisk() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        for (const [userId, session] of Object.entries(j || {})) {
          if (session?.cookie) this.cache.set(userId, session);
        }
        if (this.cache.size > 0) {
          logger.info(`[session] 已从磁盘恢复 ${this.cache.size} 个账号的会话缓存`);
        }
      }
    } catch (err) {
      logger.warn("[session] 会话缓存读取失败:", err?.message || err);
    }
  }

  #saveDisk() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const obj = Object.fromEntries(this.cache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (err) {
      logger.warn("[session] 会话缓存写入失败:", err?.message || err);
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
    logger.info(`[session] 账号 ${entry.userId} 无缓存会话，开始 passToken 换发...`);
    return this.refreshSession(entry);
  }

  /** 会话失效（上游 401）后调用：清除缓存，下次重新换发 */
  invalidate(entry) {
    if (entry.type !== "account") return;
    this.cache.delete(entry.userId);
    this.#saveDisk();
    logger.info(`[session] 已清除账号 ${entry.userId} 的缓存会话`);
  }

  /** 通过 passToken 换发新的 serviceToken 会话 */
  async refreshSession(entry) {
    if (entry.type !== "account") {
      throw new Error("该账号不是 AT/RT 模式，无法自动换发");
    }
    const authCookie = `userId=${entry.userId}; passToken=${entry.passToken}`;

    // 第 1 步：不带 serviceToken 请求轻量接口，从 401 响应中获取官方 loginUrl
    let loginUrl = null;
    try {
      const probe = await fetch(`${config.upstreamBase}/open-apis/user/mi/get`, {
        headers: {
          "Accept-Language": "zh-CN",
          "User-Agent": config.userAgent,
          Cookie: `userId=${entry.userId};`,
        },
        redirect: "manual",
      });
      const body = await probe.text().catch(() => "");
      try {
        loginUrl = JSON.parse(body)?.loginUrl || null;
      } catch {
        loginUrl = null;
      }
    } catch (err) {
      logger.debug("[session] loginUrl 探测请求失败，将使用构造的换发地址:", err?.message || err);
    }

    // loginUrl 兜底：401 未返回时按官方回调格式构造（sign 对该服务固定）
    if (!loginUrl) {
      loginUrl = `https://account.xiaomi.com/pass/serviceLogin?callback=${encodeURIComponent(
        `${config.upstreamBase}/sts?sign=%2FKuvzNMEPYoLWPMSl3fRtWQeN%2Bo%3D&followup=${encodeURIComponent(config.upstreamBase + "/")}`
      )}&sid=xiaomichatbot&_group=DEFAULT`;
    }
    assertOfficialUrl(loginUrl, AUTH_HOSTS);

    // 第 2 步：携带 passToken 访问 serviceLogin（_json=true）
    const passportUrl = new URL(loginUrl);
    passportUrl.searchParams.set("_json", "true");
    const passportResp = await fetch(passportUrl, {
      headers: {
        "User-Agent": config.userAgent,
        Cookie: authCookie,
      },
      redirect: "manual",
    });
    const passportText = await passportResp.text();
    let passport;
    try {
      passport = parsePassportJson(passportText);
    } catch {
      throw new Error(`passport 响应解析失败: ${passportText.slice(0, 120)}`);
    }
    if (passport.code !== 0 || !passport.location) {
      throw new Error(
        `passToken 换发失败（code=${passport.code}，${passport.description || "未描述"}）。passToken 可能已失效，请重新获取。`
      );
    }
    assertOfficialUrl(passport.location, UPSTREAM_HOSTS);

    // 第 3 步：访问 /sts 一次性票据地址，收集新的会话 Cookie
    const stsResp = await fetch(passport.location, {
      headers: { "User-Agent": config.userAgent },
      redirect: "manual",
    });
    if (stsResp.status >= 400) {
      throw new Error(`sts 换发请求失败（HTTP ${stsResp.status}）`);
    }
    const pairs = collectCookies(stsResp.headers.getSetCookie());
    const cookieMap = new Map(pairs);
    cookieMap.set("userId", String(entry.userId));
    if (!cookieMap.has("xiaomichatbot_serviceToken")) {
      throw new Error("sts 响应未下发 serviceToken，换发流程异常");
    }

    const cookie = [...cookieMap].map(([k, v]) => `${k}=${v}`).join("; ");
    const ph = cookieMap.get("xiaomichatbot_ph") || null;
    this.cache.set(entry.userId, { cookie, ph, fetchedAt: new Date().toISOString() });
    this.#saveDisk();
    logger.info(`[session] 账号 ${entry.userId} 换发成功，会话已缓存`);
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
          logger.warn(`[session] 账号 ${entry.userId} 保活失败:`, err?.message || err);
          results.push({ userId: entry.userId, refreshed: false, ok: false, error: String(err?.message || err) });
        }
      } else {
        results.push({ userId: entry.userId, refreshed: false, ok: true });
      }
    }
    return results;
  }

  status() {
    // 仅输出结构化安全字段（userId 仅保留数字），避免任何原始字符串外显
    return [...this.cache.entries()].map(([userId, s]) => ({
      userId: String(userId).replace(/[^0-9]/g, ""),
      hasCookie: !!s.cookie,
      hasPh: !!s.ph,
      fetchedAt: s.fetchedAt,
    }));
  }
}

export const sessionManager = new SessionManager();
