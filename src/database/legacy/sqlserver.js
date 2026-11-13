import "dotenv/config";
import sql from "mssql";
let poolPromise;
export function getGescomPool() {
  for (const key of [
    "GESCOM_DB_HOST",
    "GESCOM_DB_USER",
    "GESCOM_DB_PASSWORD",
  ]) {
    if (!process.env[key]) throw new Error(`Variável obrigatória: ${key}`);
  }
  if (!poolPromise) {
    const port = Number(process.env.GESCOM_DB_PORT || 1433);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("GESCOM_DB_PORT inválida");
    poolPromise = new sql.ConnectionPool({
      server: process.env.GESCOM_DB_HOST,
      port,
      database: process.env.GESCOM_DB_NAME || "GescomPro",
      user: process.env.GESCOM_DB_USER,
      password: process.env.GESCOM_DB_PASSWORD,
      options: {
        encrypt: process.env.GESCOM_DB_ENCRYPT !== "false",
        trustServerCertificate:
          process.env.GESCOM_DB_TRUST_SERVER_CERTIFICATE === "true",
        useUTC: true,
      },
      pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
      connectionTimeout: 15000,
      requestTimeout: 60000,
    })
      .connect()
      .then((pool) => {
        pool.on("error", () => {});
        return pool;
      })
      .catch((error) => {
        poolPromise = undefined;
        throw error;
      });
  }
  return poolPromise;
}
export async function closeGescomPool() {
  const pending = poolPromise;
  poolPromise = undefined;
  if (pending) await (await pending).close();
}
// O importador só expõe SELECTs estáticos. A conta SQL Server deve ter apenas SELECT.
export async function selectGescom(query) {
  if (
    !/^\s*SELECT\b/i.test(query) ||
    /;|--|\/\*|\b(INTO|INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|DROP|CREATE|TRUNCATE)\b/i.test(
      query,
    )
  ) {
    throw new Error("O legado permite somente SELECT");
  }
  return (await (await getGescomPool()).request().query(query)).recordset;
}
