import "dotenv/config";
import fs from "node:fs/promises";
import { getGescomPool, closeGescomPool } from "./sqlserver.js";
try {
  const pool = await getGescomPool();
  const columns = (
    await pool
      .request()
      .query(
        `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION`,
      )
  ).recordset;
  const keys = (
    await pool
      .request()
      .query(
        `SELECT tc.TABLE_SCHEMA,tc.TABLE_NAME,tc.CONSTRAINT_TYPE,kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA=kcu.TABLE_SCHEMA ORDER BY tc.TABLE_NAME,kcu.ORDINAL_POSITION`,
      )
  ).recordset;
  const fks = (
    await pool
      .request()
      .query(
        `SELECT OBJECT_NAME(parent_object_id) AS source_table,COL_NAME(parent_object_id,parent_column_id) AS source_column,OBJECT_NAME(referenced_object_id) AS target_table,COL_NAME(referenced_object_id,referenced_column_id) AS target_column FROM sys.foreign_key_columns`,
      )
  ).recordset;
  await fs.mkdir("reports", { recursive: true, mode: 0o700 });
  await fs.chmod("reports", 0o700);
  await fs.writeFile(
    "reports/gescom-schema.json",
    JSON.stringify({ columns, keys, fks }, null, 2),
    { mode: 0o600 },
  );
  console.log("Esquema gravado em reports/gescom-schema.json");
  console.log(
    [...new Set(columns.map((c) => c.TABLE_NAME))]
      .filter((n) =>
        /fabric|grupo|produto|client|fornec|vend|venda|cupom|pag|receb|pedido|movim/i.test(
          n,
        ),
      )
      .join("\n"),
  );
} catch (error) {
  console.error("Inspeção falhou:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await closeGescomPool();
}
