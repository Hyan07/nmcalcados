import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/database/pool.js";
import { stockList } from "../src/services/stockService.js";
import { schemas } from "../src/validators/schemas.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("filtros de estoque são combinados na contagem e paginação com parâmetros seguros", async () => {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return sql.startsWith("SELECT COUNT") ? [[{ total: 72 }]] : [[{ id: 1 }]];
  };
  try {
    const q = "Batom ' OR 1=1 --";
    const data = await stockList({
      q,
      categoryId: 2,
      brandId: 3,
      color: "Vermelho",
      size: "Único",
      availability: "available",
      active: "active",
      page: 2,
      limit: 20,
    });
    assert.equal(data.total, 72);
    assert.deepEqual(data.items, [{ id: 1 }]);
    const expected = [...Array(4).fill(`%${q}%`), 2, 3, "Vermelho", "Único"];
    assert.deepEqual(calls[0].params, expected);
    assert.deepEqual(calls[1].params, [...expected, 20, 20]);
    assert.equal(
      calls[0].sql.split("WHERE ")[1],
      calls[1].sql.split("WHERE ")[1].split(" ORDER BY")[0],
    );
    for (const { sql } of calls) {
      assert.ok(!sql.includes(q));
      assert.match(
        sql,
        /p.name LIKE \? OR p.model LIKE \? OR v.sku LIKE \? OR v.barcode LIKE \?/,
      );
      assert.match(
        sql,
        /p.category_id=\? AND p.brand_id=\? AND v.color=\? AND v.size=\?/,
      );
      assert.match(sql, /v.physical_stock>v.reserved_stock/);
      assert.match(sql, /p.active=1 AND v.active=1/);
    }
    for (const [availability, condition] of [
      ["low", "v.physical_stock-v.reserved_stock<=v.minimum_stock"],
      ["unavailable", "v.physical_stock-v.reserved_stock<=0"],
      ["reserved", "v.reserved_stock>0"],
    ]) {
      calls.length = 0;
      await stockList({ availability, active: "inactive" });
      assert.ok(
        calls.every(
          ({ sql }) =>
            sql.includes(condition) &&
            sql.includes("(p.active=0 OR v.active=0)"),
        ),
      );
    }
    for (const low of [false, "false", undefined]) {
      calls.length = 0;
      await stockList({ low });
      assert.ok(
        calls.every(({ sql }) => !sql.includes("WHERE")),
        "false não deve ativar estoque baixo",
      );
    }
    calls.length = 0;
    await stockList({ low: "true" });
    assert.match(
      calls[0].sql,
      /WHERE v.physical_stock-v.reserved_stock<=v.minimum_stock/,
    );
  } finally {
    pool.query = original;
    await pool.end();
  }
});

test("parâmetros da busca aceitam filtros vazios e rejeitam objetos e paginação inválida", () => {
  assert.equal(
    schemas.stockQuery.parse({
      categoryId: "",
      availability: "",
      q: "  bolsa  ",
    }).q,
    "bolsa",
  );
  for (const query of [
    { color: { malicious: "x" } },
    { categoryId: "x" },
    { page: "Infinity" },
    { page: "1.5" },
    { availability: "wrong" },
    { limit: 101 },
  ]) {
    assert.equal(schemas.stockQuery.safeParse(query).success, false);
  }
});

test("tela de estoque envia filtros, preserva na paginação e permite limpar", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const render = source.slice(
    source.indexOf("async function stock(page = 1)"),
    source.indexOf("async function movements()"),
  );
  const nodes = new Map(),
    calls = [],
    filters = { stock: { q: "Batom", color: "Vermelho" } };
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { addEventListener() {} });
    return nodes.get(selector);
  };
  let paginate;
  const context = vm.createContext({
    $: get,
    filters,
    URLSearchParams,
    esc: String,
    can: () => false,
    table: () => "",
    pagination: () => "",
    movements() {},
    toast(message) {
      throw new Error(message);
    },
    setupPagination: (callback) => {
      paginate = callback;
    },
    FormData: class {
      constructor(target) {
        return target.entries;
      }
    },
    api: async (url) => {
      calls.push(url);
      if (url.endsWith("/filters"))
        return {
          categories: [],
          brands: [],
          colors: ["Vermelho"],
          sizes: ["Único"],
        };
      return { items: [], total: 0 };
    },
  });
  await vm.runInContext(`${render}\nstock(2)`, context);
  assert.match(calls[0], /q=Batom&color=Vermelho&page=2/);
  assert.match(get("#view-content").innerHTML, /Cor \/ tom/);
  await paginate(3);
  assert.match(calls[2], /q=Batom&color=Vermelho&page=3/);
  get("#stock-filters").onsubmit({
    preventDefault() {},
    target: {
      entries: [
        ["q", "  Bolsa  "],
        ["availability", "low"],
      ],
    },
  });
  await new Promise(setImmediate);
  assert.match(calls[4], /q=Bolsa&availability=low&page=1/);
  get("#stock-clear").onclick();
  await new Promise(setImmediate);
  assert.equal(calls[6], "/api/admin/stock?page=1");
});
