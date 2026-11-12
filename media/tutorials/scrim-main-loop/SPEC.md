# Piloto: criar uma scrim do início ao fim

- Objetivo: ensinar uma criação real até a scrim estar pronta para jogar.
- Público: organizador que já possui uma conta autorizada; espectador acompanha sem login.
- Escopo escolhido pelo Caio: login → criação → 10 jogadores → times 5v5 → veto completo → sala pronta e visão do espectador. Sem importação pós-partida.
- Exemplo único: **Brasa de Sexta — piloto**, MD3, equipes **Brasa** e **Carvão**.
- Fontes: interface React e API reais do commit-base `212b94a`; Postgres/Phoenix/Auth locais e dados fictícios. Nenhuma escrita nos serviços hospedados.
- Forma: gravação integral em velocidade normal, com alternância de perspectiva durante pausas da organização. Nenhuma ação necessária é omitida ou realizada por endpoints de teste.
- Duração: determinada pela execução humana simulada, estimada em 2–4 minutos; sem acelerar a digitação ou ocultar o veto.
- Quadro: 1920×1080, 30 fps. Gravação 1440×720 exibida numa área de 1680×840; textos editoriais de 32–42 px. Arquivo final H.264 yuv420p.
- Som: piloto instrucional sem narração, coerente com o uso silencioso/estilo GIF discutido; instruções na tela e alternativa textual. Não adicionar música ou contratar serviços de voz.
- Cores: carvão `#100f0e`, ferro `#1d1a17`, brasa `#ff7a18`, dourado `#f1c67c`, marfim `#f4ece0`.
- Fontes: Barlow Condensed 600/700 e Source Sans 3 400, arquivos do próprio site com licença OFL.
- Layout: tela real ocupa o quadro; faixa superior reserva o título e **Visão do administrador / Visão do telespectador**. Faixa inferior explica a ação atual sem cobrir controles.
- Movimento: cursor e cliques reais da automação; rótulos estáveis durante a leitura. Sem fades de tela que escondam ações, marketing sobreposto, partículas, mockup reconstruído ou zoom contínuo.
- Limite do piloto: gravação de desktop; em celular, permitir tela cheia/rotação para ler os controles. Não declarar que a UI completa é legível a 360 px sem ampliação.

## Jornada e critérios

1. Abrir a Brasa e entrar na área administrativa com conta fictícia; senha sempre mascarada.
2. Preencher nome, escolher MD3, marcar a publicação e criar a sala.
3. Copiar o link público e abrir outra sessão como espectador, sem autenticar.
4. Voltar ao admin, adicionar os dez jogadores um por um e formar duas equipes de cinco.
5. Nomear equipes, definir capitães e demonstrar o estado atualizado ao espectador.
6. Escolher quem começa o veto e executar os dez passos MD3 com os mapas/lados da interface.
7. Mostrar a sala pronta no admin e no espectador, com três mapas definidos e **Aguardando importação**. Nenhum placar ou K/D/A inventado.

As durações e os capítulos finais devem vir do log medido da gravação. Validar 10 jogadores, 5 por equipe, três mapas, fase `live`, eventos sequenciais, espectador sem controles e ausência de requisições externas de escrita.
