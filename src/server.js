import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./database/pool.js";

try {
  await pool.query("SELECT 1");
  const server = app.listen(env.port, "0.0.0.0", () =>
    console.info(`N&M Calçados em ${env.origin}`),
  );
  server.requestTimeout = 30000;
  server.headersTimeout = 35000;
  server.on("error", async (error) => {
    console.error("Falha HTTP:", error.code || error.name);
    await pool.end();
    process.exitCode = 1;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timeout);
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  console.error(
    "Falha ao iniciar: banco indisponível.",
    error.code || error.name,
  );
  await pool.end();
  process.exitCode = 1;
}
