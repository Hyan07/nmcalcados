import { $, api, fmt, esc, toast, initCart } from "./store-common.js";
initCart();
let facets = { categories: [], brands: [], sizes: [], colors: [] };
let page = 1;
const filters = {
  q: "",
  category: "",
  brand: "",
  size: "",
  color: "",
  min: "",
  max: "",
  available: false,
};
function syncFilters() {
  for (const key of ["category", "brand", "size", "color", "min", "max"])
    filters[key] = $(`#filter-${key}`).value;
  filters.available = $("#filter-available").checked;
  page = 1;
  loadProducts();
}
function option(el, items, slug = false) {
  el.innerHTML =
    '<option value="">Todas</option>' +
    items
      .map(
        (x) =>
          `<option value="${esc(slug ? x.slug : x)}">${esc(slug ? x.name : x)}</option>`,
      )
      .join("");
}
async function loadFacets() {
  facets = await api("/api/public/filters");
  option($("#filter-category"), facets.categories, true);
  option($("#filter-brand"), facets.brands, true);
  option($("#filter-size"), facets.sizes);
  option($("#filter-color"), facets.colors);
  $("#category-links").innerHTML =
    '<button class="active" data-category="">Todos os estilos <span>↗</span></button>' +
    facets.categories
      .map(
        (x) =>
          `<button data-category="${esc(x.slug)}">${esc(x.name)} <span>↗</span></button>`,
      )
      .join("");
}
function productCard(item) {
  return `<a class="product-card" href="/produto/${encodeURIComponent(item.slug)}"><div class="card-image">${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">` : '<div class="card-placeholder"><span>N&M</span><small>CALÇADOS</small></div>'}${item.featured ? '<span class="card-label">DESTAQUE</span>' : ""}<span class="card-arrow">↗</span></div><div class="card-meta"><span>${esc(item.brand || "N&M")}</span><span>${item.available > 0 ? "DISPONÍVEL" : "ESGOTADO"}</span></div><div class="card-title"><h3>${esc(item.name)}</h3><strong>${fmt(item.price)}</strong></div></a>`;
}
async function loadProducts() {
  const grid = $("#product-grid");
  grid.innerHTML =
    '<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div>';
  const params = new URLSearchParams({ page, limit: 9 });
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, String(value));
  try {
    const result = await api(`/api/public/products?${params}`);
    grid.innerHTML = result.items.length
      ? result.items.map(productCard).join("")
      : '<div class="no-results"><span>✳</span><h3>Nenhum par por aqui.</h3><p>Tente mudar os filtros para descobrir outros modelos.</p></div>';
    const count = `${result.total} ${result.total === 1 ? "produto encontrado" : "produtos encontrados"}`;
    $("#result-count").textContent = count;
    $("#mobile-result-count").textContent = count;
    const pages = Math.ceil(result.total / result.limit);
    $("#pagination").innerHTML =
      pages > 1
        ? `<button data-page="${Math.max(1, page - 1)}" ${page === 1 ? "disabled" : ""}>← Anterior</button><span>${page} / ${pages}</span><button data-page="${Math.min(pages, page + 1)}" ${page === pages ? "disabled" : ""}>Próxima →</button>`
        : "";
  } catch (error) {
    grid.innerHTML =
      '<div class="no-results"><h3>Não foi possível carregar a coleção.</h3><p>Atualize a página em instantes.</p></div>';
    toast(error.message, "error");
  }
}
$("#category-links").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  $("#filter-category").value = button.dataset.category;
  document
    .querySelectorAll("#category-links button")
    .forEach((x) => x.classList.toggle("active", x === button));
  syncFilters();
  $("#colecao").scrollIntoView({ behavior: "smooth" });
});
document
  .querySelectorAll(".filters select,.filters input")
  .forEach((el) =>
    el.addEventListener(
      el.type === "number" ? "change" : "change",
      syncFilters,
    ),
  );
$("#clear-filters").addEventListener("click", () => {
  document
    .querySelectorAll(".filters select,.filters input")
    .forEach((el) =>
      el.type === "checkbox" ? (el.checked = false) : (el.value = ""),
    );
  filters.q = "";
  document
    .querySelectorAll("#category-links button")
    .forEach((x, i) => x.classList.toggle("active", i === 0));
  syncFilters();
});
$("#pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) return;
  page = Number(button.dataset.page);
  loadProducts();
  $("#colecao").scrollIntoView({ behavior: "smooth" });
});
$("#mobile-filters").addEventListener("click", () =>
  document.querySelector(".filters").classList.toggle("show"),
);
$("#search-toggle").addEventListener("click", () => {
  const panel = $("#search-panel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $("#global-search").focus();
});
$("#search-submit").addEventListener("click", () => {
  filters.q = $("#global-search").value.trim();
  $("#search-panel").hidden = true;
  page = 1;
  loadProducts();
  $("#colecao").scrollIntoView({ behavior: "smooth" });
});
$("#global-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("#search-submit").click();
});
try {
  await loadFacets();
  await loadProducts();
} catch (error) {
  toast(error.message, "error");
}
window.addEventListener("nm:order-created", () => loadProducts());
