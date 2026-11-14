import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { slugify } from "../utils/format.js";
import { audit } from "../repositories/stockRepository.js";

export async function listProducts({ q = "", page = 1, limit = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1),
    l = Math.min(100, Math.max(1, Number(limit) || 20)),
    term = `%${q}%`;
  const [count] = await pool.execute(
    "SELECT COUNT(*) total FROM products WHERE name LIKE ?",
    [term],
  );
  const [items] = await pool.query(
    `SELECT p.id,p.name,p.slug,p.model,p.price,p.cost,p.active,p.featured,p.created_at,b.name brand,c.name category,
    (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY is_primary DESC,position,id LIMIT 1) image,
    (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id) variant_count
    FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.name LIKE ? ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [term, l, (p - 1) * l],
  );
  return { items, total: count[0].total, page: p, limit: l };
}
export async function getProduct(id) {
  const [rows] = await pool.execute(
    "SELECT id,name,slug,description,model,brand_id,category_id,price,cost,active,featured,created_at,updated_at FROM products WHERE id=?",
    [id],
  );
  if (!rows.length) throw notFound("Produto");
  const [variants] = await pool.execute(
    "SELECT id,product_id,color,size,sku,barcode,cost,price,physical_stock,reserved_stock,minimum_stock,active FROM product_variants WHERE product_id=? ORDER BY color,size",
    [id],
  );
  const [images] = await pool.execute(
    "SELECT id,url,storage_key,position,is_primary FROM product_images WHERE product_id=? ORDER BY is_primary DESC,position,id",
    [id],
  );
  return { ...rows[0], variants, images };
}
export async function saveProduct(data, user, ip, id = null) {
  return transaction(async (conn) => {
    const slugBase = slugify(data.name);
    let slug = slugBase;
    if (id) {
      const [before] = await conn.execute(
        "SELECT id,name,slug FROM products WHERE id=? FOR UPDATE",
        [id],
      );
      if (!before.length) throw notFound("Produto");
      const [collision] = await conn.execute(
        "SELECT id FROM products WHERE slug=? AND id<>?",
        [slug, id],
      );
      if (collision.length) slug = `${slugBase}-${id}`;
      await conn.execute(
        `UPDATE products SET name=?,slug=?,description=?,model=?,brand_id=?,category_id=?,price=?,cost=?,active=?,featured=? WHERE id=?`,
        [
          data.name,
          slug,
          data.description,
          data.model,
          data.brandId || null,
          data.categoryId || null,
          data.price,
          data.cost,
          data.active,
          data.featured,
          id,
        ],
      );
      await audit(conn, {
        userId: user.id,
        action: "ALTERACAO_PRODUTO",
        entity: "products",
        entityId: id,
        before: before[0],
        after: { name: data.name, slug },
        ip,
      });
      return { id: Number(id), slug };
    }
    const [collision] = await conn.execute(
      "SELECT id FROM products WHERE slug=?",
      [slug],
    );
    if (collision.length) slug = `${slugBase}-${Date.now().toString(36)}`;
    const [result] = await conn.execute(
      `INSERT INTO products (name,slug,description,model,brand_id,category_id,price,cost,active,featured) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        data.name,
        slug,
        data.description,
        data.model,
        data.brandId || null,
        data.categoryId || null,
        data.price,
        data.cost,
        data.active,
        data.featured,
      ],
    );
    await audit(conn, {
      userId: user.id,
      action: "CADASTRO_PRODUTO",
      entity: "products",
      entityId: result.insertId,
      after: { name: data.name, slug },
      ip,
    });
    return { id: result.insertId, slug };
  });
}
export async function saveVariant(data, user, ip, id = null) {
  return transaction(async (conn) => {
    const values = [
      data.productId,
      data.color,
      data.size,
      data.sku,
      data.barcode,
      data.cost ?? null,
      data.price ?? null,
      data.minimumStock,
      data.active,
    ];
    if (id) {
      const [rows] = await conn.execute(
        "SELECT id,product_id,color,size FROM product_variants WHERE id=? FOR UPDATE",
        [id],
      );
      if (!rows.length) throw notFound("Variação");
      if (Number(rows[0].product_id) !== Number(data.productId))
        throw new AppError(
          "Não é possível transferir uma variação para outro produto.",
          409,
        );
      await conn.execute(
        `UPDATE product_variants SET product_id=?,color=?,size=?,sku=?,barcode=?,cost=?,price=?,minimum_stock=?,active=? WHERE id=?`,
        [...values, id],
      );
      await audit(conn, {
        userId: user.id,
        action: "ALTERACAO_VARIACAO",
        entity: "product_variants",
        entityId: id,
        before: rows[0],
        after: { color: data.color, size: data.size },
        ip,
      });
      return { id: Number(id) };
    }
    const [result] = await conn.execute(
      `INSERT INTO product_variants (product_id,color,size,sku,barcode,cost,price,minimum_stock,active) VALUES (?,?,?,?,?,?,?,?,?)`,
      values,
    );
    await audit(conn, {
      userId: user.id,
      action: "CADASTRO_VARIACAO",
      entity: "product_variants",
      entityId: result.insertId,
      after: { productId: data.productId, color: data.color, size: data.size },
      ip,
    });
    return { id: result.insertId };
  });
}
export async function findBarcode(barcode) {
  const code = String(barcode ?? "").trim();
  if (!code || code.length > 100)
    throw new AppError("Informe um código de barras ou SKU válido.");
  const [rows] = await pool.execute(
    `SELECT v.id variantId,v.product_id productId,v.color,v.size,v.sku,v.barcode,COALESCE(v.price,p.price) price,
    v.physical_stock-v.reserved_stock available,p.name productName FROM product_variants v JOIN products p ON p.id=v.product_id WHERE (v.barcode=? OR v.sku=?) AND v.active=1 AND p.active=1 LIMIT 2`,
    [code, code],
  );
  if (!rows.length) throw notFound("Código de barras ou SKU");
  if (rows.length > 1)
    throw new AppError(
      "Código corresponde a mais de uma variação. Busque pelo nome do produto e confira a cor e o tamanho.",
      409,
      "AMBIGUOUS_PRODUCT_CODE",
    );
  return rows[0];
}
