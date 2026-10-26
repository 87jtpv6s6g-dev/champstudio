import fs from "node:fs";
import { chromium, type Browser, type LaunchOptions } from "playwright";

/**
 * In questo ambiente il browser Chromium è preinstallato sotto /opt/pw-browsers.
 * La versione di Playwright del progetto può differire da quella del browser, quindi
 * si lancia puntando all'eseguibile preinstallato (override con PW_CHROMIUM).
 */
function resolveExecutable(): string | undefined {
  const envPath = process.env.PW_CHROMIUM;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const preinstalled = "/opt/pw-browsers/chromium";
  if (fs.existsSync(preinstalled)) return preinstalled;
  return undefined; // lascia che Playwright usi il proprio browser
}

export function launchChromium(extra: LaunchOptions = {}): Promise<Browser> {
  const executablePath = resolveExecutable();
  return chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    ...extra,
  });
}
