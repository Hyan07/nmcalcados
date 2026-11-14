import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/database/pool.js";
import { findBarcode } from "../src/services/productService.js";

test("busca do leitor aceita GTIN e SKU, preserva zeros e bloqueia ambiguidades", async () => {
  const original = pool.execute;
  const calls = [];
  const samples = new Map([
    [
      "07900190052717",
      [
        {
          variantId: 1,
          barcode: "07900190052717",
          sku: "G00001002002",
          available: 2,
        },
      ],
    ],
    [
      "G00002001002",
      [{ variantId: 2, barcode: null, sku: "G00002001002", available: 1 }],
    ],
    ["AMBIGUOUS", [{ variantId: 3 }, { variantId: 4 }]],
  ]);
  pool.execute = async (sql, params) => {
    assert.match(sql, /\(v\.barcode=\? OR v\.sku=\?\)/);
    assert.match(sql, /v\.active=1 AND p\.active=1 LIMIT 2/);
    assert.equal(params[0], params[1]);
    calls.push(params[0]);
    return [samples.get(params[0]) || []];
  };
  try {
    assert.equal((await findBarcode(" 07900190052717\r\n")).variantId, 1);
    assert.equal((await findBarcode("G00002001002")).variantId, 2);
    await assert.rejects(findBarcode("UNKNOWN"), { status: 404 });
    await assert.rejects(findBarcode("AMBIGUOUS"), {
      status: 409,
      code: "AMBIGUOUS_PRODUCT_CODE",
    });
    const before = calls.length;
    for (const value of ["", " ".repeat(3), null, "x".repeat(101)])
      await assert.rejects(findBarcode(value), { status: 400 });
    assert.equal(calls.length, before);
  } finally {
    pool.execute = original;
    await pool.end();
  }
});
