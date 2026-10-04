/**
 * ============================================================
 * JARVIS CHAT - Provedor local (llama.cpp / llama-server)
 * ============================================================
 * Fala o protocolo OpenAI (/v1/chat/completions), que o llama-server expoe.
 * Nao depende de SDK: o fetch nativo do Node basta.
 *
 * O modelo roda na maquina, sem internet e sem custo por token. O preco e a
 * latencia: um 3B quantizado responde em segundos, nao em centenas de ms.
 * ============================================================
 */

const fs = require("fs/promises");
const { getEnvString } = require("../config");

const BASE_URL = (getEnvString("LOCAL_LLM_BASE_URL") || "http://127.0.0.1:8080/v1").replace(/\/+$/, "");
// O llama-server aceita qualquer nome de modelo: ele serve o unico GGUF carregado.
const MODEL = getEnvString("LOCAL_LLM_MODEL") || "local";
const TIMEOUT_MS = Number(getEnvString("LOCAL_LLM_TIMEOUT_MS", "120000")) || 120000;

async function postJson(path, body, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      throw new Error(`llama-server respondeu ${res.status}: ${detalhe.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages, options = {}) {
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  const corpo = {
    model: options.model || MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  if (options.tools?.length) {
    corpo.tools = options.tools;
    corpo.tool_choice = options.toolChoice || "auto";
  }

  const response = await postJson("/chat/completions", corpo);

  const choice = response.choices?.[0];
  const text = choice?.message?.content?.trim() || "";

  return {
    text,
    toolCalls: normalizarToolCalls(choice?.message?.tool_calls),
    // O llama-server devolve o caminho do .gguf; encurta para o nome do arquivo.
    model: nomeCurtoDoModelo(response.model),
    provider: "local",
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens,
    },
    finishReason: choice?.finish_reason,
  };
}

/**
 * Igual ao chat(), mas em streaming: chama onDelta(trecho) a cada token e
 * devolve o mesmo objeto de resultado ao final. O timeout aqui e de
 * inatividade (entre um token e outro), nao sobre a resposta inteira —
 * resposta longa no 3B passa facil de 2 minutos somando tudo.
 */
async function chatStream(messages, options = {}, onDelta = () => {}) {
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  const controller = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const rearmar = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  };

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || MODEL,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        // Sem isto o llama-server NAO manda o bloco `usage` no streaming (testado
        // no b10240: sem a flag nenhum chunk traz usage). E o que alimenta o
        // painel de tokens e a barra de contexto.
        stream_options: { include_usage: true },
        ...(options.tools?.length
          ? { tools: options.tools, tool_choice: options.toolChoice || "auto" }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const detalhe = await res.text().catch(() => "");
      throw new Error(`llama-server respondeu ${res.status}: ${detalhe.slice(0, 200)}`);
    }

    let texto = "";
    let modelo = null;
    let finishReason = null;
    let usage = null;
    // tool_calls no streaming chegam picadas: o nome vem num delta e os
    // "arguments" em varios pedacos. Acumula por indice ate o fim.
    const toolCallsParciais = [];

    // Parse manual do SSE: eventos separados por linha em branco, payload em
    // linhas "data:". O llama-server encerra com "data: [DONE]".
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const pedaco of res.body) {
      rearmar();
      buffer += decoder.decode(pedaco, { stream: true });
      let corte;
      while ((corte = buffer.indexOf("\n\n")) !== -1) {
        const bloco = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        for (const linha of bloco.split("\n")) {
          if (!linha.startsWith("data:")) continue;
          const payload = linha.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json;
          try { json = JSON.parse(payload); } catch (_) { continue; }
          if (json.model) modelo = json.model;
          if (json.usage) usage = json.usage;
          const escolha = json.choices?.[0];
          if (escolha?.finish_reason) finishReason = escolha.finish_reason;
          const delta = escolha?.delta?.content || "";
          if (delta) {
            texto += delta;
            onDelta(delta);
          }
          for (const tc of escolha?.delta?.tool_calls || []) {
            const i = tc.index ?? 0;
            if (!toolCallsParciais[i]) toolCallsParciais[i] = { id: null, nome: "", argumentos: "" };
            if (tc.id) toolCallsParciais[i].id = tc.id;
            if (tc.function?.name) toolCallsParciais[i].nome = tc.function.name;
            if (tc.function?.arguments) toolCallsParciais[i].argumentos += tc.function.arguments;
          }
        }
      }
    }

    return {
      text: texto.trim(),
      toolCalls: montarToolCallsDoStream(toolCallsParciais),
      model: nomeCurtoDoModelo(modelo),
      provider: "local",
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        // Prefixo do prompt reaproveitado do KV cache: o llama-server nao
        // reprocessa esses tokens, e por isso a 2a mensagem responde mais rapido.
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
      },
      finishReason,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normaliza o tool_calls do modo nao-streaming para o formato interno
 * {id, nome, argumentos}. "arguments" vem como string JSON.
 */
function normalizarToolCalls(brutos) {
  if (!Array.isArray(brutos) || !brutos.length) return [];
  return brutos
    .map((tc, i) => ({
      id: tc.id || `call_${i}`,
      nome: tc.function?.name || "",
      argumentos: tc.function?.arguments || "",
    }))
    .filter((tc) => tc.nome);
}

/** Fecha as tool_calls acumuladas no streaming, descartando as sem nome. */
function montarToolCallsDoStream(parciais) {
  return (parciais || [])
    .filter(Boolean)
    .map((tc, i) => ({ id: tc.id || `call_${i}`, nome: tc.nome, argumentos: tc.argumentos }))
    .filter((tc) => tc.nome);
}

function nomeCurtoDoModelo(valor) {
  if (!valor) return MODEL;
  const base = String(valor).split("/").pop() || String(valor);
  return base.replace(/\.gguf$/i, "");
}

/**
 * Usa /health do llama-server: e barato e nao gasta inferencia. Se o processo
 * nao estiver de pe, o fetch falha na conexao e devolvemos false.
 */
async function healthCheck() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = BASE_URL.replace(/\/v1$/, "") + "/health";
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.status === "ok";
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ficha tecnica do que o llama-server realmente carregou, lida do /props. Tudo
 * daqui vem do processo de pe, nao do .env: o script pode ter subido com outro
 * -c, e o .gguf pode ter sido trocado sem ninguem mexer na configuracao.
 * Devolve {} se o modelo estiver fora.
 */
async function infoModelo() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = BASE_URL.replace(/\/v1$/, "") + "/props";
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return {};
    const data = await res.json();

    const n = data?.default_generation_settings?.n_ctx;
    const caminho = data?.model_path;

    // Tamanho em disco: o /props nao informa, entao vem do stat do proprio .gguf.
    // Falha em silencio — o arquivo pode estar noutra maquina (o Jarvis aponta
    // para o modelo que mora no odysseus-dev).
    let bytes = null;
    if (caminho) {
      try { bytes = (await fs.stat(caminho)).size; } catch (_) { /* sem tamanho */ }
    }

    return {
      contextoMax: Number.isFinite(n) ? n : null,
      quantizacao: data?.model_ftype || null,
      motor: data?.build_info || null,
      slots: data?.total_slots ?? null,
      bytes,
    };
  } catch (_) {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** Nome do modelo carregado, para exibir no painel. Null se estiver fora. */
async function modeloCarregado() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${BASE_URL}/models`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const primeiro = data?.models?.[0] || data?.data?.[0];
    const nome = primeiro?.name || primeiro?.id;
    return nome ? nomeCurtoDoModelo(nome) : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, chatStream, healthCheck, modeloCarregado, infoModelo, BASE_URL };
