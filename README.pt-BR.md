<div align="center">
  <img src="./dashboard/public/app-icon.png" width="96" height="96" alt="TokenTracker Plus Logo" />
  <h1>TokenTracker Plus (TT-plus)</h1>
  <p><strong>Acompanhe custos reais de tokens, topologia de sessões e velocidade de geração em 55 ferramentas de IA</strong></p>
  <p>
    <a href="./README.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.en.md">English</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <b>Português (BR)</b>
  </p>
</div>

> 💡 Este repositório é um fork estendido baseado em [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) (MIT). Objetivos: **100% local primeiro**, **cobrança pelo preço de tabela**, **análise por camadas de sessão** e **velocidade tok/s em tempo real**. Os direitos do upstream pertencem ao autor original; este fork também é MIT.

[✨ Recursos](#-recursos-principais) · [⚡ Início rápido](#-início-rápido) · [💰 Cobrança e heatmap](#-cobrança-e-heatmap) · [🔒 Privacidade](#-privacidade) · [📜 Guia para iniciantes](./docs/getting-started.zh-CN.md) · [❤️ Apoiar](./SPONSOR.md)

## ✨ Recursos principais

- 🔌 **55 ferramentas conectadas sem configuração** —— detecção automática dos logs locais de Claude Code, Codex, Cursor, Qoder, Kimi e mais. Sem login, sem chave de API, sem nuvem.
- 💰 **Modelos gratuitos avaliados pelo preço de tabela** —— rejeitamos a regra do upstream que zera rotas `-free`; o valor que você "pegou de graça" fica visível.
- ⚡ **Fluxo tok/s em milissegundos** —— duração por chunk e tokens de raciocínio separados, velocidade precisa por sessão.
- 🌲 **Topologia de sessões** —— sessão principal / subagentes / chamadas de ferramenta, para achar as operações caras.
- 📊 **Heatmap de 8 níveis (Lv0~Lv7)** —— incluindo o nível "Singularidade" para dias acima de 3 bilhões de tokens. 2D e 3D.
- 🏆 **65 conquistas + 17 títulos julgados offline** —— toasts estilo Steam, medalhas 3D, exportação de relatório em Canvas.
- 🪟 **Integração no Windows** —— bandeja do sistema, pet e widgets de cota; o instalador já embute o Node (sem build).
- 🌍 **Ranking global de modelos (zero configuração)** — lê direto o leaderboard oficial da Artificial Analysis: índice de inteligência, preços de entrada/saída/cache, contexto e velocidade de saída de 80+ modelos. Sem chave de API, cache local com atualização automática.
- 🎁 **Guia de benefícios dos provedores** — 53 serviços e clientes aproveitáveis de graça: créditos de boas-vindas, tiers gratuitos diários, cotas de longa duração e perks de check-in, com link de convite nos cartões com convite ativo e link oficial em todos eles, além da data de verificação e da página de origem em cada cartão, filtrável e pesquisável.
- 🔒 **100% local** —— grava apenas números; código e prompts nunca são salvos ou enviados.

## ⚡ Início rápido

**No Windows, sem build**: baixe o `TokenTracker-plus-Setup-v*.exe` em [Releases](https://github.com/01UNCLEDOG01/TokenTracker-Plus/releases) e instale. Para o primeiro contato, veja o [guia para iniciantes](./docs/getting-started.zh-CN.md) (em chinês).

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-Plus.git
cd TokenTracker-Plus
npm install
node bin/tracker.js   # 1ª execução: instala hooks, sincroniza e abre o Dashboard
node bin/tracker.js status   # estado das 55 ferramentas
node bin/tracker.js doctor   # diagnóstico
```

O dashboard local fica em `http://localhost:17680` no app do Windows (a CLI `serve` usa `7680` por padrão). A lista completa das 55 ferramentas está no [README em chinês](./README.md#-支持的-ai-工具列表55-款).

## 💰 Cobrança e heatmap

`custo = Σ(tokens × preço de tabela)`. Tarifas do LiteLLM + ajustes locais. Modelos sem preço público registram apenas tokens, sem inventar valores. O heatmap usa os quantis P30–P95 + nível Lv7 (≥ 3 bi de tokens/dia), em 8 níveis.

## 🔒 Privacidade

Só números (tokens, horários, nome do modelo, custo estimado) em `~/.tokentracker/`. Prompts, respostas e código nunca são salvos ou enviados. Cookies/chaves são necessários apenas em alguns cartões de cota — o núcleo funciona sem nada disso. Os cartões de cota do WorkBuddy (ambas as edições) só leem com o app desktop em execução (plano + créditos de recompensa diária).

## 📄 Licença

MIT. Agradecimento ao upstream [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker). Veja o [README em chinês](./README.md) para todos os detalhes.
