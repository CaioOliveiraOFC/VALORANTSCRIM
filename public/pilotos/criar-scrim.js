const player = document.querySelector('#tutorial');
const list = document.querySelector('#chapters');
const controls = document.querySelector('#pilot-controls');
const toggle = document.querySelector('#toggle-play');
const position = document.querySelector('#video-position');
const clock = document.querySelector('#video-clock');
const fullscreen = document.querySelector('#fullscreen');
const frame = document.querySelector('.player');
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function updateControls() {
  toggle.textContent = player.paused ? 'Reproduzir' : 'Pausar';
  position.max = Number.isFinite(player.duration) ? player.duration : 203;
  position.value = player.currentTime;
  clock.textContent = `${formatTime(player.currentTime)} / ${formatTime(Number.isFinite(player.duration) ? player.duration : 202)}`;
}
function playOrPause() {
  if (player.paused) player.play().catch(() => updateControls());
  else player.pause();
}
controls.hidden = false;
player.controls = false;
player.tabIndex = 0;
toggle.addEventListener('click', playOrPause);
player.addEventListener('click', playOrPause);
player.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); playOrPause(); }
});
position.addEventListener('input', () => { player.currentTime = Number(position.value); });
for (const event of ['loadedmetadata', 'play', 'pause', 'timeupdate', 'seeked']) player.addEventListener(event, updateControls);
fullscreen.addEventListener('click', () => {
  if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {});
  else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
});
if (!frame.requestFullscreen && !player.webkitEnterFullscreen) fullscreen.hidden = true;
updateControls();
fetch('criar-scrim.chapters.json').then(response => {
  if (!response.ok) throw Error('chapters');
  return response.json();
}).then(data => {
  data.chapters.forEach(chapter => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const time = document.createElement('time');
    const label = document.createElement('span');
    button.type = 'button'; time.textContent = chapter.label; label.textContent = chapter.title;
    button.append(time, label); button.dataset.time = chapter.start;
    button.addEventListener('click', () => {
      player.currentTime = chapter.start;
      frame.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      player.play().catch(() => updateControls());
    });
    li.append(button); list.append(li);
  });
  player.addEventListener('timeupdate', () => {
    const nodes = [...list.querySelectorAll('button')];
    const current = nodes.findLastIndex(node => Number(node.dataset.time) <= player.currentTime + 0.1);
    nodes.forEach((node, index) => node.setAttribute('aria-current', String(index === current)));
  });
  document.querySelector('#duration').textContent = `${data.durationLabel} · gravação completa · sem narração`;
}).catch(() => { list.textContent = 'Assista pelo player acima ou acompanhe o passo a passo em texto.'; });
