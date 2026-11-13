export class AppError extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound = (name = "Registro") =>
  new AppError(`${name} não encontrado.`, 404, "NOT_FOUND");
export const conflict = (message) => new AppError(message, 409, "CONFLICT");
