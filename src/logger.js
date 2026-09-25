import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function fmt(args) {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

export const logger = {
  debug: (...args) => {
    if (threshold <= LEVELS.debug)
      console.log(`[${new Date().toISOString()}] [DEBUG]`, fmt(args));
  },
  info: (...args) => {
    if (threshold <= LEVELS.info)
      console.log(`[${new Date().toISOString()}] [INFO] `, fmt(args));
  },
  warn: (...args) => {
    if (threshold <= LEVELS.warn)
      console.warn(`[${new Date().toISOString()}] [WARN] `, fmt(args));
  },
  error: (...args) => {
    if (threshold <= LEVELS.error)
      console.error(`[${new Date().toISOString()}] [ERROR]`, fmt(args));
  },
};
