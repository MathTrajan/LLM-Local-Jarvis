# 🤖 Jarvis Chat — Assistente Virtual com Groq

Interface web de chat para o agente virtual **Jarvis**, com integração ao provedor **Groq**, sistema de fallback simplificado e design moderno dark-theme.

---

## 📁 Estrutura do Projeto

```
jarvis-chat/
├── backend/
│   ├── server.js              ← Servidor Express (entry point)
│   ├── agent.js               ← Lógica do agente + roteamento
│   ├── providers/
│   │   └── groq.js            ← Integração com Groq SDK
│   ├── .env                   ← Variáveis de ambiente (NÃO commite!)
│   ├── .env.example           ← Template das variáveis de ambiente
│   └── package.json
├── frontend/
│   ├── index.html             ← Página principal do chat
│   ├── css/
│   │   └── style.css          ← Estilos (dark theme)
│   └── js/
│       └── app.js             ← Lógica do frontend
├── .gitignore
└── README.md
```

---

## 🚀 Instalação e Execução

### Pré-requisitos

- **Node.js** v18+ → https://nodejs.org
- **npm** v8+ (incluído com o Node.js)
- Chaves de API válidas para OpenAI e/ou Google Gemini

---

### 1️⃣ Clone ou baixe o projeto

```bash
# Via git
git clone https://github.com/seu-usuario/jarvis-chat.git
cd jarvis-chat

# Ou extraia o ZIP baixado e entre na pasta
cd jarvis-chat
```

---

### 2️⃣ Configure as variáveis de ambiente

```bash
# Acesse a pasta do backend
cd backend

# Copie o arquivo de exemplo
cp .env.example .env
```

Abra o arquivo `.env` com seu editor e preencha as chaves:

```env
GROQ_API_KEY=SuaChaveGroqAqui
PORT=3000
AGENT_ROUTING_STRATEGY=auto
```

> ⚠️ **NUNCA** commite o arquivo `.env` no Git. Ele já está no `.gitignore`.

---

### 3️⃣ Instale as dependências

```bash
# Na pasta backend/
npm install
```

---

### 4️⃣ Inicie o servidor

```bash
# Modo produção
npm start

# Modo desenvolvimento (reinicia automaticamente ao salvar)
npm run dev
```

Acesse no navegador: **http://localhost:3000**

---

## 📄 Logs de Automação (Google Drive)

O Jarvis agora pode usar automaticamente arquivos `.txt` de logs como fonte primária para responder sobre:
- erros
- execuções
- status geral do ambiente
- saúde das automações

### Configuração recomendada (Google Drive API)

No `backend/.env`:

```env
GOOGLE_DRIVE_FOLDER_ID=1B3Hv1fTVAnU4MV2aYfiMqPT1BFq7pire
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account", ...}
```

Notas importantes:
- compartilhe a pasta do Drive com o e-mail da Service Account (permissão de leitura)
- os arquivos devem estar em formato `.txt`
- o Jarvis lê os logs mais recentes e injeta esse contexto automaticamente no chat

### Fallback local (Drive sincronizado no desktop)

Se preferir usar a pasta local sincronizada do Google Drive:

```env
LOG_LOCAL_DIR=C:\\caminho\\para\\pasta\\de\\logs
```

---

## 🔑 Onde obter as chaves de API

| Provedor | URL | Plano gratuito |
|----------|-----|----------------|
| OpenAI   | https://platform.openai.com/api-keys | Crédito inicial |
| Google Gemini | https://aistudio.google.com/app/apikey | Sim (gratuito) |

---

## ⚙️ Configurações Disponíveis

