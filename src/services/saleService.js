import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { cents, decimal } from "../utils/pricing.js";
import {
  lockVariant,
  changeStock,
  audit,
} from "../repositories/stockRepository.js";
import { canTransition } from "./orderService.js";
import { requireAvailable } from "./stockPolicy.js";

export async function createSale(data, user, ip) {
  const grouped = new Map();
  for (const item of data.items) {
    const previous = grouped.get(item.variantId) || {
      quantity: 0,
      discount: 0,
    };
    grouped.set(item.variantId, {
      quantity: previous.quantity + item.quantity,
      discount: previous.discount + cents(item.discount),
    });
  }
  return transaction(async (conn) => {
    const entries = [];
    for (const id of [...grouped.keys()].sort((a, b) => a - b)) {
      const variant = await lockVariant(conn, id),
        item = grouped.get(id);
      requireAvailable(variant, item.quantity);
      const unit = cents(variant.variant_price ?? variant.product_price);
      if (item.discount > unit * item.quantity)
        throw new AppError("Desconto maior que o valor do item.");
      entries.push({ ...item, variant, unit });
    }
    const subtotal = entries.reduce((sum, x) => sum + x.unit * x.quantity, 0);
    const itemDiscount = entries.reduce((sum, x) => sum + x.discount, 0);
    const globalDiscount = cents(data.discount);
    if (globalDiscount > subtotal - itemDiscount)
      throw new AppError("Desconto maior que o valor da venda.");
    const total = subtotal - itemDiscount - globalDiscount;
    const [sale] = await conn.execute(
      "INSERT INTO sales (customer_id,user_id,subtotal,discount,total) VALUES (?,?,?,?,?)",
      [
        data.customerId || null,
        user.id,
        decimal(subtotal),
        decimal(itemDiscount + globalDiscount),
        decimal(total),
      ],
    );
    for (const entry of entries) {
      const v = entry.variant;
      await conn.execute(
        `INSERT INTO sale_items (sale_id,variant_id,product_name,color,size,quantity,unit_price,discount,subtotal) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          sale.insertId,
          v.id,
          v.product_name,
          v.color,
          v.size,
          entry.quantity,
          decimal(entry.unit),
          decimal(entry.discount),
          decimal(entry.unit * entry.quantity - entry.discount),
        ],
      );
      await changeStock(conn, v, {
        physical: -entry.quantity,
        type: "VENDA",
        quantity: entry.quantity,
        referenceType: "SALE",
        referenceId: sale.insertId,
        userId: user.id,
      });
    }
    await conn.execute(
      "INSERT INTO payments (sale_id,method,amount) VALUES (?,?,?)",
      [sale.insertId, data.payment, decimal(total)],
    );
    await audit(conn, {
      userId: user.id,
      action: "VENDA",
      entity: "sales",
      entityId: sale.insertId,
      after: { total: decimal(total) },
      ip,
    });
    return { id: sale.insertId, total: decimal(total), status: "CONCLUIDA" };
  });
}
export async function convertOrder(id, payment, user, ip) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id,status,customer_id,total,expires_at FROM orders WHERE id=? FOR UPDATE",
      [id],
    );
    if (!rows.length) throw notFound("Pedido");
    const order = rows[0];
    if (!canTransition(order.status, "CONVERTIDO_EM_VENDA"))
      throw new AppError(
        "Confirme o pedido antes de converter em venda.",
        409,
        "INVALID_TRANSITION",
      );
    if (new Date(order.expires_at).getTime() <= Date.now())
      throw new AppError("A reserva expirou.", 409, "EXPIRED");
    const [items] = await conn.execute(
      "SELECT * FROM order_items WHERE order_id=? ORDER BY variant_id",
      [id],
    );
    const locked = [];
    for (const item of items) {
      const variant = await lockVariant(conn, item.variant_id);
      if (
        variant.reserved_stock < item.quantity ||
        variant.physical_stock < item.quantity
      )
        throw new AppError(
          "Estoque reservado insuficiente.",
          409,
          "INSUFFICIENT_STOCK",
        );
      locked.push({ item, variant });
    }
    const [sale] = await conn.execute(
      "INSERT INTO sales (order_id,customer_id,user_id,subtotal,total) VALUES (?,?,?,?,?)",
      [id, order.customer_id, user.id, order.total, order.total],
    );
    for (const { item, variant } of locked) {
      await conn.execute(
        `INSERT INTO sale_items (sale_id,variant_id,product_name,color,size,quantity,unit_price,subtotal) VALUES (?,?,?,?,?,?,?,?)`,
        [
          sale.insertId,
          item.variant_id,
          item.product_name,
          item.color,
          item.size,
          item.quantity,
          item.unit_price,
          item.subtotal,
        ],
      );
      await changeStock(conn, variant, {
        physical: -item.quantity,
        reserved: -item.quantity,
        type: "VENDA",
        quantity: item.quantity,
        referenceType: "SALE",
        referenceId: sale.insertId,
        userId: user.id,
        note: "Conversão do pedido",
      });
    }
    await conn.execute(
      "INSERT INTO payments (sale_id,method,amount) VALUES (?,?,?)",
      [sale.insertId, payment, order.total],
    );
    await conn.execute(
      `UPDATE orders SET status='CONVERTIDO_EM_VENDA' WHERE id=?`,
      [id],
    );
    await conn.execute(
      `INSERT INTO order_status_history (order_id,old_status,new_status,user_id) VALUES (?,'CONFIRMADO','CONVERTIDO_EM_VENDA',?)`,
      [id, user.id],
    );
    await audit(conn, {
      userId: user.id,
      action: "CONVERSAO_PEDIDO",
      entity: "orders",
      entityId: id,
      before: { status: order.status },
      after: { saleId: sale.insertId },
      ip,
    });
    return {
      id: sale.insertId,
      orderId: id,
      total: order.total,
      status: "CONCLUIDA",
    };
  });
}
export async function cancelSale(id, user, ip) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id,status,order_id,is_historical FROM sales WHERE id=? FOR UPDATE",
      [id],
    );
    if (!rows.length) throw notFound("Venda");
    if (rows[0].is_historical)
      throw new AppError(
        "Venda histórica é somente leitura; ajuste pelo procedimento de conciliação.",
        409,
        "HISTORICAL_SALE",
      );
    if (rows[0].status !== "CONCLUIDA")
      throw new AppError("Venda já cancelada.", 409, "INVALID_TRANSITION");
    const [items] = await conn.execute(
      "SELECT variant_id,quantity FROM sale_items WHERE sale_id=? ORDER BY variant_id",
      [id],
    );
    for (const item of items) {
      const variant = await lockVariant(conn, item.variant_id);
      await changeStock(conn, variant, {
        physical: item.quantity,
        type: "CANCELAMENTO_VENDA",
        quantity: item.quantity,
        referenceType: "SALE",
        referenceId: id,
        userId: user.id,
      });
    }
    await conn.execute(
      `UPDATE sales SET status='CANCELADA',cancelled_at=UTC_TIMESTAMP() WHERE id=?`,
      [id],
    );
    await audit(conn, {
      userId: user.id,
      action: "CANCELAMENTO",
      entity: "sales",
      entityId: id,
      before: { status: "CONCLUIDA" },
      after: { status: "CANCELADA" },
      ip,
    });
    return { id, status: "CANCELADA" };
  });
}
export async function listSales({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1),
    l = Math.min(50, Math.max(1, Number(limit) || 20));
  const [count] = await pool.query("SELECT COUNT(*) total FROM sales");
  const [items] = await pool.query(
    `SELECT s.id,s.order_id,s.total,s.status,s.created_at,u.name user_name,c.name customer_name,
    (SELECT method FROM payments WHERE sale_id=s.id LIMIT 1) payment FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    [l, (p - 1) * l],
  );
  return { items, total: count[0].total, page: p, limit: l };
}
