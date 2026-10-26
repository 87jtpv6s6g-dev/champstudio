/*
 * Comando unico: pnpm test:all
 * - usa una cartella dati temporanea isolata;
 * - esegue l'intera suite (vitest) con il browser preinstallato;
 * - salva l'output reale e integrale in EVIDENCE/test-output.txt (oltre allo stdout).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "replica-tool-test-"));
const evidenceDir = path.join(root, "EVIDENCE");
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, "test-output.txt");
const outStream = fs.createWriteStream(outFile, { flags: "w" });

const header =
  `# Output di pnpm test:all\n# Data: ${new Date().toISOString()}\n` +
  `# Node: ${process.version}\n# Data dir temporanea: ${dataDir}\n` +
  `${"=".repeat(70)}\n\n`;
process.stdout.write(header);
outStream.write(header);

const env = {
  ...process.env,
  REPLICA_DATA_DIR: dataDir,
  PANEL_PORT: "0",
  PANEL_NET_HOST: "127.0.0.1",
};

const child = spawn("pnpm", ["exec", "vitest", "run"], {
  cwd: root,
  env,
  stdio: ["inherit", "pipe", "pipe"],
});

const tee = (chunk: Buffer) => {
  process.stdout.write(chunk);
  outStream.write(chunk);
};
child.stdout.on("data", tee);
child.stderr.on("data", tee);

child.on("close", (code) => {
  const footer = `\n${"=".repeat(70)}\n# Esito: ${code === 0 ? "SUCCESSO" : "FALLITO"} (exit ${code})\n`;
  process.stdout.write(footer);
  outStream.write(footer);
  outStream.end(() => {
    // pulizia della cartella temporanea
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(code ?? 1);
  });
});
