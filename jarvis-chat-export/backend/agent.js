/**
 * ============================================================
 * JARVIS CHAT — Camada do Agente
 * ============================================================
 * Provedor único: o modelo local (llama-server). Em 2026-08-18 os provedores
 * de nuvem foram removidos por decisão de privacidade — nenhum dado sai da
 * máquina, nunca. Sem llama-server de pé, o Jarvis responde 503 e pronto:
 * não existe fallback, e isso é proposital.
 * ============================================================
 */

const localProvider = require("./providers/local");
const arquivos = require("./arquivos");
const perfil = require("./perfil");

// A memória vem do navegador a cada requisição (o servidor não guarda nada).
// Sanitizar aqui evita que um payload malformado ou gigante vá parar no prompt.
const MAX_FATOS_MEMORIA = 60;
const MAX_TAMANHO_FATO = 240;

const ERRO_MODELO_FORA =
  "O modelo local não está respondendo. Suba o llama-server (npm run modelo) e tente de novo.";

function sanitizarMemoria(memoria) {
  if (!Array.isArray(memoria)) return [];
  return memoria
    .filter((f) => typeof f === "string")
    .map((f) => f.replace(/\s+/g, " ").trim().slice(0, MAX_TAMANHO_FATO))
    .filter(Boolean)
    .slice(0, MAX_FATOS_MEMORIA);
}

function getJarvisSystemPrompt(memoria = [], trechos = [], listagemArquivos = null, options = {}) {
  const fatos = sanitizarMemoria(memoria);
  // No modo documentos so a secao SEMPRE entra: os trechos do RAG ja ocupam
  // ~3600 chars do contexto de 4096 tokens do 3B.
  //
  // O perfil vai por ULTIMO no prompt, depois dos trechos. Medido em
  // 2026-09-25: com o perfil antes dos trechos, o 3B ignorava a regra de
  // precedencia e repetia uma nota antiga do vault ("analista de dados,
  // Protheus, Power BI") contra o que o perfil afirmava. Modelo pequeno da mais
  // peso ao que esta mais perto da pergunta do que a uma regra declarada.
  const blocoPerfil = perfil.bloco({ completo: !options.docs });
  const blocoMemoria = fatos.length
    ? `

Memória persistente (fatos que o usuário guardou sobre si e sobre o contexto dele):
${fatos.map((f) => `- ${f}`).join("\n")}
Use esses fatos com naturalidade quando forem relevantes à conversa. Não os recite em lista nem mencione que existe uma memória, a menos que o usuário pergunte.`
    : "";

  return {
    role: "system",
    content: `Você é JARVIS — Just A Rather Very Intelligent System — assistente pessoal criado por Matheus Trajano.

Identidade:
- Você foi desenvolvido por Matheus Trajano exclusivamente para uso pessoal.
- Quando perguntado quem te criou, quem te desenvolveu ou o que você é: responda que você é JARVIS, criado por Matheus Trajano. Não mencione Anthropic, Groq, OpenAI ou qualquer provedor de IA.
- Você não é um produto genérico — é o assistente pessoal de Matheus.

Personalidade e tom — OBRIGATÓRIO:
- Responda como um sistema técnico de alto desempenho: direto, sem rodeios.
- Vá direto à resposta. Use lista só quando houver 3+ itens distintos.
- PROIBIDO começar resposta com "Com base no que você disse...", "Analisando sua pergunta..." ou qualquer introdução que não seja a resposta em si.
- PROIBIDO encerrar com "Se precisar de mais detalhes..." ou variantes.
- Sempre em português brasileiro.

Precisão:
- Não invente dados. Quando não souber ou não tiver certeza, diga.
- Quando a pergunta for ambígua, responda o caso mais provável e diga qual suposição usou.${blocoMemoria}${listagemArquivos ? blocoArquivos(listagemArquivos) : ""}${blocoDocumentos(trechos)}${blocoPerfil}`,
  };
}

/**
 * Instrui o modelo sobre o espaço de arquivos. Sem isto ele tende a responder
 * "não tenho acesso a arquivos", que é o comportamento treinado dele, mesmo
 * com as ferramentas disponíveis na requisição.
 */
