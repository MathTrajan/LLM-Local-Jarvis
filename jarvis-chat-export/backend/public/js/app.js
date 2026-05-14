/* ════════════════════════════════════════════════
   J.A.R.V.I.S — Neural Core v5.0 · app.js
   ════════════════════════════════════════════════ */

const API_BASE    = window.location.origin;
const MAX_HISTORY = 20;
const CHAT_STORAGE_KEY = "jarvis_chat_v1";
const CHAT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const state = {
  history: [],
  isLoading: false,
  messageCount: 0,
  sessionStart: Date.now(),
  latencyHistory: [],
  savedMessages: [],       // { role, text, time } — para restaurar sessão
  prevOverdueCount: -1,    // para detectar novas ocorrências de overdue
  notifEnabled: false,
  currentFilter: "all",
};

const DOM = {
  messagesArea:      () => document.getElementById("messages-area"),
  overdueBanner:     () => document.getElementById("overdue-banner"),
  overdueBannerText: () => document.getElementById("overdue-banner-text"),
  monitorList:       () => document.getElementById("monitor-list"),
  monitorBadge:      () => document.getElementById("monitor-overdue-badge"),
  welcomeScreen:     () => document.getElementById("welcome-screen"),
  messageInput:      () => document.getElementById("message-input"),
  sendButton:        () => document.getElementById("send-button"),
  sendIcon:          () => document.querySelector(".send-icon"),
  loadingIcon:       () => document.querySelector(".loading-icon"),
  typingIndicator:   () => document.getElementById("typing-indicator"),
  charCounter:       () => document.getElementById("char-counter"),
  msgCounter:        () => document.getElementById("msg-counter"),
  btnClearChat:      () => document.getElementById("btn-clear-chat"),
  btnMenuToggle:     () => document.getElementById("btn-menu-toggle"),
  btnNotification:   () => document.getElementById("btn-notification"),
  leftSidebar:       () => document.getElementById("left-sidebar"),
  toastContainer:    () => document.getElementById("toast-container"),
  liveTime:          () => document.getElementById("live-time"),
  liveDate:          () => document.getElementById("live-date"),
  hdrLatency:        () => document.getElementById("hdr-latency"),
  hdrSystemStatus:   () => document.getElementById("hdr-system-status"),
  hdrProvider:       () => document.getElementById("hdr-provider"),
  rsStatusDot:       () => document.getElementById("rs-status-dot"),
  rsStatusText:      () => document.getElementById("rs-status-text"),
  rsLatency:         () => document.getElementById("rs-latency"),
  rsUptime:          () => document.getElementById("rs-uptime"),
  rsSource:          () => document.getElementById("rs-source"),
  rsMode:            () => document.getElementById("rs-mode"),
  rsEvents:          () => document.getElementById("rs-events"),
  rsLastEvent:       () => document.getElementById("rs-last-event"),
  rsIngestFill:      () => document.getElementById("rs-ingest-fill"),
  rsSessionStart:    () => document.getElementById("rs-session-start"),
  rsSparkline:       () => document.getElementById("rs-sparkline"),
  quickSuggestions:  () => document.getElementById("quick-suggestions"),
  apGrid:            () => document.getElementById("ap-grid"),
};

function setText(el, value) { if (el) el.textContent = value; }

/* ─── Formatadores ───────────────────────────── */
function formatSourceName(source) {
  switch (source) {
    case "sqlite-ingest": return "SQLITE";
    case "google-drive":  return "GOOGLE DRIVE";
    case "local":         return "PASTA LOCAL";
    case "none":          return "NÃO CONFIG.";
    case "error":         return "ERRO";
    default: return String(source || "DESCONHECIDO").toUpperCase();
  }
}

function formatLogMode(info = {}) {
  if (info.ingestEnabled) return "POSTGRES";
  if (info.mode === "google-drive") return "GOOGLE DRIVE";
  if (info.mode === "local") return "LOCAL";
  return "SEM LOGS";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

/* ─── Chat persistence ────────────────────────── */
function saveChatToStorage() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
      messages: state.savedMessages,
      history:  state.history,
      savedAt:  Date.now(),
    }));
  } catch (_) {}
}

function loadChatFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - data.savedAt > CHAT_TTL_MS) return null;
    return data;
  } catch (_) { return null; }
}

function clearChatStorage() {
  try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch (_) {}
}

/* ─── System status ───────────────────────────── */
async function refreshSystemStatus() {
  const [healthResult, infoResult, debugResult] = await Promise.allSettled([
    fetch(`${API_BASE}/api/health`),
    fetch(`${API_BASE}/api/info`),
    fetch(`${API_BASE}/api/logs-debug`),
  ]);

  let health = null, info = null, debug = null;
  if (healthResult.status === "fulfilled" && healthResult.value.ok)
    health = await healthResult.value.json();
  if (infoResult.status === "fulfilled" && infoResult.value.ok)
    info = await infoResult.value.json();
  if (debugResult.status === "fulfilled" && debugResult.value.ok)
    debug = await debugResult.value.json();

  const healthy      = health?.status === "healthy";
  const sourceLabel  = formatSourceName(debug?.source || info?.logs?.mode);
  const modeLabel    = formatLogMode(info?.logs || {});
  const totalEvents  = debug?.ingest?.totalEvents ?? state.messageCount;
  const lastEvent    = formatDateTime(debug?.ingest?.lastEventAt);
  const providerName = health?.groq ? "GROQ" : health?.provider?.toUpperCase?.() ?? "GROQ";

  const statusEl = DOM.hdrSystemStatus();
  if (statusEl) {
    const dot = statusEl.querySelector(".metric-dot");
    statusEl.className = `metric-value ${healthy ? "success" : "danger"}`;
    statusEl.innerHTML = "";
    if (dot) statusEl.appendChild(dot);
    statusEl.append(healthy ? "OPERACIONAL" : "DEGRADADO");
  }
  setText(DOM.hdrProvider(), providerName);

  const dot = DOM.rsStatusDot();
  if (dot) {
    dot.style.background = healthy ? "var(--success)" : "var(--danger)";
    dot.style.boxShadow  = healthy ? "0 0 8px var(--success)" : "0 0 8px var(--danger)";
  }
  const coreText = DOM.rsStatusText();
  if (coreText) {
    coreText.textContent = healthy ? "OPERACIONAL" : "DEGRADADO";
    coreText.style.color = healthy ? "var(--success)" : "var(--danger)";
  }

  setText(DOM.rsSource(),    sourceLabel);
  setText(DOM.rsMode(),      modeLabel);
  setText(DOM.rsEvents(),    String(totalEvents));
  setText(DOM.rsLastEvent(), lastEvent);

  const fillEl = DOM.rsIngestFill();
  if (fillEl) fillEl.style.width = Math.min((totalEvents / 200) * 100, 100) + "%";

  state.latencyHistory.push(totalEvents);
  if (state.latencyHistory.length > 20) state.latencyHistory.shift();
  drawSparkline();
}

