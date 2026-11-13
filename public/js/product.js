import { $, api, fmt, esc, toast, initCart, addCart } from "./store-common.js";
initCart();
const slug = decodeURIComponent(location.pathname.split("/").pop());
let product = null,
  color = null,
  size = null;
function selectedVariant() {
  return product?.variants.find((x) => x.color === color && x.size === size);
}
function renderSizes() {
  const variants = product.variants.filter((x) => x.color === color);
  $("#size-options").innerHTML = variants
    .map(
      (x) =>
        `<button class="${size === x.size ? "selected" : ""}" data-size="${esc(x.size)}" ${x.available < 1 ? "disabled" : ""}>${esc(x.size)}${x.available < 1 ? "<small>esgotado</small>" : ""}</button>`,
    )
    .join("");
  const selected = selectedVariant();
  $("#stock-hint").textContent = selected
    ? selected.available > 0
      ? `${selected.available} ${selected.available === 1 ? "disponível" : "disponíveis"}`
      : "Esgotado"
    : variants.every((x) => x.available < 1)
      ? "Esta cor está esgotada"
      : "Selecione seu tamanho";
  $("#product-quantity").innerHTML = selected
    ? Array.from(
        { length: Math.min(10, selected.available) },
        (_, i) => `<option value="${i + 1}">${i + 1}</option>`,
      ).join("")
    : "";
  $("#add-to-cart").disabled = !selected || selected.available < 1;
}
function render() {
  $("#breadcrumb-product").textContent = product.name;
  $("#product-brand").textContent =
    `${product.brand || "N&M"} / ${product.category || "CALÇADOS"}`;
  $("#product-name").textContent = product.name;
  $("#product-price").textContent = fmt(product.price);
  $("#product-description").textContent =
    product.description ||
    "Escolhido para acompanhar você em todos os seus caminhos.";
  const images = product.images.length ? product.images : [{ url: null }];
  $("#main-photo").innerHTML = images[0].url
    ? `<img src="${esc(images[0].url)}" alt="${esc(product.name)}">`
    : '<div class="card-placeholder"><span>N&M</span><small>CALÇADOS</small></div>';
  $("#photo-thumbs").innerHTML = images
    .filter((x) => x.url)
    .map(
      (x, i) =>
        `<button class="${i === 0 ? "selected" : ""}" data-image="${i}" aria-label="Foto ${i + 1} de ${esc(product.name)}"><img src="${esc(x.url)}" alt="${esc(product.name)} — foto ${i + 1}" loading="lazy"></button>`,
    )
    .join("");
  const colors = [...new Set(product.variants.map((x) => x.color))];
  color = colors[0] || null;
  $("#color-options").innerHTML = colors
    .map(
      (x) =>
        `<button class="${color === x ? "selected" : ""}" data-color="${esc(x)}">${esc(x)}</button>`,
    )
    .join("");
  renderSizes();
  $("#photo-thumbs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-image]");
    if (!button) return;
    const image = images[Number(button.dataset.image)];
    $("#main-photo").innerHTML =
      `<img src="${esc(image.url)}" alt="${esc(product.name)}">`;
    document
      .querySelectorAll("#photo-thumbs button")
      .forEach((x) => x.classList.toggle("selected", x === button));
  });
}
$("#color-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  color = button.dataset.color;
  size = null;
  document
    .querySelectorAll("#color-options button")
    .forEach((x) => x.classList.toggle("selected", x === button));
  renderSizes();
});
$("#size-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-size]");
  if (!button) return;
  size = button.dataset.size;
  renderSizes();
});
$("#add-to-cart").addEventListener("click", () => {
  const variant = selectedVariant();
  if (!variant) return toast("Escolha uma numeração.", "error");
  addCart(product, variant, Number($("#product-quantity").value || 1));
});
try {
  product = await api(`/api/public/products/${encodeURIComponent(slug)}`);
  render();
} catch (error) {
  $("#product-name").textContent = "Produto indisponível";
  toast(error.message, "error");
}
window.addEventListener("nm:order-created", async () => {
  try {
    product = await api(`/api/public/products/${encodeURIComponent(slug)}`);
    render();
  } catch {}
});
