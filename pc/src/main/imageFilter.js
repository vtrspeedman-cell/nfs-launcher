'use strict';
// Pacotes de imagem do jogo: só CSS no canvas (sem script e sem tocar no jogo). #game é o NFSU2, #canvas é o Most Wanted
// e o Carbon.
//  - No NFSU2 (desde a 3.0.9), os efeitos rodam no motor do app (pc/motor/nfs-imagem.wgsl): o CSS só leva os valores,
//    na propriedade --nfs-image do canvas. Vale na hora, e pesa menos que o filtro CSS (~0,15 ms contra até ~0,5 ms
//    por quadro em 1440p). O motor oficial do `npm start` ignora a propriedade.
//  - Nos outros jogos continua o filtro CSS de antes (cor e nitidez); só o anti-serrilhado vai pelo motor.
const SHARPEN = 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'><filter id=\'n\' color-interpolation-filters=\'sRGB\'><feConvolveMatrix order=\'3\' preserveAlpha=\'true\' kernelMatrix=\'0 -.25 0 -.25 2 -.25 0 -.25 0\'/></filter></svg>#n")';

// Ordem dos 14 números de --nfs-image (a mesma do motor) e o valor neutro de cada um.
const FX_KEYS = Object.freeze(['fxaa', 'nit', 'sat', 'vib', 'con', 'bri', 'gama', 'vin', 'r', 'g', 'b', 'bloom', 'limiar', 'sepia']);
const NEUTRAL = Object.freeze({ fxaa: 0, nit: 0, sat: 1, vib: 0, con: 1, bri: 1, gama: 1, vin: 0, r: 1, g: 1, b: 1, bloom: 0, limiar: 0.7, sepia: 0 });
// Limites que o motor aceita (fora deles, ele ignora a linha inteira).
const RANGE = Object.freeze({ fxaa: [0, 1], nit: [0, 1], sat: [0, 2], vib: [-1, 1], con: [0.5, 1.5], bri: [0.5, 1.5], gama: [0.5, 2], vin: [0, 1], r: [0.5, 1.5], g: [0.5, 1.5], b: [0.5, 1.5], bloom: [0, 2], limiar: [0, 0.99], sepia: [0, 1] });

// css = filtro CSS (jogos sem os efeitos no motor); fx = os mesmos valores para o motor (nit = nitidez CAS, sat =
// saturação, vib = vibrance, con = contraste, bri = brilho, vin = vinheta, bloom = brilho em volta das luzes).
const MODES = Object.freeze({
  suave: { css: 'saturate(1.12) contrast(1.03)', fx: { sat: 1.12, con: 1.03 } },
  vivido: { css: 'saturate(1.25) contrast(1.05)', fx: { sat: 1.25, con: 1.05 } },
  intenso: { css: 'saturate(1.5) contrast(1.08)', fx: { sat: 1.5, con: 1.08 } },
  nitido: { css: SHARPEN, fx: { nit: 0.6 } },
  vividoNitido: { css: `${SHARPEN} saturate(1.25) contrast(1.05)`, fx: { nit: 0.6, sat: 1.25, con: 1.05 } },
  // Presets só de cor (ideia do "ReShade" de Safari que mandaram ao Bruno, 09/11; sem camadas por cima do jogo).
  cinema: { css: 'contrast(1.15) saturate(0.9) brightness(0.95)', fx: { sat: 0.9, con: 1.15, bri: 0.95, vin: 0.3 } },
  pretoBranco: { css: 'grayscale(1) contrast(1.15)', fx: { sat: 0, con: 1.15 } },
  porDoSol: { css: 'sepia(0.25) saturate(1.3) brightness(1.05)', fx: { sepia: 0.25, sat: 1.3, bri: 1.05 } },
  frio: { css: 'hue-rotate(10deg) saturate(1.05) contrast(1.05)', fx: { r: 0.92, g: 0.98, b: 1.1, sat: 1.05, con: 1.05 } },
  quente: { css: 'sepia(0.15) saturate(1.15) contrast(1.03)', fx: { r: 1.08, g: 1.02, b: 0.9, sat: 1.1, con: 1.03 } },
  noturno: { css: 'hue-rotate(10deg) saturate(0.85) contrast(1.12) brightness(0.9)', fx: { r: 0.88, g: 0.95, b: 1.12, sat: 0.85, con: 1.12, bri: 0.9, vin: 0.35, bloom: 0.5, limiar: 0.7 } },
  retro: { css: 'sepia(0.35) saturate(0.85) contrast(1.1)', fx: { sepia: 0.35, sat: 0.85, con: 1.1, vin: 0.25 } },
  desbotado: { css: 'saturate(0.7) contrast(0.9) brightness(1.05)', fx: { sat: 0.7, con: 0.9, bri: 1.05, gama: 1.1 } },
  // Pacotes que só o motor faz por inteiro (pedido do Bruno, 10/11: o "ReShade nosso"); nos outros jogos, só a cor.
  neon: { css: 'saturate(1.35) contrast(1.06) brightness(1.03)', fx: { nit: 0.4, sat: 1.3, vib: 0.3, con: 1.06, bloom: 0.9, limiar: 0.6 } },
  realista: { css: 'saturate(0.92) contrast(1.1)', fx: { nit: 0.5, sat: 0.92, con: 1.1, vin: 0.15, bloom: 0.3, limiar: 0.75, r: 1.02, b: 0.97 } },
});
const MODE_IDS = Object.freeze(Object.keys(MODES));

const num = (v) => String(Math.round(v * 1000) / 1000);
// Os 14 números, na ordem do motor. Valor fora do limite volta ao neutro.
function spec(fx = {}, fxaa = false) {
  return FX_KEYS.map((k) => {
    const v = k === 'fxaa' ? (fxaa ? 1 : 0) : fx[k];
    const [lo, hi] = RANGE[k];
    return num(Number.isFinite(v) && v >= lo && v <= hi ? v : NEUTRAL[k]);
  }).join(' ');
}

// on/mode = pacote de imagem; fxaa = anti-serrilhado do motor (opção à parte, que o app desliga quando o do próprio
// jogo está ligado). Sem nenhum dos dois: null (nada é posto na página).
function css(on, mode, fxaa = false) {
  const m = on && Object.prototype.hasOwnProperty.call(MODES, mode) ? MODES[mode] : null;
  if (!m && !fxaa) return null;
  const game = `#game{--nfs-image:${spec(m ? m.fx : {}, fxaa)}}`;
  const other = [fxaa && `--nfs-image:${spec({}, true)}`, m && `filter:${m.css}`].filter(Boolean).join(';');
  return `${game}#canvas{${other}}`;
}

// Botão da barra: cada clique vai para o próximo modo e, depois do último, desliga. Desligado, volta ao primeiro.
function next(on, mode) {
  const i = MODE_IDS.indexOf(mode);
  if (!on || i < 0) return { on: true, mode: MODE_IDS[0] };
  if (i === MODE_IDS.length - 1) return { on: false, mode };
  return { on: true, mode: MODE_IDS[i + 1] };
}

module.exports = { MODE_IDS, MODES, FX_KEYS, NEUTRAL, RANGE, spec, css, next };
