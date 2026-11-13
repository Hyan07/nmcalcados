import { AppError } from "../utils/errors.js";

export function projectStock(
  physical,
  reserved,
  physicalDelta = 0,
  reservedDelta = 0,
) {
  const nextPhysical = physical + physicalDelta,
    nextReserved = reserved + reservedDelta;
  if (
    !Number.isInteger(nextPhysical) ||
    !Number.isInteger(nextReserved) ||
    nextPhysical < 0 ||
    nextReserved < 0 ||
    nextReserved > nextPhysical
  )
    throw new AppError(
      "Estoque insuficiente para esta operação.",
      409,
      "INSUFFICIENT_STOCK",
    );
  return {
    physical: nextPhysical,
    reserved: nextReserved,
    available: nextPhysical - nextReserved,
  };
}
export function requireAvailable(variant, quantity) {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    variant.physical_stock - variant.reserved_stock < quantity
  )
    throw new AppError(
      "Estoque disponível insuficiente.",
      409,
      "INSUFFICIENT_STOCK",
    );
}
