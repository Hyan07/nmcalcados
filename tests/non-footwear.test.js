import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { schemas } from "../src/validators/schemas.js";

test("variação sem cor/tamanho usa os mesmos valores dos produtos importados sem grade", () => {
  for (const fields of [
    {},
    { color: "", size: "  " },
    { color: null, size: null },
  ]) {
    const variant = schemas.variant.parse({ productId: 1, ...fields });
    assert.equal(variant.color, "Padrão");
    assert.equal(variant.size, "Único");
  }
  const clothing = schemas.variant.parse({
    productId: 1,
    color: "Azul",
    size: "M",
  });
  assert.equal(clothing.size, "M");
  assert.equal(clothing.color, "Azul");
  assert.equal(
    schemas.variant.parse({ productId: 1, color: "Preto", size: "39" }).size,
    "39",
  );
  assert.equal(
    schemas.variant.safeParse({ productId: 1, size: "x".repeat(21) }).success,
    false,
  );
});

async function storefront(variants) {
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        innerHTML: "",
        textContent: "",
        value: "1",
        disabled: false,
        addEventListener(type, listener) {
          this[type] = listener;
        },
      });
    return nodes.get(selector);
  };
  const added = [];
  const source = (
    await readFile(new URL("../public/js/product.js", import.meta.url), "utf8")
  ).replace(/^import .*;\n/, "");
  await vm.runInNewContext(`(async () => { ${source} })()`, {
    $: get,
    initCart() {},
    fmt: String,
    esc: String,
    toast() {},
    addCart: (...args) => added.push(args),
    api: async () => ({ name: "Produto", price: 20, variants, images: [] }),
    location: { pathname: "/produto/teste" },
    window: { addEventListener() {} },
    document: { querySelectorAll: () => [] },
  });
  return { get, added };
}

test("produto sem grade pode entrar na sacola sem exigir numeração", async () => {
  const variant = { id: 1, color: "Padrão", size: "Único", available: 3 };
  const { get, added } = await storefront([variant]);
  assert.equal(get("#add-to-cart").disabled, false);
  assert.match(get("#stock-hint").textContent, /3 disponíveis/);
  get("#add-to-cart").click();
  assert.equal(added[0][1].id, 1);
  assert.equal(added[0][2], 1);
});

test("tamanho único respeita a cor escolhida e o estoque", async () => {
  const { get, added } = await storefront([
    { id: 1, color: "Azul", size: "Único", available: 0 },
    { id: 2, color: "Preto", size: "Único", available: 2 },
  ]);
  get("#add-to-cart").click();
  assert.equal(added[0][1].id, 2);
  get("#color-options").click({
    target: { closest: () => ({ dataset: { color: "Azul" } }) },
  });
  assert.equal(get("#add-to-cart").disabled, true);
  assert.equal(get("#stock-hint").textContent, "Esgotado");
});

test("calçados e roupas continuam exigindo seleção do tamanho", async () => {
  for (const sizes of [
    ["38", "39"],
    ["P", "M"],
  ]) {
    const { get, added } = await storefront(
      sizes.map((size, i) => ({
        id: i + 1,
        color: "Preto",
        size,
        available: 2,
      })),
    );
    assert.equal(get("#add-to-cart").disabled, true);
    get("#size-options").click({
      target: { closest: () => ({ dataset: { size: sizes[1] } }) },
    });
    assert.equal(get("#add-to-cart").disabled, false);
    get("#add-to-cart").click();
    assert.equal(added[0][1].id, 2);
  }
});

test("venda de acessório registra tamanho único, pagamento e baixa só no estoque disponível", async () => {
  const { pool } = await import("../src/database/pool.js");
  const { createSale } = await import("../src/services/saleService.js");
  const original = pool.getConnection;
  const variant = {
    id: 9,
    product_id: 1,
    product_name: "Bolsa",
    color: "Padrão",
    size: "Único",
    product_price: "25.00",
    variant_price: null,
    active: 1,
    product_active: 1,
    physical_stock: 3,
    reserved_stock: 1,
  };
  const writes = [];
  let commits = 0,
    rollbacks = 0;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {
      commits++;
    },
    async rollback() {
      rollbacks++;
    },
    release() {},
    async execute(sql, params) {
      if (sql.includes("FOR UPDATE")) return [[{ ...variant }]];
      writes.push({ sql, params });
      return [{ insertId: 10 }];
    },
  });
  try {
    const input = schemas.sale.parse({
      payment: "PIX",
      items: [{ variantId: 9, quantity: 2 }],
    });
    const sale = await createSale(input, { id: 1 }, "127.0.0.1");
    assert.equal(sale.total, "50.00");
    assert.equal(commits, 1);
    assert.deepEqual(
      writes.find((x) => x.sql.startsWith("UPDATE product_variants")).params,
      [1, 1, 9],
    );
    const item = writes.find((x) => x.sql.startsWith("INSERT INTO sale_items"));
    assert.deepEqual(item.params.slice(2, 6), ["Bolsa", "Padrão", "Único", 2]);
    assert.deepEqual(
      writes.find((x) => x.sql.startsWith("INSERT INTO payments")).params,
      [10, "PIX", "50.00"],
    );
    const count = writes.length;
    await assert.rejects(
      createSale(
        schemas.sale.parse({
          payment: "PIX",
          items: [{ variantId: 9, quantity: 3 }],
        }),
        { id: 1 },
        null,
      ),
      { code: "INSUFFICIENT_STOCK" },
    );
    assert.equal(writes.length, count);
    assert.equal(rollbacks, 1);
  } finally {
    pool.getConnection = original;
    await pool.end();
  }
});
