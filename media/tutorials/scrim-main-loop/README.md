# Piloto — criação completa de uma scrim

Vídeo instrucional solicitado pelo Caio: **do login até a scrim pronta para jogar**.
A importação pós-partida ficou fora deste piloto por escolha explícita. A captura
contínua está em velocidade normal e alterna admin/telespectador durante pausas,
sem omitir ações necessárias.

## Entrega

- Página de revisão: `/pilotos/criar-scrim.html`.
- MP4: `/pilotos/criar-scrim.mp4`, 1920×1080, 30 fps, aproximadamente **3min22s**.
- Capítulos, poster e alternativa textual acompanham o player.
- `evidence.json` registra tempos medidos, perspectivas e verificações da captura.
- [SPEC.md](SPEC.md): escopo e decisões. [STORYLINES.md](STORYLINES.md): forma escolhida.
- [REVIEW.md](REVIEW.md): revisão visual e limitações.

A página é um artefato de revisão independente. Não inclui integração do vídeo
na landing ou no portal administrativo e não altera os fluxos do aplicativo.

## O que foi gravado

1. Página inicial e login de uma conta autorizada fictícia.
2. Criação de **Brasa de Sexta — piloto**, MD3 e publicada para espectadores.
3. Cópia do link e abertura em outro contexto de navegador, sem login.
4. Cadastro dos dez jogadores, um por um.
5. Sorteio de duas equipes de cinco, nomes Brasa/Carvão e capitães.
6. Veto MD3 inteiro: bans, picks, lados e decider.
7. Três mapas definidos: Haven, Lotus e Sunset, aguardando importação.

A interface React, a API, as regras de domínio e as cinco migrações SQL são as
reais do commit-base `212b94a`. O banco é PGlite em memória; Auth, REST, Henrik e
Phoenix têm provedores locais de demonstração. A captura não acessa nem altera
Supabase, Vercel ou Henrik hospedados. Os nicks e a conta exibida são fictícios.

## Produção reproduzível

Requisitos: dependências de desenvolvimento do app instaladas, Node 22+ (24 foi
usado), Python 3, FFmpeg/FFprobe, Chromium e Playwright Core 1.58.2. O Hyperframes
está fixado em **0.9.39** e usa cache da tarefa, sem instalar pacotes no app.

`capture.mjs` aceita `PILOT_PLAYWRIGHT_MODULE` e `PILOT_CHROME` para outros caminhos.
Neste workspace, o módulo já existe em
`/workspace/.onboarding/browser/node_modules/playwright-core/index.mjs`.
O gravador Playwright também precisa de seu componente FFmpeg:

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/brasa-playwright-browsers \
  node /workspace/.onboarding/browser/node_modules/playwright-core/cli.js install ffmpeg
```

Na raiz do repositório:

```bash
# Compilar um cliente que se conecta apenas ao provedor local de gravação.
VITE_SUPABASE_URL=http://127.0.0.1:4203 \
VITE_SUPABASE_ANON_KEY=local-public-video-example \
  node node_modules/vite/bin/vite.js build --outDir /tmp/brasa-pilot-dist

python3 media/tutorials/scrim-main-loop/prepare-assets.py

# Manter este processo ativo; é exclusivamente uma fixture local.
PILOT_DIST=/tmp/brasa-pilot-dist PILOT_PORT=4203 \
  node node_modules/tsx/dist/cli.mjs media/tutorials/scrim-main-loop/capture-server.ts
```

Em outro terminal, depois de o servidor anunciar que está pronto:

```bash
# Ensaio de seletores e regras, sem gerar gravação.
PILOT_FAST=1 node media/tutorials/scrim-main-loop/capture.mjs
# Gravação em velocidade normal; reinicia somente o banco local antes de começar.
node media/tutorials/scrim-main-loop/capture.mjs
python3 media/tutorials/scrim-main-loop/assemble.py
python3 media/tutorials/scrim-main-loop/publish-assets.py
```

Em `media/tutorials/scrim-main-loop/project`:

```bash
../hf.sh check --json
../hf.sh snapshot --review
../hf.sh preview --background --port 4315
# Revisar frames e prévia antes da entrega.
npm run render
# Depois do render, na raiz do repositório:
python3 media/tutorials/scrim-main-loop/publish-assets.py \
  --video media/tutorials/scrim-main-loop/raw/criar-scrim.mp4
```

O wrapper aponta o Hyperframes para o Chromium existente e mantém caches,
histórico e estado dentro de diretórios graváveis da tarefa. Usa os parâmetros
oficiais `HYPERFRAMES_BROWSER_PATH`, `HYPERFRAMES_CACHE_DIR`,
`HYPERFRAMES_HISTORY_ROOT`, `HYPERFRAMES_EXTRACT_CACHE_DIR` e XDG; não altera `HOME`
nem o registro gerenciado de skills. `HYPERFRAMES_NO_TELEMETRY=1` fica ativo.
A CLI pode ser usada a partir das skills oficiais sem ativar um plugin na conta.

`assemble.py --reuse-media` recompõe só os rótulos sobre o mesmo master já
verificado. Os tempos de capítulos vêm da captura; o rótulo de sala pronta foi
ajustado para o primeiro quadro verificado de Partida, em 186.0 s.

`raw/`, o vídeo intermediário e os caches não entram no Git. Fontes OFL e o
copyright de GSAP acompanham as fontes editáveis. O MP4 otimizado e o poster são
os únicos artefatos visuais necessários ao player público.

## Verificar o player

Depois de publicar os assets e executar `npm run build`, na raiz do repositório:

```bash
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4320 --strictPort
# Em outro terminal:
node media/tutorials/scrim-main-loop/verify-player.mjs
```

O teste verifica metadados, seek/reprodução, capítulos, pausa, layout em 390/320 px
e ausência de chamadas à API. O Vite Preview e a Vercel suportam requisições Range;
o servidor simples de Python não é adequado para validar seek no MP4.

Medições do piloto: H.264 yuv420p, 6062 frames, 202.066667 s, 8.701.199 bytes,
sem áudio. A renderização Hyperframes levou cerca de 12min12s com GPU de software;
`delivery.json` contém o checksum do arquivo. Esse custo é de produção offline,
não de execução para quem assiste.
