/**
 * ============================================================
 * JARVIS CHAT — Acesso a arquivos (sandbox)
 * ============================================================
 * Da ao modelo local a capacidade de criar, ler, editar e apagar arquivos,
 * restrita a UMA raiz. Nada aqui executa nada: so mexe em texto no disco.
 *
 * Por que a sandbox e inegociavel: o modelo e um Qwen 3B quantizado. Ele erra
 * caminho e alucina nome de arquivo com frequencia bem maior que um modelo
 * grande. Sem raiz unica, um caminho inventado alcanca ~/Dev (projeto em
 * producao) e o vault do Obsidian. Com raiz unica, o pior caso e lixo numa
 * pasta descartavel.
 *
 * Segunda linha de defesa, no server.js: NADA aqui e chamado durante o chat.
 * O modelo apenas PROPOE; quem executa e o clique do usuario.
 * ============================================================
 */

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { getEnvString } = require("./config");

/** Expande ~ no comeco do caminho, como o shell faz. */
function expandirTil(valor) {
  if (!valor) return valor;
  if (valor === "~") return os.homedir();
  if (valor.startsWith("~/")) return path.join(os.homedir(), valor.slice(2));
  return valor;
}

const RAIZ = path.resolve(
  expandirTil(getEnvString("JARVIS_ARQUIVOS_RAIZ") || path.join(os.homedir(), "Jarvis-Arquivos"))
);

// Só texto. Sem binario, sem .app, sem nada que o macOS trate como executavel.
// O modelo pode escrever codigo (.js, .py, .sh) porque o Jarvis nunca o executa —
// o arquivo fica parado ate voce abrir.
const EXTENSOES = new Set([
  ".md", ".txt", ".json", ".csv", ".tsv", ".log", ".yml", ".yaml",
  ".html", ".css", ".js", ".ts", ".jsx", ".tsx", ".py", ".sh", ".sql", ".xml", ".env",
]);

const MAX_BYTES = 512 * 1024;      // teto por arquivo: 512 KB
const MAX_ITENS_LISTAGEM = 200;
const MAX_CHARS_LEITURA = 20000;   // o contexto do 3B e 4096 tokens

// Indice automatico por pasta, no espirito do CLAUDE.md. E DERIVADO: nunca
// recebe linha nova, e reescrito inteiro a partir do que existe no disco, e as
// datas saem do filesystem. Log incremental duplicaria a verdade, e duas copias
// "mantidas em sincronia na mao" divergem (foi o bug v1.7.1 do Capital).
const NOME_INDICE = "JARVIS.md";

class ErroArquivo extends Error {
  constructor(mensagem, codigo = "ARQUIVO_INVALIDO") {
    super(mensagem);
    this.name = "ErroArquivo";
    this.codigo = codigo;
  }
}

/** Cria a raiz se ainda nao existir. Idempotente. */
function garantirRaiz() {
  fs.mkdirSync(RAIZ, { recursive: true });
  return RAIZ;
}

/**
 * Converte caminho relativo vindo do modelo em absoluto DENTRO da raiz.
 * Recusa: caminho absoluto, escape por "..", e symlink que aponte para fora.
 *
 * O symlink e checado no ancestral existente mais proximo, nao no alvo: o
 * arquivo final pode nao existir ainda (caso do criar_arquivo), mas a pasta
 * que o contem existe e e ela que poderia estar apontando para fora.
 */
function resolverSeguro(caminhoRelativo) {
  const bruto = String(caminhoRelativo || "").trim();
  if (!bruto) throw new ErroArquivo("Caminho vazio.");
  if (bruto.includes("\0")) throw new ErroArquivo("Caminho invalido.");

  if (path.isAbsolute(bruto) || bruto.startsWith("~")) {
    throw new ErroArquivo(
      "Use caminho relativo ao espaco de arquivos do Jarvis, sem barra no inicio e sem ~.",
      "FORA_DA_RAIZ"
    );
  }

  const alvo = path.resolve(RAIZ, bruto);
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + path.sep)) {
    throw new ErroArquivo("Esse caminho fica fora do espaco de arquivos do Jarvis.", "FORA_DA_RAIZ");
  }

  let ancestral = path.dirname(alvo);
  while (ancestral.startsWith(RAIZ) && !fs.existsSync(ancestral)) {
    ancestral = path.dirname(ancestral);
  }
  if (fs.existsSync(ancestral)) {
    const real = fs.realpathSync(ancestral);
    const raizReal = fs.realpathSync(RAIZ);
    if (real !== raizReal && !real.startsWith(raizReal + path.sep)) {
      throw new ErroArquivo("Esse caminho sai da raiz por um atalho.", "FORA_DA_RAIZ");
    }
  }
  return alvo;
}

