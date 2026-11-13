import { z } from "zod";
import { digits, validCpf } from "../utils/format.js";

const id = z.coerce.number().int().positive();
const cash = z.coerce.number().finite().nonnegative().multipleOf(0.01);
const text = (max = 190) => z.string().trim().min(1).max(max);
const optionalText = (max = 190) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const cpf = z
  .string()
  .nullish()
  .transform((v) => digits(v))
  .refine(validCpf, "CPF inválido");
export const parse = (schema, value) => schema.parse(value);
export const schemas = {
  login: z.object({ email: z.email().max(190), password: z.string().min(1) }),
  product: z.object({
    name: text(),
    description: optionalText(5000),
    model: optionalText(120),
    brandId: id.nullish(),
    categoryId: id.nullish(),
    price: cash,
    cost: cash.default(0),
    active: z.boolean().default(true),
    featured: z.boolean().default(false),
  }),
  variant: z.object({
    productId: id,
    color: text(80),
    size: text(20),
    sku: optionalText(100),
    barcode: optionalText(100),
    cost: cash.nullish(),
    price: cash.nullish(),
    minimumStock: z.coerce.number().int().nonnegative().default(2),
    active: z.boolean().default(true),
  }),
  order: z.object({
    customer: z.object({
      name: text(120),
      phone: text(30).refine(
        (v) => digits(v).length >= 10 && digits(v).length <= 13,
        "Telefone inválido",
      ),
      email: z
        .email()
        .max(190)
        .nullish()
        .transform((v) => v || null),
      cpf,
    }),
    items: z
      .array(
        z.object({
          variantId: id,
          quantity: z.coerce.number().int().positive().max(50),
        }),
      )
      .min(1)
      .max(30),
  }),
  sale: z.object({
    customerId: id.nullish(),
    payment: z.enum(["DINHEIRO", "PIX", "DEBITO", "CREDITO", "OUTROS"]),
    discount: cash.default(0),
    items: z
      .array(
        z.object({
          variantId: id,
          quantity: z.coerce.number().int().positive().max(100),
          discount: cash.default(0),
        }),
      )
      .min(1)
      .max(100),
  }),
  status: z.object({
    status: z.enum(["EM_ATENDIMENTO", "CONFIRMADO", "CANCELADO"]),
  }),
  payment: z.object({
    payment: z.enum(["DINHEIRO", "PIX", "DEBITO", "CREDITO", "OUTROS"]),
  }),
  adjustment: z.object({
    variantId: id,
    quantity: z.coerce.number().int().positive(),
    direction: z.enum(["ENTRADA", "SAIDA"]),
    note: text(255),
  }),
  supplier: z.object({
    name: text(),
    tradeName: optionalText(),
    taxId: optionalText(20),
    phone: optionalText(30),
    whatsapp: optionalText(30),
    email: z
      .email()
      .nullish()
      .transform((v) => v || null),
    address: optionalText(1000),
    notes: optionalText(1000),
    active: z.boolean().default(true),
  }),
  customer: z.object({
    name: text(120),
    cpf,
    phone: optionalText(30),
    email: z
      .email()
      .nullish()
      .transform((v) => v || null),
    active: z.boolean().default(true),
  }),
  purchase: z.object({
    supplierId: id,
    notes: optionalText(1000),
    items: z
      .array(
        z.object({
          variantId: id,
          quantity: z.coerce.number().int().positive(),
          unitCost: cash,
        }),
      )
      .min(1),
  }),
  user: z.object({
    name: text(120),
    email: z.email().max(190),
    password: z.string().min(12).max(128),
    roleId: id,
    active: z.boolean().default(true),
    permissions: z.record(z.string(), z.boolean()).optional(),
  }),
  permission: z.object({ permission: text(80), allowed: z.boolean() }),
};
