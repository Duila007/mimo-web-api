/**
 * 管理面板页面（内嵌单文件 HTML）。
 * 与接口层（panel.js）分离：本文件只包含静态页面模板，不含任何响应数据流。
 * 页面所有动态数据均由前端以 textContent/replaceChildren 渲染，不存在模板拼接。
 */

export function servePanelPage(res, { captchaAppKey, captchaSdkUrl }) {
  const html = PANEL_HTML.replace("__CAPTCHA_APP_KEY__", captchaAppKey).replace(
    "__CAPTCHA_SDK_URL__",
    captchaSdkUrl
  );
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const PANEL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mimo-web-api 管理面板</title>
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
  <h1>mimo-web-api 管理面板</h1>

  <div class="card">
    <div class="row">
      <span class="muted">API Key</span>
      <input id="apiKey" type="password" placeholder="填入 API_KEY（Bearer）" style="flex:1; min-width:220px">
      <button class="pri" id="saveKey">保存并加载</button>
      <span id="keyHint" class="muted"></span>
    </div>
  </div>

  <div class="tabs">
    <button data-tab="overview" class="on">概览</button>
    <button data-tab="accounts">账号池</button>
    <button data-tab="addaccount">添加账号</button>
    <button data-tab="usage">统计</button>
    <button data-tab="logs">日志</button>
    <button data-tab="playground">对话测试</button>
  </div>

  <div class="section on" id="sec-overview">
    <div class="card">
      <h2>服务概览</h2>
      <div class="row" id="kpis"></div>
      <p class="muted" id="cfgInfo"></p>
    </div>
  </div>

  <div class="section" id="sec-accounts">
    <div class="card">
      <h2>账号池
        <button class="mini" id="btnReload" style="margin-left:8px">刷新</button>
        <button class="mini pri" id="btnRefreshAll">全部立即换发</button>
      </h2>
      <table><thead><tr>
        <th>#</th><th>模式</th><th>标识</th><th>健康</th><th>失败</th><th>冷却</th><th>最近换发</th><th>操作</th>
      </tr></thead><tbody id="accRows"></tbody></table>
      <p class="muted">AT/RT 账号在会话失效时会自动换发，无需手动维护；"冷却"表示近期失败后的暂停秒数。</p>
    </div>
  </div>

  <div class="section" id="sec-addaccount">
    <div class="card">
      <h2>小米账号登录（自动获取 AT/RT）</h2>
      <p class="muted">在面板内完成小米官方登录（手机短信 / 密码），服务端自动拿到 passToken 与 serviceToken 并加入账号池，全程无需复制 Cookie。验证时如弹出滑块，请在弹层中手动拖动完成。</p>
      <div class="row">
        <input id="loginPhone" placeholder="手机号（短信登录）" style="width:180px">
        <button class="pri" id="btnSendSms">获取验证码</button>
        <input id="loginSmsCode" placeholder="短信验证码" style="width:120px">
        <button id="btnVerifySms">登录并添加账号</button>
      </div>
      <div class="row" style="margin-top:10px">
        <input id="loginAccount" placeholder="小米账号（手机/邮箱/ID）" style="width:180px">
        <input id="loginPassword" type="password" placeholder="密码（密码登录）" style="width:160px">
        <button id="btnLoginPwd">密码登录并添加</button>
      </div>
      <div id="captchaBox" class="muted"></div>
      <div id="loginMsg" class="muted"></div>
    </div>
    <div class="card">
      <details>
        <summary>手动添加（passToken / 完整 Cookie 备用方式）</summary>
        <div class="row" style="margin-top:10px">
          <input id="mUserId" placeholder="userId" style="width:140px">
          <input id="mPassToken" placeholder="passToken（RT）" style="flex:1; min-width:200px">
          <button id="btnAddManual">添加</button>
        </div>
        <div class="row" style="margin-top:8px">
          <input id="mCookie" placeholder="或粘贴完整 Cookie 串" style="flex:1; min-width:260px">
          <button id="btnAddCookie">添加 Cookie 账号</button>
        </div>
      </details>
    </div>
  </div>

  <div class="section" id="sec-usage">
    <div class="card">
      <h2>今日用量</h2>
      <div class="row" id="usageKpis"></div>
      <h2 style="margin-top:16px">近 14 天</h2>
      <table><thead><tr><th>日期</th><th>请求数</th><th>Prompt Tokens</th><th>Completion Tokens</th><th>总 Tokens</th><th>错误</th></tr></thead>
      <tbody id="usageRows"></tbody></table>
      <p class="muted" id="modelUsage"></p>
    </div>
  </div>

  <div class="section" id="sec-logs">
    <div class="card">
      <h2>最近请求 <button class="mini" id="btnLogsReload">刷新</button></h2>
      <table><thead><tr><th>时间</th><th>模型</th><th>流式</th><th>状态</th><th>Prompt</th><th>Completion</th><th>耗时</th><th>错误</th></tr></thead>
      <tbody id="logRows"></tbody></table>
    </div>
  </div>

  <div class="section" id="sec-playground">
    <div class="card">
      <h2>对话测试</h2>
      <div class="row">
        <select id="playModel">
          <option value="mimo-v2.6-pro">mimo-v2.6-pro</option>
          <option value="mimo-v2.6-pro-ultraspeed-studio">mimo-v2.6-pro-ultraspeed-studio</option>
          <option value="mimo-v2.6-flash">mimo-v2.6-flash</option>
        </select>
        <label class="muted"><input type="checkbox" id="playStream" checked> 流式</label>
      </div>
      <textarea id="playInput" rows="3" placeholder="输入消息…" style="width:100%; margin-top:8px"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="pri" id="btnPlay">发送</button>
        <button id="btnPlayStop">中断</button>
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
  const j = await r.json().catch(() => ({ error: { message: "响应解析失败" } }));
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

// ---------- 标签页 ----------
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
    $("keyHint").textContent = "已连接";
  } catch (e) {
    $("keyHint").textContent = "加载失败: " + e.message;
  }
}

