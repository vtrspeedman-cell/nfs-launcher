const test = require('node:test');
const assert = require('node:assert');
const { isExternalUrl, isAllowedUrl } = require('../src/main/config');

test('link da playlist do Spotify vai para o navegador; o resto continua bloqueado', () => {
  assert.ok(isExternalUrl('https://open.spotify.com/playlist/2KYnOjOMzSCeQs97ZJiMe1'));
  assert.ok(!isAllowedUrl('https://open.spotify.com/playlist/2KYnOjOMzSCeQs97ZJiMe1', 'nfsu2'));
  for (const u of ['http://open.spotify.com/x', 'https://evil.com/open.spotify.com', 'https://open.spotify.com.evil.com/',
    'https://a:b@open.spotify.com/', 'https://open.spotify.com:8443/', 'javascript:alert(1)', 'file:///c:/x', 'nada']) {
    assert.ok(!isExternalUrl(u), u);
  }
});

test('login do Last.fm abre só no Last.fm, sem porta nem usuário', () => {
  const { isLoginUrl } = require('../src/main/config');
  assert.ok(isLoginUrl('https://www.last.fm/api/auth/?api_key=x&cb=https%3A%2F%2Fnfsu2.xyz%2Flastfm.html'));
  for (const u of ['http://www.last.fm/api/auth/', 'https://www.last.fm:8443/', 'https://a@www.last.fm/', 'https://evil.last.fm.example/', 'https://fm.bot/'])
    assert.ok(!isLoginUrl(u), u);
  assert.ok(isExternalUrl('https://fm.bot/'));
});
