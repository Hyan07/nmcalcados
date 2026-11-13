import test from "node:test";
import assert from "node:assert/strict";
import { projectStock, requireAvailable } from "../src/services/stockPolicy.js";
import { canTransition } from "../src/services/orderService.js";
import { cents, decimal } from "../src/utils/pricing.js";
import { validCpf } from "../src/utils/format.js";
import { permit } from "../src/middlewares/auth.js";
import { thumbnailUrl } from "../src/utils/images.js";

test("estoque disponível considera a reserva e nunca fica negativo", () => {
  assert.deepEqual(projectStock(3, 2, 0, 0), {
    physical: 3,
    reserved: 2,
    available: 1,
  });
  assert.deepEqual(projectStock(3, 2, -1, -1), {
    physical: 2,
    reserved: 1,
    available: 1,
  });
  assert.throws(() => projectStock(3, 2, -2, 0), {
    code: "INSUFFICIENT_STOCK",
  });
  assert.throws(() => projectStock(3, 2, 0, 2), { code: "INSUFFICIENT_STOCK" });
  assert.throws(
    () => requireAvailable({ physical_stock: 3, reserved_stock: 2 }, 2),
    { code: "INSUFFICIENT_STOCK" },
  );
});
test("pedidos terminais não retornam ao fluxo de venda", () => {
  assert.equal(canTransition("PENDENTE", "EM_ATENDIMENTO"), true);
  assert.equal(canTransition("EM_ATENDIMENTO", "CONFIRMADO"), true);
  assert.equal(canTransition("CONFIRMADO", "CONVERTIDO_EM_VENDA"), true);
  assert.equal(canTransition("CANCELADO", "CONVERTIDO_EM_VENDA"), false);
  assert.equal(canTransition("EXPIRADO", "CONFIRMADO"), false);
});
test("dinheiro usa centavos inteiros e CPF é validado", () => {
  assert.equal(cents("199.90"), 19990);
  assert.equal(decimal(19990), "199.90");
  assert.equal(validCpf("529.982.247-25"), true);
  assert.equal(validCpf("111.111.111-11"), false);
});
test("permissão granular bloqueia ação sem concessão", () => {
  let result;
  permit("sales.cancel")(
    { user: { permissions: ["sales.create"] } },
    null,
    (error) => (result = error),
  );
  assert.equal(result.status, 403);
  permit("sales.create")(
    { user: { permissions: ["sales.create"] } },
    null,
    (error) => (result = error),
  );
  assert.equal(result, undefined);
});

test("catálogo entrega thumbnail Cloudinary", () => {
  assert.equal(
    thumbnailUrl("https://res.cloudinary.com/loja/image/upload/v1/par.webp"),
    "https://res.cloudinary.com/loja/image/upload/c_fill,w_640,h_720,q_auto,f_auto/v1/par.webp",
  );
});
