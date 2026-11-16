import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function posHarness(stock = 2, reserved = 0) {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const functions = source.slice(
    source.indexOf("function renderPosVariants()"),
    source.indexOf("async function finishSale()"),
  );
  const nodes = new Map(),
    messages = [];
  const node = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        innerHTML: "",
        value: "0",
        focus() {},
        querySelectorAll(selector) {
          const attr = selector.slice(1, -1);
          const key = attr
            .replace(/^data-/, "")
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          return [
            ...this.innerHTML.matchAll(new RegExp(`${attr}="(\\d+)"`, "g")),
          ].map((match) => ({ dataset: { [key]: match[1] }, value: "1" }));
        },
      });
    return nodes.get(selector);
  };
  // Keep the rendered inputs so tests exercise the actual quantity/remove handlers.
  const inputs = new Map();
  const lines = node("#pos-lines");
  const query = lines.querySelectorAll;
  lines.querySelectorAll = function (selector) {
    const result = query.call(this, selector);
    inputs.set(selector, result);
    return result;
  };
  const context = vm.createContext({
    $: node,
    esc: String,
    fmt: String,
    document: { querySelectorAll: () => [] },
    toast: (...args) => messages.push(args),
  });
  vm.runInContext(
    `let posCart = [], posProduct = { name: "Batom", price: 20, variants: [{ id: 1, color: "Rosa", size: "Único", active: 1, physical_stock: ${stock}, reserved_stock: ${reserved} }] }; ${functions}`,
    context,
  );
  return {
    node,
    inputs,
    messages,
    run: (code) => vm.runInContext(code, context),
    add: (available = stock - reserved) =>
      vm.runInContext(
        `addPos({ variantId: 1, productName: "Batom", color: "Rosa", size: "Único", price: 20, available: ${available} })`,
        context,
      ),
  };
}

test("última unidade na venda sinaliza esgotado na busca e resumo e bloqueia nova adição", async () => {
  const h = await posHarness(3, 1);
  h.run("renderPosVariants()");
  assert.match(h.node("#pos-results").innerHTML, /2 disponível/);
  assert.equal(h.add(), true);
  assert.match(h.node("#pos-results").innerHTML, /1 disponível/);
  assert.equal(h.add(), true);
  assert.match(h.node("#pos-results").innerHTML, /disabled>Esgotado/);
  assert.match(h.node("#pos-lines").innerHTML, /Esgotado para adicionar/);
  assert.match(h.messages.at(-1)[0], /última unidade/);
  assert.equal(h.add(), false);
  assert.equal(h.messages.at(-1)[1], "error");
  assert.equal(h.run("posCart[0].quantity"), 2);
});

test("diminuir ou remover item restaura disponibilidade sem alterar o saldo físico", async () => {
  const h = await posHarness();
  h.add();
  h.add();
  const input = h.inputs.get("[data-pos-qty]")[0];
  input.value = "1";
  input.onchange();
  assert.match(h.node("#pos-results").innerHTML, /1 disponível/);
  assert.doesNotMatch(h.node("#pos-results").innerHTML, /disabled/);
  h.inputs.get("[data-pos-remove]")[0].onclick();
  assert.match(h.node("#pos-results").innerHTML, /2 disponível/);
  assert.equal(h.run("posProduct.variants[0].physical_stock"), 2);
});

test("produto já zerado não pode entrar na venda e leitor atualiza saldo observado", async () => {
  const h = await posHarness(0);
  h.run("renderPosVariants()");
  assert.match(h.node("#pos-results").innerHTML, /disabled>Esgotado/);
  assert.equal(h.add(), false);
  assert.equal(h.run("posCart.length"), 0);
  assert.equal(h.add(1), true);
  assert.equal(h.run("posCart[0].available"), 1);
  assert.match(h.node("#pos-results").innerHTML, /disabled>Esgotado/);
  assert.equal(h.add(0), false);
  assert.equal(h.run("posCart[0].available"), 0);
});
