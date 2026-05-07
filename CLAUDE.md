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

Data de referencia desta atualizacao: **2026-05-07 — Fim do dia**

### O que ja foi feito

1. O frontend foi reposicionado para observabilidade.
   Antes: interface de assistente generico.
   Agora: interface focada em erros, execucoes, incidentes e contexto operacional.

2. O backend continua em Node.js + Express com Groq como unico provedor LLM.

3. O endpoint de ingestao de logs via HTTP continua sendo o centro da arquitetura:
   `POST /api/log-ingest`

4. A camada de persistencia de logs foi preparada para dois modos:
   - `sqlite` local para ambiente local
   - `postgres` para producao serverless

5. O projeto foi adaptado para deploy publico em **Vercel + Neon**.
   Isso foi necessario porque SQLite local nao e adequado para producao em Vercel.

6. O backend foi ajustado para servir assets publicos a partir de:
   `backend/public`

7. O frontend atual foi espelhado para:
   - `backend/public/index.html`
   - `backend/public/css/style.css`
   - `backend/public/js/app.js`

8. Foi adicionada a dependencia:
   - `pg`

9. O arquivo de ignorados para deploy foi criado:
   - `backend/.vercelignore`

10. Foram criados scripts PowerShell adaptados ao Jarvis:
   - `jarvis-chat-export/scripts/Atualizacao_Pedidos_em_Carga_Jarvis.ps1`
   - `jarvis-chat-export/scripts/Atualizacao_Programacao_de_Pedidos_Jarvis.ps1`

11. Esses scripts mantem a rotina original de negocio, mas agora:
   - continuam gravando log `.txt`
   - continuam exibindo log no console
   - acumulam eventos estruturados
   - enviam os eventos ao Jarvis via HTTP ingest

12. O script de Programacao de Pedidos foi preparado para ler:
   - `JARVIS_INGEST_URL`
   - `JARVIS_INGEST_API_TOKEN`
   como variaveis de ambiente do Windows

13. **[NOVO - 2026-05-07 FINAL]** Centralizado e normalizado TODO acesso a variaveis de ambiente:
   - Criado `jarvis-chat-export/backend/config.js` com helpers: `getEnvString()`, `getEnvBoolean()`, `getEnvInt()`, `parseJsonEnv()`, `normalizeLocalDirPath()`
   - Atualizado `server.js`: removidos duplicados de `getEnvString/getEnvBoolean`, agora importa de `config.js`
   - Atualizado `agent.js`: usa `getEnvString()` para `AGENT_ROUTING_STRATEGY` (evita `auto\r\n`)
   - Atualizado `providers/groq.js`: normaliza chaves e modelos Groq
   - Atualizado `log-context.js`: centraliza leitura de todas as vars de Google Drive e local
   - Atualizado `log-ingest-store.js`: normaliza `DATABASE_URL`, `POSTGRES_URL`, `LOG_INGEST_API_TOKEN`
   - Atualizados `.env.example` e `README.md` com instrucoes de Neon + ingestao HTTP

14. **[NOVO - 2026-05-07 FINAL]** Projeto ja esta em producao publico:
   - URL: `https://jarvis-observability.vercel.app`
   - Projeto Vercel: `jarvis-observability`
   - Banco: ainda sem Neon configurado (proxima etapa)
   - Frontend: ja no ar
   - Backend: ja no ar
   - Endpoints validados: `/api/health`, `/api/info`, `/api/logs-debug` retornam 200

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
|   |-- server.js                ← Servidor Express (normalizado)
|   |-- agent.js                 ← Lógica do agente (normalizado)
|   |-- config.js                ← [NOVO] Helpers centralizados de env vars
|   |-- log-context.js           ← Google Drive + fallback local (normalizado)
|   |-- log-ingest-store.js      ← HTTP ingest + Postgres/SQLite (normalizado)
|   |-- package.json
|   |-- .env                      ← Local (não commitado)
|   |-- .env.example              ← Template atualizado com Neon + ingestão
|   |-- .vercelignore
|   |-- public/
|   |   |-- index.html
|   |   |-- css/style.css
|   |   `-- js/app.js
|   |-- providers/
|   |   `-- groq.js              ← Normalizado
|   `-- data/
|       `-- jarvis-logs.db        ← SQLite local (quando nao há Neon)
|-- frontend/
|   |-- index.html
|   |-- css/style.css
|   `-- js/app.js
|-- scripts/
|   |-- Atualizacao_Pedidos_em_Carga_Jarvis.ps1
|   `-- Atualizacao_Programacao_de_Pedidos_Jarvis.ps1
`-- .gitignore
```

Observacoes:

- `frontend/` continua como fonte de trabalho visual
- `backend/public/` e a estrutura usada para deploy no Vercel
- `backend/config.js` e novo e centraliza TODA leitura de env vars
- Todos os modulos do backend foram atualizados para usar `config.js`

