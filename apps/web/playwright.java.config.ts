import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// 図からのモデル編集（公式実装 = Java が必要）の E2E。通常の E2E（Java 無し）とは別に実行する: pnpm e2e:java
const PORT = Number(process.env["E2E_JAVA_PORT"] ?? 8798);
const candidates = [process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"], "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].filter((x): x is string => !!x);
const executablePath = candidates.find((p) => existsSync(p));

export default defineConfig({
  testDir: "e2e-java",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    locale: "ja-JP",
    launchOptions: { ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] },
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT), E2E_SYSML: "java" },
  },
});
