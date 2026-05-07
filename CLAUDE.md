# JARVIS - Documentacao de Continuidade

## Visao Geral

Jarvis e um agente de observabilidade para automacoes Windows.

Ele nao deve ser tratado como um chatbot generico. O papel do sistema e:

- receber logs estruturados das automacoes via HTTP ingest
- consultar eventos recentes e historico
- responder perguntas com base em evidencias reais de execucao
- ajudar a diagnosticar falhas, timeouts, erros e status operacionais

Quando o usuario pergunta algo como:

- "o que aconteceu com a automacao X?"
- "quais erros ocorreram hoje?"
- "qual foi a ultima execucao da rotina Y?"

Jarvis deve buscar contexto de logs antes de responder.

---

## Estado Atual do Projeto

Data de referencia desta atualizacao: **2026-05-07**

### O que ja foi feito

1. O frontend foi reposicionado para observabilidade.
   Antes: interface de assistente generico.
   Agora: interface focada em erros, execucoes, incidentes e contexto operacional.

2. O backend continua em Node.js + Express com Groq como unico provedor LLM.

3. O endpoint central da arquitetura continua sendo:
   `POST /api/log-ingest`

4. A persistencia de logs suporta dois modos:
   - `sqlite` local para desenvolvimento
   - `postgres` para producao serverless

5. O backend foi preparado para deploy publico em `Vercel + Neon`.

6. O backend serve os assets da interface a partir de:
   `backend/public`

7. O frontend de trabalho continua em:
   `frontend/`
   e foi espelhado para:
   - `backend/public/index.html`
   - `backend/public/css/style.css`
   - `backend/public/js/app.js`

8. Foi adicionada a dependencia:
   - `pg`

9. Foi criado:
   - `backend/.vercelignore`

10. O acesso a variaveis de ambiente foi centralizado em:
   - `jarvis-chat-export/backend/config.js`

11. Foram normalizados:
   - `server.js`
   - `agent.js`
   - `providers/groq.js`
   - `log-context.js`
   - `log-ingest-store.js`
   - `.env.example`
   - `README.md`

12. Existem scripts PowerShell operacionais adaptados ao Jarvis para uso local/servidor.
   Eles nao devem subir para o Git.

13. A pasta local `PowerShell/` foi revisada.
   - Todos os `Auto_Update_*.ps1` ja estavam com integracao Jarvis
   - `Gestor_Fila_Automacao.ps1` foi adaptado para o mesmo padrao de ingestao
   - A logica original de mutex, fila e execucao do script filho foi preservada

14. A selecao de contexto por automacao no chat foi corrigida.
   - Antes: a busca tentava usar a pergunta inteira como filtro textual
   - Efeito colateral: quando nao encontrava correspondencia, Jarvis caia nos eventos mais recentes e tendia a responder sempre sobre a mesma automacao
   - Agora: `log-ingest-store.getPromptContext()` detecta a automacao mencionada usando `automation` e `meta.script`
   - Quando encontra correspondencia, prioriza eventos daquela automacao
   - O retorno do chat agora pode incluir `contextInfo.focusAutomation`

15. Validacao local da correcao de foco por automacao foi concluida.
   - pergunta sobre `Programacao de Pedidos` retornou foco em `Programacao_de_Pedidos`
   - pergunta sobre `Pedidos em Carga` retornou foco em `Pedidos_em_Carga`

---

## Stack Atual

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| LLM | Groq API |
| Persistencia local | SQLite via `node:sqlite` |
| Persistencia producao | Postgres via `pg` |
| Banco recomendado em producao | Neon Postgres |
| Logs historicos | Google Drive ou pasta local |
| Frontend | HTML/CSS/JS puro |
| Deploy publico | Vercel |

---

## Estrutura de Arquivos Relevante

```text
jarvis-chat-export/
|-- backend/
|   |-- server.js
|   |-- agent.js
|   |-- config.js
|   |-- log-context.js
|   |-- log-ingest-store.js
|   |-- package.json
|   |-- .env.example
|   |-- .vercelignore
|   |-- public/
|   |   |-- index.html
|   |   |-- css/style.css
|   |   `-- js/app.js
|   |-- providers/
|   |   `-- groq.js
|   `-- data/
|       `-- jarvis-logs.db
|-- frontend/
|   |-- index.html
|   |-- css/style.css
|   `-- js/app.js
|-- PowerShell/                <- pasta operacional local, nao versionar
`-- .gitignore
```

Observacoes:

