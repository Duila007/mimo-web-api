import crypto from "node:crypto";

/** 生成 32 位十六进制 ID（对齐网页端的 conversationId/msgId 格式） */
export function uuid32() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function chatcmplId() {
  return `chatcmpl-${crypto.randomUUID()}`;
}

/** 从完整 Cookie 串中提取会话令牌 xiaomichatbot_ph（网页端同时以查询参数传递该值） */
export function extractPhToken(cookie) {
  const m = cookie.match(/(?:^|;\s*)xiaomichatbot_ph="?([^";]+)"?/);
  return m ? m[1] : null;
}

/**
 * 多账号池：轮询选取，失败账号进入冷却。
 * 条目类型：
 *   { type: "cookie",  cookie }                    —— 完整 Cookie（AT 模式，短期）
 *   { type: "account", userId, passToken }         —— AT/RT 模式（自动换发，长期）
 */
export class CookiePool {
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
        cooldownUntil: 0,
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
      // 全部冷却中：仍然轮询，避免直接拒绝请求
      const e = this.entries[this.cursor % this.entries.length];
      this.cursor += 1;
      return e;
    }
    // 从 cursor 起找到第一个健康账号
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
      cooldownUntil: 0,
    };
    entry.label =
      entry.type === "account" ? `account:${entry.userId}` : `cookie#${this.entries.length}`;
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

  markFailure(entry, cooldownMs = 60000) {
    if (!entry) return;
    entry.failCount += 1;
    // 指数退避冷却，上限 10 分钟
    const ms = Math.min(cooldownMs * 2 ** Math.min(entry.failCount - 1, 5), 600000);
    entry.cooldownUntil = Date.now() + ms;
  }

  markSuccess(entry) {
    if (!entry) return;
    entry.failCount = 0;
    entry.cooldownUntil = 0;
  }

  status() {
    const now = Date.now();
    // 注意：不输出任何来自配置/上游的原始字符串，仅输出结构化安全字段
    return this.entries.map((e) => ({
      index: e.index,
      type: e.type,
      userId: e.type === "account" ? String(e.userId).replace(/[^0-9]/g, "") : null,
      healthy: e.cooldownUntil <= now,
      failCount: e.failCount,
      cooldownSeconds: e.cooldownUntil > now ? Math.ceil((e.cooldownUntil - now) / 1000) : 0,
      hasPhToken: !!e.ph,
    }));
  }
}
