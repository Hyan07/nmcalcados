import { pool, transaction } from "../database/pool.js";
import { cents, decimal } from "../utils/pricing.js";

export async function dashboard() {
  const [[sales], [orders], [low], [recent], [top], [investment]] =
    await Promise.all([
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
      pool.query(
        `SELECT COALESCE(SUM(v.physical_stock * COALESCE(v.cost,p.cost,0)),0) total,
      COALESCE(SUM(v.physical_stock),0) units,
      COALESCE(SUM(CASE WHEN COALESCE(v.cost,p.cost,0)=0 THEN v.physical_stock ELSE 0 END),0) unitsWithoutCost
      FROM product_variants v JOIN products p ON p.id=v.product_id`,
      ),
    ]);
  return {
    stockInvestment: investment[0],
    salesToday: sales[0],
    pendingOrders: orders[0].count,
    lowStock: low[0].count,
    recentOrders: recent,
    topProducts: top,
  };
}
export async function reportFilters() {
  const [[products], [categories]] = await Promise.all([
    pool.query("SELECT id,name FROM products ORDER BY name,id"),
    pool.query("SELECT id,name FROM categories ORDER BY name,id"),
  ]);
  return { products, categories };
}
export async function reports({ start, end, productId, categoryId } = {}) {
  const startDate = start || "1900-01-01",
    endDate = end || "9999-12-30";
  const product = productId || null,
    category = categoryId || null;
  const itemScope = "(? IS NULL OR p.id=?) AND (? IS NULL OR p.category_id=?)";
  const scopeArgs = [product, product, category, category];
  const dateScope = (column) =>
    `${column}>=CONVERT_TZ(?,'-03:00','+00:00') AND ${column}<DATE_ADD(CONVERT_TZ(?,'-03:00','+00:00'),INTERVAL 1 DAY)`;
  const saleScope = `${dateScope("s.created_at")} AND EXISTS (
    SELECT 1 FROM sale_items si LEFT JOIN product_variants v ON v.id=si.variant_id
    LEFT JOIN products p ON p.id=COALESCE(si.product_id,v.product_id)
    WHERE si.sale_id=s.id AND (s.status='CANCELADA' OR si.legacy_cancelled=0) AND ${itemScope})`;
  const saleArgs = [startDate, endDate, ...scopeArgs];
  const purchaseScope = `pu.status='RECEBIDA' AND ${dateScope("pu.received_at")} AND EXISTS (
    SELECT 1 FROM purchase_items pi JOIN product_variants v ON v.id=pi.variant_id
    JOIN products p ON p.id=v.product_id WHERE pi.purchase_id=pu.id AND ${itemScope})`;
  const day = (column) =>
    `DATE_FORMAT(CONVERT_TZ(${column},'+00:00','-03:00'),'%Y-%m-%d')`;
  return transaction(async (conn) => {
    const [
      [summary],
      [sales],
      [payment],
      [top],
      [purchases],
      [stock],
      [movements],
      [saleDetails],
      [saleItems],
      [purchaseDetails],
    ] = await Promise.all([
      conn.execute(
        `SELECT COUNT(CASE WHEN s.status='CONCLUIDA' THEN 1 END) salesCount,
        COALESCE(SUM(CASE WHEN s.status='CONCLUIDA' THEN s.total ELSE 0 END),0) salesTotal,
        COALESCE(SUM(CASE WHEN s.status='CONCLUIDA' THEN s.discount ELSE 0 END),0) discounts,
        COALESCE(SUM(CASE WHEN s.status='CONCLUIDA' THEN s.surcharge ELSE 0 END),0) surcharges,
        COUNT(CASE WHEN s.status='CANCELADA' THEN 1 END) cancelledCount,
        COALESCE(SUM(CASE WHEN s.status='CANCELADA' THEN s.total ELSE 0 END),0) cancelledTotal
        FROM sales s WHERE ${saleScope}`,
        saleArgs,
      ),
      conn.execute(
        `SELECT ${day("s.created_at")} day,COUNT(*) count,SUM(s.total) total
        FROM sales s WHERE s.status='CONCLUIDA' AND ${saleScope} GROUP BY day ORDER BY day DESC`,
        saleArgs,
      ),
      conn.execute(
        `SELECT pay.method,pay.reconciliation_status,COUNT(*) count,SUM(pay.amount) total
        FROM payments pay JOIN sales s ON s.id=pay.sale_id WHERE s.status='CONCLUIDA' AND ${saleScope}
        GROUP BY pay.method,pay.reconciliation_status ORDER BY pay.method,pay.reconciliation_status`,
        saleArgs,
      ),
      conn.execute(
        `SELECT si.product_name,SUM(si.quantity) quantity,SUM(si.subtotal) total
        FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN product_variants v ON v.id=si.variant_id
        LEFT JOIN products p ON p.id=COALESCE(si.product_id,v.product_id)
        WHERE s.status='CONCLUIDA' AND si.legacy_cancelled=0 AND ${dateScope("s.created_at")} AND ${itemScope}
        GROUP BY COALESCE(si.product_id,v.product_id),si.product_name ORDER BY quantity DESC,si.product_name`,
        saleArgs,
      ),
      conn.execute(
        `SELECT ${day("pu.received_at")} day,COUNT(*) count,SUM(pu.total) total
        FROM purchases pu WHERE ${purchaseScope} GROUP BY day ORDER BY day DESC`,
        saleArgs,
      ),
      conn.execute(
        `SELECT p.name,v.color,v.size,v.sku,v.physical_stock,v.reserved_stock,
        v.physical_stock-v.reserved_stock available,v.minimum_stock,COALESCE(v.cost,p.cost,0) unit_cost,
        v.physical_stock*COALESCE(v.cost,p.cost,0) stock_value
        FROM product_variants v JOIN products p ON p.id=v.product_id WHERE ${itemScope} ORDER BY p.name,v.color,v.size,v.id`,
        scopeArgs,
      ),
      conn.execute(
        `SELECT m.type,COUNT(*) count,SUM(m.quantity) quantity FROM stock_movements m
        JOIN product_variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id
        WHERE ${dateScope("m.created_at")} AND ${itemScope} GROUP BY m.type ORDER BY m.type`,
        saleArgs,
      ),
      conn.execute(
        `SELECT s.id,s.created_at,s.status,s.subtotal,s.discount,s.surcharge,s.total,s.is_historical,
        COALESCE(c.name,'Balcão') customer_name,u.name user_name,
        (SELECT GROUP_CONCAT(DISTINCT method ORDER BY method SEPARATOR ', ') FROM payments WHERE sale_id=s.id) methods
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id
        WHERE ${saleScope} ORDER BY s.created_at DESC,s.id DESC`,
        saleArgs,
      ),
      conn.execute(
        `SELECT si.sale_id,si.product_name,si.color,si.size,si.quantity,si.unit_price,si.discount,si.surcharge,si.subtotal,si.legacy_cancelled
        FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${saleScope} ORDER BY s.created_at DESC,s.id DESC,si.id`,
        saleArgs,
      ),
      conn.execute(
        `SELECT pu.id,pu.received_at,pu.total,su.name supplier_name,u.name user_name
        FROM purchases pu LEFT JOIN suppliers su ON su.id=pu.supplier_id LEFT JOIN users u ON u.id=pu.user_id
        WHERE ${purchaseScope} ORDER BY pu.received_at DESC,pu.id DESC`,
        saleArgs,
      ),
    ]);
    const saleTotals = summary[0];
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        start: start || null,
        end: end || null,
        productId: product,
        categoryId: category,
      },
      summary: {
        ...saleTotals,
        averageTicket: Number(saleTotals.salesCount)
          ? (
              Number(saleTotals.salesTotal) / Number(saleTotals.salesCount)
            ).toFixed(2)
          : "0.00",
        purchasesTotal: decimal(
          purchases.reduce((sum, x) => sum + cents(x.total), 0),
        ),
        purchasesCount: purchases.reduce((sum, x) => sum + Number(x.count), 0),
        stockValue: decimal(
          stock.reduce((sum, x) => sum + cents(x.stock_value), 0),
        ),
        physicalUnits: stock.reduce(
          (sum, x) => sum + Number(x.physical_stock),
          0,
        ),
        reservedUnits: stock.reduce(
          (sum, x) => sum + Number(x.reserved_stock),
          0,
        ),
        lowStockCount: stock.filter((x) => x.available <= x.minimum_stock)
          .length,
        unitsWithoutCost: stock
          .filter((x) => Number(x.unit_cost) === 0)
          .reduce((sum, x) => sum + Number(x.physical_stock), 0),
      },
      sales,
      payment,
      top,
      purchases,
      stock,
      movements,
      saleDetails,
      saleItems,
      purchaseDetails,
    };
  });
}
