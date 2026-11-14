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
- 📊 **Heatmap de 8 níveis (Lv0~Lv7)** —— incluindo o nível "Singularidade" para dias acima de 3 bilhões de tokens. 2D e 3D. Com pelo menos 8 dias ativos na amostra, atingir P98.5 e superar P95 também resulta em Lv7.
- 🏆 **65 conquistas + 17 títulos julgados offline** —— toasts estilo Steam, medalhas 3D, exportação de relatório em Canvas. O mesmo navegador mantém o maior nível observado, inclusive na primeira exibição do cache; o uso e as proporções continuam mostrando os valores atuais medidos.
- 🪟 **Integração no Windows** —— bandeja do sistema, pet e widgets de cota; o instalador já embute o Node (sem build).
- 🌍 **Dois rankings globais de modelos** — Alterne entre inteligência da Artificial Analysis e ranking geral da AIHOT para comparar notas, preços de entrada/saída/cache, contexto e velocidade. Cada ranking tem cache próprio e fallback para um snapshot identificado. Métricas ausentes aparecem como “—”; zeros medidos continuam como zero. O ranking AIHOT vem do projeto open source AIHOT (aihot.news), de Kazik (数字生命卡兹克); agradecemos ao autor.
- 🎁 **Guia de benefícios dos provedores** — 53 serviços e clientes com créditos iniciais, benefícios diários/mensais, planos gratuitos e check-in. Cartões com campanhas ativas trazem convite; todos têm link oficial, data de verificação e fonte. A ordem A–Z usa o nome que vem primeiro entre o pinyin completo do nome chinês e a marca em inglês, com filtros, busca e marcação de resgate. Os lembretes são redefinidos à meia-noite de Pequim diariamente ou no primeiro dia de cada mês. Cartões com os dois ciclos têm marcações separadas; resgates únicos permanecem marcados. A página atualiza após a virada do dia ou suspensão, com migração das datas antigas.
- **Cotas e status dos serviços** — 35 fontes de cota/saldo. Em falhas temporárias, o Cursor usa um cache válido da mesma conta; credenciais expiradas continuam pedindo login. O OpenCode mostra o status oficial. WorkBuddy China e internacional mantêm saldos separados; o detalhe ao passar o mouse informa o primeiro dia de expiração no horário de Pequim e os créditos que expiram nesse dia, preservando decimais.
- **Detalhamento por velocidade do Codex** — Expanda um modelo para ver tokens medidos de Standard / Fast / Ultrafast e o custo completo de cada faixa, incluindo cache e contexto longo. Cartões de ferramentas e a visão de todos os modelos compartilham o cálculo; o total permanece consistente.
- **Escopo de uso e comparação somente leitura** — O indicador identifica dados locais ou da conta; o padrão é local. A comparação temporária exige nuvem configurada por você, login, sincronização ativa e leitura da nuvem disponível. Não muda preferências de envio e é redefinida ao trocar de conta ou desativar a sincronização.
- **Retenção de estatísticas e backup local** — Explore sessões locais das duas edições do Qoder, MiniMax, Devin e outras. Snapshots gzip leves preservam apenas estatísticas já coletadas após excluir a origem; não recuperam conversas não coletadas. Exporte `.ttbackup` nas configurações; a importação em outro PC mostra uma prévia e adiciona somente dados ausentes.
- 🔒 **100% local** —— grava apenas números; código e prompts nunca são salvos ou enviados.

- **Carregamento e modo escuro** — Respostas locais de sessões usam gzip negociado e reutilizam listas durante a reconstrução. O cache em disco usa E/S assíncrona, formato versionado e validade máxima de 24 horas; formatos antigos são reconstruídos automaticamente. A página mostra a data do snapshot e tenta atualizar em segundo plano. Textos, bordas e foco de teclado dos benefícios têm maior contraste. A inicialização serve a página antes da cópia do runtime e reparo das integrações; JS/CSS compartilhados são pré-comprimidos para transferência.
- **Coleta de uso em segundo plano** — As atualizações coletam uso local do DB/WAL do TRAE CN, sessões do OpenClaw sem sinais do plugin e Prime Agent. No Windows, leituras do TRAE usam uma breve proteção compartilhada durante gravações. Uso preenchido ou corrigido depois é reconciliado pela diferença, sem bloquear novos registros ou duplicar valores; a leitura na nuvem continua exigindo consentimento separado. Desde a atualização de 2026-09 do cliente Trae, o log local de requisições não registra mais campos de cache, então a taxa de acerto do TRAE CN é **estimada** a partir da sua taxa medida no mesmo modelo em outras fontes (os totais de tokens continuam medidos e o custo usa a mesma estimativa).

