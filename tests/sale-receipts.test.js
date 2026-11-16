import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { pool } from "../src/database/pool.js";
import {
  createSale,
  convertOrder,
  saleReceipt,
} from "../src/services/saleService.js";
import { schemas } from "../src/validators/schemas.js";
import { permitAny } from "../src/middlewares/auth.js";
import { up } from "../src/database/migrations/003_sale_receipts.js";
import { saleReceiptFixture } from "./fixtures/sale-receipt.js";
after(() => pool.end());

async function withConnection(execute, work) {
  const original = pool.getConnection;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    execute,
  });
  try {
    await work();
  } finally {
    pool.getConnection = original;
  }
}

test("novas vendas e conversões gravam o texto de garantia no mesmo registro da venda", async () => {
  const writes = [];
  const variant = {
    id: 1,
    product_id: 1,
    product_name: "Batom",
    color: "Rosa",
    size: "Único",
    variant_price: null,
    product_price: "25.00",
    physical_stock: 2,
    reserved_stock: 1,
    active: 1,
    product_active: 1,
  };
  await withConnection(
    async (sql, params) => {
      if (sql.startsWith("SELECT id,status,customer_id"))
        return [
          [
            {
              id: 8,
              status: "CONFIRMADO",
              customer_id: 1,
              total: "25.00",
              expires_at: new Date(Date.now() + 60000),
            },
          ],
        ];
      if (sql.startsWith("SELECT * FROM order_items"))
        return [
          [
            {
              variant_id: 1,
              product_name: "Batom",
              color: "Rosa",
              size: "Único",
              quantity: 1,
              unit_price: "25.00",
              subtotal: "25.00",
            },
          ],
        ];
      if (sql.includes("FOR UPDATE")) return [[{ ...variant }]];
      writes.push({ sql, params });
      return [{ insertId: 50 }];
    },
    async () => {
      await createSale(
        schemas.sale.parse({
          payment: "PIX",
          items: [{ variantId: 1, quantity: 1 }],
          warrantyText: "Texto registrado na venda",
        }),
        { id: 1 },
        null,
      );
      await convertOrder(
        8,
        "PIX",
        { id: 1 },
        null,
        "Texto registrado na conversão",
      );
    },
  );
  const sales = writes.filter((x) => x.sql.startsWith("INSERT INTO sales"));
  assert.equal(sales.length, 2);
  for (const sale of sales) assert.match(sale.sql, /warranty_text/);
  assert.equal(sales[0].params.at(-1), "Texto registrado na venda");
  assert.equal(sales[1].params.at(-1), "Texto registrado na conversão");
});

test("reimpressão lê valores e garantia da venda original sem movimentar estoque", async () => {
  const fixture = saleReceiptFixture(),
    queries = [];
  await withConnection(
    async (sql, params) => {
      queries.push(sql);
      assert.deepEqual(params, [1001]);
      if (sql.includes("FROM sale_items")) return [fixture.items];
      if (sql.includes("FROM payments")) return [fixture.payments];
      return [[{ ...fixture, user_id: 7 }]];
    },
    async () => {
      const result = await saleReceipt(1001, {
        id: 7,
        permissions: ["sales.create"],
      });
      assert.equal(result.warranty_text, fixture.warranty_text);
      assert.equal(result.total, "180.00");
      assert.equal(result.items[0].unit_price, "150.00");
      assert.equal(queries.length, 3);
      assert.ok(queries.every((sql) => sql.trim().startsWith("SELECT")));
      assert.doesNotMatch(queries.join(" "), /JOIN products|UPDATE|INSERT/);
      await assert.rejects(
        saleReceipt(1001, { id: 8, permissions: ["sales.create"] }),
        { status: 403 },
      );
      assert.equal(
        (await saleReceipt(1001, { id: 8, permissions: ["sales.view"] })).id,
        1001,
      );
    },
  );
});

test("cupom valida garantia, respeita permissões e migration pode ser retomada", async () => {
  assert.equal(
    schemas.sale.safeParse({
      payment: "PIX",
      items: [{ variantId: 1, quantity: 1 }],
      warrantyText: "x".repeat(2001),
    }).success,
    false,
  );
  assert.equal(
    schemas.sale.parse({
      payment: "PIX",
      items: [{ variantId: 1, quantity: 1 }],
      warrantyText: " ",
    }).warrantyText,
    null,
  );
  for (const permission of ["sales.view", "sales.create"]) {
    let error;
    permitAny("sales.view", "sales.create")(
      { user: { permissions: [permission] } },
      null,
      (e) => {
        error = e;
      },
    );
    assert.equal(error, undefined);
  }
  let denied;
  permitAny("sales.view", "sales.create")(
    { user: { permissions: ["stock.view"] } },
    null,
    (e) => {
      denied = e;
    },
  );
  assert.equal(denied.status, 403);
  let exists = false,
    alterations = 0;
  const conn = {
    async execute() {
      return [exists ? [{ COLUMN_NAME: "warranty_text" }] : []];
    },
    async query() {
      alterations++;
      exists = true;
    },
  };
  await up(conn);
  await up(conn);
  assert.equal(alterations, 1);
});

