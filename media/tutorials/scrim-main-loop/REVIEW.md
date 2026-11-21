# Revisão do piloto

## Escolhas

- Um exemplo completo em vez de montagem promocional ou duas telas simultâneas.
- Captura em velocidade normal; nenhuma ação de criação foi substituída por uma
  requisição de teste. Os pontos de troca para o telespectador ocorrem durante pausas.
- Sem narração ou música: piloto instrucional silencioso, com instruções e texto
  alternativo. A ausência de áudio é intencional; nenhum som foi ouvido ou avaliado.
- Material real do aplicativo e mapas, sem reconstruir a interface em motion graphics.
- Cores e fontes da Brasa; indicação funcional da perspectiva no canto superior.

## Verificações executadas

- Ensaio completo e gravação completa concluídos, sem erros JavaScript.
- Dez jogadores, cinco por equipe, capitães e três mapas definidos.
- Fase final `live`; nenhum round, K/D/A ou resultado importado inventado.
- 26 eventos locais com sequências contínuas. Nenhum `match.import`.
- Telespectador sem controles de edição; nenhum acesso de escrita a serviços hospedados.
- `Hyperframes check`: zero erros de lint, execução, layout, movimento e contraste.
- `snapshot --review`: folhas de beats, cortes e tamanho de celular inspecionadas.
- Oito frames adicionais: início, login, espectador inicial, jogadores, times,
  veto público, Partida administrativa e Partida pública.
- Revisão independente conforme a skill Hyperframes: nenhum P0/P1 restante.

## Correção feita

A primeira amostra em 189.4 s já mostrava Partida enquanto o rótulo ainda pedia o
lado do decider. O primeiro quadro de Partida foi conferido em 186.0 s e a legenda
**Scrim pronta para jogar** foi antecipada para esse ponto. O texto secundário do
cabeçalho também passou de 27 para 28 px.

## Avisos mantidos por decisão

- 24 avisos estruturais de lint: uma gravação contínua usa oito rótulos de papel e
  22 instruções cronometradas, geradas por um script. As recomendações de subdividir
  a timeline não correspondem a erro visual, de sincronização ou de execução.
- `film_silent` e informação `audio_none`: o piloto foi feito sem áudio. A própria
  página informa isso e oferece passo a passo escrito.

## Limites e próximo refinamento

O ponto mais fraco é ler a UI completa em um celular na vertical: a captura é de
um desktop. O player permite tela cheia e tem capítulos e texto; uma versão curta
para a landing pode usar recortes maiores ou uma captura própria de celular.
A fonte da gravação mostra o contador nativo “Jogadores sem time (10/10)” mesmo
após o sorteio: ele conta inscritos; essa redação pertence ao aplicativo e não foi
alterada para o vídeo.

## Arquivo exportado

- Renderização nativa Hyperframes 0.9.39 concluída em aproximadamente 12min12s,
  com três workers e captura por screenshot em GPU de software neste ambiente.
- FFprobe: H.264, yuv420p, 1920×1080, 30 fps, 6062 frames e 202.066667 segundos.
- Arquivo: 8.701.199 bytes (aproximadamente 8,7 MB), sem faixa de áudio.
- Decodificação integral por FFmpeg concluída sem erros.
- Frames extraídos do MP4 em 63.8 s e 186.3 s foram inspecionados: perspectiva
  pública sem edição e legenda de sala pronta sincronizada com Partida.
- Build completo da aplicação aprovado com os arquivos estáticos.
- A reprodução e os capítulos são testados no servidor Vite Preview, que oferece
  suporte a HTTP Range. O servidor simples de Python não permite esse teste de
  seek: ele responde 200 a pedidos parciais e o navegador volta ao início.

Os resultados do teste do player ficam em `player-verification.json`.

## Reprodução no navegador

Player validado em Vite Preview: metadados corretos, sete capítulos, seek por
botão, reprodução e pausa funcionando. Sem overflow em 390 e 320 px; alternativa
textual de sete passos disponível. Zero erros JavaScript, arquivos falhos ou
requisições à API durante a visita à página do piloto.

O player usa controles fora da imagem para que pausar não cubra a instrução
exibida no rodapé do vídeo. A checagem de seek espera o quadro ser decodificado
antes de capturar a evidência; mudar apenas `currentTime` ainda pode mostrar
o quadro anterior por alguns instantes.
