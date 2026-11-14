'use strict';
// FPS baixo (pedido do Bruno, 14/11): o app conta os quadros do jogo num mundo isolado (o site não vê nem é alterado;
// só um requestAnimationFrame que soma 1 por quadro) e, se a média ficar abaixo de 30 por 1 minuto seguido de jogo
// na tela, liga o modo leve e avisa, com "Desfazer". Lógica pura aqui; main.js lê a contagem a cada 5 s.

const WORLD = 1077;          // id do mundo isolado (fora dos usados pelo Electron)
const WARMUP_MS = 3 * 60e3;  // carregamento e compilação do jogo derrubam o FPS: espera 3 min após abrir a página
const SAMPLE_MS = 5e3;
const WINDOW = 12;           // 12 amostras de 5 s = 1 minuto
const LOW = 30;
const STALL = 2;             // abaixo disso é travada de carregamento, não FPS baixo: zera a janela

const startCode = `(() => { if (globalThis.__nfsFps) return; const s = globalThis.__nfsFps = { n: 0 };
  const f = () => { s.n++; requestAnimationFrame(f); }; requestAnimationFrame(f); })()`;
const readCode = `(() => { const s = globalThis.__nfsFps; if (!s) return null; const n = s.n; s.n = 0;
  return { n, vis: document.visibilityState === 'visible' }; })()`;

// Uma vigia por página aberta. add() recebe a contagem de quadros, o tempo passado e se o jogo está na tela;
// devolve a média (FPS) quando a janela inteira ficou abaixo do limite, senão null.
function watcher() {
  let fps = [];
  return {
    add(frames, ms, visible) {
      if (!visible || !(ms > 0)) { fps = []; return null; }
      const v = (frames * 1000) / ms;
      if (v < STALL || v >= LOW) { fps = []; return null; }
      fps.push(v);
      if (fps.length < WINDOW) return null;
      const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
      fps = [];
      return Math.round(avg);
    },
  };
}

module.exports = { WORLD, WARMUP_MS, SAMPLE_MS, WINDOW, LOW, STALL, startCode, readCode, watcher };
