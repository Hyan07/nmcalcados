import "dotenv/config";
import { getGescomPool, closeGescomPool } from "./sqlserver.js";

try {
  const pool = await getGescomPool();

  console.log("\n=== PRODUTOS ÓRFÃOS NA GRADE ===\n");

  const orfaos = await pool.request().query(`
    SELECT
      g.Produto,
      COUNT(*) AS Variacoes,
      SUM(CASE WHEN g.Atual > 0 THEN g.Atual ELSE 0 END) AS Estoque
    FROM Grade_Medida_Produto_Detalhamento g
    LEFT JOIN Produto p
      ON p.Prod = g.Produto
    WHERE p.Prod IS NULL
    GROUP BY g.Produto
    ORDER BY g.Produto
  `);

  console.table(orfaos.recordset);

  console.log("\n=== CÓDIGOS DE BARRAS DUPLICADOS ===\n");

  const duplicados = await pool.request().query(`
    SELECT
      g.GtinGrade AS codigo_barras,
      g.Produto AS codigo_produto,
      p.Dscr AS produto,
      g.CodigoGrade AS sku,
      cor.Descricao AS cor,
      tamanho.Descricao AS tamanho,
      g.Atual AS estoque

    FROM Grade_Medida_Produto_Detalhamento g

    LEFT JOIN Produto p
      ON p.Prod = g.Produto

    LEFT JOIN Grade_Medida_Produto_Eixo1 cor
      ON cor.CodigoCategoria = '1'
      AND cor.Codigo = g.RefHorizontal

    LEFT JOIN Grade_Medida_Produto_Eixo2 tamanho
      ON tamanho.CodigoCategoria = '2'
      AND tamanho.Codigo = g.RefVertical

    WHERE g.GtinGrade IN (
      SELECT GtinGrade
      FROM Grade_Medida_Produto_Detalhamento
      WHERE NULLIF(LTRIM(RTRIM(GtinGrade)), '') IS NOT NULL
      GROUP BY GtinGrade
      HAVING COUNT(*) > 1
    )

    ORDER BY
      g.GtinGrade,
      g.Produto
  `);

  console.table(duplicados.recordset);

  console.log("\n=== PRODUTOS SEM GRADE COM ESTOQUE ===\n");

  const semGrade = await pool.request().query(`
    SELECT
      p.Prod AS codigo,
      p.Dscr AS produto,
      p.Qtde AS estoque,
      p.Vend AS preco,
      p.Gtin AS gtin,
      p.Cean AS cean
    FROM Produto p
    WHERE NOT EXISTS (
      SELECT 1
      FROM Grade_Medida_Produto_Detalhamento g
      WHERE g.Produto = p.Prod
    )
    AND ISNULL(p.Qtde,0) <> 0
    ORDER BY p.Dscr
  `);

  console.table(semGrade.recordset);

  console.log(
    "Produtos sem grade com estoque:",
    semGrade.recordset.length
  );

} catch (erro) {
  console.error(erro);
} finally {
  await closeGescomPool();
}
