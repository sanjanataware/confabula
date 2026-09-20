const pairingTokenPattern = /^[A-Za-z0-9_-]{43}$/;

type BrowserLocation = Pick<Location, 'hash' | 'pathname' | 'search'>;
type ReplaceLocation = (path: string) => void;

function getBrowserLocation(): BrowserLocation | null {
  return typeof window !== 'undefined' && window.location ? window.location : null;
}

function getReplaceLocation(): ReplaceLocation | null {
  if (typeof window === 'undefined' || !window.history?.replaceState) return null;
  return (path) => window.history.replaceState(window.history.state, document.title, path);
}

export function parsePairingFragment(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const token = new URLSearchParams(fragment).get('pair')?.trim();
  return token && pairingTokenPattern.test(token) ? token : null;
}

export function consumePairingFragment(
  browserLocation: BrowserLocation | null = getBrowserLocation(),
): string | null {
  return browserLocation ? parsePairingFragment(browserLocation.hash) : null;
}

export function clearPairingFragment(
  browserLocation: BrowserLocation | null = getBrowserLocation(),
  replaceLocation: ReplaceLocation | null = getReplaceLocation(),
): void {
  if (!browserLocation) return;
  const fragment = browserLocation.hash;
  const parameters = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  if (!parameters.has('pair')) return;
  replaceLocation?.(`${browserLocation.pathname}${browserLocation.search}`);
}
