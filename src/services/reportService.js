import { pool } from "../database/pool.js";

export async function dashboard() {
  const [[sales], [orders], [low], [recent], [top]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) count,COALESCE(SUM(total),0) total FROM sales WHERE status='CONCLUIDA' AND DATE(created_at)=UTC_DATE()`,
    ),
    pool.query(
      `SELECT COUNT(*) count FROM orders WHERE status IN ('PENDENTE','EM_ATENDIMENTO','CONFIRMADO')`,
    ),
    pool.query(
      "SELECT COUNT(*) count FROM product_variants WHERE active=1 AND physical_stock-reserved_stock<=minimum_stock",
    ),
    pool.query(
      `SELECT o.id,o.status,o.total,o.created_at,c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 5`,
    ),
    pool.query(
      `SELECT si.product_name,SUM(si.quantity) quantity FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='CONCLUIDA' GROUP BY si.product_name ORDER BY quantity DESC LIMIT 5`,
    ),
  ]);
  return {
    salesToday: sales[0],
    pendingOrders: orders[0].count,
    lowStock: low[0].count,
    recentOrders: recent,
    topProducts: top,
  };
}
export async function reports({ start, end, productId, categoryId } = {}) {
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(start || "")
    ? start
    : "2000-01-01";
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(end || "") ? end : "2100-01-01";
  const [[sales], [payment], [top], [purchases], [stock], [movements]] =
    await Promise.all([
      pool.execute(
        `SELECT DATE(created_at) day,COUNT(*) count,SUM(total) total FROM sales WHERE status='CONCLUIDA' AND DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 100`,
        [startDate, endDate],
      ),
      pool.execute(
        `SELECT p.method,COUNT(*) count,SUM(p.amount) total FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='CONCLUIDA' AND DATE(s.created_at) BETWEEN ? AND ? GROUP BY p.method`,
        [startDate, endDate],
      ),
      pool.execute(
        `SELECT si.product_name,SUM(si.quantity) quantity,SUM(si.subtotal) total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN product_variants v ON v.id=si.variant_id LEFT JOIN products p ON p.id=COALESCE(si.product_id,v.product_id) WHERE s.status='CONCLUIDA' AND DATE(s.created_at) BETWEEN ? AND ? AND (? IS NULL OR p.id=?) AND (? IS NULL OR p.category_id=?) GROUP BY si.product_name ORDER BY quantity DESC LIMIT 20`,
        [
          startDate,
          endDate,
          productId || null,
          productId || null,
          categoryId || null,
          categoryId || null,
        ],
      ),
      pool.execute(
        `SELECT DATE(created_at) day,COUNT(*) count,SUM(total) total FROM purchases WHERE status='RECEBIDA' AND DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 100`,
        [startDate, endDate],
      ),
      pool.query(
        "SELECT p.name,v.color,v.size,v.physical_stock,v.reserved_stock,v.physical_stock-v.reserved_stock available,v.minimum_stock FROM product_variants v JOIN products p ON p.id=v.product_id ORDER BY p.name LIMIT 200",
      ),
      pool.execute(
        "SELECT type,COUNT(*) count,SUM(quantity) quantity FROM stock_movements WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY type",
        [startDate, endDate],
      ),
    ]);
  return { sales, payment, top, purchases, stock, movements };
}
