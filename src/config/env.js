import "dotenv/config";
import { readFileSync } from "node:fs";

const prod = process.env.NODE_ENV === "production";
export const env = {
  prod,
  port: Number(process.env.PORT || 3000),
  origin:
    process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`,
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    ...(process.env.DB_SOCKET_PATH
      ? { socketPath: process.env.DB_SOCKET_PATH }
      : {}),
    database: process.env.DB_NAME || "nm_calcados",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    ...(process.env.DB_SSL === "true"
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(process.env.DB_SSL_CA_FILE
              ? { ca: readFileSync(process.env.DB_SSL_CA_FILE, "utf8") }
              : {}),
          },
        }
      : {}),
  },
  sessionSecret:
    process.env.SESSION_SECRET ||
    "development-only-session-secret-do-not-use-in-production",
  reservationHours: Number(process.env.RESERVATION_EXPIRATION_HOURS || 24),
};
if (prod && (env.sessionSecret.length < 32 || !process.env.APP_ORIGIN)) {
  throw new Error(
    "SESSION_SECRET (32+ caracteres) e APP_ORIGIN são obrigatórios em produção",
  );
}

for (const [name, value, min, max] of [
  ["PORT", env.port, 1, 65535],
  ["DB_PORT", env.db.port, 1, 65535],
  ["DB_CONNECTION_LIMIT", env.db.connectionLimit, 1, 100],
  ["TRUST_PROXY", env.trustProxy, 0, 10],
  ["RESERVATION_EXPIRATION_HOURS", env.reservationHours, 1, 8760],
]) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} inválida`);
}
if (prod) {
  for (const key of [
    "SESSION_SECRET",
    "APP_ORIGIN",
    "DB_HOST",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
  ]) {
    if (!process.env[key]) throw new Error(`${key} obrigatória em produção`);
  }
  if (/replace-with|development-only/i.test(env.sessionSecret))
    throw new Error("Substitua SESSION_SECRET por segredo aleatório");
  const origin = new URL(env.origin);
  if (origin.protocol !== "https:" || origin.origin !== env.origin)
    throw new Error(
      "APP_ORIGIN deve ser uma origem HTTPS sem caminho ou barra final",
    );
}
