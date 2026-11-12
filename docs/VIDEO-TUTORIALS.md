# Vídeos de apresentação e tutoriais: viabilidade técnica

Avaliação de **12/11/2026**, vinculada ao [roadmap](ROADMAP.md). O pedido desta
etapa é guardar ideias e avaliar a ferramenta. Não inclui produzir os vídeos,
inserir players, mudar a interface ou publicar uma versão do site.

## Conclusão

**É tecnicamente viável usar Hyperframes para compor os vídeos da Brasa.** Ele
transforma HTML/CSS, animações e mídia em MP4/WebM. Capturas reais do aplicativo
podem receber recortes, zoom, indicações de clique e identificação de perspectiva.

Para a landing, a recomendação é **vídeo curto em loop com aparência de GIF**,
normalmente mais eficiente que GIF para gravações de interface. Para o portal de
administração, vídeos com controles, abertos por demanda na seção correspondente.
A escolha final de resolução, qualidade e tamanho depende de um piloto renderizado.

O Hyperframes participa da **produção dos arquivos**. Os visitantes recebem vídeo
HTML nativo e arquivos estáticos; não precisam carregar o editor, o renderizador
ou uma integração HeyGen. A renderização fica fora de Vercel Functions e do banco.

## Ferramenta e origem verificadas

