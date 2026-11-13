import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { readSource } from "./source.js";
import { buildPlan } from "./plan.js";
import { importPlan } from "./importer.js";
import { closeGescomPool } from "./sqlserver.js";
import { pool } from "../pool.js";
const args = process.argv.slice(2),
  dryRun = args.includes("--dry-run");
let conn,
  locked = false,
  report = { dryRun, committed: false, counts: {}, errors: [] };
const reportFile = path.resolve(
  "reports",
  `gescom-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
try {
  if (args.some((a) => a !== "--dry-run"))
    throw new Error("Uso: npm run migrate:gescom -- [--dry-run]");
  console.info(
    dryRun
      ? "GescomPro: dry-run, nenhuma escrita MySQL."
      : "GescomPro: importação transacional.",
  );
  const plan = buildPlan(await readSource());
  conn = await pool.getConnection();
  if (!dryRun) {
    const [rows] = await conn.query(
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(),':gescom-import'),256),0) AS acquired",
    );
    if (rows[0].acquired !== 1)
      throw new Error("Outra migração Gescom está em execução");
    locked = true;
    await conn.beginTransaction();
  } else await conn.query("START TRANSACTION READ ONLY");
  report = await importPlan(conn, plan, { dryRun });
  // Saldo inicial = somente variantes novas. O histórico não chama serviços de estoque.
  if (dryRun) await conn.rollback();
  else {
    await conn.commit();
    report.committed = true;
  }
} catch (error) {
  if (conn) await conn.rollback();
  if (error.report) report = error.report;
  // Não registrar mensagens de drivers: podem conter SQL, dados pessoais ou host.
  report.errors.push({
    code: error.code || "MIGRATION_FAILED",
    message: error.code
      ? "Falha de banco; confira conectividade e esquema."
      : error.message,
  });
  report.committed = false;
  if (!dryRun) {
    report.rolledBack = true;
    for (const count of Object.values(report.counts)) {
      count.rolledBack = count.imported;
      count.imported = 0;
    }
  }
  process.exitCode = 1;
} finally {
  if (locked)
    await conn
      .query(
        "SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(),':gescom-import'),256))",
      )
      .catch(() => {});
  conn?.release();
  await Promise.allSettled([pool.end(), closeGescomPool()]);
  await fs.mkdir(path.dirname(reportFile), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(reportFile), 0o700);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.table(report.counts);
  console.info(
    `Exceções: ${report.exceptions?.length || 0}; erros: ${report.errors.length}; commit: ${report.committed}`,
  );
  console.info(`Relatório privado: ${reportFile}`);
  if (report.errors.length) console.error(report.errors);
}