- `frontend/` continua como fonte de trabalho visual
- `backend/public/` e a estrutura usada para deploy no Vercel
- `backend/config.js` centraliza a leitura de env vars
- `PowerShell/` existe localmente para copiar scripts ao servidor Windows
- `jarvis-chat-export/scripts/` e `PowerShell/` sao areas operacionais locais e nao devem subir para o Git

---

## Fluxo de Operacao do Jarvis

```text
Usuario envia pergunta
        |
        v
POST /api/chat
        |
        v
agent.processMessage()
        |
        +--> tenta contexto de ingestao em tempo real
        |    via log-ingest-store.getPromptContext()
        |
        +--> se necessario, complementa com log-context.js
        |    - Google Drive
        |    - pasta local
        |
        `--> monta prompt com contexto operacional
             e envia para Groq
```

### Fontes de contexto

1. `HTTP ingest`
   Fonte prioritaria para eventos em tempo real.
   O backend tenta detectar a automacao citada pelo usuario e focar nela.

2. `Google Drive`
   Historico ou fallback de logs `.txt`.

3. `Pasta local`
   Alternativa local para leitura de `.txt`.

---

## Comportamento Atual do Chat

- Se a pergunta mencionar uma automacao como `Programacao de Pedidos` ou `Pedidos em Carga`, Jarvis deve priorizar eventos dessa automacao
- A deteccao usa o campo `automation` e tambem `meta.script` dos eventos ingeridos
- Se nenhuma automacao for identificada, Jarvis usa busca textual geral
- Se ainda assim nao houver foco claro, Jarvis cai nos eventos mais recentes
- Se nao existir evidencia suficiente, a resposta correta e declarar que nao encontrou isso nos logs disponiveis

---

## Persistencia de Logs

### Ambiente local

Se `DATABASE_URL` e `POSTGRES_URL` estiverem vazios:

- Jarvis usa SQLite local
- arquivo padrao:
  `backend/data/jarvis-logs.db`

### Ambiente de producao

Se `DATABASE_URL` ou `POSTGRES_URL` existir:

- Jarvis usa Postgres
- `/api/info` e `/api/logs-debug` devem indicar `postgres`

### Motivo

Vercel nao e um ambiente adequado para persistencia duravel em SQLite local.
Por isso o deploy publico deve usar `Neon Postgres`.

---

## Variaveis de Ambiente Criticas

Todas as variaveis sao lidas via `config.js`:

- `getEnvString(name, fallback)`
- `getEnvBoolean(name, fallback)`
- `getEnvInt(name, fallback)`
- `parseJsonEnv(name)`
- `normalizeLocalDirPath(path)`

```env
# Servidor
PORT=3000
AGENT_ROUTING_STRATEGY=auto
ALLOWED_ORIGIN=*

# Groq
GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_1=llama-3.3-70b-versatile
GROQ_MODEL_2=llama-3.1-8b-instant

# HTTP ingest
LOG_INGEST_ENABLED=true
LOG_INGEST_API_TOKEN=troque-por-um-token-seguro
LOG_INGEST_MAX_CONTEXT_EVENTS=60

# Banco
DATABASE_URL=postgresql://user:password@host/db?sslmode=require

# Fallback local
LOG_LOCAL_DIR=G:\Meu Drive\Log
```

---

## Scripts Operacionais

### Regras

- nao alterar a logica principal das automacoes
- nao versionar scripts operacionais no Git
- manter o `.txt` local
- manter a saida no console
- acumular eventos estruturados
- enviar o lote para `POST /api/log-ingest` no final

### Variaveis no servidor Windows

```powershell
[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_URL",
  "https://jarvis-observability.vercel.app/api/log-ingest",
  "Machine"
)

[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_API_TOKEN",
  "<token-do-backend>",
  "Machine"
)
```

---

## Estado do Deploy

- Projeto alvo documentado: `jarvis-observability`
- URL alvo documentada: `https://jarvis-observability.vercel.app`
- O estado real do deploy precisa sempre ser revalidado antes de testes externos
- Confirmar sempre:
  - `/api/health`
  - `/api/info`
  - `/api/logs-debug`

---

## Proximos Passos

1. Validar a correcao de foco por automacao no ambiente publico
2. Confirmar se o banco em producao esta em `postgres`
3. Testar ingestao real a partir do servidor Windows
4. Perguntar no chat por automacoes diferentes e confirmar `contextInfo.focusAutomation`
5. Ajustar casos de alias adicionais se surgirem nomes de automacao muito diferentes entre pergunta e log

---

## Cuidados

- nao subir scripts operacionais para o Git
- nao usar SQLite como banco principal na Vercel
- nao apontar scripts para URL publica sem token definido
- nao confiar so em `.txt` local como historico de producao
- nao deixar `LOG_INGEST_API_TOKEN` vazio