function blocoArquivos(listagem) {
  const inventario = Array.isArray(listagem) && listagem.length
    ? `
- Arquivos que existem agora (use exatamente estes caminhos):
${listagem.map((l) => `  ${l}`).join("\n")}`
    : `
- O espaço de arquivos está vazio no momento.`;

  return `

Espaço de arquivos:
- Você tem ferramentas para listar, ler, criar, editar e apagar arquivos de texto em um espaço reservado ao usuário.${inventario}
- Nunca invente caminho. Para ler, editar ou apagar, use um caminho da lista acima, copiado literalmente.
- Use uma ferramenta somente quando o usuário pedir de fato para ver, criar, alterar ou apagar um arquivo. Conversa comum não usa ferramenta.
- Caminhos são sempre relativos a esse espaço (ex: "notas/reuniao.md"). Nunca use caminho absoluto nem "..".
- Quando não souber o nome exato do arquivo, use listar_pasta antes de agir.
- Antes de editar_arquivo, use ler_arquivo: editar substitui o conteúdo inteiro.
- Nenhuma ação acontece sozinha: o usuário ainda confirma na tela. Não afirme que já criou ou já apagou algo.
- Cada pasta tem um JARVIS.md gerado automaticamente pelo sistema, com o índice do que existe nela. Nunca crie, edite nem apague esse arquivo: ele se atualiza sozinho depois de cada ação.
- Ao criar vários arquivos que formam um conjunto, coloque-os numa subpasta com nome curto (ex: "receitas/", "viagem-2026/"). Cada subpasta ganha o seu próprio índice.`;
}

/**
 * Bloco do modo documentos: trechos das notas do usuário recuperados pelo RAG.
 * O contexto do 3B é 4096 tokens — quem chama já limitou quantidade e tamanho.
 */
function blocoDocumentos(trechos) {
  if (!Array.isArray(trechos) || !trechos.length) return "";
  const corpo = trechos
    .map((t, i) => `[Trecho ${i + 1} | nota "${t.titulo || t.arquivo}"]\n${t.texto}`)
    .join("\n\n");
  return `

Modo documentos ativo. Trechos das notas e documentos do usuário, recuperados para esta pergunta:

${corpo}

Regras do modo documentos:
- Responda com base nesses trechos e no histórico da conversa.
- Se a informação pedida não estiver nos trechos, diga que não encontrou nos documentos. Não complete com suposição.
- Ao usar um trecho, cite o nome da nota entre parênteses.
- Trecho é nota antiga do usuário e pode estar desatualizado. Se contradisser o perfil do usuário mais abaixo, o perfil é a verdade atual e o trecho é histórico.
- Nunca copie os rótulos "[Trecho N | nota ...]" para a resposta: são marcação interna.`;
}

/**
 * Quais ferramentas mandar na requisição.
 *
 * No modo documentos elas ficam DE FORA: o contexto do 3B é de 4096 tokens e os
 * trechos do RAG já ocupam ~3600 chars. Somar os schemas das cinco ferramentas
 * empurra o histórico para fora da janela, e a pergunta sobre notas não precisa
 * mexer em arquivo. Mesma lógica que já pula a extração de memória nesse modo.
 */
function ferramentasPara(options = {}) {
  if (options.docs) return [];
  if (options.arquivos === false) return [];
  return arquivos.schemasDasFerramentas();
}

/** Monta a lista de mensagens que vai para o modelo: prompt + histórico + pergunta. */
function montarMensagens(userMessage, conversationHistory = [], options = {}) {
  const systemPrompt = getJarvisSystemPrompt(options.memory, options.trechos, options.listagemArquivos, options);
  const filteredHistory = conversationHistory.filter((m) => m.role !== "system");
  return [systemPrompt, ...filteredHistory, { role: "user", content: userMessage }];
}

/**
 * O /health do llama-server responde em milissegundos. Checar antes do chat
 * troca um timeout de minutos (servidor de pé mas modelo carregando) por um
 * erro imediato e claro.
 */
async function garantirModeloVivo() {
  const vivo = await localProvider.healthCheck();
  if (!vivo) {
    throw new AgentError(ERRO_MODELO_FORA, { primaryError: "llama-server nao esta respondendo" });
  }
}

/**
 * Preenche options.listagemArquivos quando as ferramentas estao ativas. Fica
 * aqui, e nao no server, para valer igual no /chat e no /chat/stream.
 */
async function comInventarioDeArquivos(options) {
  if (!ferramentasPara(options).length) return options;
  try {
    return { ...options, listagemArquivos: await arquivos.arvoreResumida() };
  } catch (erro) {
    console.error("[Jarvis] Nao consegui listar o espaco de arquivos:", erro.message);
    return options;
  }
}

