import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/gescom.js";
import { buildPlan } from "../src/database/legacy/plan.js";
import { importPlan } from "../src/database/legacy/importer.js";
test(
  "importação MySQL: rollback, idempotência, histórico e proteção do saldo",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    if (!process.env.DB_NAME?.endsWith("_test"))
      throw new Error("Use banco isolado _test");
    const { pool } = await import("../src/database/pool.js");
    const { cancelSale } = await import("../src/services/saleService.js");
    const c = await pool.getConnection();
    try {
      const p = buildPlan(fixture());
      await c.beginTransaction();
      const [before] = await c.query("SELECT COUNT(*) n FROM products");
      await importPlan(c, p, { dryRun: false });
      await c.rollback();
      const [after] = await c.query("SELECT COUNT(*) n FROM products");
      assert.equal(before[0].n, after[0].n);
      await c.beginTransaction();
      const first = await importPlan(c, p, { dryRun: false });
      assert.equal(first.counts.product_variants.imported, 4);
      await c.commit();
      const [v] = await c.query(
        "SELECT SUM(physical_stock) n FROM product_variants",
      );
      assert.equal(Number(v[0].n), 11);
      await c.beginTransaction();
      const second = await importPlan(c, p, { dryRun: false });
      await c.commit();
      assert.equal(
        Object.values(second.counts).reduce((n, r) => n + r.imported, 0),
        0,
      );
      const [barcodes] = await c.query(
        "SELECT COUNT(*) n FROM product_variants WHERE barcode='789'",
      );
      assert.equal(barcodes[0].n, 1);
      const [sales] = await c.query(
        "SELECT id,user_id FROM sales WHERE is_historical=1",
      );
      assert.equal(sales.length, 1);
      await assert.rejects(
        cancelSale(sales[0].id, { id: sales[0].user_id }, "127.0.0.1"),
        { code: "HISTORICAL_SALE" },
      );
      const [stock] = await c.query(
        "SELECT SUM(physical_stock) n FROM product_variants",
      );
      assert.equal(Number(stock[0].n), 11);
    } finally {
      await c.rollback();
      c.release();
      await pool.end();
    }
  },
);
