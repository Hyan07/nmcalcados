import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { digits } from "../utils/format.js";
import {
  lockVariant,
  changeStock,
  audit,
} from "../repositories/stockRepository.js";
import { cents, decimal } from "../utils/pricing.js";
import { requireAvailable } from "./stockPolicy.js";

const transitions = {
  PENDENTE: ["EM_ATENDIMENTO", "CANCELADO", "EXPIRADO"],
  EM_ATENDIMENTO: ["CONFIRMADO", "CANCELADO", "EXPIRADO"],
  CONFIRMADO: ["CONVERTIDO_EM_VENDA", "CANCELADO", "EXPIRADO"],
  CONVERTIDO_EM_VENDA: [],
  CANCELADO: [],
  EXPIRADO: [],
};
export function canTransition(from, to) {
  return !!transitions[from]?.includes(to);
}
export async function createOrder(data, ip) {
  const grouped = new Map();
  for (const item of data.items)
    grouped.set(
      item.variantId,
      (grouped.get(item.variantId) || 0) + item.quantity,
    );
  const ids = [...grouped.keys()].sort((a, b) => a - b);
  return transaction(async (conn) => {
    const locked = [];
    for (const id of ids) {
      const variant = await lockVariant(conn, id);
      requireAvailable(variant, grouped.get(id));
      locked.push(variant);
    }
    const customer = data.customer;
    let customerId;
    if (customer.cpf) {
      const [result] = await conn.execute(
        `INSERT INTO customers (name,cpf,phone,email) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),name=VALUES(name),phone=VALUES(phone),email=VALUES(email)`,
        [customer.name, digits(customer.cpf), customer.phone, customer.email],
      );
      customerId = result.insertId;
    } else {
      const [result] = await conn.execute(
        "INSERT INTO customers (name,phone,email) VALUES (?,?,?)",
        [customer.name, customer.phone, customer.email],
      );
      customerId = result.insertId;
    }
    let total = 0;
    const items = locked.map((v) => {
      const quantity = grouped.get(v.id),
        unit = cents(v.variant_price ?? v.product_price),
        subtotal = unit * quantity;
      total += subtotal;
      return { variant: v, quantity, unit, subtotal };
    });
    const [order] = await conn.execute(
      `INSERT INTO orders (customer_id,total,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? HOUR))`,
      [
        customerId,
        decimal(total),
        Math.max(1, Number(process.env.RESERVATION_EXPIRATION_HOURS) || 24),
      ],
    );
    for (const item of items) {
      const v = item.variant;
      await conn.execute(
        `INSERT INTO order_items (order_id,variant_id,product_name,color,size,quantity,unit_price,subtotal) VALUES (?,?,?,?,?,?,?,?)`,
        [
          order.insertId,
          v.id,
          v.product_name,
          v.color,
          v.size,
          item.quantity,
          decimal(item.unit),
          decimal(item.subtotal),
        ],
      );
      await changeStock(conn, v, {
        reserved: item.quantity,
        type: "RESERVA",
        quantity: item.quantity,
        referenceType: "ORDER",
        referenceId: order.insertId,
      });
    }
    await conn.execute(
      `INSERT INTO order_status_history (order_id,new_status,note) VALUES (?,'PENDENTE','Reserva criada no catálogo')`,
      [order.insertId],
    );
    await audit(conn, {
      action: "PEDIDO",
      entity: "orders",
      entityId: order.insertId,
      after: { status: "PENDENTE", total: decimal(total) },
      ip,
    });
    return { id: order.insertId, status: "PENDENTE", total: decimal(total) };
  });
}
export async function listOrders({ status, page = 1, limit = 20 } = {}) {
  const args = [];
  const where = status ? "WHERE o.status=?" : "";
  if (status) args.push(status);
  const safePage = Math.max(1, Number(page) || 1),
    safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const [count] = await pool.query(
    `SELECT COUNT(*) total FROM orders o ${where}`,
    args,
  );
  const [items] = await pool.query(
    `SELECT o.id,o.status,o.total,o.expires_at,o.created_at,c.name customer_name,c.phone FROM orders o JOIN customers c ON c.id=o.customer_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [...args, safeLimit, (safePage - 1) * safeLimit],
  );
  return { items, total: count[0].total, page: safePage, limit: safeLimit };
}
export async function getOrder(id) {
  const [rows] = await pool.execute(
    `SELECT o.*,c.name customer_name,c.phone,c.email,c.cpf FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`,
    [id],
  );
  if (!rows.length) throw notFound("Pedido");
  const [items] = await pool.execute(
    "SELECT id,variant_id,product_name,color,size,quantity,unit_price,subtotal FROM order_items WHERE order_id=?",
    [id],
  );
  const [history] = await pool.execute(
    "SELECT old_status,new_status,note,created_at FROM order_status_history WHERE order_id=? ORDER BY id",
    [id],
  );
  return { ...rows[0], items, history };
}
export async function changeOrderStatus(id, next, user, ip) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id,status,expires_at FROM orders WHERE id=? FOR UPDATE",
      [id],
    );
    if (!rows.length) throw notFound("Pedido");
    const order = rows[0];
    if (!canTransition(order.status, next))
      throw new AppError(
        "Transição de pedido não permitida.",
        409,
        "INVALID_TRANSITION",
      );
    if (
      next !== "CANCELADO" &&
      next !== "EXPIRADO" &&
      new Date(order.expires_at).getTime() <= Date.now()
    )
      throw new AppError("A reserva expirou.", 409, "EXPIRED");
    if (next === "CANCELADO" || next === "EXPIRADO") {
      const [items] = await conn.execute(
        "SELECT variant_id,quantity FROM order_items WHERE order_id=? ORDER BY variant_id",
        [id],
      );
      for (const item of items) {
        const variant = await lockVariant(conn, item.variant_id);
        await changeStock(conn, variant, {
          reserved: -item.quantity,
          type: "LIBERACAO_RESERVA",
          quantity: item.quantity,
          referenceType: "ORDER",
          referenceId: id,
          userId: user?.id || null,
          note: next,
        });
      }
    }
    await conn.execute("UPDATE orders SET status=? WHERE id=?", [next, id]);
    await conn.execute(
      "INSERT INTO order_status_history (order_id,old_status,new_status,user_id) VALUES (?,?,?,?)",
      [id, order.status, next, user?.id || null],
    );
    await audit(conn, {
      userId: user?.id || null,
      action: "STATUS_PEDIDO",
      entity: "orders",
      entityId: id,
      before: { status: order.status },
      after: { status: next },
      ip,
    });
    return { id, status: next };
  });
}
export async function expireReservations(batch = 100) {
  const [rows] = await pool.query(
    `SELECT id FROM orders WHERE status IN ('PENDENTE','EM_ATENDIMENTO','CONFIRMADO') AND expires_at<=UTC_TIMESTAMP() ORDER BY id LIMIT ?`,
    [batch],
  );
  let count = 0;
  for (const row of rows) {
    try {
      await changeOrderStatus(row.id, "EXPIRADO", null, null);
      count++;
    } catch (error) {
      if (error.code !== "INVALID_TRANSITION") throw error;
    }
  }
  return count;
}
