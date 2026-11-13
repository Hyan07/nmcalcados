import { schemas, parse } from "../validators/schemas.js";
import { login, logout, cookieOptions } from "../services/authService.js";

export async function loginAction(req, res) {
  const { email, password } = parse(schemas.login, req.body);
  const result = await login(email, password, req.ip);
  res.cookie("nm_session", result.token, cookieOptions);
  res.cookie("nm_csrf", result.csrf, { ...cookieOptions, httpOnly: false });
  res.json({ user: result.user, csrf: result.csrf });
}
export async function logoutAction(req, res) {
  await logout(req.cookies?.nm_session);
  res.clearCookie("nm_session", { ...cookieOptions, maxAge: undefined });
  res.clearCookie("nm_csrf", {
    ...cookieOptions,
    httpOnly: false,
    maxAge: undefined,
  });
  res.json({ ok: true });
}
export function meAction(req, res) {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      permissions: req.user.permissions,
    },
  });
}
