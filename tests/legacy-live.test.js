import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { readSource } from "../src/database/legacy/source.js";
import { buildPlan } from "../src/database/legacy/plan.js";
import { importPlan } from "../src/database/legacy/importer.js";
import { closeGescomPool } from "../src/database/legacy/sqlserver.js";
test(
  "ensaio completo com fonte real: inserts e repetição, sempre ROLLBACK",
  { skip: process.env.RUN_GESCOM_LIVE_TESTS !== "1" },
  async () => {
    if (!process.env.DB_NAME?.endsWith("_test"))
      throw new Error("Requer banco isolado _test");
    const { pool } = await import("../src/database/pool.js");
    let c;
    try {
      const p = buildPlan(await readSource());
      c = await pool.getConnection();
      const [initial] = await c.query("SELECT COUNT(*) n FROM legacy_records");
      assert.equal(
        initial[0].n,
        0,
        "Use destino de teste sem importações anteriores",
      );
      const [before] = await c.query(
        "SELECT COALESCE(SUM(physical_stock),0) stock FROM product_variants",
      );
      const [movements] = await c.query(
        "SELECT COUNT(*) n FROM stock_movements",
      );
      await c.beginTransaction();
      const first = await importPlan(c, p, { dryRun: false });
      assert.equal(
        Object.values(first.counts).reduce((n, x) => n + x.imported, 0),
        p.records.length,
      );
      const [after] = await c.query(
        "SELECT SUM(physical_stock) stock FROM product_variants",
      );
      assert.equal(
        Number(after[0].stock) - Number(before[0].stock),
        p.stock.total,
      );
      const [linkedItems] = await c.query(
        "SELECT COUNT(*) n FROM sale_items si LEFT JOIN product_variants v ON v.id=si.variant_id LEFT JOIN products p ON p.id=COALESCE(si.product_id,v.product_id) WHERE p.id IS NOT NULL",
      );
      assert.equal(linkedItems[0].n, p.sourceCounts.Pre_Venda_Itens);
      const second = await importPlan(c, p, { dryRun: false });
      assert.equal(
        Object.values(second.counts).reduce((n, x) => n + x.imported, 0),
        0,
      );
      assert.equal(
        Object.values(second.counts).reduce((n, x) => n + x.ignored, 0),
        p.records.length,
      );
      const [afterMovements] = await c.query(
        "SELECT COUNT(*) n FROM stock_movements",
      );
      assert.equal(afterMovements[0].n, movements[0].n);
      await c.rollback();
      const [rolledBack] = await c.query(
        "SELECT COUNT(*) n FROM legacy_records",
      );
      assert.equal(rolledBack[0].n, 0);
      console.log(
        `Ensaio: ${p.records.length} registros inseridos, repetição ignorou todos, saldo ${p.stock.total}; rollback confirmado.`,
      );
    } finally {
      if (c) {
        await c.rollback();
        c.release();
      }
      await Promise.allSettled([pool.end(), closeGescomPool()]);
    }
  },
);