---

## Fluxo de Operacao do Jarvis

### Fluxo principal por requisicao

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

1. **HTTP ingest**
   Fonte prioritaria para eventos em tempo real.

2. **Google Drive**
   Historico ou fallback de logs `.txt`.

3. **Pasta local**
   Alternativa local para leitura de `.txt`.

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
- o modo retornado por `/api/info` e `/api/logs-debug` deve indicar `postgres`

### Motivo da mudanca

Vercel nao e um ambiente adequado para persistencia duravel em SQLite local.
Por isso o deploy publico deve usar **Neon Postgres**.

---

## Variaveis de Ambiente Criticas

### Backend

Todas as variaveis sao agora lidas via `config.js`:
- `getEnvString(name, fallback)` — lê e trim automatico
- `getEnvBoolean(name, fallback)` — parse de true/false
- `getEnvInt(name, fallback)` — parse de numero
- `parseJsonEnv(name)` — parse de JSON
- `normalizeLocalDirPath(path)` — normaliza barras Windows

```env
# Servidor
PORT=3000
AGENT_ROUTING_STRATEGY=auto
ALLOWED_ORIGIN=*

# Groq (provedor LLM)
GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_1=llama-3.3-70b-versatile
GROQ_MODEL_2=llama-3.1-8b-instant

# HTTP Ingest (modo principal de logs)
LOG_INGEST_ENABLED=true
LOG_INGEST_API_TOKEN=jarvis_ingest_token_2026_change_me
LOG_INGEST_MAX_CONTEXT_EVENTS=60

# Persistencia em Producao (Vercel + Neon)
DATABASE_URL=postgresql://user:password@host:5432/db
# ou POSTGRES_URL=postgresql://...

# Persistencia Local (desenvolvimento)
# LOG_DB_FILE=C:\\jarvis-data\\jarvis-logs.db

# Google Drive (fallback de logs)
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_LOG_FOLDER_NAME=Log
GOOGLE_SERVICE_ACCOUNT_JSON=

# Google OAuth (alternativa a Service Account)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost

# Logs Locais (fallback)
LOG_LOCAL_DIR=G:\\Meu Drive\\Log

# Tamanho de contexto
LOG_CONTEXT_MAX_FILES=12
LOG_CONTEXT_MAX_BYTES_PER_FILE=60000
LOG_CONTEXT_MAX_CHARS=18000
```

### Scripts PowerShell no servidor Windows

```powershell
# Configurar variaveis de ambiente da maquina (Machine)
[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_URL",
  "https://jarvis-observability.vercel.app/api/log-ingest",
  "Machine"
)

[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_API_TOKEN",
  "jarvis_ingest_token_2026_change_me",
  "Machine"
)

# Verificar se foram setadas corretamente
Get-ChildItem Env:JARVIS*
```

### Importante

- Todas as variaveis sao automaticamente trimmed em `config.js`
- Isso previne erros como `auto\r\n` em `AGENT_ROUTING_STRATEGY`
- Tokens com espacos extras sao rejeitados corretamente
- Em producao (Vercel), usar o painel de variaveis de ambiente do projeto

---

## Endpoints da API

| Metodo | Endpoint | Funcao |
|---|---|---|
| POST | `/api/chat` | conversa operacional com o Jarvis |
| GET | `/api/health` | status do provedor LLM |
| POST | `/api/log-ingest` | ingestao de logs estruturados |
| GET | `/api/logs/query` | consulta protegida de eventos |
| GET | `/api/logs-debug` | diagnostico de fonte de logs e ingestao |
| GET | `/api/info` | configuracao atual do backend |

---

## Frontend Atual

O frontend ja foi ajustado para o conceito correto do produto.

### O que ele comunica agora

- sistema operacional
- fonte ativa de logs
- modo de log
- total de eventos
- ultimo evento conhecido
- cards de perguntas operacionais

### O que ele deixou de comunicar

- perguntas genericas sobre IA
- exemplos de codigo aleatorios
- temas sem relacao com automacoes

---

## Scripts PowerShell Integrados

### 1. Pedidos em Carga

Arquivo:
`jarvis-chat-export/scripts/Atualizacao_Pedidos_em_Carga_Jarvis.ps1`

### 2. Programacao de Pedidos

Arquivo:
`jarvis-chat-export/scripts/Atualizacao_Programacao_de_Pedidos_Jarvis.ps1`

### Comportamento esperado desses scripts

- nao alteram a rotina principal de negocio
- continuam gerando `.txt`
- agrupam logs em memoria
- enviam lote final para o Jarvis
- incluem campos estruturados:
  - `automation`
  - `level`
  - `message`
  - `runId`
  - `status`
  - `errorCode`
  - `tags`
  - `meta`

### Observacao importante

