import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import * as controller from "../controllers/authController.js";
import { requireAuth, protectWrite } from "../middlewares/auth.js";

const router = Router();
router.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  }),
  controller.loginAction,
);
router.get("/me", requireAuth, controller.meAction);
router.post("/logout", requireAuth, protectWrite, controller.logoutAction);
export default router;
