import crypto from "node:crypto";
import { logger } from "./logger.js";

/**
 * 工具透传（OpenAI function calling 模拟）。
 *
 * MiMo 网页端上游不支持原生 function calling。开启透传后：
 *  1. 把 OpenAI tools 定义注入对话（首条用户消息前的协议化指令块），
 *     要求模型以 <tool_call>{"name":"...","arguments":{...}}</tool_call> 包裹发出调用；
 *  2. 模型输出后解析该标记：
 *     - 命中 → 返回标准 OpenAI tool_calls（finish_reason="tool_calls"）
 *     - 未命中 → 按普通文本返回
 *
 * 开关：全局 env TOOL_PASSTHROUGH（默认开）+ 请求级 tool_passthrough 字段覆盖。
 */

const TOOL_MARKER_OPEN = "<tool_call>";
const TOOL_MARKER_CLOSE = "</tool_call>";

export function toolPassthroughEnabled(body) {
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
        /* ignore */
      }
    }
  }
  lines.push("");
  lines.push(
    "When you decide to call one or more tools, reply with ONLY tool-call blocks and nothing else, " +
      "each wrapped exactly like:\n" +
      TOOL_MARKER_OPEN +
      '{"name":"<tool name>","arguments":{<json arguments>}}' +
      TOOL_MARKER_CLOSE +
      "\nMultiple calls use multiple consecutive blocks. " +
      "If no tool call is needed, answer the user normally in plain text without the blocks."
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

/**
 * 根据请求生成注入到首条用户消息前的工具指令块（无工具/未开启时返回 null）。
 */
export function buildToolInstruction(body) {
  if (!toolPassthroughEnabled(body)) return null;
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => t?.type === "function" && t.function?.name) : [];
  if (tools.length === 0) return null;
  const spec = renderToolSpec(tools);
  const choice = renderToolChoice(body.tool_choice);
  return ["[Tool Passthrough / 工具透传已开启]", spec, choice].filter(Boolean).join("\n");
}

function newCallId() {
  return `call_${crypto.randomBytes(8).toString("hex")}`;
}

/** 解析模型输出中的工具调用块 */
export function parseToolCalls(content) {
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
          arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
      });
    } catch (err) {
      logger.debug("[toolcall] 工具调用块解析失败:", err?.message || err);
    }
  }
  // 剩余正文：去掉工具调用块后的内容
  const remaining = content
    .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "")
    .trim();
  return { calls, remaining };
}