## ⚡ Início rápido

> **Pré-requisitos**: para executar a partir do código-fonte é preciso Node.js **20+**; fontes SQLite (opencode/zcode/loomy/trae etc.) exigem, além disso, Node.js **22.5+** (usa o `node:sqlite` nativo) ou a instalação do comando `sqlite3`. O instalador do Windows já embute o Node; o pacote universal para macOS também embute o Node e roda em Macs Apple silicon/Intel com macOS 13+.

**No Windows/macOS, sem build**: baixe em [Releases](https://github.com/01UNCLEDOG01/TokenTracker-Plus/releases) e instale — `TokenTracker-Setup.exe` no Windows; no macOS (Apple silicon / Intel), arraste o `TokenTracker-plus-1.26.0.dmg` para "Aplicativos". O build macOS não é assinado: se a primeira abertura avisar "não é possível verificar o desenvolvedor", clique com o botão direito → "Abrir", ou execute `xattr -cr /Applications/TokenTracker-plus.app`. Para o primeiro contato, veja o [guia para iniciantes](./docs/getting-started.zh-CN.md) (em chinês).

> 🍎 **Cliente nativo do macOS — build próprio do TT-Plus desde a 1.26.0**: mantém a forma nativa de menu bar em SwiftUI (binário universal, Apple silicon / Intel), com seis idiomas de interface (zh-CN / zh-TW / en / ja / ko / de); **local-first**, sem conta na nuvem, login ou telas de OAuth; o menu de páginas cobre as 13 páginas do fork e aceita deep links `tokentracker://open?path=`; sete pets de desktop embutidos (incluindo Gengxu 庚戌 / YeaCat 猫也); a verificação de atualização lê apenas as Releases deste repositório (asset `TokenTracker-plus-<version>.dmg`). Os widgets WidgetKit agora acompanham o pacote (resumo / mapa de calor / principais modelos / limites; assinatura ad-hoc + sandbox, sem App Group); a janela de cota e a cobertura completa dos 35 provedores de limites já estão incluídas nesta versão.

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-Plus.git
cd TokenTracker-Plus
npm install
node bin/tracker.js   # 1ª execução: instala hooks, sincroniza e abre o Dashboard
node bin/tracker.js status   # estado das 55 ferramentas
node bin/tracker.js doctor   # diagnóstico
```

O dashboard local fica em `http://localhost:17680` nos apps do Windows e macOS (a CLI `serve` usa `7680` por padrão). A lista completa das 55 ferramentas está no [README em chinês](./README.md#-支持的-ai-工具列表55-款).

## 💰 Cobrança e heatmap

`custo = Σ(tokens × preço de tabela)`. Tarifas do LiteLLM + ajustes locais. Modelos sem preço público registram apenas tokens, sem inventar valores. O heatmap usa os quantis P30 / P55 / P75 / P88 / P95 / P98.5 + nível Lv7 (≥ 3 bi de tokens/dia), em 8 níveis.

## 🔒 Privacidade

A coleta local dispensa conta e nuvem. Cartões de cota e saldo consultam seus provedores; rankings e status usam fontes públicas. A sincronização com nuvem própria exige configuração explícita. Veja a [política de privacidade](./docs/PRIVACY.md).

Só números (tokens, horários, nome do modelo, custo estimado) em `~/.tokentracker/`. Prompts, respostas e código nunca são salvos ou enviados. Cookies/chaves são necessários apenas em alguns cartões de cota — o núcleo funciona sem nada disso. Os cartões de cota do WorkBuddy (ambas as edições) só leem com o app desktop em execução (plano + créditos de recompensa diária).

## 📄 Licença

MIT. Agradecimento ao upstream [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker). Veja o [README em chinês](./README.md) para todos os detalhes.
