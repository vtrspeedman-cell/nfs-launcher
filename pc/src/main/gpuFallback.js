'use strict';
// Modo DirectX 11 (pedido do Bruno): placa sem DirectX 12 não acha adaptador de WebGPU e o jogo recusa abrir.
// A detecção é o teste real de WebGPU da tela inicial: a informação do motor (`supportsDx12`) vem falsa logo ao abrir,
// até numa RTX 4060, e ligar DX11 sem precisar tiraria desempenho de quem tem DX12.
//  - 'try':    sem adaptador e nunca tentou: liga o modo e reabre, uma vez só (nunca entra em ciclo).
//  - 'failed': já está em DX11 e também não achou placa de verdade: só avisa; o modo fica ligado até o jogador voltar ao DirectX 12.
//  - 'none':   nada a fazer.
function decide({ supported, software, unblockOn, tried, safeMode, gameStarted }) {
  if (safeMode) return 'none';
  if (unblockOn) return supported && !software ? 'none' : 'failed';
  if (supported || tried || gameStarted) return 'none';
  return 'try';
}
module.exports = { decide };
