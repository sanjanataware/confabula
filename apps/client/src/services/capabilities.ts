export type LanguageCapability = {
  code: string;
  display_name: string;
  muse_bias_name: string;
  speech_route: {
    kind: 'device_speech';
  };
};

export type CapabilitiesResponse = {
  protocol_version: 1;
  languages: LanguageCapability[];
};

export type HealthResponse = {
  status: 'ok' | 'not_ready';
  protocol_version: 1;
  providers: {
    meta: boolean;
    device_speech: boolean;
  };
};

export function normalizeBackendBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const debugLoopback =
    __DEV__ && process.env.EXPO_PUBLIC_LOOPBACK_DEBUG === '1' &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    (url.port === '8000' || (process.env.EXPO_PUBLIC_E2E === '1' && url.port === '8765'));
  if (
    (url.protocol !== 'https:' && !debugLoopback) || !url.hostname ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('Use an HTTPS backend origin without a path or credentials.');
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchJson(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Backend request failed with status ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCapabilities(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilitiesResponse> {
  const result = await fetchJson(`${normalizeBackendBaseUrl(baseUrl)}/v1/capabilities`, fetcher, 5_000);
  if (
    !isRecord(result) || result.protocol_version !== 1 || !Array.isArray(result.languages) ||
    !result.languages.length || !result.languages.every((item: unknown) =>
      isRecord(item) && typeof item.code === 'string' && item.code.length > 0 &&
      typeof item.display_name === 'string' && item.display_name.length > 0 &&
      typeof item.muse_bias_name === 'string' && isRecord(item.speech_route) &&
      item.speech_route.kind === 'device_speech',
    )
  ) {
    throw new Error('Backend returned invalid language capabilities.');
  }
  return result as CapabilitiesResponse;
}

export async function loadHealth(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<HealthResponse> {
  const result = await fetchJson(`${normalizeBackendBaseUrl(baseUrl)}/health`, fetcher, 5_000);
  if (
    !isRecord(result) || result.protocol_version !== 1 ||
    !['ok', 'not_ready'].includes(String(result.status)) || !isRecord(result.providers) ||
    typeof result.providers.meta !== 'boolean' ||
    result.providers.device_speech !== true
  ) {
    throw new Error('Backend returned invalid readiness information.');
  }
  return result as HealthResponse;
}

export async function discoverBackend(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ health: HealthResponse; capabilities: CapabilitiesResponse }> {
  const [health, capabilities] = await Promise.all([
    loadHealth(baseUrl, fetcher),
    loadCapabilities(baseUrl, fetcher),
  ]);
  return { health, capabilities };
}
