/**
 * MiMo 上游流式响应中的思考内容分隔器。
 *
 * 网页端约定：模型的思考（reasoning）内容直接混在 message 增量里，
 * 以 `<think>` 开头、`</think>` 结尾（原始流中标记后跟随一个 NUL 字符
 * `\u0000`，如 `<think>\u0000`、`</think>\u0000`，与网页端源码
 * O="<think>\0"、U="</think>\0" 一致）。
 *
 * 注意：上游偶尔会发送**单独的** `\u0000` 增量（甚至出现在 <think> 标记之前），
 * 因此本拆分器在输入时统一剥离 NUL 字符，只按标记本身（不含 NUL）匹配。
 *
 * 拆分结果为 {type: 'reasoning'|'content', text} 片段序列，
 * 并容忍标记被拆分到多个增量中的情况。
 */

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export class ThinkingSplitter {
  constructor() {
    this.buf = "";
    this.state = "outside"; // outside | thinking | answer
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
    // 剥离协议中的 NUL 字符（标记定位不依赖它，且上游会发送游离的 NUL）
    this.buf += delta.replace(/\u0000/g, "");
    const out = [];

    for (;;) {
      if (this.state === "answer") {
        // 答案阶段仍可能再次进入思考块，统一扫描
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

      if (this.state === "thinking") {
        const close = this.buf.indexOf(THINK_CLOSE);
        if (close !== -1) {
          this.#emit("reasoning", this.buf.slice(0, close), out);
          this.buf = this.buf.slice(close + THINK_CLOSE.length);
          this.state = "answer";
          continue;
        }
        const keep = Math.min(this.buf.length, THINK_CLOSE.length - 1);
        const emitLen = this.buf.length - keep;
        if (emitLen > 0) {
          this.#emit("reasoning", this.buf.slice(0, emitLen), out);
          this.buf = this.buf.slice(emitLen);
        }
        break;
      }

      // outside：尚未遇到 <think>
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
      // 未闭合的思考块：剩余内容仍视为思考（容忍 </think> 缺失，如被截断）
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
}

/** 将若干片段合并为 {reasoning, content} 两个字符串 */
export function mergePieces(pieces) {
  let reasoning = "";
  let content = "";
  for (const p of pieces) {
    if (p.type === "reasoning") reasoning += p.text;
    else content += p.text;
  }
  return { reasoning, content };
}
