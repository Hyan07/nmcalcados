import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

export function notFoundRoute(req, res) {
  res.status(404).json({ error: "Rota não encontrada.", code: "NOT_FOUND" });
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError)
    return res.status(422).json({
      error: "Verifique os dados informados.",
      code: "VALIDATION_ERROR",
      details: error.issues.map((x) => ({
        field: x.path.join("."),
        message: x.message,
      })),
    });
  if (error instanceof AppError)
    return res
      .status(error.status)
      .json({ error: error.message, code: error.code });
  if (error.code === "ER_DUP_ENTRY")
    return res.status(409).json({
      error: "Já existe um registro com esses dados.",
      code: "DUPLICATE",
    });
  if (error.code === "ER_NO_REFERENCED_ROW_2")
    return res.status(422).json({
      error: "Registro relacionado não encontrado.",
      code: "INVALID_REFERENCE",
    });
  if (error.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({
      error: "Imagem acima do limite de 5 MB.",
      code: "FILE_TOO_LARGE",
    });
  console.error(
    "Erro interno:",
    error.code || error.name,
    env.prod ? "" : error.message,
  );
  res
    .status(500)
    .json({ error: "Erro interno. Tente novamente.", code: "INTERNAL_ERROR" });
}
