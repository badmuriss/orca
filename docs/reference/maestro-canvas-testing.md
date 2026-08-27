# Testar o Maestro Canvas

Este guia cobre a validação manual e automatizada do Maestro Canvas no desktop e no mobile.

## Preparação

Use a branch da feature e instale as dependências na raiz do repositório:

```bash
cd /home/badmuriss/Documents/orca
git switch badmuriss/maestro-canvas
pnpm install
```

## Teste manual no desktop

Inicie o Orca:

```bash
cd /home/badmuriss/Documents/orca
pnpm dev
```

No Linux, o processo pode encerrar após detectar uma sequência de falhas da GPU. Quando aparecer a mensagem de fallback, execute `pnpm dev` novamente. A segunda execução usa renderização por software.

Abra um projeto ou workspace e valide:

1. O ícone do Maestro é a primeira aba, fica fixo e não pode ser fechado.
2. O Canvas abre mesmo sem uma Harness Run.
3. O botão de criação oferece terminal normal e os agentes CLI disponíveis.
4. O menu de contexto do Canvas cria Terminal, Browser e annotation.
5. Terminal, Browser e Markdown aparecem renderizados dentro das janelas do Canvas.
6. Clicar no preview seleciona a janela, mas só `Focus` troca para a aba correspondente.
7. As janelas podem ser movidas e redimensionadas pelos controles visíveis.
8. Os conectores podem ser arrastados entre janelas. Links automáticos e sugeridos têm estados distintos.
9. Uma nova annotation cria um Markdown normal e permite editar conteúdo e cor depois da criação.
10. O scroll aplica zoom. `Shift+scroll` move na horizontal. `Ctrl+scroll`, ou `Command+scroll` no macOS, move na vertical.
11. O painel de progresso distingue concluído, ativo, pendente, bloqueado e próximo passo.

## Testes focados do desktop

Rode os testes unitários da superfície atual do Maestro:

```bash
cd /home/badmuriss/Documents/orca
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/maestro/MaestroWorkspaceBrowserPreview.test.tsx \
  src/renderer/src/components/maestro/MaestroWorkspaceContentPreview.test.tsx \
  src/renderer/src/components/maestro/MaestroWorkspaceWindow.test.tsx \
  src/renderer/src/components/maestro/maestro-workspace-window-layout.test.ts \
  src/renderer/src/components/maestro/useMaestroWorkspaceViewport.test.tsx \
  src/renderer/src/components/maestro/maestro-canvas-viewport.test.ts \
  src/renderer/src/components/maestro/maestro-tab.test.tsx \
  src/renderer/src/components/maestro/useMaestroWorkspaceRunProgress.test.tsx
```

Valide lint, formatação e whitespace nos arquivos principais:

```bash
cd /home/badmuriss/Documents/orca
pnpm exec oxfmt --check src/renderer/src/components/maestro tests/e2e/maestro-workspace-tab-canvas.spec.ts
pnpm exec oxlint src/renderer/src/components/maestro tests/e2e/maestro-workspace-tab-canvas.spec.ts
git diff --check
```

## E2E do desktop

O E2E precisa de um build criado com `--mode e2e`. Um build comum não expõe `window.__store` e faz os testes expirarem.

### Fluxo completo

Este comando prepara o runtime Electron, cria o build correto e executa toda a spec do Maestro com um worker:

```bash
cd /home/badmuriss/Documents/orca
ORCA_E2E_HEADLESS=1 pnpm run test:e2e -- \
  tests/e2e/maestro-workspace-tab-canvas.spec.ts \
  --workers=1 \
  --max-failures=1
```

### Iteração rápida

Crie o build uma vez:

```bash
cd /home/badmuriss/Documents/orca
pnpm exec electron-vite build --mode e2e
```

Depois rode apenas os cenários de Browser e conteúdo renderizado:

```bash
cd /home/badmuriss/Documents/orca
SKIP_BUILD=1 ORCA_E2E_HEADLESS=1 pnpm exec playwright test \
  tests/e2e/maestro-workspace-tab-canvas.spec.ts \
  --config tests/playwright.config.ts \
  --project=electron-headless \
  --grep '@mwc-browser' \
  --workers=1 \
  --max-failures=1
```

Capture todos os estados de refinamento visual com o mesmo build:

```bash
cd /home/badmuriss/Documents/orca
SKIP_BUILD=1 ORCA_E2E_HEADLESS=1 pnpm exec playwright test \
  tests/e2e/maestro-workspace-tab-canvas.visual.spec.ts \
  --config tests/playwright.config.ts \
  --project=electron-headless \
  --grep '@mwc-visual-refinement-composite' \
  --workers=1 \
  --max-failures=1
```

Os PNGs e o manifesto ficam em:

```text
.visual-evidence/maestro-workspace-tab-canvas/
```

Essa pasta é ignorada pelo Git. Inspecione os PNGs com uma ferramenta de visão antes de considerar uma mudança visual concluída.

## Teste manual no mobile

O mobile precisa do Orca desktop para fornecer o servidor RPC na porta `6768`.

No primeiro terminal, na raiz do repositório:

```bash
cd /home/badmuriss/Documents/orca
pnpm dev
lsof -nP -iTCP:6768 -sTCP:LISTEN
```

No segundo terminal:

```bash
cd /home/badmuriss/Documents/orca/mobile
pnpm install
pnpm start
```

Para compilar um development client nativo:

```bash
cd /home/badmuriss/Documents/orca/mobile
pnpm exec expo run:android
pnpm start --dev-client
```

No macOS com Xcode:

```bash
cd /home/badmuriss/Documents/orca/mobile
pnpm exec expo run:ios
pnpm start --dev-client
```

Faça o pareamento em `Settings > Mobile` no desktop. Use `ws://10.0.2.2:6768` no emulador Android. Em um aparelho físico, use `ws://<ip-do-desktop>:6768` e mantenha os dois dispositivos na mesma rede.

Depois do pareamento, abra um workspace no mobile e valide:

1. O Maestro aparece como rota fixa do workspace e não exige Harness Run.
2. O Canvas carrega Terminal, Browser, Markdown, annotations e links reais.
3. Pan, zoom, seleção, `Fit` e Inspector funcionam em telefone e tablet.
4. O handoff abre o Terminal ou Browser exato, sem criar uma cópia.
5. Estados vazio, indisponível e conteúdo populado continuam legíveis.

## Testes focados do mobile

Execute a partir de `mobile/`:

```bash
cd /home/badmuriss/Documents/orca/mobile
pnpm exec vitest run src/maestro/mobile-maestro-geometry.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

As evidências mobile existentes ficam em:

```text
.visual-evidence/maestro-mobile-canvas/
```

## Problemas comuns

- Todos os E2E expiram em `window.__store`: refaça `pnpm exec electron-vite build --mode e2e`.
- O desktop encerra após erros `GPU process isn't usable`: execute `pnpm dev` novamente para usar o fallback de software.
- O mobile não conecta no emulador Android: confirme `ws://10.0.2.2:6768` e verifique a porta com `lsof`.
- O mobile conecta, mas não mostra mudanças do processo principal: reinicie `pnpm dev`. O hot reload do Metro só atualiza o JavaScript mobile.
- O Browser aparece como `Capturing`: aguarde o primeiro frame. No E2E, espere `img[data-browser-page-id]` antes do screenshot.
