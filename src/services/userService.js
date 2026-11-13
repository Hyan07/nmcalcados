import bcrypt from "bcrypt";
import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { audit } from "../repositories/stockRepository.js";

export async function listUsers() {
  const [items] = await pool.query(
    "SELECT u.id,u.name,u.email,u.active,u.created_at,r.id role_id,r.name role FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id",
  );
  return items;
}
export async function roles() {
  const [items] = await pool.query(
    "SELECT id,name,label FROM roles ORDER BY id",
  );
  return items;
}
export async function permissions() {
  const [items] = await pool.query(
    "SELECT id,code FROM permissions ORDER BY code",
  );
  return items;
}
export async function userOverrides(userId) {
  const [users] = await pool.execute("SELECT id FROM users WHERE id=?", [
    userId,
  ]);
  if (!users.length) throw notFound("Usuário");
  const [items] = await pool.execute(
    "SELECT p.code,up.allowed FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=?",
    [userId],
  );
  return items;
}
export async function createUser(data, actor, ip) {
  const hash = await bcrypt.hash(data.password, 12);
  return transaction(async (conn) => {
    const [result] = await conn.execute(
      "INSERT INTO users (role_id,name,email,password_hash,active) VALUES (?,?,?,?,?)",
      [data.roleId, data.name, data.email.toLowerCase(), hash, data.active],
    );
    for (const [code, allowed] of Object.entries(data.permissions || {})) {
      const [perms] = await conn.execute(
        "SELECT id FROM permissions WHERE code=?",
        [code],
      );
      if (!perms.length) throw new AppError(`Permissão inválida: ${code}`, 422);
      await conn.execute(
        "INSERT INTO user_permissions (user_id,permission_id,allowed) VALUES (?,?,?)",
        [result.insertId, perms[0].id, allowed],
      );
    }
    await audit(conn, {
      userId: actor.id,
      action: "ALTERACAO_USUARIO",
      entity: "users",
      entityId: result.insertId,
      after: { name: data.name, email: data.email },
      ip,
    });
    return { id: result.insertId };
  });
}
export async function setUserPermission(userId, code, allowed, actor, ip) {
  if (
    Number(userId) === actor.id &&
    code === "users.manage" &&
    allowed === false
  )
    throw new AppError(
      "Não é possível remover sua própria permissão de gerenciar usuários.",
    );
  return transaction(async (conn) => {
    const [users] = await conn.execute("SELECT id FROM users WHERE id=?", [
      userId,
    ]);
    if (!users.length) throw notFound("Usuário");
    const [perms] = await conn.execute(
      "SELECT id FROM permissions WHERE code=?",
      [code],
    );
    if (!perms.length) throw notFound("Permissão");
    await conn.execute(
      "INSERT INTO user_permissions (user_id,permission_id,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed=VALUES(allowed)",
      [userId, perms[0].id, allowed],
    );
    await audit(conn, {
      userId: actor.id,
      action: "ALTERACAO_USUARIO",
      entity: "users",
      entityId: userId,
      after: { permission: code, allowed },
      ip,
    });
    return { id: Number(userId), permission: code, allowed };
  });
}
export async function resetUserPermission(userId, code, actor, ip) {
  return transaction(async (conn) => {
    await conn.execute(
      "DELETE up FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=? AND p.code=?",
      [userId, code],
    );
    await audit(conn, {
      userId: actor.id,
      action: "ALTERACAO_USUARIO",
      entity: "users",
      entityId: userId,
      after: { permission: code, reset: true },
      ip,
    });
    return { id: Number(userId), permission: code, reset: true };
  });
}
export async function setUserActive(userId, active, actor, ip) {
  if (Number(userId) === actor.id && !active)
    throw new AppError("Não é possível desativar sua própria conta.");
  return transaction(async (conn) => {
    const [result] = await conn.execute(
      "UPDATE users SET active=? WHERE id=?",
      [active, userId],
    );
    if (!result.affectedRows) throw notFound("Usuário");
    if (!active)
      await conn.execute("DELETE FROM sessions WHERE user_id=?", [userId]);
    await audit(conn, {
      userId: actor.id,
      action: "ALTERACAO_USUARIO",
      entity: "users",
      entityId: userId,
      after: { active },
      ip,
    });
    return { id: Number(userId), active };
  });
}
