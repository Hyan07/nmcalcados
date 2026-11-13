import { z } from "zod";
import { schemas, parse } from "../validators/schemas.js";
import * as products from "../services/productService.js";
import * as orders from "../services/orderService.js";
import * as sales from "../services/saleService.js";
import * as stock from "../services/stockService.js";
import * as purchases from "../services/purchaseService.js";
import * as users from "../services/userService.js";
import * as images from "../services/imageService.js";
import * as reports from "../services/reportService.js";
import { listEntity, saveEntity } from "../repositories/adminRepository.js";
import { pool } from "../database/pool.js";

const ok = (res, data, status = 200) => res.status(status).json(data);
const id = (req) => parse(z.coerce.number().int().positive(), req.params.id);
export const dashboard = async (req, res) => ok(res, await reports.dashboard());
export const report = async (req, res) =>
  ok(res, await reports.reports(req.query));
export const productList = async (req, res) =>
  ok(res, await products.listProducts(req.query));
export const productOne = async (req, res) =>
  ok(res, await products.getProduct(id(req)));
export const productCreate = async (req, res) =>
  ok(
    res,
    await products.saveProduct(
      parse(schemas.product, req.body),
      req.user,
      req.ip,
    ),
    201,
  );
export const productUpdate = async (req, res) =>
  ok(
    res,
    await products.saveProduct(
      parse(schemas.product, req.body),
      req.user,
      req.ip,
      id(req),
    ),
  );
export const variantCreate = async (req, res) =>
  ok(
    res,
    await products.saveVariant(
      parse(schemas.variant, req.body),
      req.user,
      req.ip,
    ),
    201,
  );
export const variantUpdate = async (req, res) =>
  ok(
    res,
    await products.saveVariant(
      parse(schemas.variant, req.body),
      req.user,
      req.ip,
      id(req),
    ),
  );
export const barcode = async (req, res) =>
  ok(res, await products.findBarcode(req.params.barcode));
export const imageUpload = async (req, res) =>
  ok(res, await images.uploadImages(id(req), req.files, req.user, req.ip), 201);
export const imageUpdate = async (req, res) =>
  ok(
    res,
    await images.updateImage(
      id(req),
      Number(req.params.imageId),
      parse(
        z.object({
          position: z.coerce.number().int().nonnegative().optional(),
          isPrimary: z.boolean().optional(),
        }),
        req.body,
      ),
      req.user,
      req.ip,
    ),
  );
export const imageDelete = async (req, res) =>
  ok(
    res,
    await images.deleteImage(
      id(req),
      Number(req.params.imageId),
      req.user,
      req.ip,
    ),
  );
export const orderList = async (req, res) =>
  ok(res, await orders.listOrders(req.query));
export const orderOne = async (req, res) =>
  ok(res, await orders.getOrder(id(req)));
export const orderStatus = async (req, res) =>
  ok(
    res,
    await orders.changeOrderStatus(
      id(req),
      parse(schemas.status, req.body).status,
      req.user,
      req.ip,
    ),
  );
export const orderConvert = async (req, res) =>
  ok(
    res,
    await sales.convertOrder(
      id(req),
      parse(schemas.payment, req.body).payment,
      req.user,
      req.ip,
    ),
  );
export const saleList = async (req, res) =>
  ok(res, await sales.listSales(req.query));
export const saleCreate = async (req, res) =>
  ok(
    res,
    await sales.createSale(parse(schemas.sale, req.body), req.user, req.ip),
    201,
  );
export const saleCancel = async (req, res) =>
  ok(res, await sales.cancelSale(id(req), req.user, req.ip));
export const stockList = async (req, res) =>
  ok(res, await stock.stockList(req.query));
export const stockMovements = async (req, res) =>
  ok(res, await stock.movements(req.query));
export const stockAdjust = async (req, res) =>
  ok(
    res,
    await stock.adjustStock(
      parse(schemas.adjustment, req.body),
      req.user,
      req.ip,
    ),
  );
export const purchaseList = async (req, res) =>
  ok(res, await purchases.listPurchases());
export const purchaseCreate = async (req, res) =>
  ok(
    res,
    await purchases.createPurchase(
      parse(schemas.purchase, req.body),
      req.user,
      req.ip,
    ),
    201,
  );
export const purchaseReceive = async (req, res) =>
  ok(res, await purchases.receivePurchase(id(req), req.user, req.ip));
const mapping = {
  suppliers: {
    schema: schemas.supplier,
    fields: (d) => ({
      name: d.name,
      trade_name: d.tradeName,
      tax_id: d.taxId,
      phone: d.phone,
      whatsapp: d.whatsapp,
      email: d.email,
      address: d.address,
      notes: d.notes,
      active: d.active,
    }),
  },
  customers: {
    schema: schemas.customer,
    fields: (d) => ({
      name: d.name,
      cpf: d.cpf || null,
      phone: d.phone,
      email: d.email,
      active: d.active,
    }),
  },
};
export const entityList = (table) => async (req, res) =>
  ok(res, await listEntity(table, req.query));
export const entityCreate = (table) => async (req, res) =>
  ok(
    res,
    await saveEntity(
      table,
      mapping[table].fields(parse(mapping[table].schema, req.body)),
    ),
    201,
  );
export const entityUpdate = (table) => async (req, res) =>
  ok(
    res,
    await saveEntity(
      table,
      mapping[table].fields(parse(mapping[table].schema, req.body)),
      id(req),
    ),
  );
export const userList = async (req, res) => ok(res, await users.listUsers());
export const userRoles = async (req, res) => ok(res, await users.roles());
export const userPermissions = async (req, res) =>
  ok(res, await users.permissions());
export const userOverrides = async (req, res) =>
  ok(res, await users.userOverrides(id(req)));
export const userCreate = async (req, res) =>
  ok(
    res,
    await users.createUser(parse(schemas.user, req.body), req.user, req.ip),
    201,
  );
export const userPermission = async (req, res) => {
  const data = parse(schemas.permission, req.body);
  ok(
    res,
    await users.setUserPermission(
      id(req),
      data.permission,
      data.allowed,
      req.user,
      req.ip,
    ),
  );
};
export const userPermissionReset = async (req, res) =>
  ok(
    res,
    await users.resetUserPermission(
      id(req),
      parse(z.object({ permission: z.string().min(1) }), req.body).permission,
      req.user,
      req.ip,
    ),
  );
export const userActive = async (req, res) =>
  ok(
    res,
    await users.setUserActive(
      id(req),
      parse(z.object({ active: z.boolean() }), req.body).active,
      req.user,
      req.ip,
    ),
  );
export const auditList = async (req, res) => {
  const [items] = await pool.query(
    "SELECT a.id,a.action,a.entity,a.entity_id,a.created_at,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100",
  );
  ok(res, items);
};
