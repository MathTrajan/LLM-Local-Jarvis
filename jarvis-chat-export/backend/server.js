require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const { getEnvString } = require("./config");
const agent = require("./agent");

const app = express();

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
    allowedHeaders: ["Content-Type", "Authorization"],
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
    });
  } catch (err) {
    console.error("[/api/chat] Erro:", err.message, err.details || "");
    if (err.name === "AgentError") {
      const isRateLimit = /rate_limit|too large|TPM/i.test(err.details?.primaryError || "");
      const userMessage = isRateLimit
        ? "Limite de requisicoes do Groq atingido. Aguarde 1 min e tente novamente."
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

api.get("/info", (req, res) => {
  res.json({
    name: "Jarvis Chat API",
    version: "2.0.0",
    routing: {
      strategy: getEnvString("AGENT_ROUTING_STRATEGY") || "auto",
      providers: ["groq"],
    },
  });
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
  });
}

module.exports = app;
