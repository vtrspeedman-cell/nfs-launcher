'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allowPermission, HID_MAX, hidKey, sanitizeHidGrants, addHidGrant, hidGranted } = require('../src/main/permissions');

test('permissões que o jogo precisa são liberadas', () => {
  for (const p of ['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'persistent-storage']) {
    assert.equal(allowPermission(p, {}), true, p);
  }
});
test('pasta de músicas: só leitura', () => {
  assert.equal(allowPermission('fileSystem', { fileAccessType: 'readable', isDirectory: true }), true);
  assert.equal(allowPermission('fileSystem', { fileAccessType: 'writable', isDirectory: true }), false);
  assert.equal(allowPermission('fileSystem', {}), false);
  assert.equal(allowPermission('fileSystem', undefined), false);
});
test('demais permissões continuam negadas', () => {
  for (const p of ['media', 'geolocation', 'notifications', 'hid', 'usb', 'serial', 'display-capture',
    'clipboard-read', 'openExternal', 'midiSysex', 'unknown']) {
    assert.equal(allowPermission(p, { fileAccessType: 'readable' }), false, p);
  }
});
test('WebHID só nos sites dos jogos', () => {
  assert.equal(allowPermission('hid', { requestingUrl: 'https://nfsu2.xyz/' }), true);
  assert.equal(allowPermission('hid', { securityOrigin: 'https://web.nfsmwo.com/' }), true);
  assert.equal(allowPermission('hid', { requestingUrl: 'https://evil.example/' }), false);
  assert.equal(allowPermission('hid', { requestingUrl: 'http://nfsu2.xyz/' }), false);
  assert.equal(allowPermission('hid', undefined), false);
});
test('controles lembrados: fabricante:modelo, o mais recente primeiro', () => {
  const steam = { vendorId: 10462, productId: 4354, deviceId: 'a' };
  const wheel = { vendorId: 1133, productId: 49766, deviceId: 'b' };
  assert.equal(hidKey(steam), '10462:4354');
  assert.equal(hidKey({ vendorId: '1' }), null);
  let list = addHidGrant([], steam);
  list = addHidGrant(list, wheel);
  list = addHidGrant(list, steam);
  assert.deepEqual(list, ['10462:4354', '1133:49766']);
  assert.equal(hidGranted(list, { ...wheel, deviceId: 'outro' }), true);
  assert.equal(hidGranted(list, { vendorId: 1, productId: 2 }), false);
  assert.equal(hidGranted(undefined, steam), false);
  assert.deepEqual(sanitizeHidGrants(['1:2', '1:2', 'x', 3, '1:2:3']), ['1:2']);
  assert.deepEqual(sanitizeHidGrants('1:2'), []);
  let many = [];
  for (let i = 0; i < HID_MAX + 5; i++) many = addHidGrant(many, { vendorId: i, productId: 1 });
  assert.equal(many.length, HID_MAX);
  assert.equal(many[0], `${HID_MAX + 4}:1`);
});
