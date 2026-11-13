import { hash } from "./plan.js";
export const uniqueFields = {
  brands: [["name"], ["slug"]],
  categories: [["name"], ["slug"]],
  products: [["slug"]],
  product_variants: [["sku"], ["barcode"], ["product_id", "color", "size"]],
  customers: [["cpf"]],
  suppliers: [["tax_id"]],
  sales: [],
  sale_items: [],
  payments: [],
};
const canonical = (v) =>
  String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .trimEnd();
const uniqueKey = (values, fields) =>
  fields.some((f) => values[f] === null || values[f] === undefined)
    ? null
    : JSON.stringify(fields.map((f) => canonical(values[f])));
export async function importPlan(conn, plan, { dryRun = true } = {}) {
  const report = {
    dryRun,
    committed: false,
    sourceCounts: plan.sourceCounts,
    stock: plan.stock,
    counts: {},
    exceptions: [...plan.exceptions],
    errors: [],
  };
  const [migrations] = await conn.query(
    "SELECT name FROM schema_migrations WHERE name='002_gescom.js'",
  );
  if (!migrations.length)
    throw new Error("Execute npm run migrate antes de importar");
  const [users] = await conn.query(
    "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='ADMIN' AND u.active=1 ORDER BY u.id LIMIT 1",
  );
  if (!users.length)
    throw new Error(
      "Execute o seed: administrador ativo é necessário para autoria histórica",
    );
  const actor = users[0].id;
  const [legacy] = await conn.query(
    "SELECT entity,key_hash,target_id,source_hash FROM legacy_records WHERE source='gescompro'",
  );
  const mappings = new Map(legacy.map((r) => [`${r.entity}:${r.key_hash}`, r]));
  const resolved = new Map(),
    existing = new Map(),
    sets = new Map();
  for (const [table, indexes] of Object.entries(uniqueFields)) {
    report.counts[table] = { imported: 0, ignored: 0, errors: 0 };
    const columns = [...new Set(["id", ...indexes.flat()])];
    const [rows] = await conn.query(
      `SELECT ${columns.join(",")} FROM ${table}`,
    );
    existing.set(table, new Set(rows.map((r) => String(r.id))));
    sets.set(
      table,
      indexes.map((fields) => ({
        fields,
        values: new Set(
          rows.map((r) => uniqueKey(r, fields)).filter((k) => k !== null),
        ),
      })),
    );
  }
  for (const r of plan.records) {
    const old = mappings.get(r.id);
    if (old) {
      if (!existing.get(r.table).has(String(old.target_id)))
        throw new Error(
          `Destino removido para ${r.id}; requer conciliação manual`,
        );
      resolved.set(r.id, old.target_id);
    }
  }
  const resolve = (value) => {
    if (value && typeof value === "object") {
      if (value.actor) return actor;
      if (value.ref) {
        if (!resolved.has(value.ref))
          throw new Error(`Referência não resolvida: ${value.ref}`);
        return resolved.get(value.ref);
      }
    }
    return value;
  };
  let current;
  try {
    for (const r of plan.records) {
      current = r;
      const count = report.counts[r.table],
        old = mappings.get(r.id);
      if (old) {
        count.ignored++;
        if (old.source_hash !== r.sourceHash)
          report.exceptions.push({
            code: "SOURCE_CHANGED_NOT_OVERWRITTEN",
            table: r.table,
            key: r.key,
          });
        continue;
      }
      const values = Object.fromEntries(
        Object.entries(r.values).map(([k, v]) => [k, resolve(v)]),
      );
      for (const index of sets.get(r.table)) {
        let key = uniqueKey(values, index.fields);
        if (key === null) continue;
        if (index.values.has(key)) {
          const field = index.fields[0];
          report.exceptions.push({
            code: "UNIQUE_COLLISION_PRESERVED",
            table: r.table,
            key: r.key,
            fields: index.fields,
            original: index.fields.length === 1 ? values[field] : undefined,
          });
          if (["barcode", "cpf", "tax_id"].includes(field))
            values[field] = null;
          else if (field === "sku")
            values.sku = `GSC-${hash(r.key).slice(0, 40)}`;
          else if (field === "name")
            values.name = `${values.name.slice(0, 70)} [${hash(r.key).slice(0, 12)}]`;
          else if (field === "product_id")
            values.size = `${values.size.slice(0, 5)}~${hash(r.key).slice(0, 14)}`;
          else throw new Error(`Colisão não resolvida: ${r.table}.${field}`);
          key = uniqueKey(values, index.fields);
          if (key !== null && index.values.has(key))
            throw new Error(`Colisão persistente: ${r.table}.${field}`);
        }
        if (key !== null) index.values.add(key);
      }
      // Validate lengths of identifiers without silently truncating SKU/barcode.
      for (const field of ["sku", "barcode"])
        if (values[field]?.length > 100)
          throw new Error(
            `${r.table}.${field} maior que 100; requer conciliação`,
          );
      let id = `planned:${r.id}`;
      if (!dryRun) {
        const columns = Object.keys(values);
        const [result] = await conn.execute(
          `INSERT INTO ${r.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          Object.values(values),
        );
        id = result.insertId;
        await conn.execute(
          "INSERT INTO legacy_records (source,entity,key_hash,source_key,target_id,source_hash,source_data) VALUES (?,?,?,?,?,?,?)",
          [
            "gescompro",
            r.table,
            hash(r.key),
            JSON.stringify(r.key),
            id,
            r.sourceHash,
            JSON.stringify(r.source),
          ],
        );
      }
      resolved.set(r.id, id);
      count.imported++;
    }
  } catch (error) {
    if (current) {
      report.counts[current.table].errors++;
      report.failedRecord = { table: current.table, key: current.key };
    }
    error.report = report;
    throw error;
  }
  return report;
}
