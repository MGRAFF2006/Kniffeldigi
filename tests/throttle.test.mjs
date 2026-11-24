// Unit-Tests für die IP-Normalisierung der Versuchslimits.
// Ausführen: node --test tests/throttle.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeIp } from '../functions/api/_lib/throttle.js';

test('IPv4 wird einheitlich geschrieben', () => {
  assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp(' 203.000.113.007 '), '203.0.113.7');
});

test('IPv4-gemappte IPv6-Adressen zählen wie die IPv4-Adresse', () => {
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('::FFFF:102:304'), '1.2.3.4');
  assert.equal(normalizeIp('0:0:0:0:0:ffff:0102:0304'), '1.2.3.4');
  // Verschiedene gemappte Adressen teilen sich keinen Bucket.
  assert.notEqual(normalizeIp('::ffff:1.2.3.4'), normalizeIp('::ffff:5.6.7.8'));
});

test('IPv6 wird auf das /64-Netz gekürzt', () => {
  const a = normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
  assert.equal(a, '2001:db8:1:2::/64');
  assert.equal(normalizeIp('2001:0DB8:0001:0002::1'), a, 'andere Adresse und Schreibweise im selben /64');
  assert.equal(normalizeIp('2001:db8:1::5'), '2001:db8:1:0::/64');
  assert.notEqual(normalizeIp('2001:db8:1:3::1'), a, 'Nachbarnetz ist ein eigener Bucket');
  assert.equal(normalizeIp('::1'), '0:0:0:0::/64');
});

test('Ungültige Angaben ergeben keine IP', () => {
  for (const raw of [null, undefined, '', '   ', 'unknown', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.4/24',
    '2001:db8::1::2', '2001:db8:1:2:3:4:5:6:7', '2001:db8:1:2:3:4:5', '12345::1', 'g::1', ':1:2:3:4:5:6:7',
    '::ffff:1.2.3.999', '1.2.3.4:80']) {
    assert.equal(normalizeIp(raw), null, JSON.stringify(raw));
  }
});
