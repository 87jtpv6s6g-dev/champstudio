# mirror

Private internal tool: given the URL of one of my own sites, produce a 100%
faithful, fully self-contained replica, serve it on a link I can open from
computer and phone, and record my browsing sessions on the replica in a panel.

> Strategy: the replica **keeps and runs the site's original code** (HTML, CSS,
> JS bundles) in an isolated environment. The site is never rewritten.

## Pipeline (staged, with on-disk artifacts and typed contracts)

```
capture → explore → archive → transform → mock → package → verify → serve (+record)
```

Only `capture`/`explore` touch the network. Every stage reads/writes artifacts
validated with `zod` (`SCHEMA_VERSION` in `src/schemas`). `/__mirror/` is the
reserved engine namespace (panel, recording endpoint, MSW worker, isolation
script) and never collides with the site's own routes.

## CLI (contract)

```
mirror build <url> [--port N] [--out DIR] [--max-pages N] [--lan]
mirror rebuild <dir>        # re-runs transform→verify from artifacts, no re-capture
mirror serve <dir> [--port N] [--lan]
mirror list
```

Output layout: `<out>/<domain>/{capture/, graph.json, manifest.json, site/, qa/, sessions.db}`.

## Status

- **M0 — scaffolding + test bench: DONE (this milestone).** Zod contracts, the
  network spy server, 16 trap fixtures + a healthy baseline, and two suites:
  - `pnpm test` — unit/property tests on the contracts (green).
  - `pnpm e2e:fixtures` — runs the real engine over every fixture and asserts
    **all** done-criteria. **Red on purpose** until M1+: the engine is a stub,
    which proves the e2e measures real behaviour instead of rubber-stamping.
- M1 capture+archive · M2 transform+package+serve · M3 explore · M4 dual-layer
  isolation + simulated backend · M5 differential verify · M6 phone access
  (`--lan`, mkcert HTTPS, QR) · M7 live capture (rrweb panel) · M8 real-site
  acceptance (`pnpm e2e:site -- <url>`) · M9 private-server prep (Docker).

## Dev

```
pnpm install
pnpm test          # unit + property
pnpm e2e:fixtures  # engine over trap fixtures (red until implemented)
pnpm typecheck
```

Node 22, TypeScript strict, pnpm, vitest, fast-check. Exact dependency versions.
Docker (`docker/Dockerfile`) pins Chromium for reproducible capture/verify and
the future private-server move.

### Phone access (M6, preview)

`--lan` will serve the replica over HTTPS on the LAN IP with an `mkcert`
certificate and print a QR code. `mkcert` is installed in the Docker image but
**cannot be exercised in the cloud container** — the real "open from phone" test
is run locally. Tracked by fixture #15 (`lan-https-sw`).
