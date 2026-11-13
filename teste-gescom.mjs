import "dotenv/config";
import { getGescomPool, closeGescomPool } from "./src/database/legacy/sqlserver.js";
try {
 const pool = await getGescomPool();
 const result = await pool.request().query("SELECT COUNT(*) AS total FROM Produto");
 console.log("Produtos:", result.recordset[0].total);
} catch (error) {
 console.error("Conexão GescomPro falhou:", error.code || error.name);
 process.exitCode = 1;
} finally { await closeGescomPool(); }
