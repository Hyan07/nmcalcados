import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import publicRoutes from "./routes/publicRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { notFoundRoute, errorHandler } from "./middlewares/errors.js";
import { getPublic } from "./repositories/catalogRepository.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);
export const app = express();
app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", env.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: env.prod ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: "300kb" }));
app.use(cookieParser());
app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use(express.static(root, { index: false, maxAge: env.prod ? "7d" : 0 }));
app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(root, "admin.html")));
const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
app.get("/produto/:slug", async (req, res, next) => {
  try {
    const product = await getPublic(req.params.slug);
    if (!product) return res.status(404).sendFile(path.join(root, "404.html"));
    const html = (await import("node:fs/promises")).readFile(
      path.join(root, "product.html"),
      "utf8",
    );
    const description =
      product.description?.slice(0, 155) ||
      `${product.name} na N&M Calçados. Veja cores, numerações e disponibilidade.`;
    const title = `${product.name} | N&M Calçados`;
    const canonical = `${env.origin}/produto/${encodeURIComponent(product.slug)}`;
    const rendered = (await html)
      .replaceAll("%%TITLE%%", escapeHtml(title))
      .replaceAll("%%DESCRIPTION%%", escapeHtml(description))
      .replaceAll("%%URL%%", escapeHtml(canonical))
      .replaceAll(
        "%%IMAGE%%",
        escapeHtml(product.image || `${env.origin}/images/atelier-hero.webp`),
      );
    res.send(rendered);
  } catch (error) {
    next(error);
  }
});
app.use(notFoundRoute);
app.use(errorHandler);
