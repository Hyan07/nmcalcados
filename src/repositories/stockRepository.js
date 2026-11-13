import { notFound } from "../utils/errors.js";
import { projectStock } from "../services/stockPolicy.js";

export async function lockVariant(conn, id) {
  const [rows] = await conn.execute(
    `SELECT v.id,v.product_id,v.color,v.size,v.sku,v.barcode,v.price variant_price,v.physical_stock,v.reserved_stock,v.active,
    p.name product_name,p.price product_price,p.active product_active
    FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? FOR UPDATE`,
    [id],
  );
  if (!rows.length || !rows[0].active || !rows[0].product_active)
    throw notFound("Variação");
  return rows[0];
}
export async function changeStock(
  conn,
  variant,
  {
    physical = 0,
    reserved = 0,
    type,
    quantity,
    referenceType = null,
    referenceId = null,
    userId = null,
    note = null,
  },
) {
  const projected = projectStock(
    variant.physical_stock,
    variant.reserved_stock,
    physical,
    reserved,
  );
  const nextPhysical = projected.physical,
    nextReserved = projected.reserved;
  await conn.execute(
    "UPDATE product_variants SET physical_stock=?,reserved_stock=? WHERE id=?",
    [nextPhysical, nextReserved, variant.id],
  );
  await conn.execute(
    `INSERT INTO stock_movements (variant_id,type,quantity,stock_before,stock_after,reserved_before,reserved_after,reference_type,reference_id,user_id,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      variant.id,
      type,
      quantity,
      variant.physical_stock,
      nextPhysical,
      variant.reserved_stock,
      nextReserved,
      referenceType,
      referenceId,
      userId,
      note,
    ],
  );
  variant.physical_stock = nextPhysical;
  variant.reserved_stock = nextReserved;
}
export async function audit(
  conn,
  {
    userId = null,
    action,
    entity,
    entityId = null,
    before = null,
    after = null,
    ip = null,
  },
) {
  await conn.execute(
    "INSERT INTO audit_logs (user_id,action,entity,entity_id,before_json,after_json,ip) VALUES (?,?,?,?,?,?,?)",
    [
      userId,
      action,
      entity,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ip,
    ],
  );
}