/* ─── Sparkline ──────────────────────────────── */
function drawSparkline() {
  const canvas = DOM.rsSparkline();
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const data = state.latencyHistory;
  if (data.length < 2) return;

  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * w, y: h - 4 - (v / max) * (h - 8) }));

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(0,217,255,0.18)");
  grad.addColorStop(1, "rgba(0,217,255,0)");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, h);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cp = { x: (pts[i - 1].x + pts[i].x) / 2, y: pts[i - 1].y };
    ctx.bezierCurveTo(cp.x, cp.y, cp.x, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = "rgba(0,217,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/* ─── Notifications ──────────────────────────── */
async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showOverdueNotification(automations) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.hasFocus()) return;
  const overdue = automations.filter(a => a.status === "overdue");
  if (!overdue.length) return;
  const names = overdue.map(a => a.displayName).join(", ");
  try {
    new Notification("JARVIS — Automação Atrasada", {
      body: names,
      icon: "/favicon.svg",
      tag: "jarvis-overdue",
      silent: false,
    });
  } catch (_) {}
}

function updateNotificationButton(overdueCount) {
  const btn = DOM.btnNotification();
  if (!btn) return;
  btn.classList.toggle("notif-active", overdueCount > 0);
  btn.title = overdueCount > 0
    ? `${overdueCount} automação${overdueCount > 1 ? "ões" : ""} atrasada${overdueCount > 1 ? "s" : ""} — clique para ativar notificações`
    : "Notificações";
}

/* ─── Contextual suggestions ─────────────────── */
function updateContextualSuggestions(automations) {
  const suggestions = DOM.quickSuggestions();
  if (!suggestions) return;

  suggestions.querySelectorAll(".qcard--alert").forEach(el => el.remove());

  const overdue = automations.filter(a => a.status === "overdue");
  if (!overdue.length) return;

  const alertSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

  [...overdue].reverse().forEach(a => {
    const card = document.createElement("button");
    card.className = "qcard qcard--alert";
    card.dataset.msg = `Diagnostique a automação ${a.displayName}: quando rodou pela última vez, qual o status e qual a provável causa do atraso?`;
    card.style.cssText = "border-color:rgba(255,61,110,0.4);background:rgba(255,61,110,0.06);";
    card.innerHTML = `
      <span class="qcard-icon" style="color:var(--danger)">${alertSvg}</span>
      <span class="qcard-title" style="color:var(--danger)">ATRASADA</span>
      <span class="qcard-desc">${a.displayName}</span>
      <span class="qcard-arrow" style="color:var(--danger)">→</span>`;
    suggestions.prepend(card);
  });
}

/* ─── Monitor ────────────────────────────────── */
const STATUS_LABEL = { ok:"OK", overdue:"ATRASADA", pending:"AGUARDANDO", not_connected:"S/ CONEXÃO", not_scheduled:"NÃO AGENDADA" };

function formatMonitorTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
}

async function refreshMonitor() {
  try {
    const res = await fetch(`${API_BASE}/api/monitor`);
    if (!res.ok) return;
    const data = await res.json();

    const list     = DOM.monitorList();
    const badge    = DOM.monitorBadge();
    const banner   = DOM.overdueBanner();
    const bannerTx = DOM.overdueBannerText();

    if (list) {
      function renderItems(items) {
        return items.map(a => {
          const meta = a.status === "ok"
            ? formatMonitorTime(a.lastEventAt)
            : a.status === "overdue"
            ? `${a.hoursElapsed}h atraso`
            : a.status === "pending"
            ? `${a.hoursElapsed}h atrás`
            : "";
          const clickable = a.connected ? "monitor-item-clickable" : "";
          const query = a.connected
            ? `data-query="Diagnostique ${a.displayName}: status da última atualização, horário e erros encontrados."`
            : "";
          return `<div class="monitor-item ${a.status} ${clickable}" ${query}>
            <span class="monitor-dot ${a.status}"></span>
            <span class="monitor-name" title="${a.displayName}">${a.displayName}</span>
            <span class="monitor-meta">${meta}</span>
          </div>`;
        }).join("");
      }

      list.innerHTML = renderItems(data.automations || []);

      const dsList = document.getElementById("datasources-list");
      if (dsList) {
        const dsHtml = renderItems(data.dataSources || []);
        dsList.innerHTML = dsHtml || '<div class="monitor-loading">NENHUMA FONTE</div>';
      }

      list.querySelectorAll(".monitor-item-clickable").forEach(el => {
        el.addEventListener("click", () => {
          const q = el.getAttribute("data-query");
          if (!q) return;
          const input = DOM.messageInput();
          if (input) { input.value = q; input.dispatchEvent(new Event("input")); sendMessage(); }
        });
      });
    }

    const overdueCount = data.overdueCount || 0;
    if (badge) { badge.textContent = overdueCount; badge.hidden = overdueCount === 0; }
    if (banner && bannerTx) {
      banner.hidden = overdueCount === 0;
      bannerTx.textContent = `${overdueCount} AUTOMAÇÃO${overdueCount > 1 ? "ÕES" : ""} ATRASADA${overdueCount > 1 ? "S" : ""}`;
    }

    updateNotificationButton(overdueCount);

    const allItems = [...(data.automations || []), ...(data.dataSources || [])];

    // Notificação quando novos overdues aparecem
    if (state.prevOverdueCount !== -1 && overdueCount > state.prevOverdueCount) {
      showOverdueNotification(allItems);
    }
    state.prevOverdueCount = overdueCount;

    // Sugestões contextuais na tela de boas-vindas
    if (DOM.welcomeScreen()) updateContextualSuggestions(allItems);

  } catch (_) {}
}