/**
 * O indice e derivado: qualquer edicao manual sumiria na proxima geracao.
 * Recusar na entrada e mais honesto que aceitar e sobrescrever depois.
 */
function recusarSeForIndice(alvo) {
  if (path.basename(alvo) === NOME_INDICE) {
    throw new ErroArquivo(
      `${NOME_INDICE} e gerado automaticamente pelo Jarvis e nao pode ser alterado a mao.`,
      "ARQUIVO_RESERVADO"
    );
  }
}

function validarExtensao(alvo) {
  const ext = path.extname(alvo).toLowerCase();
  if (!EXTENSOES.has(ext)) {
    throw new ErroArquivo(
      `Extensao "${ext || "(nenhuma)"}" nao permitida. Permitidas: ${[...EXTENSOES].join(", ")}`,
      "EXTENSAO_NAO_PERMITIDA"
    );
  }
}

function validarTamanho(conteudo) {
  const bytes = Buffer.byteLength(String(conteudo ?? ""), "utf8");
  if (bytes > MAX_BYTES) {
    throw new ErroArquivo(`Conteudo grande demais (${bytes} bytes). Teto: ${MAX_BYTES}.`, "GRANDE_DEMAIS");
  }
}

function relativo(alvo) {
  return path.relative(RAIZ, alvo) || ".";
}

// ─────────────────────────────────────────────────────────────
// OPERACOES
// ─────────────────────────────────────────────────────────────

async function listarPasta({ caminho = "." } = {}) {
  garantirRaiz();
  const alvo = caminho === "." || caminho === "" ? RAIZ : resolverSeguro(caminho);
  let entradas;
  try {
    entradas = await fsp.readdir(alvo, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === "ENOENT") throw new ErroArquivo("Essa pasta nao existe.", "NAO_ENCONTRADO");
    throw erro;
  }
  const itens = entradas
    .filter((e) => !e.name.startsWith(".") && e.name !== NOME_INDICE)
    .slice(0, MAX_ITENS_LISTAGEM)
    .map((e) => ({ nome: e.name, tipo: e.isDirectory() ? "pasta" : "arquivo" }));
  return { caminho: relativo(alvo), itens, total: itens.length };
}

async function lerArquivo({ caminho } = {}) {
  garantirRaiz();
  const alvo = resolverSeguro(caminho);
  let conteudo;
  try {
    conteudo = await fsp.readFile(alvo, "utf8");
  } catch (erro) {
    if (erro.code === "ENOENT") throw new ErroArquivo("Esse arquivo nao existe.", "NAO_ENCONTRADO");
    if (erro.code === "EISDIR") throw new ErroArquivo("Isso e uma pasta, nao um arquivo.", "E_PASTA");
    throw erro;
  }
  const truncado = conteudo.length > MAX_CHARS_LEITURA;
  return {
    caminho: relativo(alvo),
    conteudo: truncado ? conteudo.slice(0, MAX_CHARS_LEITURA) : conteudo,
    truncado,
  };
}

async function criarArquivo({ caminho, conteudo = "" } = {}) {
  garantirRaiz();
  const alvo = resolverSeguro(caminho);
  recusarSeForIndice(alvo);
  validarExtensao(alvo);
  validarTamanho(conteudo);

  await fsp.mkdir(path.dirname(alvo), { recursive: true });
  try {
    // wx falha se o arquivo ja existe: criar nunca sobrescreve em silencio.
    await fsp.writeFile(alvo, String(conteudo), { encoding: "utf8", flag: "wx" });
  } catch (erro) {
    if (erro.code === "EEXIST") {
      throw new ErroArquivo("Ja existe um arquivo nesse caminho. Use editar_arquivo.", "JA_EXISTE");
    }
    throw erro;
  }
  return { caminho: relativo(alvo), bytes: Buffer.byteLength(String(conteudo), "utf8") };
}

