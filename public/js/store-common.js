export const $ = (selector, root = document) => root.querySelector(selector);
export const fmt = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value) || 0,
  );
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || "Não foi possível concluir. Tente novamente.",
    );
  return data;
}
export function toast(message, type = "success") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast visible ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4200);
}
const cartKey = "nm_cart_v1";
let cart = [];
try {
  cart = JSON.parse(localStorage.getItem(cartKey) || "[]");
  if (!Array.isArray(cart)) cart = [];
} catch {
  cart = [];
}
const save = () => {
  localStorage.setItem(cartKey, JSON.stringify(cart));
  updateCount();
};
const updateCount = () => {
  const count = $("#cart-count");
  if (count) count.textContent = cart.reduce((n, x) => n + x.quantity, 0);
};
let hydrated = [];
export async function refreshCart() {
  const slugs = [...new Set(cart.map((x) => x.slug))];
  const products = await Promise.all(
    slugs.map((slug) =>
      api(`/api/public/products/${encodeURIComponent(slug)}`).catch(() => null),
    ),
  );
  const map = new Map(products.filter(Boolean).map((x) => [x.slug, x]));
  hydrated = cart
    .map((line) => {
      const product = map.get(line.slug),
        variant = product?.variants.find((v) => v.id === line.variantId);
      return { ...line, product, variant };
    })
    .filter((x) => x.product && x.variant);
  cart = hydrated.map(({ slug, variantId, quantity }) => ({
    slug,
    variantId,
    quantity,
  }));
  save();
  renderCart();
}
function renderCart() {
  const container = $("#cart-items");
  if (!container) return;
  if (!hydrated.length)
    container.innerHTML =
      '<div class="cart-empty"><span>✳</span><h3>Sua sacola está esperando.</h3><p>Escolha um par para começar.</p><a href="/#colecao">Explorar coleção ↗</a></div>';
  else
    container.innerHTML = hydrated
      .map(
        ({ slug, variantId, quantity, product, variant }) =>
          `<div class="cart-line"><div class="cart-line-image">${product.image ? `<img src="${esc(product.image)}" alt="${esc(product.name)}">` : "<span>N&M</span>"}</div><div class="cart-line-content"><small>${esc(product.brand || "N&M CALÇADOS")}</small><h3>${esc(product.name)}</h3><p>${esc(variant.color)} · ${esc(variant.size)}</p><strong>${fmt(variant.price)}</strong><div class="cart-line-actions"><button data-cart-change="-1" data-id="${variantId}" aria-label="Diminuir quantidade">−</button><span>${quantity}</span><button data-cart-change="1" data-id="${variantId}" aria-label="Aumentar quantidade">+</button><button class="remove" data-cart-remove="${variantId}">Remover</button></div>${quantity > variant.available ? '<small class="stock-error">Quantidade maior que o estoque disponível</small>' : ""}</div></div>`,
      )
      .join("");
  const total = hydrated.reduce(
    (n, x) => n + Number(x.variant.price) * x.quantity,
    0,
  );
  $("#cart-total").textContent = fmt(total);
  $("#checkout-open").disabled =
    !hydrated.length || hydrated.some((x) => x.quantity > x.variant.available);
}
export function addCart(product, variant, quantity = 1) {
  if (!variant || variant.available < 1)
    return toast("Esta numeração está esgotada.", "error");
  const existing = cart.find((x) => x.variantId === variant.id);
  if ((existing?.quantity || 0) + quantity > variant.available)
    return toast("Quantidade acima do estoque disponível.", "error");
  if (existing) existing.quantity += quantity;
  else cart.push({ slug: product.slug, variantId: variant.id, quantity });
  save();
  openCart();
  toast("Adicionado à sua sacola.");
}
export async function openCart() {
  $("#cart-backdrop").hidden = false;
  $("#cart-drawer").classList.add("open");
  $("#cart-drawer").setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
  try {
    await refreshCart();
  } catch (error) {
    toast(error.message, "error");
  }
}
export function closeCart() {
  $("#cart-backdrop").hidden = true;
  $("#cart-drawer").classList.remove("open");
  $("#cart-drawer").setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}
export function initCart() {
  updateCount();
  $("#cart-toggle")?.addEventListener("click", openCart);
  $("#cart-close")?.addEventListener("click", closeCart);
  $("#cart-backdrop")?.addEventListener("click", closeCart);
  $("#cart-items")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-cart-remove]");
    const change = event.target.closest("[data-cart-change]");
    if (remove) {
      cart = cart.filter(
        (x) => x.variantId !== Number(remove.dataset.cartRemove),
      );
      save();
      refreshCart();
    }
    if (change) {
      const item = cart.find((x) => x.variantId === Number(change.dataset.id));
      if (!item) return;
      const next = item.quantity + Number(change.dataset.cartChange);
      const current = hydrated.find((x) => x.variantId === item.variantId);
      if (next > current.variant.available)
        return toast("Quantidade acima do estoque disponível.", "error");
      if (next < 1) cart = cart.filter((x) => x !== item);
      else item.quantity = next;
      save();
      refreshCart();
    }
  });
  $("#checkout-open")?.addEventListener("click", () => {
    $("#checkout-dialog").showModal();
    closeCart();
  });
  $(".dialog-close")?.addEventListener("click", () =>
    $("#checkout-dialog").close(),
  );
  $("#checkout-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("[type=submit]");
    button.disabled = true;
    button.textContent = "Enviando reserva...";
    try {
      await refreshCart();
      if (
        !hydrated.length ||
        hydrated.some((x) => x.quantity > x.variant.available)
      )
        throw new Error("Revise sua sacola antes de reservar.");
      const fields = Object.fromEntries(new FormData(event.target));
      const result = await api("/api/public/orders", {
        method: "POST",
        body: JSON.stringify({
          customer: {
            name: fields.name,
            phone: fields.phone,
            email: fields.email || null,
            cpf: fields.cpf || null,
          },
          items: cart.map((x) => ({
            variantId: x.variantId,
            quantity: x.quantity,
          })),
        }),
      });
      cart = [];
      hydrated = [];
      save();
      renderCart();
      event.target.reset();
      $("#checkout-dialog").close();
      window.dispatchEvent(new CustomEvent("nm:order-created"));
      toast(`Reserva #${result.id} enviada! Nossa equipe entrará em contato.`);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
      button.innerHTML = "Enviar reserva <span>↗</span>";
    }
  });
}
