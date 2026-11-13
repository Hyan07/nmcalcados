import { selectGescom } from "./sqlserver.js";
export const fields = {
  Fabricante: ["Fabr", "Nome"],
  Grupo_Produto: ["Grup", "Dscr"],
  Produto: [
    "Prod",
    "Dscr",
    "Fabr",
    "Grup",
    "Qtde",
    "Cust",
    "Vend",
    "Gtin",
    "Cean",
    "Situ",
  ],
  Grade_Medida_Produto_Detalhamento: [
    "Grade",
    "Produto",
    "RefHorizontal",
    "RefVertical",
    "Atual",
    "CodigoGrade",
    "GtinGrade",
    "Situacao",
  ],
  Grade_Medida_Produto_Eixo1: ["CodigoCategoria", "Codigo", "Descricao"],
  Grade_Medida_Produto_Eixo2: ["CodigoCategoria", "Codigo", "Descricao"],
  Cliente: ["Clie", "Nome", "Ncpf", "Fone", "Emai", "Situ"],
  Fornecedor: ["Forn", "Raso", "Fant", "Cnpj", "Ncpf", "Fone", "Emai"],
  Pre_Venda: [
    "Ndoc",
    "Clie",
    "Emis",
    "Fechamento",
    "Vend",
    "Canc",
    "Stat",
    "Tipo",
    "Tota",
    "Desc",
    "Acre",
    "TotaFinal",
    "Troco",
  ],
  Pre_Venda_Itens: [
    "Ndoc",
    "Nite",
    "Prod",
    "Qtde",
    "Vuni",
    "Valo",
    "Vtot",
    "Pdes",
    "Pacr",
    "Canc",
    "QuantidadeDevolvida",
  ],
  Grade_Medida_Pre_Venda_Itens: [
    "Ndoc",
    "Nite",
    "Produto",
    "RefHorizontal",
    "RefVertical",
    "Quantidade",
    "Cancelado",
  ],
  Pre_Venda_FormaPagamento: [
    "Id",
    "Ndoc",
    "Espe",
    "Valor",
    "DataVencimento",
    "pagamento_parcial",
    "ValorDevolvido",
  ],
};
export async function readSource() {
  const schema = await selectGescom(
    "SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS",
  );
  for (const [table, columns] of Object.entries(fields))
    for (const column of columns) {
      if (
        !schema.some(
          (c) =>
            c.TABLE_SCHEMA === "dbo" &&
            c.TABLE_NAME === table &&
            c.COLUMN_NAME === column,
        )
      )
        throw new Error(`Esquema não validado: dbo.${table}.${column}`);
    }
  const old = await selectGescom("SELECT COUNT(*) AS total FROM dbo.Vendas");
  if (old[0].total)
    throw new Error(
      "Vendas também contém dados: revise o mapeamento para evitar duplicar documentos",
    );
  const data = {};
  for (const [table, columns] of Object.entries(fields)) {
    data[table] = await selectGescom(
      `SELECT ${columns.map((c) => `[${c}]`).join(",")} FROM dbo.[${table}]`,
    );
  }
  return data;
}
