import "dotenv/config";
import { getGescomPool, closeGescomPool } from "./sqlserver.js";

try {
  const pool = await getGescomPool();

  console.log("\n=== ANÁLISE DO GESCOMPRO ===\n");

  // Produtos
  const produtos = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM Produto
  `);

  console.log("Produtos:", produtos.recordset[0].total);

  // Produtos que possuem grade
  const produtosComGrade = await pool.request().query(`
    SELECT COUNT(DISTINCT Produto) AS total
    FROM Grade_Medida_Produto_Detalhamento
  `);

  console.log(
    "Produtos com grade:",
    produtosComGrade.recordset[0].total
  );

  // Variações
  const variantes = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM Grade_Medida_Produto_Detalhamento
  `);

  console.log("Variações:", variantes.recordset[0].total);

  // Estoque total nas grades
  const estoque = await pool.request().query(`
    SELECT
      SUM(CASE WHEN Atual > 0 THEN Atual ELSE 0 END) AS total
    FROM Grade_Medida_Produto_Detalhamento
  `);

  console.log(
    "Unidades em estoque nas grades:",
    estoque.recordset[0].total
  );

  // Variações com estoque
  const comEstoque = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM Grade_Medida_Produto_Detalhamento
    WHERE Atual > 0
  `);

  console.log(
    "Variações com estoque:",
    comEstoque.recordset[0].total
  );

  // Códigos de barras preenchidos
  const codigos = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM Grade_Medida_Produto_Detalhamento
    WHERE NULLIF(LTRIM(RTRIM(GtinGrade)), '') IS NOT NULL
  `);

  console.log(
    "Variações com código de barras:",
    codigos.recordset[0].total
  );

  // Código de barras duplicado
  const duplicados = await pool.request().query(`
    SELECT
      GtinGrade,
      COUNT(*) AS quantidade
    FROM Grade_Medida_Produto_Detalhamento
    WHERE NULLIF(LTRIM(RTRIM(GtinGrade)), '') IS NOT NULL
    GROUP BY GtinGrade
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  console.log(
    "Códigos de barras duplicados:",
    duplicados.recordset.length
  );

  if (duplicados.recordset.length) {
    console.table(duplicados.recordset.slice(0, 20));
  }

  // SKUs duplicados
  const skus = await pool.request().query(`
    SELECT
      CodigoGrade,
      COUNT(*) AS quantidade
    FROM Grade_Medida_Produto_Detalhamento
    WHERE NULLIF(LTRIM(RTRIM(CodigoGrade)), '') IS NOT NULL
    GROUP BY CodigoGrade
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  console.log(
    "SKUs duplicados:",
    skus.recordset.length
  );

  if (skus.recordset.length) {
    console.table(skus.recordset.slice(0, 20));
  }

  // Produtos sem grade
  const semGrade = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM Produto p
    WHERE NOT EXISTS (
      SELECT 1
      FROM Grade_Medida_Produto_Detalhamento g
      WHERE g.Produto = p.Prod
    )
  `);

  console.log(
    "Produtos sem grade:",
    semGrade.recordset[0].total
  );

  console.log("\n=== FIM DA ANÁLISE ===\n");

} catch (erro) {
  console.error("\nERRO:");
  console.error(erro);
} finally {
  await closeGescomPool();
}
