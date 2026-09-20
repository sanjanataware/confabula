import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:8764',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: [
    {
      command:
        'cd ../backend && uv run uvicorn tests.e2e.fake_app:app --host 127.0.0.1 --port 8765 --no-access-log',
      url: 'http://127.0.0.1:8765/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        'EXPO_PUBLIC_LOOPBACK_DEBUG=1 EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8765 npx expo start --web --host localhost --port 8764',
      url: 'http://localhost:8764',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
