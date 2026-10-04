/**
 * Smoke test da indice JARVIS.md.
 *
 * Aponta JARVIS_ARQUIVOS_RAIZ para /tmp ANTES de carregar arquivos.js: o modulo
 * le a raiz uma vez, na importacao. Por isso a pasta real do usuario nunca e
 * tocada por este script.
 *
 * Rodar: npm run testar
 */
process.env.JARVIS_ARQUIVOS_RAIZ = "/tmp/jarvis-indice-teste";
const fs = require("fs");
const path = require("path");
fs.rmSync("/tmp/jarvis-indice-teste", { recursive: true, force: true });

const a = require("../arquivos.js");

let passou = 0, falhou = 0;
const ok = (n, c) => c ? (passou++, console.log(`  ok   ${n}`)) : (falhou++, console.log(`  FALHA ${n}`));
async function recusa(nome, fn, codigo) {
  try { await fn(); falhou++; console.log(`  FALHA ${nome} (deixou passar)`); }
  catch (e) {
    if (!codigo || e.codigo === codigo) { passou++; console.log(`  ok   ${nome} -> ${e.codigo}`); }
    else { falhou++; console.log(`  FALHA ${nome} (codigo ${e.codigo})`); }
  }
}
const ler = (p) => fs.readFileSync(path.join(a.RAIZ, p), "utf8");

(async () => {
  a.garantirRaiz();

  console.log("\n== indice nasce com o primeiro arquivo ==");
  await a.executarFerramenta("criar_arquivo", { caminho: "bolo.md", conteudo: "# Bolo de cenoura\ningredientes..." });
  ok("JARVIS.md criado na raiz", fs.existsSync(path.join(a.RAIZ, "JARVIS.md")));
  let idx = ler("JARVIS.md");
  ok("lista o arquivo", idx.includes("`bolo.md`"));
  ok("extraiu o titulo markdown", idx.includes("Bolo de cenoura"));
  ok("nao lista a si mesmo", !idx.includes("`JARVIS.md`"));
  ok("tem data de geracao", /Última geração:/.test(idx));

  console.log("\n== subpasta ganha indice proprio e a raiz aponta para ela ==");
  await a.executarFerramenta("criar_arquivo", { caminho: "receitas/torta.md", conteudo: "# Torta de limao\nmassa..." });
  ok("indice da subpasta existe", fs.existsSync(path.join(a.RAIZ, "receitas/JARVIS.md")));
  ok("indice da subpasta lista torta", ler("receitas/JARVIS.md").includes("`torta.md`"));
  ok("indice da subpasta diz o nome da pasta", ler("receitas/JARVIS.md").includes("da pasta `receitas/`"));
  idx = ler("JARVIS.md");
  ok("raiz lista a subpasta", idx.includes("`receitas/`"));
  ok("raiz aponta para o indice da subpasta", idx.includes("receitas/JARVIS.md"));

  console.log("\n== titulo sem heading cai na primeira linha ==");
  await a.executarFerramenta("criar_arquivo", { caminho: "lista.txt", conteudo: "\n\ncomprar pao\noutra linha" });
  ok("usou a primeira linha com texto", ler("JARVIS.md").includes("comprar pao"));

  console.log("\n== edicao atualiza o assunto no indice ==");
  await a.executarFerramenta("editar_arquivo", { caminho: "bolo.md", conteudo: "# Bolo de chocolate\nnovo" });
  idx = ler("JARVIS.md");
  ok("assunto novo aparece", idx.includes("Bolo de chocolate"));
  ok("assunto antigo sumiu", !idx.includes("Bolo de cenoura"));

  console.log("\n== apagar remove do indice ==");
  await a.executarFerramenta("apagar_arquivo", { caminho: "lista.txt" });
  ok("saiu do indice", !ler("JARVIS.md").includes("`lista.txt`"));

  console.log("\n== JARVIS.md e protegido ==");
  await recusa("editar o indice", () => a.executarFerramenta("editar_arquivo", { caminho: "JARVIS.md", conteudo: "x" }), "ARQUIVO_RESERVADO");
  await recusa("apagar o indice", () => a.executarFerramenta("apagar_arquivo", { caminho: "JARVIS.md" }), "ARQUIVO_RESERVADO");
  await recusa("criar indice em subpasta", () => a.executarFerramenta("criar_arquivo", { caminho: "receitas/JARVIS.md", conteudo: "x" }), "ARQUIVO_RESERVADO");

  console.log("\n== indice fica fora do que o modelo enxerga ==");
  const listado = await a.executarFerramenta("listar_pasta", { caminho: "." });
  ok("listar_pasta esconde o indice", !listado.itens.some((i) => i.nome === "JARVIS.md"));
  const arvore = await a.arvoreResumida();
  ok("arvore do prompt esconde o indice", !arvore.some((l) => l.includes("JARVIS.md")));
  ok("arvore mostra os arquivos reais", arvore.includes("bolo.md") && arvore.includes("receitas/torta.md"));

  console.log("\n== pasta que fica vazia perde o indice ==");
  await a.executarFerramenta("apagar_arquivo", { caminho: "receitas/torta.md" });
  ok("indice da subpasta removido", !fs.existsSync(path.join(a.RAIZ, "receitas/JARVIS.md")));

  console.log(`\nRESULTADO: ${passou} ok, ${falhou} falha(s)`);
  console.log("\n--- JARVIS.md da raiz ---\n");
  console.log(ler("JARVIS.md"));
  process.exit(falhou ? 1 : 0);
})();