async function processMessage(userMessage, conversationHistory = [], options = {}) {
  const opcoes = await comInventarioDeArquivos(options);
  const messages = montarMensagens(userMessage, conversationHistory, opcoes);
  const startTime = Date.now();

  await garantirModeloVivo();

  try {
    const result = await localProvider.chat(messages, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      tools: ferramentasPara(options),
    });
    const latency = Date.now() - startTime;
    console.log(`[Jarvis] ✓ Resposta local (${result.model}) em ${latency}ms`);
    return buildResponse(result, latency);
  } catch (erro) {
    if (erro.name === "AgentError") throw erro;
    console.error("[Jarvis] ✗ Falha no modelo local:", erro.message);
    throw new AgentError(ERRO_MODELO_FORA, {
      primaryError: erro.message,
      totalLatencyMs: Date.now() - startTime,
    });
  }
}

/**
 * Versão streaming: chama handlers.onDelta(trecho) a cada token e
 * handlers.onStart() quando a inferência começa. Falha depois do primeiro
 * token vira erro com parcial=true — o cliente já viu parte do texto.
 */
async function processMessageStream(userMessage, conversationHistory = [], options = {}, handlers = {}) {
  const onDelta = handlers.onDelta || (() => {});
  const onStart = handlers.onStart || (() => {});

  const opcoes = await comInventarioDeArquivos(options);
  const messages = montarMensagens(userMessage, conversationHistory, opcoes);
  const startTime = Date.now();

  await garantirModeloVivo();

  let emitiu = false;
  try {
    onStart({ provider: "local" });
    const result = await localProvider.chatStream(
      messages,
      {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        signal: options.signal,
        tools: ferramentasPara(options),
      },
      (delta) => {
        emitiu = true;
        onDelta(delta);
      }
    );
    const latency = Date.now() - startTime;
    console.log(`[Jarvis] ✓ Stream local (${result.model}) em ${latency}ms`);
    return buildResponse(result, latency);
  } catch (erro) {
    console.error("[Jarvis] ✗ Falha no stream local:", erro.message);
    throw new AgentError(
      emitiu ? "A resposta foi interrompida no meio." : ERRO_MODELO_FORA,
      { primaryError: erro.message, parcial: emitiu, totalLatencyMs: Date.now() - startTime }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// EXTRAÇÃO DE MEMÓRIA
// ─────────────────────────────────────────────────────────────

const PROMPT_EXTRACAO = `Você extrai fatos duráveis sobre o usuário a partir de uma mensagem de chat.

Fato durável: nome, profissão, preferências estáveis, contexto pessoal ou de trabalho que continua valendo daqui a semanas. Exemplos: "Trabalha como analista de suporte", "Prefere respostas curtas", "Tem um projeto chamado Capital".
NÃO é fato durável: pedido pontual, pergunta, tarefa da conversa, conteúdo técnico genérico, estado passageiro.

Responda SOMENTE com um array JSON de strings em português, sem markdown e sem explicação. Cada fato em terceira pessoa, com no máximo 140 caracteres. Se não houver fato durável, responda [].`;

/**
 * Extrai fatos duráveis da mensagem do usuário. Melhor esforço: modelo fora
 * do ar ou JSON inválido devolvem lista vazia — a memória é um extra, nunca
 * pode derrubar o chat.
 */
async function extrairFatos(mensagemDoUsuario) {
  const vivo = await localProvider.healthCheck();
  if (!vivo) return [];

  try {
    const result = await localProvider.chat(
      [
        { role: "system", content: PROMPT_EXTRACAO },
        { role: "user", content: mensagemDoUsuario },
      ],
      { maxTokens: 200, temperature: 0 }
    );
    return parsearFatos(result.text);
  } catch (erro) {
    console.error("[Jarvis] Extração de memória falhou:", erro.message);
    return [];
  }
}

/** Acha o primeiro array JSON no texto do modelo. Modelo pequeno às vezes envolve em prosa. */
function parsearFatos(texto) {
  const m = String(texto || "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => typeof f === "string")
      .map((f) => f.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch (_) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// HEALTH CHECK E HELPERS
// ─────────────────────────────────────────────────────────────

async function checkProvidersHealth() {
  const [local, modeloLocal, info] = await Promise.all([
    localProvider.healthCheck(),
    localProvider.modeloCarregado(),
    localProvider.infoModelo(),
  ]);

  return {
    local: local === true,
    localModel: modeloLocal,
    modelo: info || {},
    anyAvailable: local === true,
  };
}

function buildResponse(providerResult, latencyMs) {
  return {
    text: providerResult.text,
    toolCalls: providerResult.toolCalls || [],
    provider: "local",
    model: providerResult.model,
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
  processMessageStream,
  extrairFatos,
  checkProvidersHealth,
  getJarvisSystemPrompt,
  AgentError,
};
