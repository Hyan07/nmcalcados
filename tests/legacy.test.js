import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, money, stock, hash } from "../src/database/legacy/plan.js";
import { importPlan, uniqueFields } from "../src/database/legacy/importer.js";
import { selectGescom } from "../src/database/legacy/sqlserver.js";
import { fixture } from "./fixtures/gescom.js";
test("mapeamento real: grades, órfãos, padrão, histórico e pagamentos", () => {
  const p = buildPlan(fixture()),
    vs = p.records.filter((r) => r.table === "product_variants");
  assert.deepEqual(p.stock, { grades: 8, defaults: 3, total: 11 });
  assert.equal(vs.length, 4);
  assert.equal(vs[0].values.color, "Preto");
  assert.equal(vs[0].values.size, "38");
  assert.equal(vs[0].values.sku, "SKU1");
  assert.equal(
    p.records.find((r) => r.table === "products" && r.key === "9999").values
      .active,
    0,
  );
  assert.equal(
    p.records.find((r) => r.table === "sales").values.is_historical,
    1,
  );
  assert.equal(
    p.records.find((r) => r.table === "sale_items").values.unit_price,
    "90.00",
  );
  assert.equal(
    p.records.find((r) => r.table === "payments").values.reconciliation_status,
    "LEGADO_NAO_CONCILIADO",
  );
});
test("valores inválidos interrompem; não se perde estoque negativo/fracionário", () => {
  assert.throws(() => stock(-1));
  assert.throws(() => stock(1.2));
  assert.equal(money(12.345), "12.35");
  const d = fixture();
  d.Grade_Medida_Produto_Detalhamento[0].Atual = -1;
  assert.throws(() => buildPlan(d));
});
test("histórico sem vínculo não inventa variante e mantém referências", () => {
  const d = fixture();
  d.Grade_Medida_Pre_Venda_Itens = [];
  const p = buildPlan(d);
  const i = p.records.find((r) => r.table === "sale_items");
  assert.equal(i.values.variant_id, null);
  assert.ok(i.values.product_id.ref);
  assert.equal(i.source.Prod, "0001");
  assert.ok(
    p.exceptions.some((e) => e.code === "HISTORICAL_VARIANT_UNRESOLVED"),
  );
});
function mock(legacy = []) {
  return {
    calls: [],
    async query(sql) {
      this.calls.push(sql);
      if (sql.includes("schema_migrations"))
        return [[{ name: "002_gescom.js" }]];
      if (sql.includes("JOIN roles")) return [[{ id: 1 }]];
      if (sql.includes("FROM legacy_records")) return [legacy];
      const table = sql.split(" FROM ")[1];
      return [
        legacy
          .filter((r) => r.entity === table)
          .map((r) => ({ id: r.target_id })),
      ];
    },
    async execute() {
      throw new Error("Dry run tentou escrever");
    },
  };
}
test("dry-run trata barcode duplicado e não faz escrita", async () => {
  const c = mock(),
    r = await importPlan(c, buildPlan(fixture()));
  assert.equal(r.counts.product_variants.imported, 4);
  assert.ok(
    r.exceptions.some(
      (e) =>
        e.code === "UNIQUE_COLLISION_PRESERVED" && e.fields[0] === "barcode",
    ),
  );
  assert.equal(r.committed, false);
  assert.ok(c.calls.every((q) => q.startsWith("SELECT")));
});
test("segunda execução ignora todos os mapeamentos já importados", async () => {
  const p = buildPlan(fixture());
  const legacy = p.records.map((r, i) => ({
    entity: r.table,
    key_hash: hash(r.key),
    target_id: i + 1,
    source_hash: r.sourceHash,
  }));
  const r = await importPlan(mock(legacy), p);
  assert.equal(
    Object.values(r.counts).reduce((n, c) => n + c.ignored, 0),
    p.records.length,
  );
  assert.equal(
    Object.values(r.counts).reduce((n, c) => n + c.imported, 0),
    0,
  );
});
test("conector rejeita SQL de escrita antes de conectar", async () => {
  for (const q of [
    "DELETE FROM Produto",
    "SELECT * INTO x FROM Produto",
    "SELECT 1; DROP TABLE Produto",
    "EXEC sp_help",
  ])
    await assert.rejects(selectGescom(q), /somente SELECT/);
});

test("desconto e acréscimo rateados preservam valor líquido dos itens", () => {
  const d = fixture();
  d.Pre_Venda_Itens[0].Valo = 100;
  let i = buildPlan(d).records.find((r) => r.table === "sale_items");
  assert.equal(i.values.discount, "10.00");
  assert.equal(i.values.surcharge, "0.00");
  d.Pre_Venda_Itens[0].Valo = 80;
  i = buildPlan(d).records.find((r) => r.table === "sale_items");
  assert.equal(i.values.discount, "0.00");
  assert.equal(i.values.surcharge, "10.00");
});