### Variáveis de Ambiente (`.env`)

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `OPENAI_API_KEY` | Chave da API OpenAI | — |
| `GEMINI_API_KEY` | Chave da API Gemini | — |
| `PORT` | Porta do servidor | `3000` |
| `AGENT_ROUTING_STRATEGY` | Estratégia de roteamento | `auto` |
| `OPENAI_MODEL` | Modelo OpenAI a usar | `gpt-4o-mini` |
| `GEMINI_MODEL` | Modelo Gemini a usar | `gemini-1.5-flash` |
| `ALLOWED_ORIGIN` | Origem CORS permitida | `*` |

### Estratégias de Roteamento

| Estratégia | Comportamento |
|------------|---------------|
| `auto` | Tenta OpenAI → fallback Gemini se falhar |
| `openai` | Sempre OpenAI → fallback Gemini |
| `gemini` | Sempre Gemini → fallback OpenAI |
| `round-robin` | Alterna entre os dois provedores |

---

## 🔒 Segurança

- ✅ Chaves de API lidas **exclusivamente** via variáveis de ambiente
- ✅ Chaves **nunca** aparecem no frontend ou logs
- ✅ Helmet.js para headers HTTP seguros
- ✅ Rate limiting: 30 mensagens/minuto por IP
- ✅ CORS configurável por origem
- ✅ Validação de input no backend
- ✅ `.gitignore` protegendo o `.env`

---

## 🌐 Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/chat` | Envia mensagem ao Jarvis |
| `GET`  | `/api/health` | Status dos provedores |
| `GET`  | `/api/info` | Informações do servidor |

### Exemplo de requisição `/api/chat`

```json
POST /api/chat
Content-Type: application/json

{
  "message": "Olá Jarvis, como vai?",
  "history": [],
  "options": {
    "strategy": "auto",
    "temperature": 0.7
  }
}
```

### Resposta

```json
{
  "text": "Olá! Estou funcionando perfeitamente...",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "usedFallback": false,
  "latencyMs": 847,
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

---

## 🖥️ Funcionalidades da Interface

- 💬 Chat em tempo real com histórico de conversa
- 🌙 Dark theme profissional inspirado em IA
- 📱 Design responsivo (desktop, tablet, mobile)
- ⚡ Indicador de qual provedor respondeu cada mensagem
- ↩️ Notificação visual quando fallback é ativado
- 🔄 Health check dos provedores na sidebar
- ⚙️ Controles de roteamento e temperatura em tempo real
- 🗑️ Botão para limpar conversa
- ⌨️ Enter para enviar, Shift+Enter para nova linha
- 📝 Suporte a Markdown nas respostas (código, tabelas, listas)
- 💡 Sugestões rápidas na tela inicial

---

## 🛠️ Dependências

### Backend
| Pacote | Versão | Uso |
|--------|--------|-----|
| `express` | ^4.18 | Servidor HTTP |
| `dotenv` | ^16.3 | Variáveis de ambiente |
| `openai` | ^4.28 | SDK oficial OpenAI |
| `@google/generative-ai` | ^0.7 | SDK oficial Gemini |
| `cors` | ^2.8 | Cross-Origin Resource Sharing |
| `helmet` | ^7.1 | Segurança HTTP |
| `express-rate-limit` | ^7.1 | Rate limiting |
| `nodemon` | ^3.0 | Auto-reload em desenvolvimento |

---

## 📋 Scripts disponíveis

```bash
npm start    # Inicia em produção
npm run dev  # Inicia com nodemon (desenvolvimento)
```

---

## 🔧 Troubleshooting

**Erro: "OPENAI_API_KEY não está definida"**
→ Verifique se o arquivo `.env` existe em `backend/` e se a chave está preenchida.

**Erro: "Cannot find module 'openai'"**
→ Execute `npm install` na pasta `backend/`.

**Chat não carrega no navegador**
→ Verifique se o servidor está rodando em http://localhost:3000

**Gemini retorna erro 429**
→ Limite de taxa atingido. Aguarde alguns minutos ou use estratégia `openai`.

---

## 📄 Licença

MIT License — Uso livre para fins educacionais e comerciais.
