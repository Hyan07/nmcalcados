import { createHash } from "node:crypto";
export const text = (value) => String(value ?? "").trim();
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const identity = (table, key) => `${table}:${hash(key)}`;
export const ref = (table, key) => ({ ref: identity(table, key) });
export function money(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e10)
    throw new Error("Valor monetário inválido");
  return (Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100).toFixed(
    2,
  );
}
export function stock(value) {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 4294967295)
    throw new Error("Estoque/quantidade inválido: requer inteiro não negativo");
  return n;
}
const group = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
};
export function buildPlan(data) {
  const records = [],
    exceptions = [];
  const warn = (code, table, key, details = {}) =>
    exceptions.push({ code, table, key, ...details });
  const add = (table, key, source, values) => {
    records.push({
      table,
      key,
      source,
      values,
      id: identity(table, key),
      sourceHash: hash(source),
    });
  };
  const clip = (value, max, table, key) => {
    const s = text(value);
    if (s.length > max)
      warn("TRUNCATED_FIELD", table, key, { length: s.length, limit: max });
    return s.slice(0, max);
  };
  const slug = (table, key) => `gescom-${table}-${hash(key).slice(0, 24)}`;
  const sorted = (rows, keys) =>
    [...rows].sort((a, b) =>
      JSON.stringify(keys.map((k) => text(a[k]))).localeCompare(
        JSON.stringify(keys.map((k) => text(b[k]))),
        "en",
      ),
    );
  for (const [source, table, code, label] of [
    ["Fabricante", "brands", "Fabr", "Nome"],
    ["Grupo_Produto", "categories", "Grup", "Dscr"],
  ])
    for (const r of sorted(data[source], [code]))
      add(table, text(r[code]), r, {
        name: clip(r[label], 100, table, r[code]) || `Legado ${r[code]}`,
        slug: slug(table, r[code]),
      });
  const brands = new Set(data.Fabricante.map((r) => text(r.Fabr))),
    categories = new Set(data.Grupo_Produto.map((r) => text(r.Grup)));
  const products = new Map(data.Produto.map((r) => [text(r.Prod), r]));
  const grades = sorted(data.Grade_Medida_Produto_Detalhamento, [
    "Grade",
    "RefHorizontal",
    "RefVertical",
  ]);
  for (const g of grades)
    if (!products.has(text(g.Produto))) {
      const key = text(g.Produto);
      products.set(key, {
        Prod: key,
        Dscr: `Produto legado ausente ${key}`,
        Vend: 0,
        Cust: 0,
        Qtde: 0,
        Situ: "INATIVO",
        placeholder: true,
      });
      warn("ORPHAN_PRODUCT_PRESERVED", "products", key);
    }
  for (const [key, p] of products) {
    const relation = (set, code, table) => {
      if (!text(code)) return null;
      if (!set.has(text(code))) {
        warn("MISSING_REFERENCE", "products", key, {
          relation: table,
          sourceCode: text(code),
        });
        return null;
      }
      return ref(table, text(code));
    };
    add("products", key, p, {
      name: clip(p.Dscr, 190, "products", key) || `Produto ${key}`,
      slug: slug("products", key),
      brand_id: relation(brands, p.Fabr, "brands"),
      category_id: relation(categories, p.Grup, "categories"),
      price: money(p.Vend),
      cost: money(p.Cust),
      active: p.Situ === "S" ? 1 : 0,
    });
  }
  const colors = new Map(
    data.Grade_Medida_Produto_Eixo1.filter((r) => r.CodigoCategoria === 1).map(
      (r) => [text(r.Codigo), text(r.Descricao)],
    ),
  );
  const sizes = new Map(
    data.Grade_Medida_Produto_Eixo2.filter((r) => r.CodigoCategoria === 2).map(
      (r) => [text(r.Codigo), text(r.Descricao)],
    ),
  );
  const variantByAxes = new Map(),
    defaultVariants = new Map(),
    byProduct = group(grades, (r) => text(r.Produto));
  let gradeStock = 0,
    defaultStock = 0;
  for (const g of grades) {
    const key = [text(g.Grade), text(g.RefHorizontal), text(g.RefVertical)];
    const color = colors.get(text(g.RefHorizontal)),
      size = sizes.get(text(g.RefVertical));
    if (!color || !size) warn("MISSING_AXIS_LABEL", "product_variants", key);
    const n = stock(g.Atual);
    gradeStock += n;
    add("product_variants", key, g, {
      product_id: ref("products", text(g.Produto)),
      color: clip(color || g.RefHorizontal, 80, "product_variants", key),
      size: clip(size || g.RefVertical, 20, "product_variants", key),
      sku: text(g.CodigoGrade) || null,
      barcode: text(g.GtinGrade) || null,
      physical_stock: n,
      active:
        !products.get(text(g.Produto)).placeholder && g.Situacao === "Ativo"
          ? 1
          : 0,
    });
    const axisKey = JSON.stringify([
      text(g.Produto),
      text(g.RefHorizontal),
      text(g.RefVertical),
    ]);
    if (variantByAxes.has(axisKey))
      throw new Error("Grade ambígua por produto/cor/tamanho");
    variantByAxes.set(axisKey, ref("product_variants", key));
  }
  for (const [key, p] of products)
    if (!byProduct.has(key)) {
      const vkey = ["default", key],
        n = stock(p.Qtde);
      defaultStock += n;
      add("product_variants", vkey, p, {
        product_id: ref("products", key),
        color: "Padrão",
        size: "Único",
        sku: `GSC-${key}`,
        barcode: text(p.Gtin) || text(p.Cean) || null,
        physical_stock: n,
        active: p.Situ === "S" ? 1 : 0,
      });
      defaultVariants.set(key, ref("product_variants", vkey));
    }
  for (const r of sorted(data.Cliente, ["Clie"])) {
    const key = text(r.Clie),
      cpf = text(r.Ncpf).replace(/\D/g, "");
    if (cpf && cpf.length !== 11)
      warn("INVALID_CPF_PRESERVED", "customers", key);
    add("customers", key, r, {
      name: clip(r.Nome, 120, "customers", key) || `Cliente ${key}`,
      cpf: cpf.length === 11 ? cpf : null,
      phone: clip(r.Fone, 30, "customers", key) || null,
      email: clip(r.Emai, 190, "customers", key) || null,
      active: r.Situ === "I" ? 0 : 1,
    });
  }
  for (const r of sorted(data.Fornecedor, ["Forn"])) {
    const key = text(r.Forn);
    add("suppliers", key, r, {
      name: clip(r.Raso, 190, "suppliers", key) || `Fornecedor ${key}`,
      trade_name: clip(r.Fant, 190, "suppliers", key) || null,
      tax_id: clip(text(r.Cnpj) || text(r.Ncpf), 20, "suppliers", key) || null,
      phone: clip(r.Fone, 30, "suppliers", key) || null,
      email: clip(r.Emai, 190, "suppliers", key) || null,
    });
  }
  const customers = new Set(data.Cliente.map((r) => text(r.Clie))),
    sales = new Map(),
    items = group(data.Pre_Venda_Itens, (r) => text(r.Ndoc)),
    gradeItems = group(
      sorted(data.Grade_Medida_Pre_Venda_Itens, [
        "Ndoc",
        "Nite",
        "Produto",
        "RefHorizontal",
        "RefVertical",
        "Quantidade",
        "Cancelado",
      ]),
      (r) => JSON.stringify([text(r.Ndoc), text(r.Nite)]),
    );
  for (const s of sorted(data.Pre_Venda, ["Ndoc"])) {
    const key = text(s.Ndoc);
    if (!["A", "S"].includes(s.Canc) || s.Stat !== "X" || s.Tipo !== "B")
      throw new Error(`Estado de venda não validado: ${key}`);
    if (!customers.has(text(s.Clie)))
      throw new Error(`Cliente ausente na venda ${key}`);
    if (!(s.Emis instanceof Date) || !Number.isFinite(s.Emis.getTime()))
      throw new Error(`Data inválida: ${key}`);
    const date = s.Emis.toISOString().slice(0, 19).replace("T", " ");
    sales.set(key, s);
    const sum =
      (items.get(key) || [])
        .filter((i) => i.Canc === "N")
        .reduce((n, i) => n + Math.round(Number(money(i.Vtot)) * 100), 0) / 100;
    const total = money(s.TotaFinal);
    if (money(sum) !== total)
      warn("SALE_TOTAL_MISMATCH", "sales", key, {
        itemTotal: money(sum),
        total,
      });
    add("sales", key, s, {
      customer_id: ref("customers", text(s.Clie)),
      user_id: { actor: true },
      subtotal: money(s.Tota),
      discount: money(s.Desc),
      surcharge: money(s.Acre),
      total,
      status: s.Canc === "S" ? "CANCELADA" : "CONCLUIDA",
      is_historical: 1,
      created_at: date,
    });
  }
  for (const i of sorted(data.Pre_Venda_Itens, ["Ndoc", "Nite"])) {
    const key = [text(i.Ndoc), text(i.Nite)];
    if (!sales.has(key[0])) throw new Error("Item sem venda");
    const p = products.get(text(i.Prod));
    if (!p) throw new Error("Produto histórico ausente");
    const gs = gradeItems.get(JSON.stringify(key)) || [];
    let variant = defaultVariants.get(text(i.Prod)) || null,
      color = "Não identificado",
      size = "N/I";
    // Itens de múltiplas grades mantêm sua linha financeira original; os eixos
    // completos ficam no source_data, sem inventar a atribuição dos valores.
    if (gs.length === 1 && Number(gs[0].Quantidade) === Number(i.Qtde)) {
      const g = gs[0];
      if (text(g.Produto) !== text(i.Prod))
        throw new Error("Produto da grade difere do item histórico");
      variant =
        variantByAxes.get(
          JSON.stringify([
            text(g.Produto),
            text(g.RefHorizontal),
            text(g.RefVertical),
          ]),
        ) || null;
      color = colors.get(text(g.RefHorizontal)) || text(g.RefHorizontal);
      size = sizes.get(text(g.RefVertical)) || text(g.RefVertical);
    } else if (variant) {
      color = "Padrão";
      size = "Único";
    }
    if (!variant)
      warn("HISTORICAL_VARIANT_UNRESOLVED", "sale_items", key, {
        gradeRows: gs.length,
      });
    if (Number(i.QuantidadeDevolvida))
      warn("HISTORICAL_RETURN_PRESERVED", "sale_items", key, {
        quantity: i.QuantidadeDevolvida,
      });
    const quantity = stock(i.Qtde);
    if (!quantity) throw new Error("Item com quantidade zero");
    add(
      "sale_items",
      key,
      { ...i, grades: gs },
      {
        sale_id: ref("sales", key[0]),
        variant_id: variant,
        product_id: ref("products", text(i.Prod)),
        product_name: clip(p.Dscr, 190, "sale_items", key),
        color: clip(color, 80, "sale_items", key),
        size: clip(size, 20, "sale_items", key),
        quantity,
        unit_price: money(i.Valo),
        discount: money(
          Math.max(0, Number(money(i.Valo)) * quantity - Number(money(i.Vtot))),
        ),
        surcharge: money(
          Math.max(0, Number(money(i.Vtot)) - Number(money(i.Valo)) * quantity),
        ),
        subtotal: money(i.Vtot),
        legacy_cancelled: i.Canc === "N" ? 0 : 1,
      },
    );
  }
  for (const p of sorted(data.Pre_Venda_FormaPagamento, ["Id"])) {
    const key = text(p.Id);
    if (!sales.has(text(p.Ndoc))) throw new Error("Pagamento sem venda");
    const methods = {
      DIN: "DINHEIRO",
      PIX: "PIX",
      CTC: "CREDITO",
      CTD: "DEBITO",
    };
    const method = methods[text(p.Espe)] || "OUTROS";
    if (method === "OUTROS")
      warn("PAYMENT_METHOD_PRESERVED", "payments", key, {
        method: text(p.Espe),
      });
    add("payments", key, p, {
      sale_id: ref("sales", text(p.Ndoc)),
      method,
      amount: money(p.Valor),
      reconciliation_status: "LEGADO_NAO_CONCILIADO",
      created_at: sales
        .get(text(p.Ndoc))
        .Emis.toISOString()
        .slice(0, 19)
        .replace("T", " "),
    });
  }
  const ids = new Set();
  for (const r of records) {
    if (ids.has(r.id)) throw new Error(`Chave legada repetida em ${r.table}`);
    ids.add(r.id);
  }
  return {
    records,
    exceptions,
    sourceCounts: Object.fromEntries(
      Object.entries(data).map(([t, rs]) => [t, rs.length]),
    ),
    stock: {
      grades: gradeStock,
      defaults: defaultStock,
      total: gradeStock + defaultStock,
    },
  };
}
