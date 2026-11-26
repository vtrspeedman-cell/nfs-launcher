'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/main/discordLogin');

test('vínculo do Discord: só o botão do site do jogo aberto', () => {
  assert.equal(d.isStart('https://nfsu2.xyz/names/discord/start?do=link', 'nfsu2'), true);
  assert.equal(d.isStart('https://nfsu2.xyz/names/discord/start?do=recover', 'nfsu2'), true);
  assert.equal(d.isStart('https://nfsu2.xyz/names/discord/start?do=link', 'nfsu2mod'), false);
  assert.equal(d.isStart('https://evil.example/names/discord/start', 'nfsu2'), false);
  assert.equal(d.isStart('http://nfsu2.xyz/names/discord/start', 'nfsu2'), false);
  assert.equal(d.isStart('https://nfsu2.xyz/names/discord/back?code=x', 'nfsu2'), false);
  assert.equal(d.isStart('https://nfsu2.xyz/', 'nfsu2'), false);
});
test('janela do login: só o Discord e o caminho do vínculo', () => {
  assert.equal(d.isFlow('https://discord.com/oauth2/authorize?client_id=1', 'nfsu2'), true);
  assert.equal(d.isFlow('https://discord.com/login?redirect_to=%2Foauth2', 'nfsu2'), true);
  assert.equal(d.isFlow('https://nfsu2.xyz/names/discord/back?code=x&state=y', 'nfsu2'), true);
  assert.equal(d.isFlow('https://evil.discord.com.example/', 'nfsu2'), false);
  assert.equal(d.isFlow('https://user:x@discord.com/', 'nfsu2'), false);
  assert.equal(d.isFlow('http://discord.com/', 'nfsu2'), false);
  assert.equal(d.isFlow('https://nfsu2.xyz/', 'nfsu2'), false);
  assert.equal(d.isFlow('https://evil.example/names/discord/back', 'nfsu2'), false);
});
test('a volta é o site do jogo fora do caminho do vínculo', () => {
  assert.equal(d.isReturn('https://nfsu2.xyz/#discord=abc', 'nfsu2'), true);
  assert.equal(d.isReturn('https://nfsu2.xyz/#discord-error=denied', 'nfsu2'), true);
  assert.equal(d.isReturn('https://nfsu2.xyz/names/discord/back?code=x', 'nfsu2'), false);
  assert.equal(d.isReturn('https://discord.com/app', 'nfsu2'), false);
  assert.equal(d.isReturn('https://nfsu2mod.xyz/#discord=abc', 'nfsu2'), false);
});
test('mesmo documento: só quando muda apenas o #', () => {
  assert.equal(d.sameDocument('https://nfsu2.xyz/', 'https://nfsu2.xyz/#discord=abc'), true);
  assert.equal(d.sameDocument('https://nfsu2.xyz/#crew=U2BR', 'https://nfsu2.xyz/#discord=abc'), true);
  assert.equal(d.sameDocument('https://nfsu2.xyz/?x=1', 'https://nfsu2.xyz/#discord=abc'), false);
  assert.equal(d.sameDocument('https://nfsu2.xyz/', 'https://nfsu2.xyz/'), false);
  assert.equal(d.sameDocument('about:blank', 'https://nfsu2.xyz/#discord=abc'), false);
});
