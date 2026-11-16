import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { pool } from "../src/database/pool.js";
import { reports } from "../src/services/reportService.js";
import { schemas } from "../src/validators/schemas.js";
import { reportFixture } from "./fixtures/report.js";

test("relatório completo usa mesmos filtros, valores sem duplicação e nenhum corte silencioso", async () => {
  const data = reportFixture(),
    original = pool.getConnection,
    calls = [];
  const results = [
    [data.summary],
    data.sales,
    data.payment,
    data.top,
    data.purchases,
    data.stock,
    data.movements,
    data.saleDetails,
    data.saleItems,
    data.purchaseDetails,
  ];
  let commits = 0,
    released = 0;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {
      commits++;
    },
    async rollback() {},
    release() {
      released++;
    },
    async execute(sql, args) {
      const result = results[calls.length];
      calls.push({ sql, args });
      return [result];
    },
  });
  try {
    const result = await reports({
      start: "2026-11-01",
      end: "2026-11-16",
      productId: 2,
      categoryId: 3,
    });
    assert.equal(result.summary.salesTotal, "180.00");
    assert.equal(result.summary.averageTicket, "180.00");
    assert.equal(result.summary.stockValue, "124.00");
    assert.equal(result.summary.purchasesTotal, "60.00");
    assert.equal(result.summary.physicalUnits, 7);
    assert.equal(result.summary.reservedUnits, 1);
    assert.equal(result.summary.unitsWithoutCost, 2);
    assert.equal(result.summary.lowStockCount, 1);
    assert.equal(result.saleDetails.length, 2);
    assert.equal(commits, 1);
    assert.equal(released, 1);
    assert.equal(calls.length, 10);
    for (const [i, { sql, args }] of calls.entries()) {
      assert.doesNotMatch(sql, /LIMIT/i);
      assert.deepEqual(
        args,
        i === 5 ? [2, 2, 3, 3] : ["2026-11-01", "2026-11-16", 2, 2, 3, 3],
      );
      assert.match(sql, /p.id=\?/);
      assert.match(sql, /p.category_id=\?/);
    }
    assert.match(calls[0].sql, /EXISTS/);
    assert.match(calls[4].sql, /pu.received_at/);
    assert.match(calls[2].sql, /reconciliation_status/);
    assert.match(calls[8].sql, /si.sale_id=s.id/);
    assert.doesNotMatch(calls[5].sql, /created_at|received_at/);
  } finally {
    pool.getConnection = original;
    await pool.end();
  }
});

test("filtros validam datas reais e intervalo e permitem todo o período", () => {
  assert.equal(
    schemas.reportQuery.safeParse({ start: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    schemas.reportQuery.safeParse({ start: "2026-11-17", end: "2026-11-16" })
      .success,
    false,
  );
  assert.equal(
    schemas.reportQuery.safeParse({ productId: { id: 1 } }).success,
    false,
  );
  assert.equal(
    schemas.reportQuery.safeParse({
      start: "",
      end: "",
      productId: "",
      categoryId: "",
    }).success,
    true,
  );
});

test("documento inclui todas as seções, dados históricos e escapa texto antes da impressão", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const context = vm.createContext({
    esc: (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    fmt: (v) =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(v)),
    fixture: reportFixture(),
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function reportDate("),
      source.indexOf("function prepareReportPrint("),
    ),
    context,
  );
  context.fixture.filters.productId = 1;
  context.fixture.stock.push({
    ...context.fixture.stock[0],
    name: '<img src=x onerror="alert(1)">',
  });
  const html = vm.runInContext(
    'renderReportDocument(fixture, { products: [{id:1,name:"Batom"}], categories: [] }, "Gestor")',
    context,
  );
  for (const title of [
    "01 /",
    "02 /",
    "03 /",
    "04 /",
    "05 /",
    "06 /",
    "07 /",
    "08 /",
    "09 /",
  ])
    assert.ok(html.includes(title));
  assert.match(html, /DOCUMENTO NÃO FISCAL/);
  assert.match(html, /valor integral dos documentos/);
  assert.match(html, /Histórico não conciliado/);
  assert.match(html, /16\/11\/2026/);
  assert.match(html, /12:30/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Venda #1002 · Cancelada/);
});

test("impressão usa o documento gerado, configura cupom/resumo e chama a impressão", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const classes = new Set();
  let printed = 0;
  const context = vm.createContext({
    currentView: "reports",
    $: (selector) =>
      selector === ".report-document"
        ? {}
        : { value: selector === "#report-paper" ? "receipt" : "summary" },
    document: {
      body: {
        classList: {
          contains: (name) => classes.has(name),
          add: (name) => classes.add(name),
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
      },
    },
    window: {
      print() {
        printed++;
      },
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function prepareReportPrint("),
      source.indexOf('window.addEventListener("beforeprint"'),
    ),
    context,
  );
  vm.runInContext("printReport()", context);
  assert.equal(printed, 1);
  assert.ok(classes.has("printing-report"));
  assert.ok(classes.has("report-receipt"));
  assert.ok(classes.has("report-summary-only"));
});
