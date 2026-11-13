import test from "node:test";
import assert from "node:assert/strict";

test(
  "fluxo transacional completo de estoque e pedidos (RUN_DB_TESTS=1)",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    if (!process.env.DB_NAME?.endsWith("_test"))
      throw new Error("Use um banco exclusivo com nome terminado em _test");
    const [
      { pool },
      { saveProduct, saveVariant },
      { adjustStock },
      { createOrder, changeOrderStatus },
      { convertOrder, cancelSale, createSale },
      { receivePurchase, createPurchase },
    ] = await Promise.all([
      import("../src/database/pool.js"),
      import("../src/services/productService.js"),
      import("../src/services/stockService.js"),
      import("../src/services/orderService.js"),
      import("../src/services/saleService.js"),
      import("../src/services/purchaseService.js"),
    ]);
    try {
      const [users] = await pool.query(
        "SELECT id FROM users ORDER BY id LIMIT 1",
      );
      assert.ok(users.length, "Execute npm run seed no banco de teste");
      const user = { id: users[0].id };
      const product = await saveProduct(
        {
          name: `Tênis Teste ${Date.now()}`,
          description: "Teste de transação",
          model: "Revolution",
          brandId: null,
          categoryId: null,
          price: 199.9,
          cost: 80,
          active: true,
          featured: false,
        },
        user,
        "127.0.0.1",
      );
      const variant = await saveVariant(
        {
          productId: product.id,
          color: "Preto",
          size: "39",
          sku: `TEST-${Date.now()}`,
          barcode: `789${Date.now()}`,
          cost: 80,
          price: null,
          minimumStock: 1,
          active: true,
        },
        user,
        "127.0.0.1",
      );
      await adjustStock(
        {
          variantId: variant.id,
          quantity: 1,
          direction: "ENTRADA",
          note: "Estoque de teste",
        },
        user,
        "127.0.0.1",
      );
      const customer = {
        name: "Cliente Teste",
        phone: "11999999999",
        email: null,
        cpf: "",
      };
      const attempts = await Promise.allSettled([
        createOrder(
          { customer, items: [{ variantId: variant.id, quantity: 1 }] },
          "127.0.0.1",
        ),
        createOrder(
          { customer, items: [{ variantId: variant.id, quantity: 1 }] },
          "127.0.0.1",
        ),
      ]);
      assert.equal(
        attempts.filter((x) => x.status === "fulfilled").length,
        1,
        "Só uma reserva pode obter a última unidade",
      );
      const order = attempts.find((x) => x.status === "fulfilled").value;
      const [reserved] = await pool.execute(
        "SELECT physical_stock,reserved_stock FROM product_variants WHERE id=?",
        [variant.id],
      );
      assert.equal(reserved[0].physical_stock, 1);
      assert.equal(reserved[0].reserved_stock, 1);
      await changeOrderStatus(order.id, "EM_ATENDIMENTO", user, "127.0.0.1");
      await changeOrderStatus(order.id, "CONFIRMADO", user, "127.0.0.1");
      const sale = await convertOrder(order.id, "PIX", user, "127.0.0.1");
      assert.equal(sale.total, "199.90");
      const [afterSale] = await pool.execute(
        "SELECT physical_stock,reserved_stock FROM product_variants WHERE id=?",
        [variant.id],
      );
      assert.equal(afterSale[0].physical_stock, 0);
      assert.equal(afterSale[0].reserved_stock, 0);
      await cancelSale(sale.id, user, "127.0.0.1");
      const [afterCancel] = await pool.execute(
        "SELECT physical_stock,reserved_stock FROM product_variants WHERE id=?",
        [variant.id],
      );
      assert.equal(afterCancel[0].physical_stock, 1);
      const pos = await createSale(
        {
          items: [{ variantId: variant.id, quantity: 1, discount: 0 }],
          discount: 0,
          payment: "DINHEIRO",
          customerId: null,
        },
        user,
        "127.0.0.1",
      );
      assert.equal(pos.total, "199.90");
      await assert.rejects(
        createSale(
          {
            items: [{ variantId: variant.id, quantity: 1, discount: 0 }],
            discount: 0,
            payment: "DINHEIRO",
            customerId: null,
          },
          user,
          "127.0.0.1",
        ),
        { code: "INSUFFICIENT_STOCK" },
      );
      const [supplier] = await pool.execute(
        "INSERT INTO suppliers (name) VALUES (?)",
        [`Fornecedor Teste ${Date.now()}`],
      );
      const purchase = await createPurchase(
        {
          supplierId: supplier.insertId,
          notes: null,
          items: [{ variantId: variant.id, quantity: 3, unitCost: 75 }],
        },
        user,
        "127.0.0.1",
      );
      await receivePurchase(purchase.id, user, "127.0.0.1");
      const [afterPurchase] = await pool.execute(
        "SELECT physical_stock FROM product_variants WHERE id=?",
        [variant.id],
      );
      assert.equal(afterPurchase[0].physical_stock, 3);
      const [movements] = await pool.execute(
        "SELECT type FROM stock_movements WHERE variant_id=?",
        [variant.id],
      );
      assert.ok(
        ["RESERVA", "VENDA", "CANCELAMENTO_VENDA", "COMPRA"].every((type) =>
          movements.some((x) => x.type === type),
        ),
      );
      const expiring = await createOrder(
        { customer, items: [{ variantId: variant.id, quantity: 1 }] },
        "127.0.0.1",
      );
      await changeOrderStatus(expiring.id, "EXPIRADO", null, null);
      const [released] = await pool.execute(
        "SELECT reserved_stock,physical_stock FROM product_variants WHERE id=?",
        [variant.id],
      );
      assert.equal(released[0].reserved_stock, 0);
      assert.equal(released[0].physical_stock, 3);
    } finally {
      await pool.end();
    }
  },
);
