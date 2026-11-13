import {
  listPublic,
  getPublic,
  facets,
} from "../repositories/catalogRepository.js";
import { createOrder } from "../services/orderService.js";
import { schemas, parse } from "../validators/schemas.js";
import { notFound } from "../utils/errors.js";

export async function products(req, res) {
  res.json(await listPublic(req.query));
}
export async function product(req, res) {
  const item = await getPublic(req.params.slug);
  if (!item) throw notFound("Produto");
  res.json(item);
}
export async function filters(req, res) {
  res.json(await facets());
}
export async function order(req, res) {
  res
    .status(201)
    .json(await createOrder(parse(schemas.order, req.body), req.ip));
}
