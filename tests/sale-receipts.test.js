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

test("banco anterior: venda, conversão e reimpressão preservam garantia sem a coluna nova", async () => {
  const rows = new Map(),
    audits = new Map(),
    writes = [];
  let nextId = 90;
  let columnExists = false;
  const variant = {
    id: 1,
    product_id: 1,
    product_name: "Batom",
    color: "Rosa",
    size: "Único",
    variant_price: null,
    product_price: "25.00",
    physical_stock: 3,
    reserved_stock: 1,
    active: 1,
    product_active: 1,
  };
  await withConnection(
    async (sql, params) => {
      if (
        !columnExists &&
        (sql.includes("s.warranty_text") ||
          (sql.startsWith("INSERT INTO sales") &&
            sql.includes("warranty_text")))
      )
        throw Object.assign(
          new Error("Unknown column 'warranty_text' in 'field list'"),
          { code: "ER_BAD_FIELD_ERROR" },
        );
      if (sql.includes("FROM audit_logs")) {
        const entry =
          audits.get(params[0]) ||
          (params[1] != null && audits.get(params[1])?.saleId === params[2]
            ? audits.get(params[1])
            : null);
        return [[{ warranty_text: entry?.warrantyText || null }]];
      }
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
      if (sql.includes("FROM sales s")) return [[{ ...rows.get(params[0]) }]];
      if (sql.includes("FROM sale_items")) return [saleReceiptFixture().items];
      if (sql.includes("FROM payments"))
        return [
          [
            {
              method: "PIX",
              amount: "25.00",
              reconciliation_status: "RECEBIDO",
            },
          ],
        ];
      writes.push({ sql, params });
      if (sql.startsWith("INSERT INTO sales")) {
        const id = nextId++;
        rows.set(id, {
          id,
          order_id: sql.includes("(order_id,") ? params[0] : null,
          user_id: 1,
          total: "25.00",
          warranty_text: null,
        });
        return [{ insertId: id }];
      }
      if (sql.startsWith("INSERT INTO audit_logs"))
        audits.set(params[3], JSON.parse(params[5]));
      return [{ insertId: 1 }];
    },
    async () => {
      const sale = await createSale(
        schemas.sale.parse({
          payment: "PIX",
          items: [{ variantId: 1, quantity: 1 }],
          warrantyText: "Texto original do balcão",
        }),
        { id: 1 },
        null,
      );
      const converted = await convertOrder(
        8,
        "PIX",
        { id: 1 },
        null,
        "Texto original da reserva",
      );
      assert.equal(sale.total, "25.00");
      assert.equal(
        (await saleReceipt(sale.id, { id: 1, permissions: ["sales.create"] }))
          .warranty_text,
        "Texto original do balcão",
      );
      assert.equal(
        (
          await saleReceipt(converted.id, {
            id: 1,
            permissions: ["sales.view"],
          })
        ).warranty_text,
        "Texto original da reserva",
      );
      columnExists = true;
      assert.equal(
        (await saleReceipt(sale.id, { id: 1, permissions: ["sales.view"] }))
          .warranty_text,
        "Texto original do balcão",
        "A garantia anterior à migração continua disponível após adicionar a coluna",
      );
    },
  );
  assert.equal(
    writes.filter((x) => x.sql.startsWith("INSERT INTO sales")).length,
    2,
  );
  assert.equal(
    writes.filter((x) => x.sql.startsWith("UPDATE product_variants")).length,
    2,
  );
  assert.equal(
    writes.filter((x) => x.sql.startsWith("INSERT INTO payments")).length,
    2,
  );
});

test("compatibilidade não repete inserts diante de outros erros de banco", async () => {
  for (const error of [
    Object.assign(new Error("Unknown column 'subtotal' in 'field list'"), {
      code: "ER_BAD_FIELD_ERROR",
    }),
    Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
    Object.assign(new Error("Connection lost"), {
      code: "PROTOCOL_CONNECTION_LOST",
    }),
  ]) {
    let attempts = 0;
    await withConnection(
      async (sql) => {
        if (sql.includes("FOR UPDATE"))
          return [
            [
              {
                id: 1,
                active: 1,
                product_active: 1,
                product_price: "25.00",
                physical_stock: 1,
                reserved_stock: 0,
              },
            ],
          ];
        if (sql.startsWith("INSERT INTO sales")) {
          attempts++;
          throw error;
        }
        throw new Error("Não deveria gravar outros registros depois da falha");
      },
      async () => {
        await assert.rejects(
          createSale(
            schemas.sale.parse({
              payment: "PIX",
              items: [{ variantId: 1, quantity: 1 }],
            }),
            { id: 1 },
            null,
          ),
          { code: error.code },
        );
      },
    );
    assert.equal(attempts, 1);
  }
});

test("falha ao preservar garantia na auditoria reverte a transação no banco anterior", async () => {
  const original = pool.getConnection;
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
    async execute(sql) {
      if (sql.includes("FOR UPDATE"))
        return [
          [
            {
              id: 1,
              product_name: "Batom",
              color: "Rosa",
              size: "Único",
              active: 1,
              product_active: 1,
              product_price: "25.00",
              physical_stock: 1,
              reserved_stock: 0,
            },
          ],
        ];
      if (sql.startsWith("INSERT INTO sales") && sql.includes("warranty_text"))
        throw Object.assign(
          new Error("Unknown column 'warranty_text' in 'field list'"),
          { code: "ER_BAD_FIELD_ERROR" },
        );
      if (sql.startsWith("INSERT INTO audit_logs"))
        throw Object.assign(new Error("Audit unavailable"), {
          code: "ER_DISK_FULL",
        });
      return [{ insertId: 1 }];
    },
  });
  try {
    await assert.rejects(
      createSale(
        schemas.sale.parse({
          payment: "PIX",
          items: [{ variantId: 1, quantity: 1 }],
        }),
        { id: 1 },
        null,
      ),
      { code: "ER_DISK_FULL" },
    );
    assert.equal(commits, 0);
    assert.equal(rollbacks, 1);
  } finally {
    pool.getConnection = original;
  }
});

test("cupom ajusta altura ao conteúdo e recalcula para vendas mais curtas", async () => {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  let pixels = 384,
    size;
  const classes = new Set();
  const root = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    getBoundingClientRect() {
      assert.ok(classes.has("sale-receipt-measure"));
      return { height: pixels };
    },
  };
  const context = vm.createContext({
    root,
    document: {
      styleSheets: [
        {
          get cssRules() {
            throw new Error("Cross-origin stylesheet");
          },
        },
        {
          cssRules: [
            {
              type: 6,
              selectorText: "sale-coupon",
              style: {
                setProperty(name, value) {
                  assert.equal(name, "size");
                  size = value;
                },
              },
            },
          ],
        },
      ],
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function fitSaleReceiptPage("),
      source.indexOf("async function printSaleReceipt("),
    ),
    context,
  );
  vm.runInContext("fitSaleReceiptPage(root)", context);
  assert.equal(size, "80mm 108mm");
  assert.equal(classes.size, 0);
  pixels = 192;
  vm.runInContext("fitSaleReceiptPage(root)", context);
  assert.equal(size, "80mm 57mm");
});