/* ─── Clock + Uptime ─────────────────────────── */
function updateClock() {
  const now = new Date();
  setText(DOM.liveTime(), now.toLocaleTimeString("pt-BR", { hour12: false }));
  setText(DOM.liveDate(), now.toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric" }).toUpperCase());
  setText(DOM.rsUptime(), formatUptime(Date.now() - state.sessionStart));
}

/* ─── Loading ────────────────────────────────── */
function setLoading(on) {
  state.isLoading = on;
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;
  input.disabled = on;
  if (on) {
    btn.disabled = true;
    DOM.sendIcon()?.setAttribute("hidden", "");
    DOM.loadingIcon()?.removeAttribute("hidden");
    DOM.typingIndicator()?.removeAttribute("hidden");
  } else {
    btn.disabled = input.value.trim().length === 0;
    DOM.sendIcon()?.removeAttribute("hidden");
    DOM.loadingIcon()?.setAttribute("hidden", "");
    DOM.typingIndicator()?.setAttribute("hidden", "");
    input.focus();
  }
}

/* ─── Toast ──────────────────────────────────── */
function showToast(msg, type = "info") {
  const c = DOM.toastContainer(); if (!c) return;
  const t = document.createElement("div");
  t.className = `toast toast-${type}`; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add("toast-out"); setTimeout(() => t.remove(), 280); }, 3500);
}

/* ─── Char counter ───────────────────────────── */
function updateCharCounter(len) {
  const el = DOM.charCounter(); if (!el) return;
  el.textContent = `${len}/8000`;
  el.className = len > 7500 ? "char-counter danger" : len > 6000 ? "char-counter warning" : "char-counter";
}