Antes de copiar os scripts para o servidor de automacao, o Jarvis publico precisa existir e o token precisa estar configurado.

---

## GitHub

O projeto ja existe no GitHub.

Remote identificado localmente:

```text
origin
https://github.com/MathTrajan/Jarvis-Chat-Assistente-Virtual-Inteligente.git
```

### Situacao atual

- o repositorio local possui alteracoes nao publicadas
- antes do deploy na Vercel, essas alteracoes precisam ser revisadas e enviadas ao GitHub

### Passos recomendados para atualizar o GitHub

1. revisar `git status`
2. revisar `git diff`
3. adicionar apenas os arquivos corretos
4. fazer commit com mensagem clara
5. fazer `git push origin main`

---

## Deploy Recomendado

### Plataforma

- **Vercel** para hospedagem publica do backend e frontend
- **Neon** para banco Postgres serverless

### Motivo

Essa combinacao e a melhor opcao para o desenho atual do projeto:

- Vercel hospeda Express publicamente
- Neon resolve a persistencia dos logs em producao
- o frontend estatico pode ser servido via `public/`
- os scripts Windows conseguem enviar logs para uma URL publica

### Referencia operacional

- Vercel recebe o backend e a UI
- Neon armazena `log_events`
- Groq continua sendo o provedor LLM
- o servidor Windows roda as automacoes e envia logs para a URL publica do Jarvis

---

## O que falta fazer agora

### Bloco 1 - Publicar alteracoes no GitHub

- [ ] revisar `git status` (alteracoes criadas na sessao)
- [ ] revisar `git diff` (comparar mudancas)
- [ ] adicionar arquivos relevantes:
  - `jarvis-chat-export/backend/config.js` (novo)
  - `jarvis-chat-export/backend/server.js` (atualizado)
  - `jarvis-chat-export/backend/agent.js` (atualizado)
  - `jarvis-chat-export/backend/providers/groq.js` (atualizado)
  - `jarvis-chat-export/backend/log-context.js` (atualizado)
  - `jarvis-chat-export/backend/log-ingest-store.js` (atualizado)
  - `jarvis-chat-export/backend/.env.example` (atualizado)
  - `jarvis-chat-export/README.md` (atualizado)
  - `CLAUDE.md` (documentacao)
- [ ] fazer commit com mensagem clara:
  ```
  feat: normalize environment variables and add centralized config helper
  
  - Created config.js for centralized env var reading (trim, parse, normalize)
  - Updated all backend modules to use config helpers
  - Prevents \r\n in AGENT_ROUTING_STRATEGY and other env vars
  - Adds proper parsing for DATABASE_URL/POSTGRES_URL for Neon
  - Updated .env.example with Neon and ingest configuration
  - Updated README with Vercel + Neon deployment guide
  ```
- [ ] fazer `git push origin main`

### Bloco 2 - Conectar Neon em Vercel

- [ ] acessar painel Vercel do projeto `jarvis-observability`
- [ ] ir em Settings > Environment Variables
- [ ] adicionar variavel `DATABASE_URL`:
  - valor: string de conexao Neon (formato: `postgresql://user:password@host/db`)
- [ ] adicionar variavel `LOG_INGEST_API_TOKEN`:
  - valor: `jarvis_ingest_token_2026_change_me` (ou um token seguro)
- [ ] confirmar que as variaveis existentes estao presentes:
  - `GROQ_API_KEY_1`
  - `GROQ_API_KEY_2` (opcional, mas recomendado)
  - `AGENT_ROUTING_STRATEGY`
- [ ] fazer redeploy do projeto (Vercel faz automaticamente ao reconhecer mudancas no GitHub, ou manualmente)

### Bloco 3 - Validar endpoints em producao

Apos o redeploy, testar via browser ou curl:

```bash
# Verificar se API esta ativa
curl https://jarvis-observability.vercel.app/api/health

# Verificar configuracao e modo de persistencia
curl https://jarvis-observability.vercel.app/api/info

# Verificar diagnostico de logs (deve indicar "postgres" como modo)
curl https://jarvis-observability.vercel.app/api/logs-debug
```

Esperado:
- `/api/info` deve retornar `logs.mode = "postgres"`
- `/api/health` deve retornar `groq: true`
- `/api/logs-debug` deve mostrar banco como Postgres

### Bloco 4 - Preparar servidor Windows

- [ ] abrir PowerShell como Administrador
- [ ] configurar variavel de ambiente:
  ```powershell
  [Environment]::SetEnvironmentVariable(
    "JARVIS_INGEST_URL",
    "https://jarvis-observability.vercel.app/api/log-ingest",
    "Machine"
  )
  ```
- [ ] configurar token:
  ```powershell
  [Environment]::SetEnvironmentVariable(
    "JARVIS_INGEST_API_TOKEN",
    "jarvis_ingest_token_2026_change_me",
    "Machine"
  )
  ```
