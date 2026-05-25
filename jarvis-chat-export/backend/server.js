require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const { getEnvString, getEnvBoolean } = require("./config");
const agent = require("./agent");
const { hasDriveConfig, getLogContext } = require("./log-context");
const logIngestStore = require("./log-ingest-store");
const { getMonitorStatus } = require("./monitor");
const { sendTelegramMessage } = require("./telegram");

const app = express();

// Cache do monitor: recalcula no maximo a cada 5min (era 30s).
// O calculo agora faz 1 query Postgres (em vez de 13), entao a janela maior
// elimina varios CU/hora sem perder reatividade pratica (front polla a cada 30s
// mas todos batem no mesmo cache).
let _monitorCache = null;
let _monitorCacheAt = 0;
const MONITOR_CACHE_TTL = 5 * 60 * 1000;

async function getCachedMonitorStatus(force = false) {
  const now = Date.now();
  if (!force && _monitorCache && now - _monitorCacheAt < MONITOR_CACHE_TTL) {
    return _monitorCache;
  }
  _monitorCache = await getMonitorStatus();
  _monitorCacheAt = now;
  return _monitorCache;
}

const _overdueNotified = new Set();

async function checkAndNotifyOverdue() {
  try {
    // Reusa cache (era force=true). O TTL de 5min ja casa com o intervalo de checagem.
    const status = await getCachedMonitorStatus(false);
    const all = [...(status.automations || []), ...(status.dataSources || [])];
    for (const item of all) {
      if (item.status === "overdue" && !_overdueNotified.has(item.name)) {
        _overdueNotified.add(item.name);
        const msg = `🚨 <b>JARVIS ALERT</b>\n<b>${item.displayName}</b> está atrasada\n${item.hoursElapsed}h sem execução`;
        await sendTelegramMessage(msg);
        console.log(`[telegram] Alerta enviado: ${item.displayName}`);
      } else if (item.status !== "overdue") {
        _overdueNotified.delete(item.name);
      }
    }
  } catch (err) {
    console.error("[telegram] Erro ao checar overdues:", err.message);
  }
}

async function runLogCleanup() {
  const days = Number(getEnvString("LOG_RETAIN_DAYS", "30")) || 30;
  try {
    const deleted = await logIngestStore.deleteOldEvents(days);
    if (deleted != null) console.log(`[cleanup] ${deleted} eventos removidos (>${days} dias)`);
  } catch (err) {
    console.error("[cleanup] Erro:", err.message);
  }
}
const PORT = Number(getEnvString("PORT", "3000")) || 3000;
const api = express.Router();

const publicDir = path.join(__dirname, "public");
const legacyFrontendDir = path.join(__dirname, "../frontend");
const frontendDir = fs.existsSync(publicDir) ? publicDir : legacyFrontendDir;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(
  cors({
    origin: getEnvString("ALLOWED_ORIGIN", "*"),
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "x-jarvis-token"],
  })
);

const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas requisicoes. Aguarde um momento.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(frontendDir));

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerToken = req.headers["x-jarvis-token"];
  return typeof headerToken === "string" ? headerToken.trim() : "";
}

function requireIngestToken(req, res, next) {
  const expected = getEnvString("LOG_INGEST_API_TOKEN");
  if (!expected) {
    return res.status(503).json({
      error: "LOG_INGEST_API_TOKEN nao configurado.",
      code: "INGEST_TOKEN_NOT_CONFIGURED",
    });
  }

  const provided = getBearerToken(req);
  if (!provided || provided !== expected) {
    return res.status(401).json({
      error: "Token invalido para ingestao de logs.",
      code: "INVALID_INGEST_TOKEN",
    });
  }

  return next();
}

api.post("/chat", chatRateLimiter, async (req, res) => {
  const { message, history = [], options = {} } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Mensagem invalida.", code: "INVALID_MESSAGE" });
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0 || trimmedMessage.length > 8000) {
    return res.status(400).json({ error: "Tamanho de mensagem invalido.", code: "BAD_SIZE" });
  }

  try {
    const response = await agent.processMessage(trimmedMessage, history, options);
    return res.json({
      text: response.text,
      provider: response.provider,
      model: response.model,
      usedFallback: response.usedFallback,
      latencyMs: response.latencyMs,
      timestamp: response.timestamp,
      contextInfo: response.contextInfo,
    });
  } catch (err) {
    console.error("[/api/chat] Erro:", err.message, err.details || "");
    if (err.name === "AgentError") {
      // Detecta rate limit do Groq pra dar mensagem util ao usuario
      const isRateLimit = /rate_limit|too large|TPM/i.test(err.details?.primaryError || "");
      const userMessage = isRateLimit
        ? "Muitos eventos no contexto para o tier atual do Groq. Tente uma pergunta mais especifica ou aguarde 1 min."
        : err.message;
      return res.status(503).json({ error: userMessage, code: "AGENT_UNAVAILABLE" });
    }
    return res.status(500).json({ error: "Erro interno no Jarvis.", code: "INTERNAL_ERROR" });
  }
});

