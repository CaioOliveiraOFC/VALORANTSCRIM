/** Rode na raiz do repositório APÓS copiar os arquivos deste pacote. */
import { readFileSync, writeFileSync } from 'node:fs';

function replace(path, from, to) {
  const before = readFileSync(path, 'utf8');
  if (to && before.includes(to)) return;
  if (!before.includes(from)) throw new Error(`Trecho original não encontrado em ${path}: ${from.slice(0, 80)}`);
  writeFileSync(path, before.replace(from, to));
  console.log(`Atualizado: ${path}`);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.scripts.dev = 'npx --yes vercel@64.4.0 dev';
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
replace('tsconfig.json', '"include": ["src", "vite.config.ts"]', '"include": ["src", "api", "vite.config.ts"]');
replace('vite.config.ts',
  `const API = \`http://localhost:\${process.env.PORT ?? 8787}\`;\n\n`,
  '');
replace('vite.config.ts',
  `  server: {\n    proxy: {\n      '/api': API,\n      '/ws': { target: API.replace('http', 'ws'), ws: true },\n    },\n  },\n`,
  '');
replace('src/shared/scrim.ts', 'export const MAX_PLAYERS = 12;', 'export const MAX_PLAYERS = 10;');
replace('src/shared/scrim.ts',
  `      assert(e.team === null || isTeam(e.team), 'Time inválido.');\n      return {`,
  `      assert(e.team === null || isTeam(e.team), 'Time inválido.');\n      if (e.team !== null) {\n        const count = s.players.filter((p) => p.team === e.team && p.id !== e.playerId).length;\n        assert(count < 5, 'Este time já possui cinco jogadores.');\n      }\n      return {`);
replace('src/shared/scrim.ts',
  `      assert(Array.isArray(e.A) && Array.isArray(e.B), 'Times inválidos.');`,
  `      assert(Array.isArray(e.A) && Array.isArray(e.B), 'Times inválidos.');\n      assert(e.A.length <= 5 && e.B.length <= 5, 'Cada time aceita no máximo cinco jogadores.');`);
replace('src/shared/scrim.ts',
  `      assert(s.pool.length === POOL_SIZE, \`A pool precisa ter \${POOL_SIZE} mapas.\`);`,
  `      assert(s.pool.length === POOL_SIZE, \`A pool precisa ter \${POOL_SIZE} mapas.\`);\n      assert(s.players.length === 10, 'A scrim precisa ter dez jogadores.');\n      assert(['A', 'B'].every((team) => s.players.filter((p) => p.team === team).length === 5), 'Monte dois times de cinco jogadores.');`);
replace('src/client/components/TeamsPanel.tsx',
  `        <button className="primary" onClick={() => act({ type: 'veto.start', first })}>`,
  `        <button className="primary" disabled={uneven || state.players.length !== 10} onClick={() => act({ type: 'veto.start', first })}>`);
replace('src/client/components/TeamsPanel.tsx',
  `      {isAdmin ? (\n        <input`,
  `      {editable ? (\n        <input`);
replace('src/shared/scrim.test.ts',
  `  const run = (cmd: Command) => {\n    state = applyEvent(state, { ...cmd, seq: state.version + 1, at: state.version * 1000 } as ScrimEvent);`,
  `  const run = (cmd: Command) => {\n    if (cmd.type === 'veto.start' && state.players.length === 0) {\n      for (let i = 0; i < 10; i++) {\n        state = applyEvent(state, { seq: state.version + 1, at: state.version * 1000, type: 'player.add', playerId: 'p' + i, name: 'Jogador ' + i });\n        state = applyEvent(state, { seq: state.version + 1, at: state.version * 1000, type: 'player.assign', playerId: 'p' + i, team: i < 5 ? 'A' : 'B' });\n      }\n    }\n    state = applyEvent(state, { ...cmd, seq: state.version + 1, at: state.version * 1000 } as ScrimEvent);`);
replace('.gitignore', 'data/\n', 'data/\n.env\n.env.*\n!.env.example\n');
replace('README.md', '# Scrims VALORANT', '# Scrims VALORANT\n\n> **Deploy Vercel + Supabase:** consulte [README-VERCEL.md](./README-VERCEL.md). O fluxo abaixo descreve o servidor Docker/Node legado; a migração serverless usa Postgres + Supabase Realtime.');
console.log('Migração aplicada. Rode npm run build && npm test e configure as variáveis na Vercel.');
