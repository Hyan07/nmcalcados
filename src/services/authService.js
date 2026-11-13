import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../database/pool.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

const hash = (token) =>
  crypto.createHmac("sha256", env.sessionSecret).update(token).digest("hex");
const sessionHours = 12;
export async function login(email, password, ip) {
  const [rows] = await pool.execute(
    "SELECT id,name,email,password_hash,active FROM users WHERE email=?",
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (
    !user ||
    !user.active ||
    !(await bcrypt.compare(password, user.password_hash))
  )
    throw new AppError(
      "E-mail ou senha inválidos.",
      401,
      "INVALID_CREDENTIALS",
    );
  const token = crypto.randomBytes(32).toString("hex"),
    csrf = crypto.randomBytes(32).toString("hex");
  await pool.execute(
    "INSERT INTO sessions (user_id,token_hash,csrf_hash,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? HOUR))",
    [user.id, hash(token), hash(csrf), sessionHours],
  );
  await pool.execute(
    `INSERT INTO audit_logs (user_id,action,entity,entity_id,ip) VALUES (?,'LOGIN','users',?,?)`,
    [user.id, user.id, ip],
  );
  return {
    token,
    csrf,
    user: { id: user.id, name: user.name, email: user.email },
  };
}
export async function sessionFromToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await pool.execute(
    `SELECT s.id session_id,s.csrf_hash,u.id,u.name,u.email,u.active,r.name role
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
    WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()`,
    [hash(token)],
  );
  if (!rows.length || !rows[0].active) return null;
  const user = rows[0];
  const [perms] = await pool.execute(
    `SELECT p.code,COALESCE(up.allowed,IF(rp.permission_id IS NULL,0,1)) allowed FROM permissions p
    LEFT JOIN role_permissions rp ON rp.permission_id=p.id AND rp.role_id=(SELECT role_id FROM users WHERE id=?)
    LEFT JOIN user_permissions up ON up.permission_id=p.id AND up.user_id=?`,
    [user.id, user.id],
  );
  return {
    ...user,
    permissions: perms.filter((x) => x.allowed).map((x) => x.code),
  };
}
export async function logout(token) {
  if (token)
    await pool.execute("DELETE FROM sessions WHERE token_hash=?", [
      hash(token),
    ]);
}
export function csrfMatches(session, token) {
  if (!session || !token || !/^[a-f0-9]{64}$/.test(token)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(session.csrf_hash, "hex"),
    Buffer.from(hash(token), "hex"),
  );
}
export const cookieOptions = {
  httpOnly: true,
  secure: env.prod,
  sameSite: "lax",
  path: "/",
  maxAge: sessionHours * 60 * 60 * 1000,
};
