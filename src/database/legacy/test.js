import "dotenv/config";
import { getGescomPool, closeGescomPool } from "./sqlserver.js";

try {
  const pool = await getGescomPool();

  const resultado = await pool.request().query(`
    SELECT TOP 10
      Prod,
      Dscr,
      Vend,
      Qtde
    FROM Produto
    ORDER BY Prod
  `);

  console.log("Conexão com GescomPro OK!");
  console.table(resultado.recordset);

} catch (erro) {
  console.error("Erro:");
  console.error(erro.message);

} finally {
  await closeGescomPool();
}
