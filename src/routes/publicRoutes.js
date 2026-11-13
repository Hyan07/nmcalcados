import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import * as controller from "../controllers/publicController.js";

const router = Router();
const orderLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Aguarde alguns minutos antes de enviar outro pedido." },
});
router.get("/products", controller.products);
router.get("/products/:slug", controller.product);
router.get("/filters", controller.filters);
router.post("/orders", orderLimit, controller.order);
export default router;
