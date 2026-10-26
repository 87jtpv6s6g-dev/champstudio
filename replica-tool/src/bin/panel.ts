import { ensureDirs } from "../config.js";
import { startPanel } from "../panel/server.js";

async function main() {
  ensureDirs();
  const panel = await startPanel();
  // eslint-disable-next-line no-console
  console.log(`\n  Pannello avviato su ${panel.url}\n  Apri questo indirizzo nel browser del computer.\n`);

  const stop = async () => {
    await panel.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Avvio del pannello fallito:", e);
  process.exit(1);
});
