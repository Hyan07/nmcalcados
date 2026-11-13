import mysql from "mysql2/promise";
import { env } from "../config/env.js";

export const pool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  decimalNumbers: false,
  timezone: "Z",
});
// TIMESTAMP é convertido pelo fuso da sessão MySQL antes de chegar ao driver.
// Fixar UTC evita deslocamento duplo quando o servidor usa America/Sao_Paulo.
pool.on("connection", (connection) =>
  connection.query("SET time_zone = '+00:00'"),
);

export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
