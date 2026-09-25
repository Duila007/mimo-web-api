import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * 面板添加账号的持久化存储（data/accounts.json）。
 * 只存账号条目对象；所有字符串在入库前由调用方净化。
 */

const DATA_DIR = path.join(config.PROJECT_ROOT, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

export function loadPanelAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
      if (Array.isArray(arr)) return arr.filter((a) => a && typeof a === "object");
    }
  } catch (err) {
    logger.warn("[accounts] accounts.json 读取失败:", err?.message || err);
  }
  return [];
}

export function savePanelAccounts(accounts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
}
