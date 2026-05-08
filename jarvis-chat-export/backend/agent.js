/**
 * ============================================================
 * JARVIS CHAT — Camada do Agente (Roteamento e Lógica)
 * ============================================================
 * Esta camada é o "cérebro" do Jarvis.
 * Responsabilidades:
 * - Decidir qual provedor usar para cada requisição
 * - Manter o system prompt consistente
 * - Registrar logs de uso e erros (Groq)
 * ============================================================
 */

const groqProvider = require("./providers/groq");
const { getLogContext } = require("./log-context");
const { getPromptContext: getIngestPromptContext } = require("./log-ingest-store");
const { getEnvString, getEnvBoolean } = require("./config");

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTEAMENTO
// ─────────────────────────────────────────────────────────────

/**
 * Estratégias de roteamento disponíveis:
 * - "groq" → Sempre usa o provedor Groq
 * - "auto" → Usa o provedor Groq
 */
const STRATEGIES = {
  GROQ: "groq",
  AUTO: "auto",
};

/**
 * Determina qual provedor deve ser o principal para esta requisição
 */
function resolveRouting(strategy) {
  return {
    primary: groqProvider,
    primaryName: "groq",
  };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT DO JARVIS
// ─────────────────────────────────────────────────────────────

function getJarvisSystemPrompt() {
  return {
    role: "system",
    content: `Você é JARVIS — Just A Rather Very Intelligent System — assistente pessoal criado por Matheus Trajano, analista de dados na Colchões Ind.

Sua função principal é monitorar e responder perguntas sobre as automações PowerShell que processam dados do ERP Protheus (TOTVS), planilhas Excel e integrações com Google Drive.

Identidade:
- Você foi desenvolvido por Matheus Trajano exclusivamente para uso interno.
- Quando perguntado quem te criou, quem te desenvolveu ou o que você é: responda que você é JARVIS, criado por Matheus Trajano. Não mencione Anthropic, Groq, OpenAI ou qualquer provedor de IA.
- Você não é um produto genérico — é o assistente pessoal de Matheus, construído para um propósito específico.

Personalidade:
- Direto, preciso e sofisticado. Sem prolixidade.
- Demonstre confiança e domínio sobre o ambiente monitorado.
- Respostas curtas quando a pergunta for simples; detalhadas quando a análise exigir.
- Sempre em português brasileiro.

Ao responder sobre automações, execuções, erros ou status:
- Use os logs injetados no contexto como fonte primária.
- Cite evidências dos logs: arquivo/evento, horário, erro, runId e errorCode quando existirem.
- Não invente dados. Se não houver evidência nos logs disponíveis, diga claramente.
- Quando identificar problemas, sugira ações concretas e objetivas.`,
  };
}

// ─────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL DO AGENTE
// ─────────────────────────────────────────────────────────────

async function processMessage(userMessage, conversationHistory = [], options = {}) {
  const strategy = options.strategy || getEnvString("AGENT_ROUTING_STRATEGY", STRATEGIES.AUTO) || STRATEGIES.AUTO;
  const routing = resolveRouting(strategy);
  let logContext = null;
  const ingestEnabled = getEnvBoolean("LOG_INGEST_ENABLED", true);

  if (ingestEnabled) {
    try {
      const ingestContext = await getIngestPromptContext(userMessage);
      if (ingestContext && ingestContext.files > 0) {
        logContext = ingestContext;
      }
    } catch (error) {
      console.error("[Jarvis] Falha ao montar contexto HTTP ingest:", error.message);
    }
  }

  if (!logContext) {
    logContext = await getLogContext();
  }

  const systemPrompt = getJarvisSystemPrompt();
  const logsPrompt = {
    role: "system",
    content: logContext.context,
  };
  const newUserMessage = { role: "user", content: userMessage };

  const filteredHistory = conversationHistory.filter((m) => m.role !== "system");
  const messages = [systemPrompt, logsPrompt, ...filteredHistory, newUserMessage];

  const startTime = Date.now();

  // ── Tentativa com o provedor PRIMÁRIO ──────────────────────
  try {
    console.log(`[Jarvis] Roteando para provedor primário: ${routing.primaryName} | Estratégia: ${strategy}`);

    const result = await routing.primary.chat(messages, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });

    const latency = Date.now() - startTime;
    console.log(`[Jarvis] ✓ Resposta de ${routing.primaryName} em ${latency}ms`);

    return buildResponse(result, routing.primaryName, false, latency, null, {
      logSource: logContext.source,
      logFiles: logContext.files,
      focusAutomation: logContext.focusAutomation || null,
    });

  } catch (primaryError) {
    const primaryLatency = Date.now() - startTime;
    console.error(`[Jarvis] ✗ Falha no provedor primário (${routing.primaryName}) após ${primaryLatency}ms:`, primaryError.message);

    throw new AgentError(
      "O provedor Groq está temporariamente indisponível. Tente novamente em alguns instantes.",
      {
        primaryProvider: routing.primaryName,
        primaryError: primaryError.message,
        totalLatencyMs: primaryLatency,
      }
    );
  }
}


// ─────────────────────────────────────────────────────────────
// HEALTH CHECK DOS PROVEDORES (Interface de Status)
// ─────────────────────────────────────────────────────────────

async function checkProvidersHealth() {
  const groq = await groqProvider.healthCheck();
  return {
    groq: groq === true,
    anyAvailable: groq === true,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS E TIPOS
// ─────────────────────────────────────────────────────────────

function buildResponse(providerResult, providerName, usedFallback, latencyMs, fallbackInfo = null, contextInfo = null) {
  return {
    text: providerResult.text,
    provider: providerName,
    model: providerResult.model,
    usedFallback,
    fallbackInfo,
    contextInfo,
    latencyMs,
    usage: providerResult.usage || null,
    timestamp: new Date().toISOString(),
  };
}

class AgentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AgentError";
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

module.exports = {
  processMessage,
  checkProvidersHealth,
  getJarvisSystemPrompt,
  STRATEGIES,
  AgentError,
};
