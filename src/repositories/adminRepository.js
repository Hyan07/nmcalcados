import { pool } from "../database/pool.js";
import { notFound } from "../utils/errors.js";

const allowed = {
  suppliers: [
    "name",
    "trade_name",
    "tax_id",
    "phone",
    "whatsapp",
    "email",
    "address",
    "notes",
    "active",
  ],
  customers: ["name", "cpf", "phone", "email", "active"],
};
export async function listEntity(table, { page = 1, limit = 20, q = "" } = {}) {
  if (!allowed[table]) throw new Error("Tabela inválida");
  const p = Math.max(1, Number(page) || 1),
    l = Math.min(100, Math.max(1, Number(limit) || 20));
  const term = `%${q}%`;
  const [count] = await pool.execute(
    `SELECT COUNT(*) total FROM ${table} WHERE name LIKE ?`,
    [term],
  );
  const [items] = await pool.query(
    `SELECT ${table === "suppliers" ? "id,name,trade_name,tax_id,phone,whatsapp,email,address,notes,active,created_at" : "id,name,cpf,phone,email,active,created_at"} FROM ${table} WHERE name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [term, l, (p - 1) * l],
  );
  return { items, total: count[0].total, page: p, limit: l };
}
export async function saveEntity(table, data, id = null) {
  if (!allowed[table]) throw new Error("Tabela inválida");
  const cols = Object.keys(data).filter((key) => allowed[table].includes(key));
  if (id) {
    const [result] = await pool.execute(
      `UPDATE ${table} SET ${cols.map((key) => `${key}=?`).join(",")} WHERE id=?`,
      [...cols.map((key) => data[key]), id],
    );
    if (!result.affectedRows) throw notFound("Registro");
    return { id: Number(id) };
  }
  const [result] = await pool.execute(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    cols.map((key) => data[key]),
  );
  return { id: result.insertId };
}
