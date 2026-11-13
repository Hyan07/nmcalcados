import bcrypt from "bcrypt";
import { pool } from "./pool.js";
import { slugify } from "../utils/format.js";

const permissions = [
  "dashboard.view",
  "products.view",
  "products.create",
  "products.edit",
  "products.delete",
  "stock.view",
  "stock.adjust",
  "sales.create",
  "sales.view",
  "sales.cancel",
  "orders.view",
  "orders.manage",
  "purchases.view",
  "purchases.create",
  "suppliers.view",
  "suppliers.manage",
  "customers.view",
  "customers.manage",
  "users.manage",
  "reports.view",
  "settings.view",
];
for (const [name, label] of [
  ["ADMIN", "Administrador"],
  ["VENDEDOR", "Vendedor"],
]) {
  await pool.execute(
    "INSERT INTO roles (name,label) VALUES (?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)",
    [name, label],
  );
}
for (const code of permissions)
  await pool.execute("INSERT IGNORE INTO permissions (code) VALUES (?)", [
    code,
  ]);
await pool.query(
  `INSERT IGNORE INTO role_permissions (role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='ADMIN'`,
);
await pool.query(
  `INSERT IGNORE INTO role_permissions (role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='VENDEDOR' AND p.code IN ('dashboard.view','products.view','stock.view','sales.create','sales.view','orders.view','orders.manage','customers.view','purchases.view')`,
);
const name = process.env.ADMIN_NAME;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (name && email && password) {
  if (password.length < 12)
    throw new Error("ADMIN_PASSWORD deve ter ao menos 12 caracteres");
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO users (role_id,name,email,password_hash) SELECT id,?,?,? FROM roles WHERE name='ADMIN' ON DUPLICATE KEY UPDATE name=VALUES(name)`,
    [name, email.toLowerCase(), hash],
  );
  console.info(`Administrador disponível: ${email}`);
} else
  console.warn(
    "ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD não configurados; administrador não criado.",
  );
for (const category of ["Tênis", "Sandálias", "Botas", "Sapatos"]) {
  await pool.execute("INSERT IGNORE INTO categories (name,slug) VALUES (?,?)", [
    category,
    slugify(category),
  ]);
}
for (const brand of ["Nike", "Adidas", "Vizzano", "Beira Rio", "Moleca"]) {
  await pool.execute("INSERT IGNORE INTO brands (name,slug) VALUES (?,?)", [
    brand,
    slugify(brand),
  ]);
}
await pool.end();
