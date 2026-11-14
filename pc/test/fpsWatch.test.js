const test = require('node:test');
const assert = require('node:assert');
const { watcher, WINDOW, SAMPLE_MS } = require('../src/main/fpsWatch');

const frames = (fps) => (fps * SAMPLE_MS) / 1000;

test('1 minuto seguido abaixo de 30 FPS devolve a média', () => {
  const w = watcher();
  for (let i = 0; i < WINDOW - 1; i++) assert.strictEqual(w.add(frames(i % 2 ? 20 : 24), SAMPLE_MS, true), null);
  assert.strictEqual(w.add(frames(24), SAMPLE_MS, true), 22);
});

test('travada, jogo fora da tela ou 30 FPS ou mais zeram a contagem', () => {
  for (const [n, vis] of [[frames(1), true], [frames(20), false], [frames(30), true]]) {
    const w = watcher();
    for (let i = 0; i < WINDOW - 1; i++) w.add(frames(20), SAMPLE_MS, true);
    assert.strictEqual(w.add(n, SAMPLE_MS, vis), null);
    assert.strictEqual(w.add(frames(20), SAMPLE_MS, true), null);
  }
});
