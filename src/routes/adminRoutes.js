import { Router } from "express";
import multer from "multer";
import { requireAuth, permit, protectWrite } from "../middlewares/auth.js";
import * as c from "../controllers/adminController.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
});
router.use(requireAuth, protectWrite);
router.get("/dashboard", permit("dashboard.view"), c.dashboard);
router.get("/reports", permit("reports.view"), c.report);
router.get("/products", permit("products.view"), c.productList);
router.get("/products/barcode/:barcode", permit("products.view"), c.barcode);
router.get("/products/:id", permit("products.view"), c.productOne);
router.post("/products", permit("products.create"), c.productCreate);
router.put("/products/:id", permit("products.edit"), c.productUpdate);
router.post("/variants", permit("products.create"), c.variantCreate);
router.put("/variants/:id", permit("products.edit"), c.variantUpdate);
router.post(
  "/products/:id/images",
  permit("products.edit"),
  upload.array("images", 8),
  c.imageUpload,
);
router.patch(
  "/products/:id/images/:imageId",
  permit("products.edit"),
  c.imageUpdate,
);
router.delete(
  "/products/:id/images/:imageId",
  permit("products.edit"),
  c.imageDelete,
);
router.get("/orders", permit("orders.view"), c.orderList);
router.get("/orders/:id", permit("orders.view"), c.orderOne);
router.patch("/orders/:id/status", permit("orders.manage"), c.orderStatus);
router.post("/orders/:id/convert", permit("orders.manage"), c.orderConvert);
router.get("/sales", permit("sales.view"), c.saleList);
router.post("/sales", permit("sales.create"), c.saleCreate);
router.post("/sales/:id/cancel", permit("sales.cancel"), c.saleCancel);
router.get("/stock", permit("stock.view"), c.stockList);
router.get("/stock/movements", permit("stock.view"), c.stockMovements);
router.post("/stock/adjust", permit("stock.adjust"), c.stockAdjust);
router.get("/purchases", permit("purchases.view"), c.purchaseList);
router.post("/purchases", permit("purchases.create"), c.purchaseCreate);
router.post(
  "/purchases/:id/receive",
  permit("purchases.create"),
  c.purchaseReceive,
);
for (const table of ["suppliers", "customers"]) {
  const base = table === "suppliers" ? "suppliers" : "customers";
  router.get(`/${base}`, permit(`${base}.view`), c.entityList(table));
  router.post(`/${base}`, permit(`${base}.manage`), c.entityCreate(table));
  router.put(`/${base}/:id`, permit(`${base}.manage`), c.entityUpdate(table));
}
router.get("/users", permit("users.manage"), c.userList);
router.get("/users/roles", permit("users.manage"), c.userRoles);
router.get("/users/permissions", permit("users.manage"), c.userPermissions);
router.post("/users", permit("users.manage"), c.userCreate);
router.get("/users/:id/permissions", permit("users.manage"), c.userOverrides);
router.patch("/users/:id/permission", permit("users.manage"), c.userPermission);
router.delete(
  "/users/:id/permission",
  permit("users.manage"),
  c.userPermissionReset,
);
router.patch("/users/:id/active", permit("users.manage"), c.userActive);
router.get("/audit", permit("settings.view"), c.auditList);
export default router;