- [ ] reiniciar a maquina OU reabrir PowerShell para carregar as variaveis
- [ ] copiar scripts PowerShell atualizados para a pasta de automacao:
  - `jarvis-chat-export/scripts/Atualizacao_Pedidos_em_Carga_Jarvis.ps1`
  - `jarvis-chat-export/scripts/Atualizacao_Programacao_de_Pedidos_Jarvis.ps1`
- [ ] executar manualmente um dos scripts para teste

### Bloco 5 - Testar ciclo completo de ingestao

1. Executar script no servidor Windows
2. Monitorar saida do script (deve indicar que enviou eventos para Jarvis)
3. Acessar `https://jarvis-observability.vercel.app`
4. No chat, perguntar sobre a automacao que acabou de rodar
5. Confirmar que:
   - O Jarvis recuperou os eventos do banco Postgres
   - A resposta cita evidencias (horario, mensagem, runId, etc.)
   - O contexto de logs aparece na resposta

### Bloco 6 - Agendamento em Producao (opcional, apos validacao)

Quando tudo estiver validado:
- [ ] atualizar Agendador de Tarefas Windows para apontar os novos scripts
- [ ] confirmar que os horarios ja estao configurados corretamente
- [ ] monitorar a primeira execucao agendada
- [ ] validar eventos chegando em tempo real no Jarvis

---

## Como Continuar a Partir Daqui

### Caminho recomendado (prioridade)

1. **Commit + Push no GitHub** (5 min)
   - fazer git add dos arquivos corretos
   - fazer commit com mensagem descritiva
   - fazer git push origin main
   
2. **Conectar Neon em Vercel** (10 min)
   - adicionar `DATABASE_URL` no painel da Vercel
   - redeploy automatico (Git) ou manual (Deploy button)
   
3. **Validar endpoints** (5 min)
   - testar `/api/info`, `/api/health`, `/api/logs-debug`
   - confirmar modo postgres
   
4. **Preparar servidor Windows** (10 min)
   - configurar variaveis de ambiente (JARVIS_INGEST_URL, token)
   - copiar scripts atualizados
   
5. **Testar ciclo completo** (15 min)
   - executar script manualmente
   - conversar com Jarvis sobre a automacao
   - validar evidencias nos eventos

### O que nao fazer

- nao usar SQLite como banco principal na Vercel (sempre Neon)
- nao apontar scripts para URL publica sem token definido
- nao confiar apenas nos `.txt` locais como persistencia de producao
- nao esquecer de fazer trim em env vars (config.js ja faz)
- nao deixar `LOG_INGEST_API_TOKEN` vazio em producao

---

## Proximo Agente / Proxima Sessao Deve Saber

Se uma nova sessao continuar este projeto, assumir o seguinte:

### Estado da Arquitetura

- o objetivo atual NAO e redesign visual, e **operacionalizar o ciclo de observabilidade**
- o frontend ja esta alinhado com observabilidade (mostra fonte de logs, status, eventos)
- o backend ja foi preparado para Postgres via Neon
- todas as variaveis de ambiente sao centralizadas em `backend/config.js`
- o deploy ja esta ativo em `https://jarvis-observability.vercel.app`

### Stack confirmado

- **Backend**: Node.js + Express + Groq
- **Persistencia local**: SQLite (arquivo `backend/data/jarvis-logs.db`)
- **Persistencia producao**: Postgres (Neon)
- **HTTP Ingest**: ativado, pronto para receber logs estruturados
- **Fallback de logs**: Google Drive ou pasta local (configuravel)

### GitHub

- repositorio remoto: `https://github.com/MathTrajan/Jarvis-Chat-Assistente-Virtual-Inteligente.git`
- branch: `main`
- projeto Vercel conectado automaticamente

### Proximo Grande Marco

**Integrar Neon em Vercel e testar ingestao real via servidor Windows**

Checklist:
- [ ] GitHub atualizado com config.js e normalizacoes
- [ ] Neon criado e conectado em Vercel via DATABASE_URL
- [ ] /api/info mostra logs.mode = "postgres"
- [ ] /api/logs-debug retorna 200 com eventos Postgres
- [ ] Servidor Windows configurado com JARVIS_INGEST_URL e token
- [ ] Scripts PowerShell testados manualmente
- [ ] Primeiro ciclo de ingestao validado

### Consideracoes de Segurança

- LOG_INGEST_API_TOKEN deve ser um valor seguro em producao (nao exemplo padrao)
- Trocar o token exemplo "jarvis_ingest_token_2026_change_me" antes de usar em ambiente real
- GROQ_API_KEY_1 e GROQ_API_KEY_2 nunca devem aparecer em logs ou frontend
- Tokens sao validados em getEnvString() - extras whitespace causa rejeicao

