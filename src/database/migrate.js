import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const root = await mysql.createConnection({
  ...env.db,
  database: undefined,
  multipleStatements: false,
});
try {
  try {
    await root.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    if (
      !["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR"].includes(
        error.code,
      )
    )
      throw error;
    console.warn(
      "Sem permissão para criar banco; usando o banco já provisionado no painel.",
    );
  }
} finally {
  await root.end();
}
const conn = await mysql.createConnection({
  ...env.db,
  multipleStatements: true,
});
try {
  await conn.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const name of (await fs.readdir(dir))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const [rows] = await conn.execute(
      "SELECT name FROM schema_migrations WHERE name = ?",
      [name],
    );
    if (rows.length) continue;
    await conn.query(await fs.readFile(path.join(dir, name), "utf8"));
    await conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", [
      name,
    ]);
    console.info(`Migração aplicada: ${name}`);
  }
} finally {
  await conn.end();
}
