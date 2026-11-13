import { AppError } from "../utils/errors.js";
import { sessionFromToken, csrfMatches } from "../services/authService.js";
import { env } from "../config/env.js";

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === env.origin) return true;
  if (!env.prod) return true;
  return false;
}

export async function requireAuth(req, res, next) {
  const session = await sessionFromToken(req.cookies?.nm_session);
  if (!session)
    return next(
      new AppError("Acesse sua conta para continuar.", 401, "AUTH_REQUIRED"),
    );
  req.user = session;
  next();
}
export function permit(code) {
  return (req, res, next) =>
    req.user?.permissions.includes(code)
      ? next()
      : next(new AppError("Sem permissão para esta ação.", 403, "FORBIDDEN"));
}
export function protectWrite(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!isAllowedOrigin(origin))
    return next(new AppError("Origem não autorizada.", 403, "INVALID_ORIGIN"));
  if (!csrfMatches(req.user, req.get("x-csrf-token")))
    return next(
      new AppError(
        "Sessão de segurança expirada. Atualize a página.",
        403,
        "INVALID_CSRF",
      ),
    );
  next();
}
