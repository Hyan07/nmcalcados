import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { pool } from "../src/database/pool.js";
import { dashboard } from "../src/services/reportService.js";

test("dashboard consulta investimento pelo custo e estoque físico, incluindo reservas e inativos", async () => {
  const original = pool.query;
  pool.query = async (sql) => {
    if (sql.includes("unitsWithoutCost")) {
      assert.match(sql, /v\.physical_stock \* COALESCE\(v\.cost,p\.cost,0\)/);
      assert.doesNotMatch(sql, /reserved_stock|active\s*=|p\.price|v\.price/);
      assert.match(sql, /COALESCE\(SUM\(/);
      return [[{ total: "12500.50", units: "123", unitsWithoutCost: "2" }]];
    }
    if (sql.includes("SELECT COUNT(*) count"))
      return [[{ count: 0, total: "0.00" }]];
    return [[]];
  };
  try {
    const data = await dashboard();
    assert.deepEqual(data.stockInvestment, {
      total: "12500.50",
      units: "123",
      unitsWithoutCost: "2",
    });
    assert.equal(data.pendingOrders, 0);
    assert.deepEqual(data.topProducts, []);
  } finally {
    pool.query = original;
    await pool.end();
  }
});

test("cartão mostra total em reais, milhares e unidades sem custo, inclusive estoque vazio", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const render = source.slice(
    source.indexOf("async function dashboard()"),
    source.indexOf("function bindGo()"),
  );
  for (const investment of [
    { total: "12500.50", units: "123", unitsWithoutCost: "2" },
    { total: "0.00", units: "0", unitsWithoutCost: "0" },
  ]) {
    const nodes = new Map();
    const get = (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, {});
      return nodes.get(selector);
    };
    await vm.runInNewContext(`${render}\ndashboard()`, {
      $: get,
      api: async () => ({
        stockInvestment: investment,
        salesToday: { total: 0, count: 0 },
        pendingOrders: 0,
        lowStock: 0,
        recentOrders: [],
        topProducts: [],
      }),
      fmt: (value) =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(Number(value)),
      can: () => false,
      table: () => "",
      bindGo() {},
    });
    const html = get("#view-content").innerHTML;
    assert.match(html, /INVESTIDO EM ESTOQUE/);
    assert.match(html, /incluindo reservas/);
    if (Number(investment.units)) {
      assert.match(html, /12\.500,50/);
      assert.match(html, /12,5 mil reais · 123 unidade/);
      assert.match(html, /2 unidade\(s\) com custo zerado ou não informado/);
    } else {
      assert.match(html, /0 mil reais · 0 unidade/);
      assert.doesNotMatch(html, /com custo zerado/);
    }
  }
});
