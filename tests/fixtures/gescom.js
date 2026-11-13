import { fields } from "../../src/database/legacy/source.js";
export function fixture() {
  const d = Object.fromEntries(Object.keys(fields).map((k) => [k, []]));
  d.Fabricante = [{ Fabr: "001", Nome: "Marca" }];
  d.Grupo_Produto = [{ Grup: "01", Dscr: "Grupo" }];
  d.Produto = [
    {
      Prod: "0001",
      Dscr: "Tênis",
      Fabr: "001",
      Grup: "01",
      Vend: 90,
      Cust: 40,
      Qtde: 999,
      Situ: "S",
    },
    { Prod: "0002", Dscr: "Sem grade", Vend: 10, Cust: 2, Qtde: 3, Situ: "S" },
  ];
  d.Grade_Medida_Produto_Detalhamento = [
    {
      Grade: "01",
      Produto: "0001",
      RefHorizontal: "1",
      RefVertical: "1",
      Atual: 2,
      CodigoGrade: "SKU1",
      GtinGrade: "789",
      Situacao: "Ativo",
    },
    {
      Grade: "01",
      Produto: "0001",
      RefHorizontal: "1",
      RefVertical: "2",
      Atual: 1,
      CodigoGrade: "SKU2",
      GtinGrade: "789",
      Situacao: "Ativo",
    },
    {
      Grade: "02",
      Produto: "9999",
      RefHorizontal: "1",
      RefVertical: "1",
      Atual: 5,
      CodigoGrade: "SKU3",
      GtinGrade: "",
      Situacao: "Ativo",
    },
  ];
  d.Grade_Medida_Produto_Eixo1 = [
    { CodigoCategoria: 1, Codigo: "1", Descricao: "Preto" },
  ];
  d.Grade_Medida_Produto_Eixo2 = [
    { CodigoCategoria: 2, Codigo: "1", Descricao: "38" },
    { CodigoCategoria: 2, Codigo: "2", Descricao: "39" },
  ];
  d.Cliente = [{ Clie: "001", Nome: "Cliente", Situ: "N" }];
  d.Fornecedor = [{ Forn: "001", Raso: "Fornecedor" }];
  d.Pre_Venda = [
    {
      Ndoc: "0001",
      Clie: "001",
      Emis: new Date("2025-01-02T00:00:00Z"),
      Canc: "A",
      Stat: "X",
      Tipo: "B",
      Tota: 90,
      Desc: 0,
      Acre: 0,
      TotaFinal: 90,
    },
  ];
  d.Pre_Venda_Itens = [
    {
      Ndoc: "0001",
      Nite: "001",
      Prod: "0001",
      Qtde: 1,
      Vuni: 88,
      Valo: 90,
      Vtot: 90,
      Canc: "N",
      QuantidadeDevolvida: 0,
    },
  ];
  d.Grade_Medida_Pre_Venda_Itens = [
    {
      Ndoc: "0001",
      Nite: "001",
      Produto: "0001",
      RefHorizontal: "1",
      RefVertical: "1",
      Quantidade: 1,
      Cancelado: false,
    },
  ];
  d.Pre_Venda_FormaPagamento = [
    { Id: 1, Ndoc: "0001", Espe: "PRO", Valor: 90 },
  ];
  return d;
}
