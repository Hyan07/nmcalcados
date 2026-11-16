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
export async function stockFilters() {
  const [[categories], [brands], [colors], [sizes]] = await Promise.all([
    pool.query("SELECT id,name FROM categories ORDER BY name"),
    pool.query("SELECT id,name FROM brands ORDER BY name"),
    pool.query("SELECT DISTINCT color FROM product_variants ORDER BY color"),
    pool.query("SELECT DISTINCT size FROM product_variants ORDER BY size"),
  ]);
  return {
    categories,
    brands,
    colors: colors.map((x) => x.color),
    sizes: sizes.map((x) => x.size),
  };
}
export async function stockList({
  q = "",
  categoryId,
  brandId,
  color,
  size,
  availability,
  active,
  low = false,
  page = 1,
  limit = 50,
} = {}) {
  const p = Math.max(1, Math.floor(Number(page)) || 1),
    l = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 50));
  const conditions = [],
    args = [];
  const term = String(q).trim();
  if (term) {
    conditions.push(
      "(p.name LIKE ? OR p.model LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)",
    );
    args.push(...Array(4).fill(`%${term}%`));
  }
  for (const [column, value] of [
    ["p.category_id", categoryId],
    ["p.brand_id", brandId],
    ["v.color", color],
    ["v.size", size],
  ]) {
    if (value != null && value !== "") {
      conditions.push(`${column}=?`);
      args.push(value);
    }
  }
  const availabilityConditions = {
    low: "v.physical_stock-v.reserved_stock<=v.minimum_stock",
    available: "v.physical_stock>v.reserved_stock",
    unavailable: "v.physical_stock-v.reserved_stock<=0",
    reserved: "v.reserved_stock>0",
  };
  if (Object.hasOwn(availabilityConditions, availability))
    conditions.push(availabilityConditions[availability]);
  if (low === true || low === "true")
    conditions.push(availabilityConditions.low);
  if (active === "active") conditions.push("p.active=1 AND v.active=1");
  if (active === "inactive") conditions.push("(p.active=0 OR v.active=0)");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = "FROM product_variants v JOIN products p ON p.id=v.product_id";
  const [count] = await pool.query(
    `SELECT COUNT(*) total ${from} ${where}`,
    args,
  );
  const [items] = await pool.query(
    `SELECT v.id,v.product_id,p.name product_name,v.color,v.size,v.sku,v.barcode,v.physical_stock,v.reserved_stock,v.physical_stock-v.reserved_stock available,v.minimum_stock,p.active product_active,v.active ${from} ${where} ORDER BY p.name,v.color,v.size,v.id LIMIT ? OFFSET ?`,
    [...args, l, (p - 1) * l],
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
