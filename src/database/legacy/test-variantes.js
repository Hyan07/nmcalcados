import "dotenv/config";
import { getGescomPool, closeGescomPool } from "./sqlserver.js";

try {
  const pool = await getGescomPool();

  const resultado = await pool.request().query(`
    SELECT TOP 30
      p.Prod AS codigo_produto,
      p.Dscr AS produto,
      p.Vend AS preco,

      cor.Descricao AS cor,
      tamanho.Descricao AS tamanho,

      gd.Atual AS estoque,
      gd.CodigoGrade AS sku,
      gd.GtinGrade AS codigo_barras

    FROM Produto p

    INNER JOIN Grade_Medida_Produto_Detalhamento gd
      ON gd.Produto = p.Prod

    LEFT JOIN Grade_Medida_Produto_Eixo1 cor
      ON cor.CodigoCategoria = '1'
      AND cor.Codigo = gd.RefHorizontal

    LEFT JOIN Grade_Medida_Produto_Eixo2 tamanho
      ON tamanho.CodigoCategoria = '2'
      AND tamanho.Codigo = gd.RefVertical

    ORDER BY
      p.Prod,
      cor.Descricao,
      tamanho.Descricao
  `);

  console.table(resultado.recordset);

} catch (erro) {
  console.error("Erro:");
  console.error(erro);

} finally {
  await closeGescomPool();
}
