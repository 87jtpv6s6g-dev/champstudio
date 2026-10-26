import { readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { serveStatic } from "./static-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = join(HERE, "..", "fixtures");

export const FixtureDescriptor = z.object({
  trap: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().min(1),
  entry: z.string().default("/index.html"),
  routes: z.array(z.string()).optional(),
  provider: z.string().optional(),
  mimeOverride: z.record(z.string()).optional(),
  secureContextRequired: z.boolean().optional(),
  checks: z.array(z.string()).min(1),
});
export type FixtureDescriptor = z.infer<typeof FixtureDescriptor>;

export interface Fixture {
  dir: string;
  siteDir: string;
  desc: FixtureDescriptor;
}

/** Discover and validate every fixture under test/fixtures. */
export function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const entry of readdirSync(FIXTURES_ROOT).sort()) {
    const dir = join(FIXTURES_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const descRaw = readFileSync(join(dir, "fixture.json"), "utf8");
    const desc = FixtureDescriptor.parse(JSON.parse(descRaw));
    out.push({ dir, siteDir: join(dir, "site"), desc });
  }
  return out;
}

async function listFiles(root: string): Promise<string[]> {
  const acc: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else acc.push(p);
    }
  }
  await walk(root);
  return acc;
}

const TEXTUAL = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg"]);

/**
 * Serves a fixture as "the original site": copies it to a temp dir, rewires
 * every `EXTERNAL` token to the spy origin (so any leak is observable), and
 * applies any MIME override the trap requires.
 */
export async function serveFixture(
  fx: Fixture,
  spyOrigin: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const work = await mkdtemp(join(tmpdir(), `mirror-fx-${fx.desc.name}-`));
  await cp(fx.siteDir, work, { recursive: true });
  for (const file of await listFiles(work)) {
    if (!TEXTUAL.has(extname(file))) continue;
    const txt = await readFile(file, "utf8");
    if (txt.includes("EXTERNAL")) {
      await writeFile(file, txt.split("EXTERNAL").join(spyOrigin));
    }
  }
  const server = await serveStatic(
    work,
    fx.desc.mimeOverride ? { mimeOverride: fx.desc.mimeOverride } : {},
  );
  return { origin: server.origin, close: server.close };
}
