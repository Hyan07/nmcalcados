import { pool, transaction } from "../database/pool.js";
import {
  lockVariant,
  changeStock,
  audit,
} from "../repositories/stockRepository.js";

export async function adjustStock(data, user, ip) {
  return transaction(async (conn) => {
    const variant = await lockVariant(conn, data.variantId);
    const physical =
      data.direction === "ENTRADA" ? data.quantity : -data.quantity;
    await changeStock(conn, variant, {
      physical,
      type: data.direction === "ENTRADA" ? "AJUSTE_ENTRADA" : "AJUSTE_SAIDA",
      quantity: data.quantity,
      userId: user.id,
      note: data.note,
    });
    await audit(conn, {
      userId: user.id,
      action: "AJUSTE_ESTOQUE",
      entity: "product_variants",
      entityId: variant.id,
      after: {
        physicalStock: variant.physical_stock,
        reservedStock: variant.reserved_stock,
        note: data.note,
      },
      ip,
    });
    return {
      variantId: variant.id,
      physicalStock: variant.physical_stock,
      reservedStock: variant.reserved_stock,
    };
  });
}
export async function stockList({ low = false, page = 1, limit = 50 } = {}) {
  const p = Math.max(1, Number(page) || 1),
    l = Math.min(100, Math.max(1, Number(limit) || 50));
  const where = low
    ? "WHERE v.physical_stock-v.reserved_stock<=v.minimum_stock"
    : "";
  const [count] = await pool.query(
    `SELECT COUNT(*) total FROM product_variants v ${where}`,
  );
  const [items] = await pool.query(
    `SELECT v.id,v.product_id,p.name product_name,v.color,v.size,v.sku,v.barcode,v.physical_stock,v.reserved_stock,v.physical_stock-v.reserved_stock available,v.minimum_stock FROM product_variants v JOIN products p ON p.id=v.product_id ${where} ORDER BY p.name,v.color,v.size LIMIT ? OFFSET ?`,
    [l, (p - 1) * l],
  );
  return { items, total: count[0].total, page: p, limit: l };
}
export async function movements({ variantId, page = 1, limit = 50 } = {}) {
  const p = Math.max(1, Number(page) || 1),
    l = Math.min(100, Math.max(1, Number(limit) || 50));
  const where = variantId ? "WHERE m.variant_id=?" : "";
  const args = variantId ? [variantId] : [];
  const [items] = await pool.query(
    `SELECT m.id,m.variant_id,m.type,m.quantity,m.stock_before,m.stock_after,m.reserved_before,m.reserved_after,m.reference_type,m.reference_id,m.note,m.created_at,p.name product_name,v.color,v.size FROM stock_movements m JOIN product_variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    [...args, l, (p - 1) * l],
  );
  return items;
}