/* ─── Markdown ───────────────────────────────── */
function parseMarkdown(text) {
  if (!text) return "";

  text = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Protege blocos de código
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,_l,code) => {
    codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return `\x00BLK${codeBlocks.length-1}\x00`;
  });

  // Processa linha a linha
  const lines = text.split("\n");
  const out = [];
  let inUl = false, inOl = false;

  for (const line of lines) {
    const ulm = line.match(/^[-*] (.+)/);
    const olm = line.match(/^\d+\. (.+)/);
    if (!ulm && inUl) { out.push("</ul>"); inUl = false; }
    if (!olm && inOl) { out.push("</ol>"); inOl = false; }

    let m;
    if      ((m = line.match(/^### (.+)/))) out.push(`<h3>${m[1]}</h3>`);
    else if ((m = line.match(/^## (.+)/)))  out.push(`<h2>${m[1]}</h2>`);
    else if ((m = line.match(/^# (.+)/)))   out.push(`<h1>${m[1]}</h1>`);
    else if (ulm) { if (!inUl) { out.push("<ul>"); inUl = true; } out.push(`<li>${ulm[1]}</li>`); }
    else if (olm) { if (!inOl) { out.push("<ol>"); inOl = true; } out.push(`<li>${olm[1]}</li>`); }
    else if (/^---+\s*$/.test(line)) out.push("<hr>");
    else out.push(line);
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");

  const BLOCK = /^<(h[1-6]|ul|ol|li|hr|pre|\/ul|\/ol)[\s>]/;
  const html = out.map((line, i, arr) => {
    if (BLOCK.test(line) || (i > 0 && BLOCK.test(arr[i-1]))) return line;
    return line === "" ? "<br>" : line + "<br>";
  }).join("");

  const result = html
    .replace(/`([^`\n]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g,"<em>$1</em>");

  return codeBlocks.reduce((t,b,i) => t.replace(`\x00BLK${i}\x00`, b), result);
}

/* ─── Copy text util ─────────────────────────── */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // fallback para HTTP localhost
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("Copiado!", "success");
  } catch (_) {
    showToast("Falha ao copiar.", "error");
  }
}

/* ─── Render message ─────────────────────────── */
function renderMessage(role, text, time) {
  const area = DOM.messagesArea();
  const ws   = DOM.welcomeScreen();
  if (ws) ws.remove();

  const t = time || new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
  const wrap = document.createElement("div");
  wrap.className = `message-wrapper ${role}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = parseMarkdown(text);

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = t;

  contentDiv.appendChild(bubble);
  contentDiv.appendChild(meta);

  if (role === "assistant") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy-btn";
    copyBtn.title = "Copiar resposta";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => copyText(text));
    contentDiv.appendChild(copyBtn);
  }

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "EU" : "J";

  if (role === "user") {
    wrap.appendChild(contentDiv);
    wrap.appendChild(avatar);
  } else {
    wrap.appendChild(avatar);
    wrap.appendChild(contentDiv);
  }

  area.appendChild(wrap);
  area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  return t;
}

/* ─── Send ───────────────────────────────────── */
async function sendMessage() {
  const input = DOM.messageInput();
  const msg   = input?.value.trim();
  if (!msg || state.isLoading) return;

  state.messageCount++;
  const time = renderMessage("user", msg);
  state.savedMessages.push({ role: "user", text: msg, time });
  input.value = ""; input.style.height = "auto";
  updateCharCounter(0); setLoading(true);
  setText(DOM.msgCounter(), state.messageCount);

  try {
    const t0  = performance.now();
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: state.history.slice(-MAX_HISTORY), options: { temperature: 0.7 } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro na API");

    const assistTime = renderMessage("assistant", data.text);
    state.savedMessages.push({ role: "assistant", text: data.text, time: assistTime });
    state.history.push({ role:"user", content:msg }, { role:"assistant", content:data.text });

    // Mantém só os últimos MAX_HISTORY * 2 mensagens salvas
    if (state.savedMessages.length > MAX_HISTORY * 2) {
      state.savedMessages = state.savedMessages.slice(-MAX_HISTORY * 2);
    }
    saveChatToStorage();

    const lat = data.latencyMs ? `${data.latencyMs}ms` : `${Math.round(performance.now() - t0)}ms`;
    setText(DOM.hdrLatency(), lat);
    setText(DOM.rsLatency(),  lat);

    await refreshSystemStatus();
  } catch (err) {
    showToast(`FALHA: ${err.message}`, "error");
  } finally {
    setLoading(false);
  }
}

/* ─── Background particles ───────────────────── */
function initParticles() {
  const canvas = document.getElementById("bg-particles"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, pts;
  const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
  const mkPt   = () => ({ x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22, a:Math.random()*.35+.08 });
  resize(); pts = Array.from({ length: 65 }, mkPt);
  window.addEventListener("resize", resize);
  (function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, .75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,217,255,${p.a})`; ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    }
    requestAnimationFrame(draw);
  })();
}

/* ═══════════════════════════════════════════════
   ADVANCED 3D HOLOGRAPHIC SPHERE
   ═══════════════════════════════════════════════ */
function initAdvancedSphere() {
  const canvas = document.getElementById("neural-sphere");
  if (!canvas) return;

  const raw = canvas.offsetWidth;
  if (!raw) { requestAnimationFrame(initAdvancedSphere); return; }

  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  const SIZE = raw;
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const CX = SIZE / 2, CY = SIZE / 2;
  const R  = SIZE * 0.365;
  const CONN = SIZE * 0.075;

  function proj3(phi, theta, rotY, rotZ) {
    const x0 = R * Math.sin(phi) * Math.cos(theta);
    const y0 = R * Math.cos(phi);
    const z0 = R * Math.sin(phi) * Math.sin(theta);
    const x1 = x0 * Math.cos(rotY) + z0 * Math.sin(rotY);
    const z1 = -x0 * Math.sin(rotY) + z0 * Math.cos(rotY);
    const x2 = x1 * Math.cos(rotZ) - y0 * Math.sin(rotZ);
    const y2 = x1 * Math.sin(rotZ) + y0 * Math.cos(rotZ);
    return { px: CX + x2, py: CY + y2, z: z1 };
  }

  const N = 280;
  const dots = Array.from({ length: N }, (_, i) => ({
    phi:   Math.acos(1 - 2 * (i + 0.5) / N),
    theta: Math.PI * (1 + Math.sqrt(5)) * i,
    sz:    0.35 + Math.random() * 0.9,
  }));

  const CELLS = Array.from({ length: 9 }, () => ({
    phi:   Math.random() * Math.PI,
    theta: Math.random() * Math.PI * 2,
    dPhi:  (Math.random() - 0.5) * 0.009,
    dTh:   (Math.random() - 0.5) * 0.013,
    baseR: R * (0.05 + Math.random() * 0.045),
    phase: Math.random() * Math.PI * 2,
    spd:   0.6 + Math.random() * 0.8,
    sides: 5 + Math.floor(Math.random() * 3),
  }));

  const ORBITS = [
    { n: 10, r: R * 0.93, spd:  0.50, tilt:  0.62, off: 0,               col: [0, 217, 255] },
    { n: 7,  r: R * 1.06, spd: -0.32, tilt: -0.80, off: Math.PI / 3,     col: [0, 110, 255] },
    { n: 12, r: R * 0.80, spd:  0.22, tilt:  1.05, off: Math.PI,          col: [0, 255, 157] },
    { n: 5,  r: R * 1.12, spd: -0.14, tilt:  0.38, off: Math.PI * 0.75,  col: [100, 200, 255] },
  ];

  const WAVES = [0, 0.5, 1.0, 1.5].map((o, i) => ({ phase: o * Math.PI * 2, spd: 0.7 + i * 0.18 }));
  const pbuf = new Array(N);

  const HOT = new Set();
  const hotTimer = setInterval(() => {
    if (HOT.size < 7) HOT.add(Math.floor(Math.random() * N));
    if (HOT.size > 3 && Math.random() > 0.55) {
      const arr = [...HOT]; HOT.delete(arr[Math.floor(Math.random() * arr.length)]);
    }
  }, 700);

  const STRM = [];
  const strmTimer = setInterval(() => {
    if (STRM.length < 8) STRM.push({
      src: Math.floor(Math.random() * N),
      dst: Math.floor(Math.random() * N),
      born: null,
      dur: 0.8 + Math.random() * 1.1,
    });
  }, 280);

  const T0 = performance.now();
  let rafId;

  function draw(now) {
    try {
      const t   = (now - T0) * 0.001;
      const rotY = t * 0.17;
      const rotZ = Math.sin(t * 0.09) * 0.12;

      ctx.clearRect(0, 0, SIZE, SIZE);

      const atm = ctx.createRadialGradient(CX, CY, R * 0.6, CX, CY, R * 1.2);
      atm.addColorStop(0, "rgba(0,80,200,0.00)");
      atm.addColorStop(0.5, "rgba(0,80,200,0.05)");
      atm.addColorStop(1, "rgba(0,217,255,0.00)");
      ctx.fillStyle = atm;
      ctx.beginPath(); ctx.arc(CX, CY, R * 1.2, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 0.8);
      ctx.strokeStyle = "rgba(0,217,255,0.9)";
      ctx.lineWidth = 0.5;
      for (let lat = 1; lat <= 7; lat++) {
        const pLat = (lat / 8) * Math.PI;
        const rr  = R * Math.sin(pLat);
        const yy  = CY - R * Math.cos(pLat) * Math.cos(rotZ * 0.5);
        ctx.globalAlpha = lat === 4 ? 0.32 + 0.10 * Math.sin(t * 0.8) : 0.14 + 0.05 * Math.sin(t * 0.8);
        ctx.lineWidth = lat === 4 ? 0.8 : 0.45;
        ctx.beginPath();
        ctx.ellipse(CX, yy, rr * (0.88 + 0.12 * Math.abs(Math.cos(rotY))), rr * 0.27, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.13 + 0.04 * Math.sin(t * 0.8);
      ctx.lineWidth = 0.4;
      for (let m = 0; m < 12; m++) {
        const mTh = (m / 12) * Math.PI * 2;
        const seg = [];
        for (let s = 0; s <= 24; s++) {
          const p = proj3((s / 24) * Math.PI, mTh, rotY, rotZ);
          if (p.z > 0) seg.push(p);
        }
        if (seg.length > 1) {
          ctx.beginPath(); ctx.moveTo(seg[0].px, seg[0].py);
          for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k].px, seg[k].py);
          ctx.stroke();
        }
      }
      ctx.restore();

      ctx.save();
      const eqA = 0.42 + 0.14 * Math.sin(t * 0.55);
      ctx.strokeStyle = `rgba(0,217,255,${eqA})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,217,255,0.7)";
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.ellipse(CX, CY - R * 0.02 * Math.sin(rotZ), R, R * 0.20 + R * 0.04 * Math.abs(Math.cos(rotY)), rotZ * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip();
      const sa = (t * 0.38) % (Math.PI * 2);
      const sweepSpan = 1.1;
      const sweepSlices = 14;
      for (let k = 0; k < sweepSlices; k++) {
        const frac = k / sweepSlices;
        const sliceStart = sa - sweepSpan + frac * sweepSpan;
        const sliceEnd   = sliceStart + sweepSpan / sweepSlices;
        ctx.beginPath(); ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, R * 0.97, sliceStart, sliceEnd);
        ctx.closePath();
        ctx.fillStyle = `rgba(0,255,160,${frac * frac * 0.065})`; ctx.fill();
      }
      const radarPulse = 0.28 + 0.12 * Math.sin(t * 2.2);
      ctx.beginPath(); ctx.moveTo(CX, CY);
      ctx.lineTo(CX + R * 0.97 * Math.cos(sa), CY + R * 0.97 * Math.sin(sa));
      ctx.strokeStyle = `rgba(0,255,190,${radarPulse})`;
      ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();

      for (let i = 0; i < N; i++) {
        const d = dots[i];
        pbuf[i] = proj3(d.phi, d.theta + rotY * 0.42, rotY * 0.42, rotZ);
        pbuf[i].sz = d.sz;
        pbuf[i].idx = i;
      }
      pbuf.sort((a, b) => a.z - b.z);
      const pmap = new Map();
      for (const p of pbuf) pmap.set(p.idx, p);

      ctx.lineWidth = 0.5;
      const CONN2 = CONN * CONN;
      for (let i = 0; i < N; i++) {
        const a = pbuf[i];
        if (a.z < -R * 0.2) continue;
        for (let j = i + 1; j < Math.min(i + 36, N); j++) {
          const b = pbuf[j];
          if (b.z < -R * 0.2) continue;
          const dx = a.px - b.px, dy = a.py - b.py;
          const dd = dx * dx + dy * dy;
          if (dd > CONN2) continue;
          const d2    = Math.sqrt(dd);
          const depth = ((a.z + b.z) / 2 + R) / (2 * R);
          const alpha = (1 - d2 / CONN) * depth * 0.22;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          ctx.strokeStyle = `rgba(0,${Math.round(138 + depth * 79)},255,${alpha})`;
          ctx.stroke();
        }
      }

      for (let i = 0; i < N; i++) {
        const p = pbuf[i];
        const depth = (p.z + R) / (2 * R);
        if (depth < 0.04) continue;
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.6 + p.sz * 7);
        const r = depth * 1.7 * p.sz * pulse + 0.2;
        ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,${Math.round(148 + depth * 69)},255,${0.12 + depth * 0.88})`;
        ctx.fill();
      }

      for (const polePhi of [0.06, Math.PI - 0.06]) {
        const pp = proj3(polePhi, 0, rotY, rotZ);
        if (pp.z < 0) continue;
        const depth = (pp.z + R) / (2 * R);
        const pg = ctx.createRadialGradient(pp.px, pp.py, 0, pp.px, pp.py, R * 0.14 * depth);
        pg.addColorStop(0,   `rgba(200,255,255,${0.70 * depth})`);
        pg.addColorStop(0.4, `rgba(0,217,255,${0.25 * depth})`);
        pg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(pp.px, pp.py, R * 0.14 * depth, 0, Math.PI * 2);
        ctx.fillStyle = pg; ctx.fill();
      }

      for (const p of pbuf) {
        if (!HOT.has(p.idx)) continue;
        const depth = (p.z + R) / (2 * R);
        if (depth < 0.12) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.8 + p.idx * 0.73);
        const nr = (2.2 + pulse * 2.4) * depth;
        const hg = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, nr * 3.5);
        hg.addColorStop(0,   `rgba(0,255,180,${0.95 * depth})`);
        hg.addColorStop(0.4, `rgba(0,210,255,${0.5 * depth})`);
        hg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(p.px, p.py, nr, 0, Math.PI * 2);
        ctx.fillStyle = hg; ctx.fill();
        ctx.beginPath(); ctx.arc(p.px, p.py, nr * 2.8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,255,180,${0.18 * depth * pulse})`;
        ctx.lineWidth = 0.6; ctx.stroke();
      }

      for (const cell of CELLS) {
        cell.phi   += cell.dPhi;
        cell.theta += cell.dTh;
        if (cell.phi > Math.PI || cell.phi < 0) cell.dPhi *= -1;
        const p = proj3(cell.phi, cell.theta, rotY * 0.28, rotZ);
        if (p.z < -R * 0.15) continue;
        const depth = (p.z + R) / (2 * R);
        const pulse = 1 + 0.22 * Math.sin(t * cell.spd + cell.phase);
        const cr    = cell.baseR * depth * pulse;
        if (cr < 1) continue;
        ctx.save();
        const cg = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, cr);
        cg.addColorStop(0,    `rgba(0,217,255,${0.13 * depth})`);
        cg.addColorStop(0.45, `rgba(0,100,255,${0.06 * depth})`);
        cg.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.beginPath();
        for (let s = 0; s <= cell.sides; s++) {
          const ang = (s / cell.sides) * Math.PI * 2;
          const w   = 1 + 0.28 * Math.sin(ang * 3 + t * cell.spd + cell.phase);
          const bx  = p.px + cr * w * Math.cos(ang);
          const by  = p.py + cr * w * Math.sin(ang) * 0.65;
          s === 0 ? ctx.moveTo(bx, by) : ctx.lineTo(bx, by);
        }
        ctx.closePath();
        ctx.fillStyle = cg; ctx.fill();
        ctx.strokeStyle = `rgba(0,217,255,${0.13 * depth})`;
        ctx.lineWidth = 0.5; ctx.stroke();
        ctx.restore();
      }

      for (const orb of ORBITS) {
        const base = t * orb.spd + orb.off;
        for (let i = 0; i < orb.n; i++) {
          const ang = base + (i / orb.n) * Math.PI * 2;
          const ox = orb.r * Math.cos(ang);
          const oy = orb.r * Math.sin(orb.tilt) * Math.sin(ang);
          const oz = orb.r * Math.cos(orb.tilt) * Math.sin(ang);
          const prx = ox * Math.cos(rotY) + oz * Math.sin(rotY);
          const prz = -ox * Math.sin(rotY) + oz * Math.cos(rotY);
          const depth = (prz + R) / (2 * R);
          if (depth < 0.02) continue;
          const px = CX + prx, py = CY + oy;
          const [cr, cg, cb] = orb.col;
          const alpha = 0.28 + depth * 0.72;
          ctx.beginPath(); ctx.arc(px, py, 1.6 * depth + 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`; ctx.fill();
          if (depth > 0.45) {
            const tang = ang - 0.9 / orb.n * Math.PI * 2;
            const tx = orb.r * Math.cos(tang);
            const ty = orb.r * Math.sin(orb.tilt) * Math.sin(tang);
            const tz = orb.r * Math.cos(orb.tilt) * Math.sin(tang);
            const trx = tx * Math.cos(rotY) + tz * Math.sin(rotY);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(CX + trx, CY + ty);
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha * 0.25})`;
            ctx.lineWidth = 0.8; ctx.stroke();
          }
        }
      }

      for (const w of WAVES) {
        const progress = ((t * w.spd + w.phase) % (Math.PI * 2)) / (Math.PI * 2);
        const wAlpha   = (1 - progress) * 0.15;
        if (wAlpha < 0.005) continue;
        ctx.beginPath(); ctx.arc(CX, CY, progress * R, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,217,255,${wAlpha})`;
        ctx.lineWidth = 1.6 * (1 - progress); ctx.stroke();
      }

      for (let i = STRM.length - 1; i >= 0; i--) {
        const s = STRM[i];
        if (s.born === null) s.born = t;
        const prog = Math.min((t - s.born) / s.dur, 1);
        if (prog >= 1) { STRM.splice(i, 1); continue; }
        const ps = pmap.get(s.src), pd = pmap.get(s.dst);
        if (!ps || !pd || ps.z < -R * 0.15 || pd.z < -R * 0.15) continue;
        const x = ps.px + (pd.px - ps.px) * prog;
        const y = ps.py + (pd.py - ps.py) * prog;
        const depth = ((ps.z + pd.z) / 2 + R) / (2 * R);
        const sg = ctx.createRadialGradient(x, y, 0, x, y, 5 * depth);
        sg.addColorStop(0,   `rgba(120,255,220,${0.92 * depth})`);
        sg.addColorStop(0.5, `rgba(0,217,255,${0.45 * depth})`);
        sg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(x, y, 3.5 * depth, 0, Math.PI * 2);
        ctx.fillStyle = sg; ctx.fill();
        const trailProg = Math.max(0, prog - 0.18);
        const tx2 = ps.px + (pd.px - ps.px) * trailProg;
        const ty2 = ps.py + (pd.py - ps.py) * trailProg;
        ctx.beginPath(); ctx.moveTo(tx2, ty2); ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(0,255,200,${0.38 * depth * (1 - prog)})`;
        ctx.lineWidth = 1.4; ctx.stroke();
      }

      ctx.save();
      const limbG = ctx.createRadialGradient(CX, CY, R * 0.78, CX, CY, R * 1.04);
      limbG.addColorStop(0,    "rgba(0,217,255,0)");
      limbG.addColorStop(0.70, `rgba(0,180,255,${0.04 + 0.03 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(0.87, `rgba(0,217,255,${0.22 + 0.08 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(0.95, `rgba(80,235,255,${0.12 + 0.06 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(1,    "rgba(0,217,255,0)");
      ctx.beginPath(); ctx.arc(CX, CY, R * 1.04, 0, Math.PI * 2);
      ctx.fillStyle = limbG; ctx.fill();
      ctx.restore();

      const coreP = 0.5 + 0.5 * Math.sin(t * 1.15);
      const cg2 = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 0.5);
      cg2.addColorStop(0,    `rgba(0,180,255,${0.25 + 0.11 * coreP})`);
      cg2.addColorStop(0.35, `rgba(0,100,255,${0.11 + 0.05 * coreP})`);
      cg2.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = cg2; ctx.fillRect(0, 0, SIZE, SIZE);

      for (const [phase, bright] of [[0, 1], [Math.PI, 0.55]]) {
        const scanY = CY + R * 0.72 * Math.sin(t * 0.28 + phase);
        const sg = ctx.createLinearGradient(CX - R, scanY, CX + R, scanY);
        sg.addColorStop(0,   "rgba(0,217,255,0)");
        sg.addColorStop(0.3, `rgba(0,217,255,${0.10 * coreP * bright})`);
        sg.addColorStop(0.5, `rgba(0,217,255,${0.18 * coreP * bright})`);
        sg.addColorStop(0.7, `rgba(0,217,255,${0.10 * coreP * bright})`);
        sg.addColorStop(1,   "rgba(0,217,255,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(CX - R, scanY - 2, R * 2, 4);
      }
    } catch (_) {}
    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(rafId); clearInterval(hotTimer); clearInterval(strmTimer); };
}

/* ─── Automations panel ──────────────────────── */
const STATUS_PT = { ok:"OK", overdue:"ATRASADA", pending:"AGUARDANDO", not_connected:"SEM CONEXÃO", not_scheduled:"NÃO AGENDADA" };

function formatMonitorTimeFull(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function applyFilter(filter) {
  state.currentFilter = filter;
  document.querySelectorAll(".ap-filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  document.querySelectorAll(".ap-card").forEach(card => {
    const status = card.dataset.status;
    card.style.display = (filter === "all" || status === filter) ? "" : "none";
  });
}

function buildRunDots(history) {
  if (!history || !history.length) return "";
  const dots = history.map(r => {
    const cls = r.hasError ? "error" : (r.status === "ok" || r.status === "SUCESSO") ? "ok" : "unknown";
    const dt = r.timestamp ? new Date(r.timestamp).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";
    return `<span class="ap-run-dot ${cls}" title="${dt}"></span>`;
  }).reverse().join("");
  return `<div class="ap-run-history"><span class="ap-run-history-label">HISTÓRICO</span>${dots}</div>`;
}

async function loadDailyStats(name) {
  try {
    const res = await fetch(`${API_BASE}/api/monitor/daily/${encodeURIComponent(name)}?days=7`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.stats || [];
  } catch (_) { return []; }
}

function buildDailyChart(stats) {
  // Gera sempre 7 slots (D-6 até hoje), preenchendo com dados reais onde houver
  const dataMap = {};
  (stats || []).forEach(d => { dataMap[d.date] = d; });

  const slots = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    slots.push(d.toISOString().slice(0, 10));
  }

  const maxTotal = Math.max(1, ...slots.map(s => dataMap[s]?.total || 0));
  const bars = slots.map(date => {
    const day = dataMap[date];
    const total  = day?.total  || 0;
    const errors = day?.errors || 0;
    const pct = total > 0 ? Math.max(18, Math.round(total / maxTotal * 100)) : 0;
    const cls = errors > 0 ? "has-error" : total > 0 ? "ok" : "empty";
    const label = date.slice(5).replace("-", "/");
    return `<div class="ap-bar-wrap" title="${date}: ${total} eventos, ${errors} erros">
      <div class="ap-bar ${cls}" style="height:${pct}%"></div>
      <span class="ap-bar-day">${label}</span>
    </div>`;
  }).join("");
  return `<div class="ap-chart"><span class="ap-chart-label">ATIVIDADE 7 DIAS</span><div class="ap-bars">${bars}</div></div>`;
}

async function loadAutomationHistory(name) {
  try {
    const res = await fetch(`${API_BASE}/api/monitor/history/${encodeURIComponent(name)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.history || [];
  } catch (_) { return []; }
}

async function renderAutomationsPanel() {
  const grid = document.getElementById("ap-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="ap-loading">CARREGANDO...</div>';
  try {
    const res = await fetch(`${API_BASE}/api/monitor`);
    if (!res.ok) throw new Error("API indisponível");
    const data = await res.json();

    if (!data.automations?.length) {
      grid.innerHTML = '<div class="ap-loading">NENHUMA AUTOMAÇÃO CONFIGURADA</div>';
      return;
    }

    // Carrega histórico e stats diárias em paralelo para todas as conectadas
    const historyMap = {}, dailyMap = {};
    await Promise.all(data.automations.filter(a => a.connected).map(async a => {
      [historyMap[a.name], dailyMap[a.name]] = await Promise.all([
        loadAutomationHistory(a.name),
        loadDailyStats(a.name),
      ]);
    }));

    grid.innerHTML = data.automations.map(a => {
      const connected   = a.connected;
      const statusClass = a.status || "not_connected";
      const statusLabel = STATUS_PT[statusClass] || statusClass.toUpperCase();
      const lastTime    = formatMonitorTimeFull(a.lastEventAt);
      const elapsed     = a.hoursElapsed != null ? `${a.hoursElapsed}h atrás` : "—";
      const askDisabled = connected ? "" : "disabled";
      const historyHtml = buildRunDots(historyMap[a.name]);
      const chartHtml   = buildDailyChart(dailyMap[a.name]);
      const runs        = historyMap[a.name] || [];
      const successRate = runs.length ? Math.round(runs.filter(r => !r.hasError).length / runs.length * 100) : null;

      return `<div class="ap-card ${statusClass === "overdue" ? "ap-card--overdue" : ""}" data-status="${statusClass}">
        <div class="ap-card-head">
          <span class="ap-dot ${statusClass}"></span>
          <span class="ap-card-name">${a.displayName}</span>
          <span class="ap-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="ap-rows">
          <div class="ap-row">
            <span class="ap-row-label">ÚLTIMA EXECUÇÃO</span>
            <span class="ap-row-val dim">${lastTime}</span>
          </div>
          <div class="ap-row">
            <span class="ap-row-label">TEMPO DECORRIDO</span>
            <span class="ap-row-val ${statusClass === "overdue" ? "danger" : ""}">${elapsed}</span>
          </div>
          <div class="ap-row">
            <span class="ap-row-label">TAXA SUCESSO</span>
            <span class="ap-row-val ${successRate !== null && successRate < 70 ? "danger" : ""}">${successRate !== null ? successRate + "% OK" : "—"}</span>
          </div>
        </div>
        ${chartHtml}
        ${historyHtml}
        <button class="ap-ask-btn" data-name="${a.displayName}" ${askDisabled}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          DIAGNOSTICAR
        </button>
      </div>`;
    }).join("");

    grid.querySelectorAll(".ap-ask-btn:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name");
        showChat();
        const input = DOM.messageInput();
        if (input) {
          input.value = `Diagnostique a automação ${name}: status da última execução, horário, duração e erros encontrados.`;
          input.dispatchEvent(new Event("input"));
          sendMessage();
        }
      });
    });

    // Reaplica filtro atual
    if (state.currentFilter !== "all") applyFilter(state.currentFilter);

  } catch (err) {
    grid.innerHTML = `<div class="ap-loading">ERRO: ${err.message}</div>`;
  }
}

async function renderDatasourcesPanel() {
  const grid = document.getElementById("ds-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="ap-loading">CARREGANDO...</div>';
  try {
    const res = await fetch(`${API_BASE}/api/monitor`);
    if (!res.ok) throw new Error("API indisponível");
    const data = await res.json();
    const sources = data.dataSources || [];

    if (!sources.length) {
      grid.innerHTML = '<div class="ap-loading">NENHUMA FONTE DE DADOS CONFIGURADA</div>';
      return;
    }

    const historyMap = {}, dailyMap = {};
    await Promise.all(sources.filter(a => a.connected).map(async a => {
      [historyMap[a.name], dailyMap[a.name]] = await Promise.all([
        loadAutomationHistory(a.name),
        loadDailyStats(a.name),
      ]);
    }));

    grid.innerHTML = sources.map(a => {
      const statusClass = a.status || "not_connected";
      const statusLabel = STATUS_PT[statusClass] || statusClass.toUpperCase();
      const lastTime    = formatMonitorTimeFull(a.lastEventAt);
      const elapsed     = a.hoursElapsed != null ? `${a.hoursElapsed}h atrás` : "—";
      const askDisabled = a.connected ? "" : "disabled";
      const historyHtml = buildRunDots(historyMap[a.name]);
      const chartHtml   = buildDailyChart(dailyMap[a.name]);
      const runs        = historyMap[a.name] || [];
      const successRate = runs.length ? Math.round(runs.filter(r => !r.hasError).length / runs.length * 100) : null;
      return `<div class="ap-card ${statusClass === "overdue" ? "ap-card--overdue" : ""}" data-status="${statusClass}">
        <div class="ap-card-head">
          <span class="ap-dot ${statusClass}"></span>
          <span class="ap-card-name">${a.displayName}</span>
          <span class="ap-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="ap-rows">
          <div class="ap-row"><span class="ap-row-label">ÚLTIMA ATUALIZAÇÃO</span><span class="ap-row-val dim">${lastTime}</span></div>
          <div class="ap-row"><span class="ap-row-label">TEMPO DECORRIDO</span><span class="ap-row-val ${statusClass === "overdue" ? "danger" : ""}">${elapsed}</span></div>
          <div class="ap-row"><span class="ap-row-label">TAXA SUCESSO</span><span class="ap-row-val ${successRate !== null && successRate < 70 ? "danger" : ""}">${successRate !== null ? successRate + "% OK" : "—"}</span></div>
        </div>
        ${chartHtml}
        ${historyHtml}
        <button class="ap-ask-btn" data-name="${a.displayName}" ${askDisabled}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          DIAGNOSTICAR
        </button>
      </div>`;
    }).join("");

    grid.querySelectorAll(".ap-ask-btn:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name");
        showChat();
        const input = DOM.messageInput();
        if (input) {
          input.value = `Diagnostique ${name}: status da última atualização, horário, duração e erros encontrados.`;
          input.dispatchEvent(new Event("input"));
          sendMessage();
        }
      });
    });
  } catch (err) {
    grid.innerHTML = `<div class="ap-loading">ERRO: ${err.message}</div>`;
  }
}

function setNavActive(view) {
  document.getElementById("nav-jarvis")?.classList.toggle("active", view === "chat");
  document.getElementById("nav-automacoes")?.classList.toggle("active", view === "automations");
  document.getElementById("nav-dados")?.classList.toggle("active", view === "dados");
}

function showAutomations() {
  document.getElementById("automations-panel").hidden  = false;
  document.getElementById("datasources-panel").hidden  = true;
  document.getElementById("messages-area").hidden      = true;
  document.getElementById("typing-indicator").hidden   = true;
  document.getElementById("input-area").hidden         = true;
  setNavActive("automations");
  renderAutomationsPanel();
}

function showDados() {
  document.getElementById("automations-panel").hidden  = true;
  document.getElementById("datasources-panel").hidden  = false;
  document.getElementById("messages-area").hidden      = true;
  document.getElementById("typing-indicator").hidden   = true;
  document.getElementById("input-area").hidden         = true;
  setNavActive("dados");
  renderDatasourcesPanel();
}

function showChat() {
  document.getElementById("automations-panel").hidden  = true;
  document.getElementById("datasources-panel").hidden  = true;
  document.getElementById("messages-area").hidden      = false;
  document.getElementById("input-area").hidden         = false;
  setNavActive("chat");
}

/* ─── Init ───────────────────────────────────── */
function init() {
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;

  updateClock();
  setInterval(updateClock, 1000);

  // Restaura conversa salva
  const saved = loadChatFromStorage();
  if (saved?.messages?.length) {
    state.history = saved.history || [];
    state.savedMessages = saved.messages;
    for (const m of saved.messages) {
      renderMessage(m.role, m.text, m.time);
    }
    state.messageCount = saved.messages.filter(m => m.role === "user").length;
    setText(DOM.msgCounter(), state.messageCount);
  }

  refreshSystemStatus().catch(() => showToast("Não foi possível carregar o status operacional.", "error"));
  refreshMonitor().catch(() => {});

  // Polling a cada 30s (monitor tem cache de 30s no servidor)
  setInterval(() => {
    refreshSystemStatus().catch(() => {});
    refreshMonitor().catch(() => {});
  }, 30_000);

  initParticles();
  initAdvancedSphere();

  input.addEventListener("input", () => {
    const len = input.value.length;
    btn.disabled = state.isLoading || input.value.trim().length === 0;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
    updateCharCounter(len);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!btn.disabled) sendMessage(); }
  });

  btn.addEventListener("click", sendMessage);

  function handleQcardClick(e) {
    const card = e.target.closest(".qcard");
    if (card) {
      const msg = card.getAttribute("data-msg");
      if (msg) { input.value = msg; input.dispatchEvent(new Event("input")); sendMessage(); }
    }
  }

  DOM.messagesArea()?.addEventListener("click", handleQcardClick);
  DOM.quickSuggestions()?.addEventListener("click", handleQcardClick);

  DOM.btnClearChat()?.addEventListener("click", () => {
    clearChatStorage();
    location.reload();
  });

  // Botão de notificação: pede permissão e ativa
  DOM.btnNotification()?.addEventListener("click", async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      state.notifEnabled = true;
      showToast("Notificações ativadas!", "success");
    } else {
      showToast("Notificações bloqueadas no navegador.", "error");
    }
  });

  // Sidebar drawer (mobile)
  DOM.btnMenuToggle()?.addEventListener("click", () => DOM.leftSidebar()?.classList.toggle("open"));
  document.addEventListener("click", e => {
    const sb = DOM.leftSidebar(), tb = DOM.btnMenuToggle();
    if (sb?.classList.contains("open") && !sb.contains(e.target) && !tb?.contains(e.target))
      sb.classList.remove("open");
  });

  // Nav: sidebar
  document.getElementById("nav-jarvis")?.addEventListener("click", showChat);
  document.getElementById("nav-automacoes")?.addEventListener("click", showAutomations);
  document.getElementById("nav-dados")?.addEventListener("click", showDados);

  document.getElementById("ap-back-btn")?.addEventListener("click", showChat);
  document.getElementById("ds-back-btn")?.addEventListener("click", showChat);
  document.getElementById("ds-refresh-btn")?.addEventListener("click", renderDatasourcesPanel);
  document.getElementById("ap-refresh-btn")?.addEventListener("click", renderAutomationsPanel);

  // Filtros do painel de automações
  document.querySelectorAll(".ap-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => applyFilter(btn.dataset.filter));
  });

  input.focus();
}

document.addEventListener("DOMContentLoaded", init);