function renderSummary(s) {
  const today = s.stats.today || {};
  const kpis = [
    ["账号总数", s.pool.length],
    ["今日请求", today.requests ?? 0],
    ["今日 Tokens", (today.promptTokens ?? 0) + " / " + (today.completionTokens ?? 0)],
    ["今日错误", today.errors ?? 0],
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
    "默认模型: " + c.defaultModel + " · 多轮模式: " + c.contextMode +
    " · 工具透传: " + (c.toolPassthrough ? "开" : "关") +
    " · AT/RT 保活: " + (c.sessionRefreshHours > 0 ? ("每 " + c.sessionRefreshHours + " 小时") : "关");
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
      a.healthy ? "正常" : "冷却中",
      String(a.failCount),
      a.cooldownSeconds > 0 ? a.cooldownSeconds + "s" : "-",
      (s.sessions || []).find(x => x.userId === a.userId)?.fetchedAt || "-",
    ];
    cells.forEach((c, ci) => {
      const td = document.createElement("td");
      if (ci === 3) {
        const tag = document.createElement("span");
        tag.className = "tag " + (c === "正常" ? "ok" : "warn");
        tag.textContent = c;
        td.appendChild(tag);
      } else td.textContent = c;
      tr.appendChild(td);
    });
    const op = document.createElement("td");
    const del = document.createElement("button");
    del.className = "mini"; del.textContent = "删除";
    del.addEventListener("click", async () => {
      if (!confirm("确定删除该账号？")) return;
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
    td.colSpan = 8; td.className = "muted"; td.textContent = "暂无账号，请到「添加账号」页添加";
    tr.appendChild(td); tb.appendChild(tr);
  }
}

$("btnReload").addEventListener("click", loadAll);
$("btnRefreshAll").addEventListener("click", async () => {
  try {
    const r = await api("/admin/session/refresh", { method: "POST" });
    alert("已换发 " + r.refreshed + " 个账号");
    loadAll();
  } catch (e) { alert(e.message); }
});

function renderUsage(st) {
  const today = st.today || {};
  const kpis = [
    ["请求数", today.requests ?? 0],
    ["Prompt Tokens", today.promptTokens ?? 0],
    ["Completion Tokens", today.completionTokens ?? 0],
    ["错误", today.errors ?? 0],
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
    ? "今日各模型: " + models.map(([m, v]) => m + " × " + v.requests).join(" · ")
    : "";
}

function renderLogs(logs) {
  const tb = $("logRows");
  tb.replaceChildren();
  for (const l of logs || []) {
    const tr = document.createElement("tr");
    const cells = [
      new Date(l.time).toLocaleString(),
      l.model, l.stream ? "流式" : "非流式", l.status,
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
    const td = document.createElement("td"); td.colSpan = 8; td.className = "muted"; td.textContent = "暂无请求";
    tr.appendChild(td); tb.appendChild(tr);
  }
}
$("btnLogsReload").addEventListener("click", async () => {
  try { renderLogs((await api("/admin/logs")).logs); } catch (e) { alert(e.message); }
});

// ---------- 小米登录向导 ----------
let captchaReady = false, captchaLoading = false;
function ensureCaptchaSdk() {
  if (captchaReady || captchaLoading) return Promise.resolve();
  captchaLoading = true;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = CAPTCHA_SDK_URL;
    s.async = true;
    s.onload = () => { captchaReady = true; captchaLoading = false; resolve(); };
    s.onerror = () => { captchaLoading = false; setMsg("captchaBox", "验证码 SDK 加载失败（可能是网络问题）", true); resolve(); };
    document.body.appendChild(s);
  });
}

async function getCaptchaCode() {
  await ensureCaptchaSdk();
  if (!captchaReady || typeof window.initMiverify !== "function") {
    throw new Error("验证码 SDK 不可用（initMiverify 未加载）");
  }
  setMsg("captchaBox", "如出现滑块，请在弹层中拖动完成验证…");
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
          setMsg("captchaBox", "人机验证通过");
          resolve(r?.icode || "");
        },
        onClose: () => {
          if (settled) return; settled = true;
          reject(new Error("验证已取消"));
        },
        onError: (e) => {
          if (settled) return; settled = true;
          reject(new Error("人机验证失败: " + (e?.message || e || "未知错误")));
        }
      }, function (start) {
        if (start && start.start) start.start();
      });
    } catch (e) {
      reject(new Error("验证码初始化异常: " + e.message));
    }
  });
}

