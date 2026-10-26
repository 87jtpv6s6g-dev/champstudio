import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SpyHit {
  method: string;
  url: string;
  at: number;
}

/**
 * A server that stands in for "the outside world". Fixtures and the original
 * site are configured to reach it. During navigation of the MIRROR, zero hits
 * must arrive here: any hit is a hard violation of the autonomy criterion.
 */
export class SpyServer {
  private server: Server;
  readonly hits: SpyHit[] = [];
  private _port = 0;

  constructor() {
    this.server = createServer((req, res) => {
      this.hits.push({
        method: req.method ?? "GET",
        url: req.url ?? "",
        at: Date.now(),
      });
      // Respond so the caller doesn't hang; realistic-ish bodies by type.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ spy: true }));
    });
  }

  async listen(host = "127.0.0.1"): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, host, resolve));
    this._port = (this.server.address() as AddressInfo).port;
    return this._port;
  }

  get port(): number {
    return this._port;
  }

  get origin(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  reset(): void {
    this.hits.length = 0;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}
