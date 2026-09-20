import {
  clearPairingFragment,
  consumePairingFragment,
  parsePairingFragment,
} from '../../src/setup/pairingBootstrap';

const token = 'p'.repeat(43);

test('parses one temporary URL-safe pairing token', () => {
  expect(parsePairingFragment(`#pair=${token}`)).toBe(token);
  expect(parsePairingFragment(`pair=${token}`)).toBe(token);
});

test.each([
  '#pair=short',
  `#pair=${'p'.repeat(42)}`,
  `#pair=${'p'.repeat(44)}`,
  `#pair=${'p'.repeat(42)}!`,
  '#other=value',
])('rejects malformed pairing fragments: %s', (fragment) => {
  expect(parsePairingFragment(fragment)).toBeNull();
});

test('reads a pairing fragment and clears it after hydration', () => {
  const browserLocation = {
    hash: `#pair=${token}`,
    pathname: '/setup',
    search: '?source=backend',
  };
  let cleanLocation: string | null = null;
  expect(consumePairingFragment(browserLocation)).toBe(token);
  clearPairingFragment(browserLocation, (path) => { cleanLocation = path; });
  expect(cleanLocation).toBe('/setup?source=backend');
});

test('clears malformed pairing material while returning no credential', () => {
  const browserLocation = { hash: '#pair=not-valid', pathname: '/', search: '' };
  let cleanLocation: string | null = null;
  expect(consumePairingFragment(browserLocation)).toBeNull();
  clearPairingFragment(browserLocation, (path) => { cleanLocation = path; });
  expect(cleanLocation).toBe('/');
});
