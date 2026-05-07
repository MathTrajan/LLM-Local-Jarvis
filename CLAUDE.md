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
|   |-- log-context.js
|   |-- log-ingest-store.js
|   |-- package.json
|   |-- .env.example
|   |-- .vercelignore
|   |-- public/
|   |   |-- index.html
|   |   |-- css/style.css
|   |   `-- js/app.js
|   `-- providers/
|       `-- groq.js
|-- frontend/
|   |-- index.html
|   |-- css/style.css
|   `-- js/app.js
`-- scripts/
    |-- Atualizacao_Pedidos_em_Carga_Jarvis.ps1
    `-- Atualizacao_Programacao_de_Pedidos_Jarvis.ps1
```

Observacao:

- `frontend/` continua como fonte de trabalho visual
- `backend/public/` e a estrutura usada para deploy no Vercel

Se houver nova mudanca no frontend, manter os arquivos de `backend/public` sincronizados.

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

```env
PORT=3000
AGENT_ROUTING_STRATEGY=auto
ALLOWED_ORIGIN=*

GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_1=llama-3.3-70b-versatile
GROQ_MODEL_2=llama-3.1-8b-instant

LOG_INGEST_ENABLED=true
LOG_INGEST_API_TOKEN=
LOG_INGEST_MAX_CONTEXT_EVENTS=60

DATABASE_URL=
# ou POSTGRES_URL=

GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_LOG_FOLDER_NAME=Log
GOOGLE_SERVICE_ACCOUNT_JSON=

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost

LOG_LOCAL_DIR=

LOG_CONTEXT_MAX_FILES=12
LOG_CONTEXT_MAX_BYTES_PER_FILE=60000
LOG_CONTEXT_MAX_CHARS=18000
```

### Scripts PowerShell no servidor Windows

```powershell
JARVIS_INGEST_URL
JARVIS_INGEST_API_TOKEN
```

Exemplo esperado em producao:

```powershell
[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_URL",
  "https://SEU-PROJETO.vercel.app/api/log-ingest",
  "Machine"
)

[Environment]::SetEnvironmentVariable(
  "JARVIS_INGEST_API_TOKEN",
  "SEU_TOKEN_AQUI",
  "Machine"
)
```

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

### Bloco 1 - Publicar a versao atual no GitHub

- [ ] revisar alteracoes locais
- [ ] confirmar arquivos que entram no commit
- [ ] commitar
- [ ] enviar para `origin`

### Bloco 2 - Criar deploy publico

- [ ] criar ou conectar projeto na Vercel apontando para `jarvis-chat-export/backend`
- [ ] instalar integracao Neon no projeto da Vercel
- [ ] configurar `DATABASE_URL` ou `POSTGRES_URL`
- [ ] configurar `GROQ_API_KEY_1`
- [ ] configurar `LOG_INGEST_API_TOKEN`
- [ ] fazer deploy
- [ ] validar `/api/health`, `/api/info` e `/api/logs-debug`

### Bloco 3 - Preparar servidor Windows

- [ ] configurar `JARVIS_INGEST_URL`
- [ ] configurar `JARVIS_INGEST_API_TOKEN`
- [ ] copiar os novos scripts `.ps1`
- [ ] executar manualmente uma rotina de teste
- [ ] confirmar que eventos chegam no Jarvis

### Bloco 4 - Validar o ciclo completo

- [ ] rodar automacao real
- [ ] confirmar ingestao no banco
- [ ] perguntar no chat sobre a automacao executada
- [ ] conferir se a resposta cita evidencias corretas

---

## Como Continuar a Partir Daqui

### Caminho recomendado

1. atualizar o GitHub com o estado atual do projeto
2. publicar o backend/frontend na Vercel
3. provisionar o Neon
4. configurar as env vars da Vercel
5. obter a URL publica final
6. apontar os scripts PowerShell para essa URL
7. iniciar os testes integrados

### O que nao fazer

- nao usar SQLite como banco principal na Vercel
- nao apontar os scripts para uma URL publica antes de definir o token
- nao confiar apenas nos `.txt` locais como estrategia final de producao

---

## Proximo Agente / Proxima Sessao Deve Saber

Se uma nova sessao continuar este projeto, assumir o seguinte:

- o objetivo atual nao e redesign visual, e publicacao operacional
- o frontend ja esta alinhado com observabilidade
- o backend ja foi preparado para Postgres
- o deploy alvo e **Vercel + Neon**
- o GitHub remoto ja existe
- os scripts PowerShell do servidor ja possuem versoes adaptadas ao Jarvis
- o proximo grande marco e:
  **subir no GitHub, publicar na Vercel, conectar Neon e testar ingestao real**

