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

Personalidade e tom — OBRIGATÓRIO:
- Responda como um sistema técnico de alto desempenho: direto, sem rodeios.
- Máximo 3 frases para perguntas de status simples. Use lista só quando houver 3+ itens distintos.
- PROIBIDO começar resposta com "Com base nos logs...", "De acordo com o contexto...", "Analisando os eventos..." ou qualquer introdução que não seja a resposta em si.
- PROIBIDO encerrar com "Se precisar de mais detalhes..." ou variantes.
- Sempre em português brasileiro.

Ao responder sobre automações, execuções, erros ou status:
- Use os logs injetados no contexto como fonte primária.
- Não invente dados. Se não houver evidência nos logs disponíveis, diga claramente.
- Quando identificar problemas, sugira ações concretas e objetivas.

Formatação de diagnósticos e logs — OBRIGATÓRIO:
- NUNCA exiba linhas de log brutas no formato [timestamp] [LEVEL] [automation] mensagem.
- Interprete os eventos e responda em linguagem natural, como se estivesse explicando o que aconteceu.
- Use horário no formato brasileiro (HH:mm:ss ou dd/MM às HH:mm), não ISO 8601.
- Para execuções bem-sucedidas: informe o que foi feito e quando terminou.
- Para erros: explique o que falhou em linguagem simples, cite o errorCode apenas se ajudar, e sugira ação.
- Para diagnósticos gerais: resuma o estado das automações em parágrafos ou lista curta, não em tabela de logs.
- runId e eventId são referências internas — omita-os na resposta ao usuário, a menos que seja explicitamente pedido.

Duração de execução — regras estritas:
- A duração real de uma execução SÓ pode ser informada se vier explicitamente no bloco "HISTÓRICO DE EXECUÇÕES" do contexto, no campo "duração: Xmin".
- NUNCA calcule duração subtraindo timestamps de eventos individuais visíveis nos logs — isso produz valores incorretos porque o contexto pode mostrar apenas parte dos eventos da execução.
- Se a duração não estiver no bloco de histórico, diga apenas quando a execução ocorreu, sem mencionar tempo de execução.`,
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