api.get("/health", async (req, res) => {
  try {
    const status = await agent.checkProvidersHealth();
    return res.json({
      status: status.anyAvailable ? "healthy" : "degraded",
      groq: status.groq,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({ status: "error", groq: false });
  }
});

api.post("/log-ingest", requireIngestToken, async (req, res) => {
  try {
    const result = await logIngestStore.appendEvents(req.body);
    return res.status(202).json({
      accepted: result.accepted,
      rejected: result.rejected,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/log-ingest] Erro:", error.message);
    return res.status(500).json({ error: "Falha ao ingerir logs.", code: "LOG_INGEST_FAILED" });
  }
});

api.get("/logs/query", requireIngestToken, async (req, res) => {
  try {
    const events = await logIngestStore.queryEvents({
      level: req.query.level,
      automation: req.query.automation,
      from: req.query.from,
      to: req.query.to,
      search: req.query.search,
      limit: req.query.limit,
    });
    return res.json({
      count: events.length,
      events,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/logs/query] Erro:", error.message);
    return res.status(500).json({ error: "Falha ao consultar logs.", code: "LOG_QUERY_FAILED" });
  }
});

api.get("/info", (req, res) => {
  const ingestEnabled = getEnvBoolean("LOG_INGEST_ENABLED", true);
  res.json({
    name: "Jarvis Chat API",
    version: "1.2.0",
    routing: {
      strategy: getEnvString("AGENT_ROUTING_STRATEGY") || "auto",
      providers: ["groq"],
    },
    logs: {
      mode: logIngestStore.getStorageMode(),
      driveFolderId: getEnvString("GOOGLE_DRIVE_FOLDER_ID") || null,
      ingestEnabled,
    },
  });
});

api.get("/monitor", async (req, res) => {
  try {
    const force = req.query.force === "1";
    const status = await getCachedMonitorStatus(force);
    return res.json(status);
  } catch (error) {
    console.error("[/api/monitor] Erro:", error.message);
    return res.status(500).json({ error: "Falha ao calcular status do monitor.", code: "MONITOR_FAILED" });
  }
});

api.get("/monitor/history/:name", async (req, res) => {
  try {
    const history = await logIngestStore.getAutomationHistory(req.params.name, 7);
    return res.json({ automation: req.params.name, history });
  } catch (error) {
    console.error("[/api/monitor/history] Erro:", error.message);
    return res.status(500).json({ error: "Falha ao buscar histórico.", code: "HISTORY_FAILED" });
  }
});

api.get("/monitor/daily/:name", async (req, res) => {
  try {
    const days  = Math.min(Number(req.query.days || 7), 30);
    const stats = await logIngestStore.getDailyStats(req.params.name, days);
    return res.json({ automation: req.params.name, days, stats });
  } catch (error) {
    console.error("[/api/monitor/daily] Erro:", error.message);
    return res.status(500).json({ error: "Falha ao buscar estatísticas diárias.", code: "DAILY_FAILED" });
  }
});

api.get("/logs-debug", async (req, res) => {
  try {
    const logs = await getLogContext();
    const ingestStats = await logIngestStore.getStats();
    return res.json({
      source: logs.source,
      files: logs.files,
      fileNames: logs.fileNames || [],
      ingest: ingestStats,
      note: "Endpoint de diagnostico para confirmar quais logs foram lidos.",
    });
  } catch (error) {
    return res.status(500).json({ source: "error", files: 0, fileNames: [], error: error.message });
  }
});

app.use("/api", api);
app.use("/", api);

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Jarvis iniciado em http://localhost:${PORT}`);
    console.log(`Frontend servido de: ${frontendDir}`);
    console.log(`Storage mode: ${logIngestStore.getStorageMode()}`);
    console.log(`Monitor OVERDUE_HOURS: ${getEnvString("MONITOR_OVERDUE_HOURS", "5")} h`);
  });
  // Limpeza de logs antigos: roda 10s após o startup e depois a cada 7 dias
  setTimeout(runLogCleanup, 10_000);
  setInterval(runLogCleanup, 7 * 24 * 60 * 60 * 1000);
  // Notificação Telegram para overdues: checar a cada 5 minutos
  setTimeout(checkAndNotifyOverdue, 20_000);
  setInterval(checkAndNotifyOverdue, 5 * 60 * 1000);
}

module.exports = app;
