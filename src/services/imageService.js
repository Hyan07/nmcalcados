import { pool, transaction } from "../database/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { storage } from "./storageService.js";
import { audit } from "../repositories/stockRepository.js";

function validImage(file) {
  const bytes = file.buffer;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype) ||
    !(jpg || png || webp)
  )
    throw new AppError("Envie uma imagem JPEG, PNG ou WEBP válida.", 422);
}
export async function uploadImages(productId, files, user, ip) {
  if (!files?.length) throw new AppError("Selecione ao menos uma imagem.");
  const [products] = await pool.execute("SELECT id FROM products WHERE id=?", [
    productId,
  ]);
  if (!products.length) throw notFound("Produto");
  files.forEach(validImage);
  const uploaded = [];
  try {
    for (const file of files) uploaded.push(await storage.upload(file));
    return await transaction(async (conn) => {
      const [count] = await conn.execute(
        "SELECT COUNT(*) total FROM product_images WHERE product_id=?",
        [productId],
      );
      let position = Number(count[0].total);
      const result = [];
      for (const item of uploaded) {
        const [insert] = await conn.execute(
          "INSERT INTO product_images (product_id,url,storage_key,position,is_primary) VALUES (?,?,?,?,?)",
          [productId, item.url, item.storageKey, position, position === 0],
        );
        result.push({ id: insert.insertId, url: item.url, position });
        position++;
      }
      await audit(conn, {
        userId: user.id,
        action: "IMAGENS_PRODUTO",
        entity: "products",
        entityId: productId,
        after: { count: files.length },
        ip,
      });
      return result;
    });
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((item) => storage.delete(item.storageKey)),
    );
    throw error;
  }
}
export async function updateImage(
  productId,
  imageId,
  { position, isPrimary },
  user,
  ip,
) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id FROM product_images WHERE product_id=? ORDER BY position,id FOR UPDATE",
      [productId],
    );
    const oldIndex = rows.findIndex(
      (row) => Number(row.id) === Number(imageId),
    );
    if (oldIndex < 0) throw notFound("Imagem");
    if (position !== undefined) {
      const target = Math.min(rows.length - 1, Math.max(0, position));
      const [item] = rows.splice(oldIndex, 1);
      rows.splice(target, 0, item);
      for (let index = 0; index < rows.length; index++)
        await conn.execute("UPDATE product_images SET position=? WHERE id=?", [
          index,
          rows[index].id,
        ]);
    }
    if (isPrimary)
      await conn.execute(
        "UPDATE product_images SET is_primary=0 WHERE product_id=?",
        [productId],
      );
    if (isPrimary)
      await conn.execute("UPDATE product_images SET is_primary=1 WHERE id=?", [
        imageId,
      ]);
    await audit(conn, {
      userId: user.id,
      action: "IMAGEM_PRODUTO",
      entity: "product_images",
      entityId: imageId,
      after: { position, isPrimary },
      ip,
    });
    return { id: Number(imageId) };
  });
}
export async function deleteImage(productId, imageId, user, ip) {
  const item = await transaction(async (conn) => {
    const [rows] = await conn.execute(
      "SELECT id,storage_key,is_primary FROM product_images WHERE id=? AND product_id=? FOR UPDATE",
      [imageId, productId],
    );
    if (!rows.length) throw notFound("Imagem");
    await conn.execute("DELETE FROM product_images WHERE id=?", [imageId]);
    if (rows[0].is_primary)
      await conn.execute(
        "UPDATE product_images SET is_primary=1 WHERE product_id=? ORDER BY position,id LIMIT 1",
        [productId],
      );
    await audit(conn, {
      userId: user.id,
      action: "EXCLUSAO_IMAGEM",
      entity: "product_images",
      entityId: imageId,
      ip,
    });
    return rows[0];
  });
  try {
    await storage.delete(item.storage_key);
  } catch (error) {
    console.warn("Falha ao remover imagem no storage:", error.message);
  }
  return { id: Number(imageId) };
}
