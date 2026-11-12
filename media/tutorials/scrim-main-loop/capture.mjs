import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/tmp/brasa-playwright-browsers';
const { chromium } = await import(
  process.env.PILOT_PLAYWRIGHT_MODULE ||
    '/workspace/.onboarding/browser/node_modules/playwright-core/index.mjs'
);
const root = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.PILOT_BASE || 'http://127.0.0.1:4203';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Capture is restricted to the isolated local fixture.');
const fast = process.env.PILOT_FAST === '1';
const out = path.join(root, 'raw', fast ? 'rehearsal' : 'take');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PILOT_CHROME || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const options = {
  baseURL: base,
  viewport: { width: 1440, height: 720 },
  ignoreHTTPSErrors: true,
  timezoneId: 'America/Sao_Paulo',
  locale: 'pt-BR',
  permissions: ['clipboard-read', 'clipboard-write'],
  ...(fast ? {} : { recordVideo: { dir: out, size: { width: 1440, height: 720 } } }),
};
const adminCtx = await browser.newContext(options),
  viewerCtx = await browser.newContext(options);
const errors = [],
  requests = [],
  marks = [],
  perspectives = [];
let t0 = 0,
  admin,
  viewer,
  roomId;
const wait = (ms) => new Promise((r) => setTimeout(r, fast ? Math.min(ms, 50) : ms));
const seconds = () => Math.round((performance.now() - t0) / 10) / 100;
async function mark(id, title, description, role = 'admin') {
  const item = { id, title, description, role, time: seconds() };
  marks.push(item);
  perspectives.push({ time: item.time, role });
  console.log(`STEP ${item.time}s ${title}`);
}
async function showRole(role, title, description) {
  await mark(`view-${marks.length}`, title, description, role);
  await wait(3100);
}
async function focus(locator) {
  await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 45)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  await wait(500);
  const r = await locator.boundingBox();
  assert(r);
  await locator
    .page()
    .mouse.move(r.x + Math.min(r.width / 2, 110), r.y + r.height / 2, { steps: fast ? 1 : 16 });
  await wait(400);
}
async function click(locator) {
  await focus(locator);
  await locator.click({ delay: fast ? 0 : 110 });
  await wait(800);
}
async function type(locator, value) {
  await click(locator);
  await locator.pressSequentially(value, { delay: fast ? 0 : 65 });
  await wait(600);
}
async function state() {
  return await admin.evaluate(
    async (id) => (await (await fetch('/__test__/state?id=' + id)).json()).row.state,
    roomId,
  );
}
async function waitState(predicate) {
  for (let i = 0; i < 100; i++) {
    const s = await state();
    if (predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Expected room state was not reached');
}
for (const ctx of [adminCtx, viewerCtx]) {
  ctx.on('page', (p) => {
    p.setDefaultTimeout(15000);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) requests.push({ method: r.method(), path: u.pathname });
    });
  });
  await ctx.route('https://media.valorant-api.com/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname.split('/');
    const asset = path.join(root, 'raw', 'maps', pathname.at(-2) + '-' + pathname.at(-1));
    try {
      await route.fulfill({ path: asset, contentType: 'image/png' });
    } catch {
      await route.abort();
    }
  });
  await ctx.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const cursor = document.createElement('div');
      cursor.id = 'pilot-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      cursor.style.cssText =
        'position:fixed;left:18px;top:18px;width:24px;height:30px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px #0009)';
      cursor.innerHTML =
        '<svg width="24" height="30" viewBox="0 0 24 30"><path d="M2 2v23l6-6 5 9 4-2-5-9h9Z" fill="#fff6e8" stroke="#20180f" stroke-width="1.6"/></svg>';
      document.body.append(cursor);
      addEventListener(
        'mousemove',
        (e) => {
          cursor.style.left = e.clientX + 'px';
          cursor.style.top = e.clientY + 'px';
        },
        true,
      );
      addEventListener(
        'mousedown',
        () => {
          cursor.style.opacity = '.55';
        },
        true,
      );
      addEventListener(
        'mouseup',
        () => {
          cursor.style.opacity = '1';
        },
        true,
      );
    });
  });
}
let adminStop, viewerStop, adminVideo, viewerVideo;
try {
  const reset = await adminCtx.request.get(base + '/__test__/reset');
  assert.equal(reset.status(), 200);
  admin = await adminCtx.newPage();
  const adminCreated = performance.now();
  viewer = await viewerCtx.newPage();
  const viewerCreated = performance.now();
  await Promise.all([admin.goto('/'), viewer.goto('/')]);
  await Promise.all([
    admin.evaluate(() => document.fonts.ready),
    viewer.evaluate(() => document.fonts.ready),
  ]);
  t0 = performance.now();
  await mark(
    'inicio',
    'Criar uma scrim',
    'Da página inicial até os times e mapas prontos para jogar.',
  );
  await wait(3000);
  await click(admin.getByRole('link', { name: 'Entrar como admin', exact: true }).first());
  await mark(
    'login',
    'Entre como administrador',
    'Use uma conta que já foi liberada pela administração.',
  );
  await type(
    admin.getByRole('textbox', { name: 'E-mail', exact: true }),
    'organizador@brasa.example',
  );
  await type(admin.getByLabel('Senha', { exact: true }), 'local-test-password');
  await click(admin.getByRole('button', { name: 'Entrar', exact: true }));
  await admin.locator('.admin-create-form').waitFor();
  await wait(1400);
  await mark(
    'criar',
    'Dê um nome e escolha MD3',
    'Marque “Mostrar para espectadores” para publicar a sala.',
  );
  await type(admin.getByRole('textbox', { name: /^Nome da sala/ }), 'Brasa de Sexta — piloto');
  await click(admin.locator('fieldset[aria-label="Formato"] label').filter({ hasText: 'MD3' }));
  await click(admin.getByRole('checkbox', { name: /Mostrar para espectadores/ }));
  assert(await admin.getByRole('checkbox', { name: /Mostrar para espectadores/ }).isChecked());
  await wait(900);
  await click(admin.getByRole('button', { name: 'Criar scrim', exact: true }));
  await admin.waitForURL(/\/s\/[a-z0-9]+$/);
  roomId = new URL(admin.url()).pathname.split('/').at(-1);
  await admin.getByRole('heading', { name: 'Brasa de Sexta — piloto', exact: true }).waitFor();
  await wait(1400);
  await mark(
    'compartilhar',
    'Compartilhe o link da sala',
    'Copiar link p/ Discord entrega o endereço de acompanhamento.',
  );
  await click(admin.getByRole('button', { name: 'Copiar link p/ Discord', exact: true }));
  const link = await admin.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(link).pathname, '/s/' + roomId);
  await viewer.goto(link);
  await viewer.getByText('Você está acompanhando como espectador.', { exact: true }).waitFor();
  await wait(1300);
  await showRole(
    'viewer',
    'O espectador entra sem login',
    'O mesmo link abre a sala pública, sem controles de edição.',
  );
  assert.equal(await viewer.getByPlaceholder('Nick do jogador').count(), 0);
  await mark('jogadores', 'Adicione os dez jogadores', 'Digite cada nick e clique em Adicionar.');
  const names = ['Caio', 'Duda', 'Rafa', 'Alef', 'Isa', 'JP', 'Nando', 'Lucas', 'Luana', 'Bruno'];
  for (let i = 0; i < names.length; i++) {
    const input = admin.getByPlaceholder('Nick do jogador');
    await type(input, names[i]);
    await click(admin.getByRole('button', { name: 'Adicionar', exact: true }));
    await waitState((s) => s.players.length === i + 1);
    await wait(300);
  }
  await wait(1200);
  await mark(
    'equipes',
    'Forme duas equipes de cinco',
    'Sortear times distribui os dez jogadores entre as equipes.',
  );
  await click(admin.getByRole('button', { name: 'Sortear times', exact: true }));
  await waitState(
    (s) =>
      s.players.filter((p) => p.team === 'A').length === 5 &&
      s.players.filter((p) => p.team === 'B').length === 5,
  );
  // Replace the old value as a real keyboard edit, then blur to save.
  await click(admin.getByRole('textbox', { name: 'Nome do Time A', exact: true }));
  await admin
    .getByRole('textbox', { name: 'Nome do Time A', exact: true })
    .press('ControlOrMeta+A');
  await admin
    .getByRole('textbox', { name: 'Nome do Time A', exact: true })
    .pressSequentially('Brasa', { delay: fast ? 0 : 65 });
  await admin.keyboard.press('Tab');
  await waitState((s) => s.teams.A.name === 'Brasa');
  await click(admin.getByRole('textbox', { name: 'Nome do Time B', exact: true }));
  await admin
    .getByRole('textbox', { name: 'Nome do Time B', exact: true })
    .press('ControlOrMeta+A');
  await admin
    .getByRole('textbox', { name: 'Nome do Time B', exact: true })
    .pressSequentially('Carvão', { delay: fast ? 0 : 65 });
  await admin.keyboard.press('Tab');
  await waitState((s) => s.teams.B.name === 'Carvão');
  await mark(
    'capitaes',
    'Defina um capitão por equipe',
    'Clique em Capitão no jogador escolhido de cada time.',
  );
  for (const team of ['A', 'B'])
    await click(
      admin
        .locator(`[data-room-focus="team-${team}"]`)
        .getByRole('button', { name: 'Capitão', exact: true })
        .first(),
    );
  await waitState((s) => !!s.teams.A.captainId && !!s.teams.B.captainId);
  await viewer.locator('[data-room-focus="team-A"]').scrollIntoViewIfNeeded();
  await viewer.locator('[data-room-focus="team-A"] h2').filter({ hasText: 'Brasa' }).waitFor();
  await wait(1000);
  assert.equal(await viewer.locator('.roster li').count(), 10);
  await showRole(
    'viewer',
    'Os times aparecem para todos',
    'Nomes, equipes e capitães chegam ao espectador pela sala.',
  );
  await mark(
    'iniciar-veto',
    'Escolha quem começa o veto',
    'O vencedor do sorteio ou duelo escolhe quem começa.',
  );
  await click(admin.getByRole('button', { name: 'Começar veto', exact: true }));
  await waitState((s) => s.phase === 'veto');
  await admin.locator('.veto-now').waitFor();
  await wait(1100);
  const choices = [
    ['Corrode', 'Ban da Brasa'],
    ['Summit', 'Ban do Carvão'],
    ['Haven', 'Pick da Brasa'],
    ['DEFESA', 'Carvão escolhe o lado'],
    ['Lotus', 'Pick do Carvão'],
    ['ATAQUE', 'Brasa escolhe o lado'],
    ['Abyss', 'Segundo ban da Brasa'],
    ['Bind', 'Segundo ban do Carvão'],
    ['DEFESA', 'Lado do mapa decisivo'],
  ];
  for (let i = 0; i < choices.length; i++) {
    const [choice, title] = choices[i];
    await mark(
      'veto-' + i,
      title,
      i === 8
        ? 'O mapa restante é o decider. Escolha o lado inicial.'
        : 'Siga a equipe e a ação indicadas na tela.',
    );
    const before = (await state()).veto.length;
    await click(
      i === 3 || i === 5 || i === 8
        ? admin.getByRole('button', { name: new RegExp('começa .*' + choice) })
        : admin.getByRole('button', { name: choice, exact: true }),
    );
    await waitState((s) => s.veto.length > before);
    await wait(1200);
    if (i === 0) {
      await viewer.locator('.veto-now').waitFor();
      await viewer.locator('[data-room-focus="maps"]').scrollIntoViewIfNeeded();
      await showRole(
        'viewer',
        'O veto também chega ao público',
        'A escolha do administrador aparece na visão do telespectador.',
      );
    }
  }
  const final = await waitState((s) => s.phase === 'live' && s.maps.length === 3);
  await wait(1400);
  await mark(
    'pronta-admin',
    'Scrim pronta para jogar',
    'Times fechados, veto concluído e três mapas definidos.',
  );
  await admin.getByRole('tab', { name: 'Partida', exact: true }).click();
  await admin.locator('.match-awaiting').waitFor();
  await admin.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(2100);
  await admin.getByRole('tab', { name: 'Veto', exact: true }).click();
  await admin.getByText('Veto concluído', { exact: true }).waitFor();
  await admin.locator('.veto-now').scrollIntoViewIfNeeded();
  await wait(2000);
  await viewer.getByRole('tab', { name: 'Partida', exact: true }).click();
  await viewer.locator('.match-awaiting').waitFor();
  await viewer.locator('.map-tabs').scrollIntoViewIfNeeded();
  await wait(1200);
  await showRole(
    'viewer',
    'Todos podem acompanhar',
    'A partida fica aguardando a importação após o jogo.',
  );
  await wait(2400);
  assert(final.players.length === 10 && final.maps.length === 3);
  assert(final.maps.every((m) => m.rounds.length === 0));
  assert.equal(
    await viewer.getByRole('button', { name: 'Buscar customizada', exact: true }).count(),
    0,
  );
  assert.equal(await viewer.getByRole('button', { name: 'Adicionar', exact: true }).count(), 0);
  const finalRole = await viewer.evaluate(
    async (id) => (await (await fetch('/api/scrims/' + id)).json()).role,
    roomId,
  );
  const inspection = await admin.evaluate(
    async (id) => await (await fetch('/__test__/state?id=' + id)).json(),
    roomId,
  );
  const events = inspection.events;
  assert(events.every((e, i) => e.seq === i + 1));
  assert(!events.some((e) => e.type === 'match.import'));
  const stats = await admin.evaluate(async () => await (await fetch('/__test__/stats')).json());
  assert.equal(stats.blockedOutbound, 0);
  assert.deepEqual(errors, []);
  await admin.screenshot({ path: path.join(out, 'admin-final.png'), fullPage: true });
  await viewer.screenshot({ path: path.join(out, 'spectator-final.png'), fullPage: true });
  const duration = seconds();
  adminVideo = admin.video();
  viewerVideo = viewer.video();
  adminStop = performance.now();
  await adminCtx.close();
  viewerStop = performance.now();
  await viewerCtx.close();
  const files = fast ? {} : { admin: await adminVideo.path(), viewer: await viewerVideo.path() };
  const report = {
    base,
    sourceCommit: '212b94ac2c6e845d1b23010b47a913aa85d068fa',
    roomId,
    title: final.title,
    duration,
    marks,
    perspectives,
    files,
    timing: { adminCreated, viewerCreated, t0, adminStop, viewerStop },
    verification: {
      players: final.players.length,
      teams: {
        A: final.players.filter((p) => p.team === 'A').length,
        B: final.players.filter((p) => p.team === 'B').length,
      },
      captains: final.teams,
      maps: final.maps.map((m) => ({
        mapId: m.mapId,
        startingSide: m.startingSide,
        rounds: m.rounds.length,
      })),
      phase: final.phase,
      eventCount: events.length,
      eventTypes: events.map((e) => e.type),
      externalRequestsBlocked: stats.blockedOutbound,
      viewerHasEditingControls: false,
      errors,
    },
    requests,
  };
  await writeFile(path.join(out, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log(
    'COMPLETE ' + JSON.stringify({ duration, players: 10, maps: 3, events: events.length, errors }),
  );
} catch (e) {
  if (admin) await admin.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
  throw e;
} finally {
  await adminCtx.close().catch(() => {});
  await viewerCtx.close().catch(() => {});
  await browser.close();
}
