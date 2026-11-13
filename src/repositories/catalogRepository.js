import { pool } from "../database/pool.js";
import { thumbnailUrl } from "../utils/images.js";

const base = `SELECT p.id,p.name,p.slug,p.description,p.model,p.price,p.featured,p.created_at,
  c.name category,b.name brand,
  (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY is_primary DESC,position,id LIMIT 1) image,
  COALESCE((SELECT SUM(GREATEST(0,v.physical_stock-v.reserved_stock)) FROM product_variants v WHERE v.product_id=p.id AND v.active=1),0) available
  FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id`;
export async function listPublic(filters = {}) {
  const where = ["p.active=1"];
  const args = [];
  if (filters.q) {
    where.push("(p.name LIKE ? OR p.model LIKE ? OR b.name LIKE ?)");
    args.push(...Array(3).fill(`%${filters.q}%`));
  }
  if (filters.category) {
    where.push("c.slug=?");
    args.push(filters.category);
  }
  if (filters.brand) {
    where.push("b.slug=?");
    args.push(filters.brand);
  }
  if (filters.min) {
    where.push("p.price>=?");
    args.push(filters.min);
  }
  if (filters.max) {
    where.push("p.price<=?");
    args.push(filters.max);
  }
  if (filters.size) {
    where.push(
      "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.size=? AND v.active=1 AND v.physical_stock>v.reserved_stock)",
    );
    args.push(filters.size);
  }
  if (filters.color) {
    where.push(
      "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.color=? AND v.active=1 AND v.physical_stock>v.reserved_stock)",
    );
    args.push(filters.color);
  }
  if (filters.available === "true")
    where.push(
      "EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND v.physical_stock>v.reserved_stock)",
    );
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(filters.limit) || 12));
  const [count] = await pool.query(
    `SELECT COUNT(*) total FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id WHERE ${where.join(" AND ")}`,
    args,
  );
  const [items] = await pool.query(
    `${base} WHERE ${where.join(" AND ")} ORDER BY p.featured DESC,p.created_at DESC LIMIT ? OFFSET ?`,
    [...args, limit, (page - 1) * limit],
  );
  return {
    items: items.map((item) => ({ ...item, image: thumbnailUrl(item.image) })),
    page,
    limit,
    total: count[0].total,
  };
}
export async function getPublic(slug) {
  const [rows] = await pool.execute(`${base} WHERE p.slug=? AND p.active=1`, [
    slug,
  ]);
  if (!rows.length) return null;
  const product = rows[0];
  const [variants] = await pool.execute(
    "SELECT id,color,size,sku,barcode,COALESCE(price,?) price,GREATEST(0,physical_stock-reserved_stock) available FROM product_variants WHERE product_id=? AND active=1 ORDER BY color,size",
    [product.price, product.id],
  );
  const [images] = await pool.execute(
    "SELECT id,url,position,is_primary FROM product_images WHERE product_id=? ORDER BY is_primary DESC,position,id",
    [product.id],
  );
  return { ...product, variants, images };
}
export async function facets() {
  const [categories] = await pool.query(
    "SELECT id,name,slug FROM categories WHERE active=1 ORDER BY name",
  );
  const [brands] = await pool.query(
    "SELECT id,name,slug FROM brands WHERE active=1 ORDER BY name",
  );
  const [sizes] = await pool.query(
    "SELECT DISTINCT size FROM product_variants WHERE active=1 ORDER BY size",
  );
  const [colors] = await pool.query(
    "SELECT DISTINCT color FROM product_variants WHERE active=1 ORDER BY color",
  );
  return {
    categories,
    brands,
    sizes: sizes.map((x) => x.size),
    colors: colors.map((x) => x.color),
  };
}