async function editarArquivo({ caminho, conteudo = "" } = {}) {
  garantirRaiz();
  const alvo = resolverSeguro(caminho);
  recusarSeForIndice(alvo);
  validarExtensao(alvo);
  validarTamanho(conteudo);

  let anterior = null;
  try {
    anterior = await fsp.readFile(alvo, "utf8");
  } catch (erro) {
    if (erro.code === "ENOENT") throw new ErroArquivo("Esse arquivo nao existe. Use criar_arquivo.", "NAO_ENCONTRADO");
    throw erro;
  }

  // Backup antes de sobrescrever: a unica forma de desfazer o erro do modelo.
  const backupDir = path.join(RAIZ, ".backups");
  await fsp.mkdir(backupDir, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(backupDir, `${path.basename(alvo)}.${carimbo}`);
  await fsp.writeFile(backup, anterior, "utf8");

  await fsp.writeFile(alvo, String(conteudo), "utf8");
  return {
    caminho: relativo(alvo),
    bytes: Buffer.byteLength(String(conteudo), "utf8"),
    backup: relativo(backup),
  };
}

/**
 * Apagar = mover para a Lixeira do macOS, nunca unlink. O rename so funciona no
 * mesmo volume; a home e a Lixeira do usuario estao no mesmo, entao serve.
 */
async function apagarArquivo({ caminho } = {}) {
  garantirRaiz();
  const alvo = resolverSeguro(caminho);
  recusarSeForIndice(alvo);
  if (alvo === RAIZ) throw new ErroArquivo("Nao da para apagar a raiz.", "FORA_DA_RAIZ");

  try {
    await fsp.stat(alvo);
  } catch (erro) {
    if (erro.code === "ENOENT") throw new ErroArquivo("Esse caminho nao existe.", "NAO_ENCONTRADO");
    throw erro;
  }

  const lixeira = path.join(os.homedir(), ".Trash");
  let destino = path.join(lixeira, path.basename(alvo));
  if (fs.existsSync(destino)) {
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    destino = path.join(lixeira, `${path.basename(alvo)}.${carimbo}`);
  }
  try {
    await fsp.rename(alvo, destino);
  } catch (erro) {
    throw new ErroArquivo(`Nao consegui mover para a Lixeira: ${erro.message}`, "FALHA_AO_APAGAR");
  }
  return { caminho: relativo(alvo), destino: "Lixeira" };
}

// ─────────────────────────────────────────────────────────────
// INDICE AUTOMATICO (JARVIS.md)
// ─────────────────────────────────────────────────────────────

/**
 * Assunto do arquivo, tirado do proprio conteudo: primeiro titulo markdown, ou
 * a primeira linha com texto. Sem IA — e instantaneo e nunca inventa.
 */
function extrairAssunto(conteudo) {
  const linhas = String(conteudo || "").split("\n");
  const titulo = linhas.find((l) => /^#{1,6}\s+\S/.test(l));
  const escolhida = titulo || linhas.find((l) => l.trim().length > 0) || "";
  return escolhida
    .replace(/^#{1,6}\s+/, "")
    .replace(/[|`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function dataCurta(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Reescreve o JARVIS.md de UMA pasta a partir do que existe nela agora.
 * Pasta sem arquivo proprio nao ganha indice, e o indice velho e removido.
 */
async function gerarIndiceDaPasta(dirAbs) {
  let entradas;
  try {
    entradas = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const arquivosDaPasta = [];
  const subpastas = [];

  for (const e of entradas) {
    if (e.name.startsWith(".") || e.name === NOME_INDICE) continue;
    if (e.isDirectory()) { subpastas.push(e.name); continue; }

    const abs = path.join(dirAbs, e.name);
    let info;
    try { info = await fsp.stat(abs); } catch (_) { continue; }

    let assunto = "";
    if (info.size <= MAX_BYTES) {
      try { assunto = extrairAssunto(await fsp.readFile(abs, "utf8")); } catch (_) { assunto = ""; }
    }
    arquivosDaPasta.push({
      nome: e.name,
      assunto: assunto || "(sem título)",
      criado: dataCurta(info.birthtime || info.mtime),
      alterado: dataCurta(info.mtime),
      tamanho: formatarTamanho(info.size),
    });
  }

  const indiceAbs = path.join(dirAbs, NOME_INDICE);

  if (!arquivosDaPasta.length && !subpastas.length) {
    await fsp.rm(indiceAbs, { force: true });
    return null;
  }

  const ehRaiz = path.resolve(dirAbs) === RAIZ;
  const rotulo = ehRaiz
    ? "do espaço de arquivos"
    : `da pasta \`${path.relative(RAIZ, dirAbs)}/\``;

  const linhas = [
    `# ${NOME_INDICE}`,
    "",
    `Índice ${rotulo}, mantido pelo Jarvis.`,
    "",
    "> Este arquivo é gerado automaticamente a cada ação confirmada e reescrito por",
    "> inteiro. Não edite à mão: a próxima geração descarta a alteração.",
    "",
    `Última geração: ${new Date().toLocaleString("pt-BR")}`,
    "",
  ];

  if (arquivosDaPasta.length) {
    linhas.push(`## Arquivos (${arquivosDaPasta.length})`, "");
    linhas.push("| Arquivo | Assunto | Criado | Alterado | Tamanho |");
    linhas.push("|---|---|---|---|---|");
    for (const a of arquivosDaPasta.sort((x, y) => x.nome.localeCompare(y.nome))) {
      linhas.push(`| \`${a.nome}\` | ${a.assunto} | ${a.criado} | ${a.alterado} | ${a.tamanho} |`);
    }
    linhas.push("");
  }

  if (subpastas.length) {
    linhas.push(`## Subpastas (${subpastas.length})`, "");
    for (const s of subpastas.sort()) {
      // Pasta vazia nao tem indice proprio: apontar para um arquivo que nao
      // existe seria pior que nao apontar.
      const temIndice = fs.existsSync(path.join(dirAbs, s, NOME_INDICE));
      linhas.push(
        temIndice
          ? `- \`${s}/\` (índice próprio em \`${s}/${NOME_INDICE}\`)`
          : `- \`${s}/\` (vazia)`
      );
    }
    linhas.push("");
  }

  await fsp.writeFile(indiceAbs, linhas.join("\n"), "utf8");
  return path.relative(RAIZ, indiceAbs);
}

/**
 * Regenera o indice da pasta afetada e o de cada ancestral ate a raiz: mexer em
 * "projetos/site/index.html" muda a contagem que aparece no indice da raiz.
 */
async function atualizarIndices(caminhoRelativo) {
  garantirRaiz();
  const alvoAbs = path.resolve(RAIZ, caminhoRelativo || ".");
  let dir = fs.existsSync(alvoAbs) && fs.statSync(alvoAbs).isDirectory() ? alvoAbs : path.dirname(alvoAbs);

  const gerados = [];
  while (dir.startsWith(RAIZ)) {
    if (fs.existsSync(dir)) {
      const gerado = await gerarIndiceDaPasta(dir);
      if (gerado) gerados.push(gerado);
    }
    if (path.resolve(dir) === RAIZ) break;
    dir = path.dirname(dir);
  }
  return gerados;
}

// ─────────────────────────────────────────────────────────────
// FERRAMENTAS EXPOSTAS AO MODELO
// ─────────────────────────────────────────────────────────────

const FERRAMENTAS = {
  listar_pasta: {
    executar: listarPasta,
    destrutiva: false,
    escreve: false,
    resumo: (a) => `Listar a pasta "${a.caminho || "."}"`,
    schema: {
      type: "function",
      function: {
        name: "listar_pasta",
        description:
          "Lista arquivos e pastas dentro do espaco de arquivos do usuario. Use antes de ler ou editar quando nao souber o nome exato.",
        parameters: {
          type: "object",
          properties: {
            caminho: { type: "string", description: 'Pasta relativa. Use "." para a raiz.' },
          },
          required: [],
        },
      },
    },
  },

  ler_arquivo: {
    executar: lerArquivo,
    destrutiva: false,
    escreve: false,
    resumo: (a) => `Ler o arquivo "${a.caminho}"`,
    schema: {
      type: "function",
      function: {
        name: "ler_arquivo",
        description: "Le o conteudo de um arquivo de texto do espaco de arquivos do usuario.",
        parameters: {
          type: "object",
          properties: {
            caminho: { type: "string", description: "Caminho relativo do arquivo, com extensao." },
          },
          required: ["caminho"],
        },
      },
    },
  },

  criar_arquivo: {
    executar: criarArquivo,
    destrutiva: false,
    escreve: true,
    resumo: (a) => `Criar o arquivo "${a.caminho}"`,
    schema: {
      type: "function",
      function: {
        name: "criar_arquivo",
        description:
          "Cria um arquivo de texto NOVO. Falha se ja existir um arquivo no caminho. Use quando o usuario pedir para escrever, anotar ou salvar algo.",
        parameters: {
          type: "object",
          properties: {
            caminho: { type: "string", description: 'Caminho relativo com extensao, ex: "notas/reuniao.md".' },
            conteudo: { type: "string", description: "Conteudo completo do arquivo." },
          },
          required: ["caminho", "conteudo"],
        },
      },
    },
  },

  editar_arquivo: {
    executar: editarArquivo,
    destrutiva: true,
    escreve: true,
    resumo: (a) => `Substituir o conteudo de "${a.caminho}"`,
    schema: {
      type: "function",
      function: {
        name: "editar_arquivo",
        description:
          "Substitui o conteudo INTEIRO de um arquivo que ja existe. Leia o arquivo antes para nao perder o que estava la.",
        parameters: {
          type: "object",
          properties: {
            caminho: { type: "string", description: "Caminho relativo do arquivo existente." },
            conteudo: { type: "string", description: "Novo conteudo completo do arquivo." },
          },
          required: ["caminho", "conteudo"],
        },
      },
    },
  },

  apagar_arquivo: {
    executar: apagarArquivo,
    destrutiva: true,
    escreve: true,
    resumo: (a) => `Mover "${a.caminho}" para a Lixeira`,
    schema: {
      type: "function",
      function: {
        name: "apagar_arquivo",
        description: "Move um arquivo ou pasta para a Lixeira do sistema. Use apenas quando o usuario pedir de forma explicita.",
        parameters: {
          type: "object",
          properties: {
            caminho: { type: "string", description: "Caminho relativo do que sera movido para a Lixeira." },
          },
          required: ["caminho"],
        },
      },
    },
  },
};

/**
 * Arvore resumida do espaco de arquivos, para injetar no system prompt.
 *
 * Sem isto o modelo inventa o caminho: pediu "apague teste-x.md" e ele mandou
 * "notas/teste-x.md", porque foi o padrao que ele mesmo usou ao criar antes.
 * A sandbox recusa o caminho errado, mas o usuario so ve a acao falhar. Ver a
 * lista real resolve na origem.
 */
async function arvoreResumida(maxItens = 60) {
  garantirRaiz();
  const linhas = [];

  async function andar(dir, prefixo, profundidade) {
    if (linhas.length >= maxItens || profundidade > 2) return;
    let entradas;
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      if (linhas.length >= maxItens) return;
      if (e.name.startsWith(".") || e.name === NOME_INDICE) continue;
      const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
      if (e.isDirectory()) {
        linhas.push(`${rel}/`);
        await andar(path.join(dir, e.name), rel, profundidade + 1);
      } else {
        linhas.push(rel);
      }
    }
  }

  await andar(RAIZ, "", 0);
  return linhas;
}

function schemasDasFerramentas() {
  return Object.values(FERRAMENTAS).map((f) => f.schema);
}

function existeFerramenta(nome) {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS, nome);
}

/** Texto curto que o front mostra no card de confirmacao. */
function resumirAcao(nome, args) {
  if (!existeFerramenta(nome)) return `Acao desconhecida "${nome}"`;
  try {
    return FERRAMENTAS[nome].resumo(args || {});
  } catch (_) {
    return nome;
  }
}

/** A ferramenta mexe no disco? Define se o indice sera regerado. */
function escreveNoDisco(nome) {
  return existeFerramenta(nome) ? FERRAMENTAS[nome].escreve === true : false;
}

function ehDestrutiva(nome) {
  return existeFerramenta(nome) ? FERRAMENTAS[nome].destrutiva : true;
}

/**
 * Executa a ferramenta. So o server chama, e so depois do clique do usuario.
 *
 * Quando a acao mexe no disco, o JARVIS.md da pasta e o dos ancestrais sao
 * regerados. Essa segunda escrita e efeito da MESMA confirmacao: o usuario
 * autorizou a acao, e o indice e derivado dela. O card avisa disso.
 *
 * Falha ao gerar indice nao derruba a acao: o arquivo do usuario ja esta no
 * lugar, e indice desatualizado e menos grave que acao reportada como erro
 * depois de ter dado certo.
 */
async function executarFerramenta(nome, args = {}) {
  if (!existeFerramenta(nome)) {
    throw new ErroArquivo(`Ferramenta desconhecida: ${nome}`, "FERRAMENTA_DESCONHECIDA");
  }

  const ferramenta = FERRAMENTAS[nome];
  const resultado = await ferramenta.executar(args);

  if (ferramenta.escreve) {
    try {
      resultado.indices = await atualizarIndices(resultado.caminho);
    } catch (erro) {
      console.error("[arquivos] Falha ao gerar o indice:", erro.message);
      resultado.indices = [];
    }
  }
  return resultado;
}

module.exports = {
  RAIZ,
  NOME_INDICE,
  garantirRaiz,
  atualizarIndices,
  resolverSeguro,
  arvoreResumida,
  schemasDasFerramentas,
  executarFerramenta,
  existeFerramenta,
  resumirAcao,
  ehDestrutiva,
  escreveNoDisco,
  ErroArquivo,
  EXTENSOES,
};
