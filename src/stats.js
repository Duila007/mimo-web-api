import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * 调用统计与请求日志。
 * - 每次对话补全记录一条日志（内存环形缓冲，默认保留 200 条）
 * - 按天/按模型聚合调用量与 token 用量，持久化到 data/usage.json
 */

const DATA_DIR = path.join(config.PROJECT_ROOT, "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const MAX_LOGS = 200;

class Stats {
  constructor() {
    this.logs = []; // 最近请求日志（新在前）
    this.daily = {}; // { "2026-09-25": { total: {requests, promptTokens, completionTokens}, models: { model: {...} } } }
    this.startedAt = new Date().toISOString();
    this.#load();
  }

  #load() {
    try {
      if (fs.existsSync(USAGE_FILE)) {
        const j = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
        if (j && typeof j.daily === "object") this.daily = j.daily;
      }
    } catch (err) {
      // 统计文件损坏不影响服务
    }
  }

  #save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      // 只保留最近 90 天
      const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
      for (const day of Object.keys(this.daily)) {
        if (day < cutoff) delete this.daily[day];
      }
      fs.writeFileSync(USAGE_FILE, JSON.stringify({ startedAt: this.startedAt, daily: this.daily }), "utf8");
    } catch {
      /* ignore */
    }
  }

  /** 记录一次对话补全（所有入库字符串先做白名单净化） */
  record({ model, stream, status, promptTokens = 0, completionTokens = 0, accountLabel = "", durationMs = 0, error = null }) {
    const safeModel = String(model ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "unknown";
    // 错误只保留状态类别，不存上游原始文本
    const safeError = error == null ? null : String(error).slice(0, 80).replace(/[^\x20-\x7e]/g, "");
    const day = new Date().toISOString().slice(0, 10);
    const d = (this.daily[day] ||= { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0, models: {} });
    const m = (d.models[safeModel] ||= { requests: 0, promptTokens: 0, completionTokens: 0 });

    d.requests += 1;
    d.promptTokens += promptTokens;
    d.completionTokens += completionTokens;
    if (status !== 200) d.errors += 1;
    m.requests += 1;
    m.promptTokens += promptTokens;
    m.completionTokens += completionTokens;

    this.logs.unshift({
      time: new Date().toISOString(),
      model: safeModel,
      stream: !!stream,
      status,
      promptTokens,
      completionTokens,
      durationMs,
      account: typeof accountLabel === "string" && accountLabel.startsWith("account:") ? accountLabel.slice(0, 24) : null,
      error: safeError,
    });
    if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
    this.#save();
  }

  summary() {
    const today = new Date().toISOString().slice(0, 10);
    const days = Object.keys(this.daily).sort().reverse().slice(0, 14);
    return {
      startedAt: this.startedAt,
      today: this.daily[today] || { requests: 0, promptTokens: 0, completionTokens: 0, errors: 0, models: {} },
      recentDays: days.map((day) => ({ day, ...this.summaryOfDay(day) })),
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
      models: d.models,
    };
  }

  recentLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }
}

export const stats = new Stats();
