import "dotenv/config";

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
