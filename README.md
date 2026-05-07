# 🤖 J.A.R.V.I.S Chat — Assistente Virtual Inteligente

O **J.A.R.V.I.S** é um agente de IA de alto desempenho, desenvolvido para oferecer uma interface de chat moderna, rápida e intuitiva. O projeto utiliza uma arquitetura híbrida de modelos de linguagem (LLMs), permitindo alternância inteligente entre provedores para garantir a melhor resposta.

## 🚀 Demonstração Online
Confira o agente em execução: [https://jarvis-assistente.onrender.com](https://jarvis-assistente.onrender.com)

## ✨ Diferenciais do Projeto
* **Interface Premium:** Design Dark Mode responsivo com painel de controle lateral.
* **Roteamento Inteligente:** Integração nativa com **Groq** (para velocidade extrema).
* **Monitoramento em Tempo Real:** Status de conexão dos provedores visível na interface.
* **Configurações Customizáveis:** Controle de criatividade (temperatura) e troca de provedor via UI.
* **Backend Robusto:** Desenvolvido em Node.js com foco em baixa latência.

## 🛠️ Tecnologias Utilizadas
* **Frontend:** HTML5, CSS3 (Modern UI), JavaScript (ES6+).
* **Backend:** Node.js, Express.
* **IA:** Groq SDK, Google Generative AI SDK.
* **Deployment:** Render (Backend/Servidor), GitHub (Versionamento).

## 🔧 Como Rodar Localmente
1.  Clone o repositório:
    ```bash
    git clone https://github.com/MathTrajan/Jarvis-Chat-Assistente-Virtual-Inteligente.git
    ```
2.  Entre na pasta do backend:
    ```bash
    cd jarvis-chat-export/backend
    ```
3.  Instale as dependências:
    ```bash
    npm install
    ```
4.  Configure suas chaves no arquivo `.env`:
    ```env
    GROQ_API_KEY=sua_chave_aqui
    # GEMINI_API_KEY=sua_chave_aqui
    ```
5.  Inicie o servidor:
    ```bash
    npm start
    ```

---
💡 *Desenvolvido por **Matheus Trajano** — [LinkedIn](https://www.linkedin.com/in/matheus-trajano-5179a7378/)*