- Repositório: [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes).
- Versão consultada e CLI executada: **0.9.39**; Node.js mínimo **22**.
- Licença do framework/pacote consultado: **Apache-2.0**.
- [Release oficial v0.9.39](https://github.com/heygen-com/hyperframes/releases/tag/v0.9.39).
- [Skill principal](https://github.com/heygen-com/hyperframes/blob/v0.9.39/skills/hyperframes/SKILL.md)
  e [skill CLI](https://github.com/heygen-com/hyperframes/blob/v0.9.39/skills/hyperframes-cli/SKILL.md).
- [Captura e scaffold](https://github.com/heygen-com/hyperframes/blob/v0.9.39/skills/hyperframes-cli/references/init-and-scaffold.md),
  [renderização](https://github.com/heygen-com/hyperframes/blob/v0.9.39/docs/guides/rendering.mdx)
  e [plugins](https://github.com/heygen-com/hyperframes/blob/v0.9.39/docs/guides/plugins.mdx).

O pacote oficial `hyperframes-agent-plugin.zip` foi baixado e seu SHA-256 conferido
contra o arquivo publicado na mesma release:

```text
55bed0c08d409b47739f80319f801f0fa9fa5e382df6afa816dea01542918f3b
```

O ZIP contém o manifesto `.codex-plugin/plugin.json`. Também foram extraídas as
seis skills do conjunto core com suas referências e licença, em uma pasta de
ferramentas do workspace, fora deste repositório. O download não equivale à
ativação de um plugin na conta do usuário: o diretório gerenciado de skills
`/workspace/.agents` é somente leitura neste ambiente. Nenhuma configuração da
conta foi alterada, e não há novos pacotes no `package.json` da aplicação.

A CLI foi obtida no cache temporário por versão explícita:

```bash
HYPERFRAMES_NO_TELEMETRY=1 npm exec \
  --cache /tmp/brasa-hyperframes-npm-cache --yes \
  --package=hyperframes@0.9.39 -- hyperframes --help

HYPERFRAMES_NO_TELEMETRY=1 npm exec \
  --cache /tmp/brasa-hyperframes-npm-cache --yes \
  --package=hyperframes@0.9.39 -- hyperframes doctor --json
```

Fixar uma versão permite repetir a avaliação; não garante a mesma versão de
Chrome entre máquinas. Para consistência visual, a produção deve fixar também
o navegador e manter fontes, imagens e gravações locais.

### Resultado da verificação do ambiente

| Item | Resultado observado |
| --- | --- |
| CLI | `hyperframes v0.9.39`; ajuda executada com sucesso |
| Node.js | `v24.19.0`, compatível com o mínimo 22 |
| FFmpeg | `7.1.5-0`, encontrado em `/usr/bin/ffmpeg` |
| FFprobe | `7.1.5-0`, encontrado em `/usr/bin/ffprobe` |
| Navegador | Chromium do sistema em `/usr/bin/chromium`, reconhecido pelo doctor |
| Recursos | CPU, memória, disco e `/dev/shm` aprovados pelo doctor |
| Dependências opcionais | Whisper, Kokoro e MusicGen não instalados; dispensáveis para a proposta inicial sem voz/música gerada |
| Render completo | **Não executado nesta avaliação**; duração, peso e qualidade dos vídeos ainda não medidos |

O `doctor` retorna `ok: false` no relatório geral por incluir as três ferramentas
opcionais ausentes. Os requisitos necessários ao fluxo básico foram encontrados.
O Chromium do sistema usa captura por screenshot; o caminho otimizado com
`chrome-headless-shell` é uma otimização futura, não um requisito para analisar
ou preparar as composições.

As verificações não substituem o piloto de captura, composição e exportação.
Não foi produzido um tutorial nem declarado sucesso de renderização.

## Dois tipos de vídeo

### Landing: entender rapidamente a proposta

- Proposta de duração: **6–15 segundos** por clipe, sem som por padrão.
- Mostrar uma ideia por vídeo: criar uma sala, preparar os times, acompanhar uma
  decisão ou importar o resultado. Não comprimir todos os passos num único GIF.
- Usar capturas do front-end real com dados de demonstração.
- Identificar **Visão do administrador** e **Visão do telespectador** no canto
  superior, em posição consistente e com contraste da identidade Brasa.
- Alternar a perspectiva para mostrar ação e consequência. Duas telas lado a
  lado podem ser avaliadas no desktop; texto minúsculo no celular não é aceitável.
- Oferecer pausa e imagem de capa. Com redução de movimento ou economia de dados,
  começar parado e permitir que a pessoa escolha reproduzir.

Exemplo de roteiro, ainda não produzido:

1. **Administrador:** prepara os times e confirma uma ação.
2. **Telespectador:** a mesma mudança aparece na sala pública.
3. Encerrar com a sala pronta para acompanhar e uma transição curta para o início.

Não mostrar placar manual, estatísticas inventadas, troféus ou transmissões ainda
não implementados como se fossem recursos já disponíveis. O X1 atual deve ser
identificado como demonstração quando aparecer.

### Administração: ajuda da seção atual

- Proposta de duração: **20–60 segundos**, ampliável se a tarefa exigir mais tempo.
- Ação **Ver como funciona** junto ao título da seção; abrir o tutorial certo com
  controles, em vez de iniciar um vídeo a cada navegação.
- Um vídeo por tarefa, com legendas/texto, ação principal destacada e resultado
  esperado. A pessoa deve conseguir usar o formulário sem assistir ao vídeo.
- Preservar o [guia HTML](../public/guia-admin.html) e o [PDF](../public/guia-admin.pdf)
  como alternativas completas e pesquisáveis.
- Identificar o tutorial por seção estável, não por busca do texto do título.
- Mostrar somente ajuda relevante às permissões do administrador atual.

Catálogo inicial sugerido, não uma entrega aprovada:

| Seção | Tutorial |
| --- | --- |
| Minhas salas | Criar, publicar e compartilhar uma sala |
| Times | Preparar os dez jogadores e organizar as equipes |
| Veto | Conduzir as etapas e acompanhar a escolha dos mapas |
| Partida / importação | Buscar por nick ou link, associar contas e confirmar a importação |
| Visibilidade e histórico | Entender publicação, ocultação e exclusão |
| Contas e permissões | Criar/suspender administradores e ajustar capacidades; ajuda do super admin |

Troféus, transmissões e X1 persistente entram no catálogo quando seus fluxos
reais estiverem implementados e validados.

## Pipeline proposto

1. **Roteirizar:** uma tarefa, resultado esperado, perspectiva e duração-alvo.
2. **Preparar dados:** sala local reproduzível e contas fictícias de teste;
   capturar administrador e espectador em contextos separados do navegador.
3. **Gravar as ações reais:** automação de navegador, como Playwright, executa os
   passos do aplicativo. Guardar o vídeo ou as capturas resultantes como mídia local.
4. **Compor no Hyperframes:** cortes, destaque de cursor/clique, zoom e rótulos
   entram numa timeline determinística, com fontes e cores da Brasa.
5. **Revisar a prévia:** verificar conteúdo, legibilidade, fidelidade ao site,
   recortes e identificação das perspectivas antes de exportar a entrega.
6. **Exportar e otimizar:** MP4 H.264 como base; WebM se o ganho justificar;
   poster WebP/AVIF e legendas WebVTT quando houver fala. GIF apenas se um uso
   específico realmente precisar dele, medindo o custo da conversão.
7. **Integrar depois:** player HTML nativo, carregamento por demanda e associação
   de cada tutorial à seção correta. Essa integração é outra etapa de implementação.

O comando `hyperframes capture <url>` captura um site como projeto editável com
screenshots e assets. Ele pode ajudar na apresentação pública, mas não comprova
uma jornada autenticada com cliques, importação e atualização de outro navegador.
Para esses tutoriais, a recomendação é gravar os passos reais e só então compor.
Não executar consultas de rede ou comandos da sala dentro da timeline de render.

Não gravar senhas, tokens, chaves, telas com segredos ou salas privadas reais.
Não alterar o Supabase hospedado para preparar uma gravação. Resultados e nomes
de demonstração devem continuar identificáveis como exemplos.

## Organização futura sugerida

```text
media/tutorials/              roteiros, composições, metadados e fontes de produção
public/tutorials/             exports pequenos/otimizados, posters e legendas
src/client/features/help/     futuro player e catálogo por seção
```

São caminhos propostos, ainda não criados. Evitar colocar gravações brutas grandes
no Git; escolher armazenamento de mídia se o catálogo crescer. Para poucos clipes
otimizados, arquivos estáticos na Vercel permitem começar sem um backend de vídeo.
O renderizador tem seu próprio ambiente Node 22+ e não muda o requisito de Node
da aplicação. Não adicionar FFmpeg/Chrome à execução de Vercel Functions.

Um catálogo deve registrar ID, seção, título, arquivo, poster, duração, versão do
site capturado e revisão. Mudanças de UI que deixem uma instrução obsoleta devem
sinalizar revisão do respectivo tutorial.

## Critérios do piloto, quando for solicitado

- Um clipe da landing e um tutorial administrativo, antes de produzir o catálogo.
- Capturas reais com dados fictícios, coerentes entre admin e telespectador.
- Rótulos e textos legíveis em desktop e celular, sem cobrir a ação principal.
- Reprodução, pausa, teclado, redução de movimento e alternativa textual válidos.
- Carregamento somente quando necessário; evitar baixar todos os vídeos ao abrir
  a landing ou o portal. Autoplay pode antecipar downloads, mesmo com `preload=none`.
- Medir duração, tamanho e decodificação do MP4/WebM, além de conferir frames
  exportados. Um orçamento inicial, ainda a validar, é até 2 MB por clipe curto.
- Registrar o roteiro, os comandos, os resultados e as limitações encontradas.

A produção local de HTML, capturas e render básico pode usar as ferramentas
abertas avaliadas. Serviços de geração de voz, avatar, música, templates Pro e
renderização hospedada têm condições próprias e não são necessários à proposta
inicial; nenhum plano pago foi contratado nesta avaliação.
