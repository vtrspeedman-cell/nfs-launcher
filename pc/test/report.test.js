'use strict';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../src/main/report');

const rec = (o) => JSON.stringify({ v: 1, started: '2026-11-20T10:00:00Z', saved: '2026-11-20T10:30:00Z', ended: null, log: '=== NFSU2 web\nok\n', ...o });

test('escolhe a partida mais recente que começou antes da página abrir', () => {
  const a = rec({ started: '2026-11-19T10:00:00Z', saved: '2026-11-19T11:00:00Z', log: 'a' });
  const b = rec({ log: 'b' });
  const agora = rec({ started: '2026-11-20T12:00:00Z', saved: '2026-11-20T12:05:00Z', log: 'agora' });
  assert.equal(r.pickLast([a, b, agora, 'lixo{'], Date.parse('2026-11-20T11:00:00Z')).log, 'b');
  assert.equal(r.pickLast([], 0), null);
  // a partida desta página caiu (sem recarregar): já tem fim, então conta
  const caiu = rec({ started: '2026-11-20T12:00:00Z', saved: '2026-11-20T12:05:00Z', ended: { code: -1, why: 'GPU-LOST' }, log: 'caiu' });
  assert.equal(r.pickLast([b, caiu], Date.parse('2026-11-20T11:00:00Z')).log, 'caiu');
  // registro sem log não conta
  assert.equal(r.pickLast([b, rec({ log: '' , saved: '2026-11-20T10:59:00Z' })], Date.parse('2026-11-20T11:00:00Z')).log, 'b');
});

test('saída normal não pede relato; queda e erro pedem', () => {
  assert.equal(r.endedBadly(null), false);
  assert.equal(r.endedBadly(JSON.parse(rec({ ended: { code: 0, why: 'exit' } }))), false);
  assert.equal(r.endedBadly(JSON.parse(rec({ ended: { code: -1, why: 'exit' } }))), false);
  assert.equal(r.endedBadly(JSON.parse(rec({ ended: { code: 0, why: 'page closed' } }))), false);
  assert.equal(r.endedBadly(JSON.parse(rec({ ended: { code: 3, why: 'exit' } }))), true);
  assert.equal(r.endedBadly(JSON.parse(rec({ ended: { code: 0, why: 'trap' } }))), true);
  assert.equal(r.endedBadly(JSON.parse(rec())), false);
  assert.equal(r.endedBadly(JSON.parse(rec({ log: 'x\nTRAP in thread 2\n' }))), true);
});

test('linhas de erro: acha as conhecidas e ignora "0 errors"', () => {
  const l = r.errorLines('ok\n[watchdog] no Present for 5s\ncompiled, 0 errors\nGPU-LOST device\nload failed: x');
  assert.deepEqual(l, ['[watchdog] no Present for 5s', 'GPU-LOST device', 'load failed: x']);
});

test('limpa usuário do Windows e e-mail; log grande guarda começo e fim', () => {
  assert.equal(r.scrub('C:\\Users\\Fulano\\AppData x@y.com'), 'C:\\Users\\<usuario>\\AppData <email>');
  const big = 'A'.repeat(100000) + 'B'.repeat(200000);
  const t = r.trimLog(big);
  assert.ok(t.length < r.LOG_MAX + 100 && t.startsWith('A') && t.endsWith('B'));
});

test('diagnóstico e log só vão com a caixa marcada', () => {
  const x = JSON.parse(rec({ log: 'TRAP in thread 1' }));
  const sem = r.payload({ texto: 'oi', diag: 'd', rec: x });
  assert.ok(!('diag' in sem) && !('log' in sem));
  const com = r.payload({ texto: 'oi', diag: 'd', rec: x, withDiag: true, withLog: true });
  assert.equal(com.diag, 'd');
  assert.equal(com.erros, 'TRAP in thread 1');
});

test('o app só fala com o intermediário (sem token no código)', () => {
  assert.match(r.RELAY_URL, /^https:\/\/[\w-]+\.[\w-]+\.workers\.dev\/relato$/);
  const fs = require('node:fs');
  assert.ok(!/ghp_|github_pat_/.test(fs.readFileSync(require.resolve('../src/main/report.js'), 'utf8')));
});