$("btnSendSms").addEventListener("click", async () => {
  const phone = $("loginPhone").value.trim();
  if (!phone) { setMsg("loginMsg", "请输入手机号", true); return; }
  try {
    $("btnSendSms").disabled = true;
    const captCode = await getCaptchaCode();
    const r = await api("/admin/login/sms/send", { method: "POST", body: JSON.stringify({ phone, captCode }) });
    setMsg("loginMsg", r.description || (r.ok ? "短信已发送" : "发送失败"), !r.ok);
  } catch (e) {
    setMsg("loginMsg", e.message, true);
  } finally {
    $("btnSendSms").disabled = false;
  }
});

$("btnVerifySms").addEventListener("click", async () => {
  const phone = $("loginPhone").value.trim();
  const code = $("loginSmsCode").value.trim();
  if (!phone || !code) { setMsg("loginMsg", "请输入手机号和短信验证码", true); return; }
  try {
    $("btnVerifySms").disabled = true;
    const r = await api("/admin/login/sms/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
    setMsg("loginMsg", "账号 " + r.userId + " 已添加（AT/RT 自动获取）", false);
    loadAll();
  } catch (e) {
    setMsg("loginMsg", "登录失败: " + e.message, true);
  } finally {
    $("btnVerifySms").disabled = false;
  }
});

$("btnLoginPwd").addEventListener("click", async () => {
  const account = $("loginAccount").value.trim();
  const password = $("loginPassword").value;
  if (!account || !password) { setMsg("loginMsg", "请输入账号和密码", true); return; }
  try {
    $("btnLoginPwd").disabled = true;
    let captCode = "";
    try { captCode = await getCaptchaCode(); } catch (e) { captCode = ""; }
    const r = await api("/admin/login/password", { method: "POST", body: JSON.stringify({ account, password, captCode }) });
    setMsg("loginMsg", "账号 " + r.userId + " 已添加（AT/RT 自动获取）", false);
    loadAll();
  } catch (e) {
    setMsg("loginMsg", "登录失败: " + e.message, true);
  } finally {
    $("btnLoginPwd").disabled = false;
  }
});

$("btnAddManual").addEventListener("click", async () => {
  try {
    await api("/admin/accounts/add", { method: "POST", body: JSON.stringify({ userId: $("mUserId").value.trim(), passToken: $("mPassToken").value.trim() }) });
    setMsg("loginMsg", "已添加", false);
    loadAll();
  } catch (e) { setMsg("loginMsg", e.message, true); }
});
$("btnAddCookie").addEventListener("click", async () => {
  try {
    await api("/admin/accounts/add", { method: "POST", body: JSON.stringify({ cookie: $("mCookie").value.trim() }) });
    setMsg("loginMsg", "已添加", false);
    loadAll();
  } catch (e) { setMsg("loginMsg", e.message, true); }
});

// ---------- 对话测试 ----------
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
      if (msg.reasoning_content) setThink("[思考] " + msg.reasoning_content);
      appendAns(msg.content || "(空)");
      appendAns("\\n\\n— 完成（" + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
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
            if (j.error) throw new Error(j.error.message || "上游错误");
            const d = j.choices?.[0]?.delta || {};
            if (d.reasoning_content) setThink("[思考中] " + d.reasoning_content);
            if (d.content) appendAns(d.content);
          }
        }
      }
      appendAns("\\n\\n— 完成（" + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      const s = document.createElement("span"); s.className = "err"; s.textContent = "错误: " + e.message;
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
