import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { cents, decimal } from "../utils/pricing.js";
import {
  lockVariant,
  changeStock,
  audit,
} from "../repositories/stockRepository.js";

export async function createPurchase(data, user, ip) {
  return transaction(async (conn) => {
    const [suppliers] = await conn.execute(
      "SELECT id FROM suppliers WHERE id=? AND active=1",
      [data.supplierId],
    );
    if (!suppliers.length) throw notFound("Fornecedor");
    const total = data.items.reduce(
      (sum, item) => sum + cents(item.unitCost) * item.quantity,
      0,
    );
    const [result] = await conn.execute(
      "INSERT INTO purchases (supplier_id,user_id,total,notes) VALUES (?,?,?,?)",
      [data.supplierId, user.id, decimal(total), data.notes],
    );
    for (const item of data.items) {
      await conn.execute(
        "INSERT INTO purchase_items (purchase_id,variant_id,quantity,unit_cost,subtotal) VALUES (?,?,?,?,?)",
        [
          result.insertId,
          item.variantId,
          item.quantity,
          decimal(cents(item.unitCost)),
          decimal(cents(item.unitCost) * item.quantity),
        ],
      );
    }
    await audit(conn, {
      userId: user.id,
      action: "COMPRA_CRIADA",
      entity: "purchases",
      entityId: result.insertId,
      after: { total: decimal(total) },
      ip,
    });
    return { id: result.insertId, status: "RASCUNHO", total: decimal(total) };
  });
}
export async function receivePurchase(id, user, ip) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id,status FROM purchases WHERE id=? FOR UPDATE",
      [id],
    );
    if (!rows.length) throw notFound("Compra");
    if (rows[0].status !== "RASCUNHO")
      throw new AppError("Compra já recebida ou cancelada.", 409);
    const [items] = await conn.execute(
      "SELECT variant_id,SUM(quantity) quantity FROM purchase_items WHERE purchase_id=? GROUP BY variant_id ORDER BY variant_id",
      [id],
    );
    for (const item of items) {
      const variant = await lockVariant(conn, item.variant_id);
      await changeStock(conn, variant, {
        physical: Number(item.quantity),
        type: "COMPRA",
        quantity: Number(item.quantity),
        referenceType: "PURCHASE",
        referenceId: id,
        userId: user.id,
      });
    }
    await conn.execute(
      `UPDATE purchases SET status='RECEBIDA',received_at=UTC_TIMESTAMP() WHERE id=?`,
      [id],
    );
    await audit(conn, {
      userId: user.id,
      action: "ENTRADA_COMPRA",
      entity: "purchases",
      entityId: id,
      after: { status: "RECEBIDA" },
      ip,
    });
    return { id, status: "RECEBIDA" };
  });
}
export async function listPurchases() {
  const [items] = await pool.query(
    "SELECT p.id,p.status,p.total,p.notes,p.created_at,p.received_at,s.name supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT 100",
  );
  return items;
}
