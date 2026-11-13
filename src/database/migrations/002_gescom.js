// Cada passo é repetível, inclusive após interrupção entre DDLs MySQL.
export async function up(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS legacy_records (
    source VARCHAR(30) NOT NULL, entity VARCHAR(40) NOT NULL,
    key_hash CHAR(64) NOT NULL, source_key JSON NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL, source_hash CHAR(64) NOT NULL,
    source_data JSON NOT NULL, imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source,entity,key_hash), INDEX idx_legacy_target (entity,target_id)
  )`);
  for (const [table, column, definition] of [
    ["sales", "is_historical", "BOOLEAN NOT NULL DEFAULT FALSE"],
    ["sales", "surcharge", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["sale_items", "surcharge", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["sale_items", "legacy_cancelled", "BOOLEAN NOT NULL DEFAULT FALSE"],
    [
      "payments",
      "reconciliation_status",
      "ENUM('RECEBIDO','LEGADO_NAO_CONCILIADO') NOT NULL DEFAULT 'RECEBIDO'",
    ],
  ]) {
    const [rows] = await conn.execute(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
      [table, column],
    );
    if (!rows.length)
      await conn.query(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
  }
  const [productColumns] = await conn.execute(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sale_items' AND column_name='product_id'",
  );
  if (!productColumns.length)
    await conn.query(
      "ALTER TABLE sale_items ADD COLUMN product_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id) REFERENCES products(id)",
    );
  const [rows] = await conn.execute(
    "SELECT IS_NULLABLE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sale_items' AND column_name='variant_id'",
  );
  if (rows[0].IS_NULLABLE !== "YES")
    await conn.query(
      "ALTER TABLE sale_items MODIFY COLUMN variant_id BIGINT UNSIGNED NULL",
    );
}
