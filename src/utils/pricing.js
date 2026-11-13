import { AppError } from "./errors.js";
export function cents(value) {
  const string = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(string))
    throw new AppError("Valor monetário inválido.");
  const [whole, fraction = ""] = string.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function decimal(valueCents) {
  return (valueCents / 100).toFixed(2);
}