async function browserFunctions() {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  return source.slice(
    source.indexOf("function receiptWarrantyField("),
    source.indexOf("let cameraStream ="),
  );
}

test("concluir venda mostra escolha de impressão uma vez e limpa o carrinho após salvar", async () => {
  let resolve,
    posts = 0,
    prompt,
    body;
  const nodes = new Map([
    ["#finish-sale", {}],
    ["#pos-discount", { value: "0" }],
    ["#pos-payment", { value: "PIX" }],
    ["#sale-warranty", { value: "Garantia informada" }],
  ]);
  const context = vm.createContext({
    $: (key) => nodes.get(key),
    saleSubmitting: false,
    posCart: [{ variantId: 1, quantity: 1, discount: 0 }],
    confirmAction: () => true,
    renderPosCart() {},
    toast() {},
    setView() {},
    window: { addEventListener() {} },
    api: (url, method, data) => {
      posts++;
      body = data;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  vm.runInContext(await browserFunctions(), context);
  context.promptSaleReceipt = (sale) => {
    prompt = sale;
  };
  const pending = vm.runInContext("finishSale()", context);
  await vm.runInContext("finishSale()", context);
  assert.equal(posts, 1);
  assert.equal(nodes.get("#finish-sale").disabled, true);
  resolve({ id: 50, total: "25.00" });
  await pending;
  assert.equal(body.warrantyText, "Garantia informada");
  assert.equal(prompt.id, 50);
  assert.equal(vm.runInContext("posCart.length", context), 0);
});

test("não imprimir fecha alerta; erro de impressão mantém venda salva sem reenviar POST", async () => {
  const nodes = new Map(),
    messages = [];
  let closed = 0;
  const context = vm.createContext({
    $: (key) => {
      if (!nodes.has(key)) nodes.set(key, {});
      return nodes.get(key);
    },
    window: { addEventListener() {} },
    dialog() {},
    fmt: String,
    closeDialog() {
      closed++;
    },
    toast: (text) => messages.push(text),
  });
  vm.runInContext(await browserFunctions(), context);
  context.printSaleReceipt = async () => {
    throw new Error("Impressora indisponível");
  };
  vm.runInContext("promptSaleReceipt({ id: 1, total: 25 })", context);
  nodes.get("#receipt-skip").onclick();
  assert.equal(closed, 1);
  await nodes.get("#receipt-confirm").onclick();
  assert.match(messages[0], /Venda salva/);
  assert.equal(nodes.get("#receipt-confirm").disabled, false);
});

test("cupom inclui itens, pagamento e garantia com texto seguro e identifica cancelamento e legado", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const fixture = saleReceiptFixture();
  fixture.warranty_text = '<script>alert("x")</script>\nGuarde o comprovante.';
  const context = vm.createContext({
    fixture,
    window: { addEventListener() {} },
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
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function reportDate("),
      source.indexOf("function reportTable("),
    ),
    context,
  );
  vm.runInContext(await browserFunctions(), context);
  const html = vm.runInContext("renderSaleReceipt(fixture)", context);
  assert.match(html, /CUPOM DE VENDA #1001/);
  assert.match(html, /180,00/);
  assert.match(html, /GARANTIA E ATENDIMENTO/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /PIX/);
  fixture.status = "CANCELADA";
  fixture.warranty_text = null;
  const old = vm.runInContext("renderSaleReceipt(fixture)", context);
  assert.match(old, /VENDA CANCELADA/);
  assert.match(old, /não foi registrado nesta venda/);
});

test("impressão busca somente o cupom salvo, abre a janela e limpa o documento depois", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const nodes = new Map(),
    classes = new Set(["printing-report"]),
    handlers = new Map(),
    calls = [];
  let printed = 0;
  const context = vm.createContext({
    $: (key) => nodes.get(key),
    api: async (...args) => {
      calls.push(args);
      return saleReceiptFixture();
    },
    document: {
      createElement() {
        return {
          remove() {
            nodes.delete("#sale-receipt-print");
          },
        };
      },
      body: {
        appendChild(element) {
          nodes.set("#" + element.id, element);
        },
        classList: {
          add: (name) => classes.add(name),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
        },
      },
    },
    window: {
      print() {
        printed++;
      },
      addEventListener: (event, fn) => handlers.set(event, fn),
    },
    closeDialog() {},
    esc: String,
    fmt: String,
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function reportDate("),
      source.indexOf("function reportTable("),
    ),
    context,
  );
  vm.runInContext(await browserFunctions(), context);
  await vm.runInContext("printSaleReceipt(1001)", context);
  assert.deepEqual(calls, [["/api/admin/sales/1001/receipt"]]);
  assert.equal(printed, 1);
  assert.ok(
    nodes
      .get("#sale-receipt-print")
      .innerHTML.includes("GARANTIA E ATENDIMENTO"),
  );
  assert.ok(classes.has("printing-sale-receipt"));
  assert.ok(!classes.has("printing-report"));
  handlers.get("afterprint")();
  assert.equal(nodes.has("#sale-receipt-print"), false);
  assert.equal(classes.has("printing-sale-receipt"), false);
});
