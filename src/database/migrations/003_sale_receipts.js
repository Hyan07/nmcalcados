// Repetível após interrupções entre o ALTER e o registro da migration.
export async function up(conn) {
  const [columns] = await conn.execute(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sales' AND column_name='warranty_text'",
  );
  if (!columns.length)
    await conn.query("ALTER TABLE sales ADD COLUMN warranty_text TEXT NULL");
}
