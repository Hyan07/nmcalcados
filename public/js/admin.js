const $ = (s, r = document) => r.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v) || 0,
  );
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
const badge = (v) =>
  `<span class="badge ${esc(v)}">${esc(String(v).replaceAll("_", " "))}</span>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const row = (label, value) =>
  `<div class="detail-row"><span>${label}</span><strong>${esc(value)}</strong></div>`;
let currentUser = null,
  currentView = "dashboard",
  productEditorId = null,
  filters = {},
  posCart = [];
function csrf() {
  return decodeURIComponent(
    document.cookie
      .split("; ")
      .find((x) => x.startsWith("nm_csrf="))
      ?.split("=")
      .slice(1)
      .join("=") || "",
  );
}
async function api(url, method = "GET", body = null) {
  const form = body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "x-csrf-token": csrf() }),
    },
    body: body == null ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data.error || "Falha ao processar a solicitação.");
  return data;
}
function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast visible ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4000);
}
function dialog(html) {
  $("#dialog-content").innerHTML = html;
  $("#action-dialog").showModal();
}
function closeDialog() {
  $("#action-dialog").close();
}
$("#dialog-close").onclick = closeDialog;
function confirmAction(message) {
  return window.confirm(message);
}
function can(permission) {
  return currentUser?.permissions.includes(permission);
}
const viewInfo = {
  dashboard: [
    "SEU NEGÓCIO EM MOVIMENTO",
    "Visão geral",
    "Acompanhe o que acontece na sua loja hoje.",
  ],
  pos: [
    "ATENDIMENTO NO BALCÃO",
    "Nova venda",
    "Um fluxo rápido para quem está aqui com você.",
  ],
  orders: [
    "PEDIDOS DO CATÁLOGO",
    "Pedidos",
    "Acompanhe e confirme cada reserva.",
  ],
  sales: ["HISTÓRICO DE VENDAS", "Vendas", "Todas as vendas em um só lugar."],
  products: [
    "SUA CURADORIA",
    "Produtos",
    "Organize modelos, fotos e numerações.",
  ],
  stock: [
    "CADA PAR CONTA",
    "Estoque",
    "Visão por cor e numeração, sempre atualizada.",
  ],
  purchases: [
    "ENTRADA DE MERCADORIA",
    "Compras",
    "Registre e receba suas compras.",
  ],
  suppliers: [
    "BONS PARCEIROS",
    "Fornecedores",
    "Informações dos parceiros da loja.",
  ],
  customers: [
    "GENTE QUE CAMINHA COM A GENTE",
    "Clientes",
    "Pessoas que compram e reservam na sua loja.",
  ],
  users: ["EQUIPE N&M", "Usuários", "Acessos e permissões do time."],
  reports: [
    "OLHAR PARA FRENTE",
    "Relatórios",
    "Números essenciais para decidir com clareza.",
  ],
  settings: [
    "PREFERÊNCIAS",
    "Configurações",
    "Auditoria e informações do sistema.",
  ],
  productEditor: [
    "SUA CURADORIA",
    "Editar produto",
    "Detalhes, variações e imagens.",
  ],
};
function setView(view) {
  currentView = view;
  const info = viewInfo[view] || viewInfo.dashboard;
  $("#view-eyebrow").textContent = info[0];
  $("#view-title").textContent = info[1];
  $("#view-subtitle").textContent = info[2];
  $("#header-crumb-title").textContent = info[1];
  $("#view-actions").innerHTML = "";
  $("#view-content").innerHTML =
    '<div class="page-loader">Carregando dados...</div>';
  document
    .querySelectorAll("#side-nav [data-view], #mobile-nav [data-view]")
    .forEach((button) => {
      const active =
        button.dataset.view === view ||
        (view === "productEditor" && button.dataset.view === "products");
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  document.querySelector(".admin-main").dataset.view = view;
  closeSidebar(false);
  $("#main-content").focus({ preventScroll: true });
  history.replaceState({}, "", `/admin#${view}`);
  renderView().catch((error) => {
    toast(error.message, "error");
    $("#view-content").innerHTML =
      `<div class="empty-state"><h3>Não foi possível carregar esta seção.</h3><p>${esc(error.message)}</p></div>`;
  });
}
async function renderView() {
  switch (currentView) {
    case "dashboard":
      return dashboard();
    case "orders":
      return orders();
    case "products":
      return products();
    case "productEditor":
      return productEditor();
    case "stock":
      return stock();
    case "pos":
      return pos();
    case "sales":
      return sales();
    case "purchases":
      return purchases();
    case "suppliers":
      return entities("suppliers");
    case "customers":
      return entities("customers");
    case "users":
      return users();
    case "reports":
      return reports();
    case "settings":
      return settings();
  }
}
const table = (heads, items, render) => {
  const rows = items
    .map((item) => {
      const template = document.createElement("template");
      template.innerHTML = `<table><tbody>${render(item)}</tbody></table>`;
      const tr = template.content.querySelector("tr");
      tr.setAttribute("role", "row");
      [...tr.children].forEach((cell, index) => {
        cell.dataset.label = heads[index] || "Ações";
        cell.setAttribute("role", "cell");
        if (!heads[index]) cell.classList.add("cell-actions");
      });
      return tr.outerHTML;
    })
    .join("");
  return `<div class="table-wrap"><table class="data-table" role="table"><caption class="sr-only">${esc(viewInfo[currentView]?.[1] || "Registros")}</caption><thead role="rowgroup"><tr role="row">${heads.map((h) => `<th scope="col" role="columnheader">${h || '<span class="sr-only">Ações</span>'}</th>`).join("")}</tr></thead><tbody role="rowgroup">${items.length ? rows : `<tr class="table-empty" role="row"><td role="cell" colspan="${heads.length}">Nenhum registro encontrado.</td></tr>`}</tbody></table></div>`;
};
const pagination = (result, callback) => {
  const pages = Math.ceil(result.total / result.limit);
  if (pages <= 1) return "";
  return `<div class="pagination"><button data-page="${Math.max(1, result.page - 1)}" ${result.page === 1 ? "disabled" : ""}>← Anterior</button><span>${result.page} de ${pages}</span><button data-page="${Math.min(pages, result.page + 1)}" ${result.page === pages ? "disabled" : ""}>Próxima →</button></div>`;
};
function setupPagination(callback) {
  $("#view-content")
    .querySelectorAll("[data-page]")
    .forEach((btn) => (btn.onclick = () => callback(Number(btn.dataset.page))));
}
async function dashboard() {
  const d = await api("/api/admin/dashboard");
  $("#order-badge").textContent = d.pendingOrders || "";
  $("#view-actions").innerHTML =
    '<button class="primary-button" id="dash-pos">+ Nova venda <span>↗</span></button>';
  $("#dash-pos").onclick = () => setView("pos");
  $("#view-content").innerHTML =
    `<div class="stat-grid"><div class="stat-card"><span>VENDAS HOJE</span><div class="stat-icon">↗</div><strong>${fmt(d.salesToday.total)}</strong><small>${d.salesToday.count} venda(s) concluída(s)</small></div><div class="stat-card"><span>PEDIDOS EM ABERTO</span><div class="stat-icon">◧</div><strong>${d.pendingOrders}</strong><small>Reservas para acompanhar</small></div><div class="stat-card"><span>ESTOQUE BAIXO</span><div class="stat-icon">▥</div><strong>${d.lowStock}</strong><small>Variações no mínimo ou abaixo</small></div><div class="stat-card"><span>PRODUTOS MAIS VENDIDOS</span><div class="stat-icon">◇</div><strong>${d.topProducts.length}</strong><small>Modelos em destaque</small></div></div><div class="quick-actions"><button data-go="orders">Ver pedidos ↗</button><button data-go="stock">Conferir estoque ↗</button><button data-go="products">Gerenciar produtos ↗</button>${can("reports.view") ? '<button data-go="reports">Ver relatórios ↗</button>' : ""}</div><div class="dashboard-grid"><div><div class="section-title"><h2>Pedidos recentes</h2><a href="#orders" data-go="orders">Ver todos ↗</a></div><div class="panel">${table(["PEDIDO", "CLIENTE", "DATA", "TOTAL", "STATUS"], d.recentOrders, (x) => `<tr><td><strong>#${x.id}</strong></td><td>${esc(x.customer_name)}</td><td>${date(x.created_at)}</td><td>${fmt(x.total)}</td><td>${badge(x.status)}</td></tr>`)}</div></div><div><div class="section-title"><h2>Mais vendidos</h2></div><div class="panel"><ul class="mini-list">${d.topProducts.length ? d.topProducts.map((x, i) => `<li><span>${String(i + 1).padStart(2, "0")} &nbsp; ${esc(x.product_name)}</span><small>${x.quantity} un.</small></li>`).join("") : "<li><span>As vendas aparecerão aqui.</span></li>"}</ul></div></div></div>`;
  bindGo();
}
function bindGo() {
  document.querySelectorAll("[data-go]").forEach(
    (x) =>
      (x.onclick = (e) => {
        e.preventDefault();
        setView(x.dataset.go);
      }),
  );
}
async function orders(page = 1) {
  const status = filters.orderStatus || "",
    q = new URLSearchParams({ page, status });
  const d = await api(`/api/admin/orders?${q}`);
  $("#view-actions").innerHTML = "";
  $("#view-content").innerHTML =
    `<div class="toolbar"><select id="order-status-filter"><option value="">Todos os status</option>${["PENDENTE", "EM_ATENDIMENTO", "CONFIRMADO", "CONVERTIDO_EM_VENDA", "CANCELADO", "EXPIRADO"].map((x) => `<option value="${x}" ${status === x ? "selected" : ""}>${x.replaceAll("_", " ")}</option>`).join("")}</select></div><div class="panel">${table(["PEDIDO", "CLIENTE", "DATA", "TOTAL", "STATUS", ""], d.items, (x) => `<tr><td><strong>#${x.id}</strong></td><td>${esc(x.customer_name)}<br><small>${esc(x.phone || "")}</small></td><td>${date(x.created_at)}</td><td>${fmt(x.total)}</td><td>${badge(x.status)}</td><td><button data-order="${x.id}">Abrir ↗</button></td></tr>`)}</div>${pagination(d)}`;
  $("#order-status-filter").onchange = (e) => {
    filters.orderStatus = e.target.value;
    orders();
  };
  document
    .querySelectorAll("[data-order]")
    .forEach((x) => (x.onclick = () => openOrder(Number(x.dataset.order))));
  setupPagination(orders);
}
async function openOrder(id) {
  const x = await api(`/api/admin/orders/${id}`);
  dialog(
    `<span class="eyebrow">RESERVA #${x.id}</span><h2>Pedido de ${esc(x.customer_name)}</h2><div class="detail-layout"><div><h3>Itens reservados</h3>${x.items.map((i) => `<div class="detail-row"><span>${esc(i.product_name)} · ${esc(i.color)} · ${esc(i.size)}<br>${i.quantity} unidade(s)</span><strong>${fmt(i.subtotal)}</strong></div>`).join("")}<div class="detail-row"><span>Total</span><strong>${fmt(x.total)}</strong></div></div><div>${row("Status", x.status.replaceAll("_", " "))}${row("Telefone", x.phone || "—")}${row("E-mail", x.email || "—")}${row("Data", date(x.created_at))}${row("Expira", date(x.expires_at))}</div></div><div class="detail-actions" id="order-actions"></div><div class="section-title"><h2>Histórico</h2></div>${x.history.map((h) => `<div class="detail-row"><span>${date(h.created_at)}</span><strong>${esc(h.new_status.replaceAll("_", " "))}</strong></div>`).join("")}`,
  );
  const actions = $("#order-actions");
  const transitions = {
    PENDENTE: ["EM_ATENDIMENTO", "CANCELADO"],
    EM_ATENDIMENTO: ["CONFIRMADO", "CANCELADO"],
    CONFIRMADO: ["CONVERTIDO_EM_VENDA", "CANCELADO"],
  };
  actions.innerHTML = (transitions[x.status] || [])
    .map((next) =>
      next === "CONVERTIDO_EM_VENDA"
        ? '<button class="primary-button" data-convert>Converter em venda ↗</button>'
        : `<button class="${next === "CANCELADO" ? "danger-button" : "secondary-button"}" data-status="${next}">${next === "CANCELADO" ? "Cancelar reserva" : next === "CONFIRMADO" ? "Confirmar pedido" : "Iniciar atendimento"}</button>`,
    )
    .join("");
  actions.querySelectorAll("[data-status]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        const next = btn.dataset.status;
        if (
          next === "CANCELADO" &&
          !confirmAction("Cancelar esta reserva e liberar o estoque?")
        )
          return;
        try {
          await api(`/api/admin/orders/${id}/status`, "PATCH", {
            status: next,
          });
          closeDialog();
          toast("Pedido atualizado.");
          orders();
        } catch (error) {
          toast(error.message, "error");
        }
      }),
  );
  $("[data-convert]", actions)?.addEventListener("click", () => {
    dialog(
      `<span class="eyebrow">PEDIDO #${id}</span><h2>Converter em venda</h2><p>O estoque será baixado e a reserva concluída. Escolha a forma de pagamento recebida.</p><form id="convert-form"><label class="field">Pagamento<select name="payment">${paymentOptions()}</select></label><div class="form-actions"><button class="primary-button" type="submit">Confirmar venda ↗</button></div></form>`,
    );
    $("#convert-form").onsubmit = async (e) => {
      e.preventDefault();
      if (!confirmAction("Confirmar a venda deste pedido?")) return;
      try {
        await api(`/api/admin/orders/${id}/convert`, "POST", {
          payment: new FormData(e.target).get("payment"),
        });
        closeDialog();
        toast("Pedido convertido em venda.");
        orders();
      } catch (error) {
        toast(error.message, "error");
      }
    };
  });
}
async function products(page = 1) {
  const q = filters.productSearch || "";
  const d = await api(
    `/api/admin/products?${new URLSearchParams({ page, q })}`,
  );
  $("#view-actions").innerHTML = can("products.create")
    ? '<button class="primary-button" id="new-product">+ Cadastrar produto <span>↗</span></button>'
    : "";
  $("#new-product")?.addEventListener("click", () => {
    productEditorId = null;
    setView("productEditor");
  });
  $("#view-content").innerHTML =
    `<div class="toolbar"><input id="product-search" placeholder="Buscar produto pelo nome" value="${esc(q)}"><button class="secondary-button" id="product-search-btn">Buscar</button></div><div class="panel">${table(["PRODUTO", "MARCA", "CATEGORIA", "PREÇO", "VARIAÇÕES", "STATUS", ""], d.items, (x) => `<tr><td><strong>${esc(x.name)}</strong><br><small>${esc(x.model || "")}</small></td><td>${esc(x.brand || "—")}</td><td>${esc(x.category || "—")}</td><td>${fmt(x.price)}</td><td>${x.variant_count}</td><td>${x.active ? badge("ATIVO") : badge("INATIVO")}</td><td><button data-product="${x.id}">Editar ↗</button></td></tr>`)}</div>${pagination(d)}`;
  $("#product-search-btn").onclick = () => {
    filters.productSearch = $("#product-search").value;
    products();
  };
  $("#product-search").onkeydown = (e) => {
    if (e.key === "Enter") $("#product-search-btn").click();
  };
  document.querySelectorAll("[data-product]").forEach(
    (x) =>
      (x.onclick = () => {
        productEditorId = Number(x.dataset.product);
        setView("productEditor");
      }),
  );
  setupPagination(products);
}
async function productEditor() {
  const [product, facets] = await Promise.all([
    productEditorId
      ? api(`/api/admin/products/${productEditorId}`)
      : Promise.resolve(null),
    api("/api/public/filters"),
  ]);
  $("#view-title").textContent = product
    ? `Editar ${product.name}`
    : "Novo produto";
  $("#view-actions").innerHTML =
    '<button class="secondary-button" id="back-products">← Voltar aos produtos</button>';
  $("#back-products").onclick = () => setView("products");
  const options = (values, current) =>
    '<option value="">Selecione</option>' +
    values
      .map(
        (x) =>
          `<option value="${x.id}" ${Number(current) === x.id ? "selected" : ""}>${esc(x.name)}</option>`,
      )
      .join("");
  $("#view-content").innerHTML =
    `<div class="product-edit"><div class="panel"><h3>Dados do produto</h3><form id="product-form" class="form-grid">${field("Nome *", "name", product?.name || "", "text", 'required maxlength="190"')}${field("Modelo", "model", product?.model || "")}${field("Preço de venda *", "price", product?.price || "", "number", 'min="0" step="0.01" required')}${field("Custo", "cost", product?.cost || 0, "number", 'min="0" step="0.01"')}<label class="field">Marca<select name="brandId">${options(facets.brands, product?.brand_id)}</select></label><label class="field">Categoria<select name="categoryId">${options(facets.categories, product?.category_id)}</select></label><label class="field full">Descrição<textarea name="description">${esc(product?.description || "")}</textarea></label><label class="field check"><input type="checkbox" name="featured" ${product?.featured ? "checked" : ""}> Produto em destaque</label><label class="field check"><input type="checkbox" name="active" ${product == null || Boolean(product.active) ? "checked" : ""}> Produto ativo</label><div class="form-actions field full"><button class="primary-button" type="submit">Salvar produto ↗</button></div></form></div><div><div class="panel"><div class="panel-head"><h3>Variações</h3>${product && can("products.create") ? '<button id="new-variant">+ Nova variação</button>' : ""}</div>${product ? (product.variants.length ? product.variants.map((v) => `<div class="variant-row"><strong>${esc(v.color)}</strong><strong>${esc(v.size)}</strong><span>${v.physical_stock - v.reserved_stock} disp.</span><small>${esc(v.sku || "")}</small><button class="text-button" data-variant="${v.id}">Editar</button></div>`).join("") : "<p>Adicione cores e numerações.</p>") : "<p>Salve o produto para cadastrar variações.</p>"}</div><div class="panel" style="margin-top:16px"><h3>Fotos do produto</h3>${product ? `<form id="upload-form"><input type="file" aria-label="Selecionar fotos do produto" name="images" accept="image/jpeg,image/png,image/webp" multiple required><div class="form-actions"><button class="secondary-button" type="submit">Enviar fotos</button></div></form><div class="image-grid">${product.images.map((img) => `<div class="image-tile"><img src="${esc(img.url)}" alt="Foto de ${esc(product.name)}"><button data-move-image="${img.id}" data-position="${img.position - 1}" aria-label="Mover foto para cima">↑</button><button data-move-image="${img.id}" data-position="${img.position + 1}" aria-label="Mover foto para baixo">↓</button><button data-primary="${img.id}">${img.is_primary ? "Principal" : "Tornar principal"}</button><button data-delete-image="${img.id}" class="delete-img">Excluir</button></div>`).join("")}</div>` : "<p>Salve o produto para enviar fotos.</p>"}</div></div></div>`;
  $("#product-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {
      name: f.get("name"),
      model: f.get("model") || null,
      description: f.get("description") || null,
      price: Number(f.get("price")),
      cost: Number(f.get("cost")),
      brandId: f.get("brandId") ? Number(f.get("brandId")) : null,
      categoryId: f.get("categoryId") ? Number(f.get("categoryId")) : null,
      featured: f.has("featured"),
      active: f.has("active"),
    };
    try {
      const saved = await api(
        product ? `/api/admin/products/${product.id}` : "/api/admin/products",
        product ? "PUT" : "POST",
        data,
      );
      productEditorId = saved.id;
      toast("Produto salvo.");
      productEditor();
    } catch (error) {
      toast(error.message, "error");
    }
  };
  if (product) {
    $("#new-variant")?.addEventListener("click", () =>
      variantDialog(product, null),
    );
    document.querySelectorAll("[data-variant]").forEach(
      (btn) =>
        (btn.onclick = () =>
          variantDialog(
            product,
            product.variants.find((v) => v.id === Number(btn.dataset.variant)),
          )),
    );
    $("#upload-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api(`/api/admin/products/${product.id}/images`, "POST", form);
        toast("Fotos enviadas.");
        productEditor();
      } catch (error) {
        toast(error.message, "error");
      }
    };
    document.querySelectorAll("[data-move-image]").forEach(
      (btn) =>
        (btn.onclick = async () => {
          try {
            await api(
              `/api/admin/products/${product.id}/images/${btn.dataset.moveImage}`,
              "PATCH",
              { position: Number(btn.dataset.position) },
            );
            productEditor();
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
    document.querySelectorAll("[data-primary]").forEach(
      (btn) =>
        (btn.onclick = async () => {
          try {
            await api(
              `/api/admin/products/${product.id}/images/${btn.dataset.primary}`,
              "PATCH",
              { isPrimary: true },
            );
            productEditor();
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
    document.querySelectorAll("[data-delete-image]").forEach(
      (btn) =>
        (btn.onclick = async () => {
          if (!confirmAction("Excluir esta foto?")) return;
          try {
            await api(
              `/api/admin/products/${product.id}/images/${btn.dataset.deleteImage}`,
              "DELETE",
            );
            toast("Foto excluída.");
            productEditor();
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
  }
}
function variantDialog(product, variant) {
  dialog(
    `<span class="eyebrow">${esc(product.name)}</span><h2>${variant ? "Editar" : "Nova"} variação</h2><form id="variant-form" class="form-grid">${field("Cor *", "color", variant?.color || "", "text", "required")}${field("Numeração *", "size", variant?.size || "", "text", "required")}${field("SKU", "sku", variant?.sku || "")}${field("Código de barras", "barcode", variant?.barcode || "")}${field("Preço específico", "price", variant?.price || "", "number", 'min="0" step="0.01"')}${field("Custo específico", "cost", variant?.cost || "", "number", 'min="0" step="0.01"')}${field("Estoque mínimo", "minimumStock", variant?.minimum_stock ?? 2, "number", 'min="0"')}<label class="field check"><input name="active" type="checkbox" ${variant == null || Boolean(variant.active) ? "checked" : ""}> Ativa</label><div class="form-actions field full"><button class="primary-button" type="submit">Salvar variação ↗</button></div></form>`,
  );
  $("#variant-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {
      productId: product.id,
      color: f.get("color"),
      size: f.get("size"),
      sku: f.get("sku") || null,
      barcode: f.get("barcode") || null,
      price: f.get("price") ? Number(f.get("price")) : null,
      cost: f.get("cost") ? Number(f.get("cost")) : null,
      minimumStock: Number(f.get("minimumStock")),
      active: f.has("active"),
    };
    try {
      await api(
        variant ? `/api/admin/variants/${variant.id}` : "/api/admin/variants",
        variant ? "PUT" : "POST",
        data,
      );
      closeDialog();
      toast("Variação salva.");
      productEditor();
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
async function stock(page = 1) {
  const low = filters.stockLow || false;
  const d = await api(`/api/admin/stock?${new URLSearchParams({ page, low })}`);
  $("#view-actions").innerHTML = can("stock.adjust")
    ? '<button class="primary-button" id="adjust-stock">+ Ajustar estoque <span>↗</span></button>'
    : "";
  $("#adjust-stock")?.addEventListener("click", () => stockDialog());
  $("#view-content").innerHTML =
    `<div class="toolbar"><label class="field check"><input id="low-only" type="checkbox" ${low ? "checked" : ""}> Somente estoque baixo</label><button class="secondary-button" id="movement-btn">Ver movimentações</button></div><div class="panel">${table(["PRODUTO", "COR / NÚMERO", "SKU", "FÍSICO", "RESERVADO", "DISPONÍVEL", "MÍNIMO"], d.items, (x) => `<tr><td><strong>${esc(x.product_name)}</strong></td><td>${esc(x.color)} · ${esc(x.size)}</td><td>${esc(x.sku || "—")}</td><td>${x.physical_stock}</td><td>${x.reserved_stock}</td><td><strong style="color:${x.available <= x.minimum_stock ? "#b45b4f" : "#304d3d"}">${x.available}</strong></td><td>${x.minimum_stock}</td></tr>`)}</div>${pagination(d)}`;
  $("#low-only").onchange = (e) => {
    filters.stockLow = e.target.checked;
    stock();
  };
  $("#movement-btn").onclick = movements;
  setupPagination(stock);
}
async function movements() {
  const data = await api("/api/admin/stock/movements");
  dialog(
    `<span class="eyebrow">RASTREABILIDADE</span><h2>Movimentações recentes</h2>${table(["DATA", "PRODUTO", "TIPO", "QTD", "FÍSICO", "RESERVADO"], data, (x) => `<tr><td>${date(x.created_at)}</td><td>${esc(x.product_name)} ${esc(x.size)}</td><td>${esc(x.type)}</td><td>${x.quantity}</td><td>${x.stock_before} → ${x.stock_after}</td><td>${x.reserved_before} → ${x.reserved_after}</td></tr>`)}`,
  );
}
async function stockDialog() {
  const data = await api("/api/admin/stock?limit=100");
  dialog(
    `<span class="eyebrow">HISTÓRICO GARANTIDO</span><h2>Ajustar estoque</h2><p>Todo ajuste ficará registrado no histórico.</p><form id="stock-form" class="form-grid"><label class="field full">Variação<select name="variantId" required>${data.items.map((x) => `<option value="${x.id}">${esc(x.product_name)} · ${esc(x.color)} · ${esc(x.size)} (${x.available} disp.)</option>`).join("")}</select></label><label class="field">Tipo<select name="direction"><option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option></select></label>${field("Quantidade", "quantity", 1, "number", 'min="1" required')}<label class="field full">Motivo<textarea name="note" required maxlength="255"></textarea></label><div class="form-actions field full"><button class="primary-button" type="submit">Registrar ajuste ↗</button></div></form>`,
  );
  $("#stock-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/admin/stock/adjust", "POST", {
        variantId: Number(f.get("variantId")),
        direction: f.get("direction"),
        quantity: Number(f.get("quantity")),
        note: f.get("note"),
      });
      closeDialog();
      toast("Estoque ajustado.");
      stock();
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
const paymentOptions = () =>
  ["DINHEIRO", "PIX", "DEBITO", "CREDITO", "OUTROS"]
    .map(
      (x) =>
        `<option value="${x}">${{ DINHEIRO: "Dinheiro", PIX: "PIX", DEBITO: "Débito", CREDITO: "Crédito", OUTROS: "Outros" }[x]}</option>`,
    )
    .join("");
async function pos() {
  posCart = [];
  $("#view-actions").innerHTML = "";
  $("#view-content").innerHTML =
    `<div class="pos-layout"><div class="panel"><div class="panel-head"><div><span class="eyebrow">01 / PRODUTOS</span><h3>Encontre o próximo par</h3></div></div><label class="input-label" for="barcode-input">Código de barras ou SKU</label><div class="scanner-bar"><input id="barcode-input" placeholder="Leia ou digite o código" autocomplete="off"><button class="secondary-button" id="camera-btn">▣ &nbsp; Ler código</button></div><p class="scanner-hint">Passe o leitor ou digite o código e pressione Enter.</p><div class="toolbar"><input id="pos-search" placeholder="Ou procure pelo nome do produto"><button class="secondary-button" id="pos-search-btn">Buscar</button></div><div class="search-results" id="pos-results"></div><button class="secondary-button pos-summary" id="pos-summary" hidden>Ver resumo da venda ↓</button></div><div class="panel pos-cart"><span class="eyebrow">02 / RESUMO</span><h3>Esta venda</h3><div id="pos-lines"></div><div class="pos-total"><span>Total</span><strong id="pos-total">R$ 0,00</strong></div><div class="pos-pay"><label class="field">Desconto geral<input id="pos-discount" type="number" min="0" step="0.01" value="0"></label><label class="field">Pagamento<select id="pos-payment">${paymentOptions()}</select></label><button class="primary-button" id="finish-sale">Finalizar venda ↗</button></div></div></div>`;
  $("#barcode-input").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = e.target.value.trim();
    e.target.value = "";
    if (!code) return;
    try {
      const item = await api(
        `/api/admin/products/barcode/${encodeURIComponent(code)}`,
      );
      addPos(item);
      toast(`${item.productName} adicionado.`);
    } catch (error) {
      toast(error.message, "error");
    }
  };
  $("#pos-search-btn").onclick = searchPos;
  $("#pos-search").onkeydown = (e) => {
    if (e.key === "Enter") searchPos();
  };
  $("#camera-btn").onclick = openCamera;
  $("#pos-summary").onclick = () =>
    document
      .querySelector(".pos-cart")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  $("#pos-discount").oninput = renderPosCart;
  $("#finish-sale").onclick = finishSale;
  renderPosCart();
  $("#barcode-input").focus();
}
async function searchPos() {
  const q = $("#pos-search").value.trim();
  if (!q) return;
  try {
    const data = await api(
      `/api/admin/products?${new URLSearchParams({ q, limit: 15 })}`,
    );
    $("#pos-results").innerHTML = data.items.length
      ? data.items
          .map(
            (x) =>
              `<div class="search-item"><div><b>${esc(x.name)}</b><small>${esc(x.brand || "")} · ${fmt(x.price)}</small></div><button data-search-id="${x.id}">Escolher ↗</button></div>`,
          )
          .join("")
      : "<p>Nenhum produto encontrado.</p>";
    document.querySelectorAll("[data-search-id]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const p = await api(`/api/admin/products/${b.dataset.searchId}`);
            $("#pos-results").innerHTML = p.variants
              .filter((v) => v.active)
              .map(
                (v) =>
                  `<div class="search-item"><div><b>${esc(p.name)} · ${esc(v.color)} · ${esc(v.size)}</b><small>${v.physical_stock - v.reserved_stock} disponível(is)</small></div><button data-add-variant="${v.id}">Adicionar +</button></div>`,
              )
              .join("");
            document.querySelectorAll("[data-add-variant]").forEach(
              (btn) =>
                (btn.onclick = () =>
                  addPos({
                    variantId: Number(btn.dataset.addVariant),
                    productName: p.name,
                    color: p.variants.find(
                      (v) => v.id === Number(btn.dataset.addVariant),
                    ).color,
                    size: p.variants.find(
                      (v) => v.id === Number(btn.dataset.addVariant),
                    ).size,
                    price:
                      p.variants.find(
                        (v) => v.id === Number(btn.dataset.addVariant),
                      ).price ?? p.price,
                    available:
                      p.variants.find(
                        (v) => v.id === Number(btn.dataset.addVariant),
                      ).physical_stock -
                      p.variants.find(
                        (v) => v.id === Number(btn.dataset.addVariant),
                      ).reserved_stock,
                  })),
            );
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
  } catch (error) {
    toast(error.message, "error");
  }
}
function addPos(item) {
  const current = posCart.find((x) => x.variantId === item.variantId);
  if ((current?.quantity || 0) >= item.available)
    return toast("Estoque disponível insuficiente.", "error");
  if (current) current.quantity++;
  else posCart.push({ ...item, quantity: 1, discount: 0 });
  renderPosCart();
  $("#barcode-input")?.focus();
}
function renderPosCart() {
  const lines = $("#pos-lines");
  if (!lines) return;
  lines.innerHTML = posCart.length
    ? posCart
        .map(
          (x) =>
            `<div class="pos-line"><div><strong>${esc(x.productName)}</strong><br><small>${esc(x.color)} · ${esc(x.size)} · ${fmt(x.price)}</small></div><label class="pos-number">Qtd.<input type="number" inputmode="numeric" min="1" max="${x.available}" value="${x.quantity}" data-pos-qty="${x.variantId}" aria-label="Quantidade"></label><label class="pos-number">Desconto (R$)<input type="number" inputmode="decimal" min="0" step="0.01" value="${x.discount}" data-pos-discount="${x.variantId}" aria-label="Desconto"></label><button data-pos-remove="${x.variantId}" aria-label="Remover">×</button></div>`,
        )
        .join("")
    : '<div class="empty-state"><span>◇</span><h3>Venda vazia</h3><p>Leia um código ou busque um produto.</p></div>';
  const total =
    posCart.reduce(
      (n, x) => n + Number(x.price) * x.quantity - Number(x.discount),
      0,
    ) - Number($("#pos-discount")?.value || 0);
  $("#pos-total").textContent = fmt(Math.max(0, total));
  const summary = $("#pos-summary");
  if (summary) {
    const quantity = posCart.reduce((sum, line) => sum + line.quantity, 0);
    summary.hidden = quantity === 0;
    summary.textContent = `Ver resumo · ${quantity} ${quantity === 1 ? "item" : "itens"} ↓`;
  }
  lines.querySelectorAll("[data-pos-qty]").forEach(
    (el) =>
      (el.onchange = () => {
        const x = posCart.find(
          (x) => x.variantId === Number(el.dataset.posQty),
        );
        const value = Number(el.value);
        if (value < 1 || value > x.available) {
          toast("Quantidade inválida para o estoque.", "error");
          renderPosCart();
          return;
        }
        x.quantity = value;
        renderPosCart();
      }),
  );
  lines.querySelectorAll("[data-pos-discount]").forEach(
    (el) =>
      (el.onchange = () => {
        const x = posCart.find(
          (x) => x.variantId === Number(el.dataset.posDiscount),
        );
        x.discount = Number(el.value) || 0;
        renderPosCart();
      }),
  );
  lines.querySelectorAll("[data-pos-remove]").forEach(
    (el) =>
      (el.onclick = () => {
        posCart = posCart.filter(
          (x) => x.variantId !== Number(el.dataset.posRemove),
        );
        renderPosCart();
      }),
  );
}
async function finishSale() {
  if (!posCart.length) return toast("Adicione um produto à venda.", "error");
  if (!confirmAction("Confirmar esta venda e baixar o estoque?")) return;
  try {
    const result = await api("/api/admin/sales", "POST", {
      items: posCart.map((x) => ({
        variantId: x.variantId,
        quantity: x.quantity,
        discount: Number(x.discount),
      })),
      discount: Number($("#pos-discount").value) || 0,
      payment: $("#pos-payment").value,
    });
    toast(`Venda #${result.id} concluída.`);
    setView("pos");
  } catch (error) {
    toast(error.message, "error");
  }
}
let cameraStream = null,
  cameraTimer = null,
  zxingReader = null;
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia)
    return toast(
      "Câmera indisponível neste navegador. Use HTTPS ou o leitor USB.",
      "error",
    );
  $("#camera-dialog").showModal();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });
    const video = $("#camera-video");
    video.srcObject = cameraStream;
    await video.play();
    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      const loop = async () => {
        if (!cameraStream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            onCameraCode(codes[0].rawValue);
            return;
          }
        } catch {}
        cameraTimer = setTimeout(loop, 180);
      };
      loop();
    } else {
      await loadZxing();
      zxingReader = new ZXing.BrowserMultiFormatReader();
      await zxingReader.decodeFromVideoElementContinuously(video, (result) => {
        if (result) onCameraCode(result.getText());
      });
    }
  } catch (error) {
    stopCamera();
    toast("Não foi possível abrir a câmera. Use o campo de código.", "error");
  }
}
async function loadZxing() {
  if (window.ZXing) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/js/vendor/zxing.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
function stopCamera() {
  clearTimeout(cameraTimer);
  zxingReader?.reset?.();
  zxingReader = null;
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  $("#camera-video").srcObject = null;
  $("#camera-dialog").close();
}
async function onCameraCode(code) {
  stopCamera();
  try {
    const item = await api(
      `/api/admin/products/barcode/${encodeURIComponent(code)}`,
    );
    addPos(item);
    toast(`${item.productName} adicionado.`);
  } catch (error) {
    toast(error.message, "error");
  }
}
$("#camera-close").onclick = stopCamera;
$("#camera-dialog").addEventListener("close", () => {
  if (cameraStream) stopCamera();
});
async function sales(page = 1) {
  const d = await api(`/api/admin/sales?page=${page}`);
  $("#view-actions").innerHTML =
    '<button class="primary-button" id="new-sale">+ Nova venda ↗</button>';
  $("#new-sale").onclick = () => setView("pos");
  $("#view-content").innerHTML =
    `<div class="panel">${table(["VENDA", "DATA", "CLIENTE", "ATENDENTE", "PAGAMENTO", "TOTAL", "STATUS", ""], d.items, (x) => `<tr><td><strong>#${x.id}</strong></td><td>${date(x.created_at)}</td><td>${esc(x.customer_name || "Balcão")}</td><td>${esc(x.user_name)}</td><td>${esc(x.payment || "—")}</td><td>${fmt(x.total)}</td><td>${badge(x.status)}</td><td>${x.status === "CONCLUIDA" && can("sales.cancel") ? `<button data-cancel-sale="${x.id}">Cancelar</button>` : ""}</td></tr>`)}</div>${pagination(d)}`;
  document.querySelectorAll("[data-cancel-sale]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        if (!confirmAction("Cancelar esta venda? O estoque será devolvido."))
          return;
        try {
          await api(
            `/api/admin/sales/${btn.dataset.cancelSale}/cancel`,
            "POST",
            {},
          );
          toast("Venda cancelada e estoque devolvido.");
          sales();
        } catch (error) {
          toast(error.message, "error");
        }
      }),
  );
  setupPagination(sales);
}
async function purchases() {
  const d = await api("/api/admin/purchases");
  $("#view-actions").innerHTML = can("purchases.create")
    ? '<button class="primary-button" id="new-purchase">+ Nova compra ↗</button>'
    : "";
  $("#new-purchase")?.addEventListener("click", purchaseDialog);
  $("#view-content").innerHTML =
    `<div class="panel">${table(["COMPRA", "FORNECEDOR", "DATA", "TOTAL", "STATUS", ""], d, (x) => `<tr><td><strong>#${x.id}</strong></td><td>${esc(x.supplier_name)}</td><td>${date(x.created_at)}</td><td>${fmt(x.total)}</td><td>${badge(x.status)}</td><td>${x.status === "RASCUNHO" ? `<button data-receive="${x.id}">Receber ↗</button>` : ""}</td></tr>`)}</div>`;
  document.querySelectorAll("[data-receive]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirmAction(
            "Confirmar recebimento e adicionar os itens ao estoque?",
          )
        )
          return;
        try {
          await api(
            `/api/admin/purchases/${b.dataset.receive}/receive`,
            "POST",
            {},
          );
          toast("Mercadoria recebida.");
          purchases();
        } catch (error) {
          toast(error.message, "error");
        }
      }),
  );
}
async function purchaseDialog() {
  const [suppliers, stock] = await Promise.all([
    api("/api/admin/suppliers?limit=100"),
    api("/api/admin/stock?limit=100"),
  ]);
  const chosen = [];
  dialog(
    `<span class="eyebrow">ENTRADA DE MERCADORIA</span><h2>Nova compra</h2><form id="purchase-form"><label class="field">Fornecedor<select name="supplierId" required>${suppliers.items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><div class="section-title"><h2>Itens da compra</h2></div><div class="form-grid"><label class="field full">Variação<select id="purchase-variant">${stock.items.map((x) => `<option value="${x.id}">${esc(x.product_name)} · ${esc(x.color)} · ${esc(x.size)}</option>`).join("")}</select></label>${field("Quantidade", "quantity", 1, "number", 'min="1"')}${field("Custo unitário", "unitCost", "", "number", 'min="0" step="0.01"')}</div><button class="secondary-button" type="button" id="purchase-add" style="margin-top:12px">+ Adicionar item</button><div id="purchase-items"></div><label class="field" style="margin-top:15px">Observação<textarea name="notes"></textarea></label><div class="form-actions"><button class="primary-button" type="submit">Criar compra ↗</button></div></form>`,
  );
  const render = () => {
    $("#purchase-items").innerHTML = chosen.length
      ? chosen
          .map(
            (item, i) =>
              `<div class="detail-row"><span>${esc(item.name)} · ${item.quantity} un. · ${fmt(item.unitCost)}</span><button class="text-button" type="button" data-remove-purchase="${i}">Remover</button></div>`,
          )
          .join("")
      : '<p style="margin-top:12px">Adicione ao menos um item.</p>';
    document.querySelectorAll("[data-remove-purchase]").forEach(
      (btn) =>
        (btn.onclick = () => {
          chosen.splice(Number(btn.dataset.removePurchase), 1);
          render();
        }),
    );
  };
  render();
  $("#purchase-add").onclick = () => {
    const id = Number($("#purchase-variant").value),
      quantity = Number($("#purchase-form [name=quantity]").value),
      unitCost = Number($("#purchase-form [name=unitCost]").value),
      variant = stock.items.find((x) => x.id === id);
    if (
      !variant ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !Number.isFinite(unitCost) ||
      unitCost < 0
    )
      return toast("Confira os dados do item.", "error");
    chosen.push({
      variantId: id,
      quantity,
      unitCost,
      name: `${variant.product_name} · ${variant.color} · ${variant.size}`,
    });
    render();
  };
  $("#purchase-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!chosen.length) return toast("Adicione ao menos um item.", "error");
    const f = new FormData(e.target);
    try {
      await api("/api/admin/purchases", "POST", {
        supplierId: Number(f.get("supplierId")),
        notes: f.get("notes") || null,
        items: chosen.map(({ variantId, quantity, unitCost }) => ({
          variantId,
          quantity,
          unitCost,
        })),
      });
      closeDialog();
      toast("Compra criada. Receba para atualizar o estoque.");
      purchases();
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
const entityMeta = {
  suppliers: {
    title: "Fornecedor",
    fields: [
      ["Nome / razão social", "name"],
      ["Nome fantasia", "tradeName"],
      ["CPF / CNPJ", "taxId"],
      ["Telefone", "phone"],
      ["WhatsApp", "whatsapp"],
      ["E-mail", "email"],
      ["Endereço", "address"],
      ["Observações", "notes"],
    ],
  },
  customers: {
    title: "Cliente",
    fields: [
      ["Nome", "name"],
      ["CPF", "cpf"],
      ["Telefone", "phone"],
      ["E-mail", "email"],
    ],
  },
};
async function entities(type, page = 1) {
  const q = filters[`${type}Q`] || "",
    d = await api(`/api/admin/${type}?${new URLSearchParams({ q, page })}`),
    meta = entityMeta[type];
  $("#view-actions").innerHTML = can(`${type}.manage`)
    ? `<button class="primary-button" id="new-entity">+ ${meta.title} ↗</button>`
    : "";
  $("#new-entity")?.addEventListener("click", () => entityDialog(type, null));
  $("#view-content").innerHTML =
    `<div class="toolbar"><input id="entity-search" placeholder="Buscar pelo nome" value="${esc(q)}"><button class="secondary-button" id="entity-search-btn">Buscar</button></div><div class="panel">${table(["NOME", "DOCUMENTO", "TELEFONE", "E-MAIL", "STATUS", ""], d.items, (x) => `<tr><td><strong>${esc(x.name)}</strong>${x.trade_name ? `<br><small>${esc(x.trade_name)}</small>` : ""}</td><td>${esc(x.tax_id || x.cpf || "—")}</td><td>${esc(x.phone || "—")}</td><td>${esc(x.email || "—")}</td><td>${x.active ? badge("ATIVO") : badge("INATIVO")}</td><td>${can(`${type}.manage`) ? `<button data-entity="${x.id}">Editar ↗</button>` : ""}</td></tr>`)}</div>${pagination(d)}`;
  $("#entity-search-btn").onclick = () => {
    filters[`${type}Q`] = $("#entity-search").value;
    entities(type);
  };
  document.querySelectorAll("[data-entity]").forEach(
    (btn) =>
      (btn.onclick = () =>
        entityDialog(
          type,
          d.items.find((x) => x.id === Number(btn.dataset.entity)),
        )),
  );
  setupPagination((p) => entities(type, p));
}
function entityDialog(type, entity) {
  const meta = entityMeta[type];
  dialog(
    `<span class="eyebrow">CADASTRO</span><h2>${entity ? "Editar" : "Novo"} ${meta.title.toLowerCase()}</h2><form id="entity-form" class="form-grid">${meta.fields.map(([label, key]) => field(label, key, entity?.[key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] || "", key === "email" ? "email" : "text", key === "name" ? "required" : "")).join("")}<label class="field check"><input name="active" type="checkbox" ${entity == null || Boolean(entity.active) ? "checked" : ""}> Ativo</label><div class="form-actions field full"><button class="primary-button" type="submit">Salvar ↗</button></div></form>`,
  );
  $("#entity-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      data = Object.fromEntries(
        meta.fields.map(([, key]) => [key, f.get(key) || null]),
      );
    data.active = f.has("active");
    try {
      await api(
        `/api/admin/${type}${entity ? `/${entity.id}` : ""}`,
        entity ? "PUT" : "POST",
        data,
      );
      closeDialog();
      toast(`${meta.title} salvo.`);
      entities(type);
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
async function users() {
  const [data, roles, perms] = await Promise.all([
    api("/api/admin/users"),
    api("/api/admin/users/roles"),
    api("/api/admin/users/permissions"),
  ]);
  $("#view-actions").innerHTML =
    '<button class="primary-button" id="new-user">+ Novo usuário ↗</button>';
  $("#new-user").onclick = () => userDialog(roles);
  $("#view-content").innerHTML =
    `<div class="panel">${table(["USUÁRIO", "E-MAIL", "PERFIL", "STATUS", ""], data, (x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.email)}</td><td>${esc(x.role)}</td><td>${x.active ? badge("ATIVO") : badge("INATIVO")}</td><td><button data-user="${x.id}">Permissões ↗</button></td></tr>`)}</div>`;
  document.querySelectorAll("[data-user]").forEach(
    (btn) =>
      (btn.onclick = () =>
        userPermissionsDialog(
          data.find((x) => x.id === Number(btn.dataset.user)),
          perms,
        )),
  );
}
function userDialog(roles) {
  dialog(
    `<span class="eyebrow">EQUIPE N&M</span><h2>Novo usuário</h2><form id="user-form" class="form-grid">${field("Nome", "name", "", "text", "required")}${field("E-mail", "email", "", "email", "required")}${field("Senha (mín. 12 caracteres)", "password", "", "password", 'minlength="12" required')}<label class="field">Perfil<select name="roleId">${roles.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("")}</select></label><div class="form-actions field full"><button class="primary-button" type="submit">Criar usuário ↗</button></div></form>`,
  );
  $("#user-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/admin/users", "POST", {
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
        roleId: Number(f.get("roleId")),
        active: true,
      });
      closeDialog();
      toast("Usuário criado.");
      users();
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
async function userPermissionsDialog(user, perms) {
  try {
    const overrides = await api(`/api/admin/users/${user.id}/permissions`);
    const selected = new Map(
      overrides.map((x) => [x.code, x.allowed ? "true" : "false"]),
    );
    dialog(
      `<span class="eyebrow">ACESSO DA EQUIPE</span><h2>${esc(user.name)}</h2><p>Permissões individuais complementam o perfil ${esc(user.role)}. Escolha Permitir ou Bloquear para uma exceção.</p><div class="toolbar"><label class="field check"><input id="user-active" type="checkbox" ${Boolean(user.active) ? "checked" : ""}> Usuário ativo</label></div><div style="max-height:45vh;overflow:auto">${perms.map((x) => `<div class="detail-row"><span>${esc(x.code)}</span><select data-perm="${esc(x.code)}"><option value="" ${!selected.has(x.code) ? "selected" : ""}>Perfil padrão</option><option value="true" ${selected.get(x.code) === "true" ? "selected" : ""}>Permitir</option><option value="false" ${selected.get(x.code) === "false" ? "selected" : ""}>Bloquear</option></select></div>`).join("")}</div>`,
    );
    $("#user-active").onchange = async (e) => {
      if (
        !e.target.checked &&
        !confirmAction("Desativar este usuário e encerrar suas sessões?")
      ) {
        e.target.checked = true;
        return;
      }
      try {
        await api(`/api/admin/users/${user.id}/active`, "PATCH", {
          active: e.target.checked,
        });
        toast("Usuário atualizado.");
      } catch (error) {
        toast(error.message, "error");
        e.target.checked = !e.target.checked;
      }
    };
    document.querySelectorAll("[data-perm]").forEach(
      (el) =>
        (el.onchange = async () => {
          try {
            if (el.value === "")
              await api(`/api/admin/users/${user.id}/permission`, "DELETE", {
                permission: el.dataset.perm,
              });
            else
              await api(`/api/admin/users/${user.id}/permission`, "PATCH", {
                permission: el.dataset.perm,
                allowed: el.value === "true",
              });
            toast("Permissão atualizada.");
          } catch (error) {
            toast(error.message, "error");
          }
        }),
    );
  } catch (error) {
    toast(error.message, "error");
  }
}
async function reports() {
  const start = filters.reportStart || "",
    end = filters.reportEnd || "",
    productId = filters.reportProductId || "",
    categoryId = filters.reportCategoryId || "";
  const [data, facets, products] = await Promise.all([
    api(
      `/api/admin/reports?${new URLSearchParams({ start, end, productId, categoryId })}`,
    ),
    api("/api/public/filters"),
    api("/api/admin/products?limit=100"),
  ]);
  $("#view-actions").innerHTML = "";
  $("#view-content").innerHTML =
    `<div class="toolbar"><label class="field">De<input id="report-start" type="date" value="${esc(start)}"></label><label class="field">Até<input id="report-end" type="date" value="${esc(end)}"></label><label class="field">Produto<select id="report-product"><option value="">Todos</option>${products.items.map((x) => `<option value="${x.id}" ${String(productId) === String(x.id) ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label><label class="field">Categoria<select id="report-category"><option value="">Todas</option>${facets.categories.map((x) => `<option value="${x.id}" ${String(categoryId) === String(x.id) ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label><button class="secondary-button" id="report-apply">Aplicar filtros</button></div><div class="report-grid"><div class="panel"><h3>Vendas por dia</h3>${table(["DATA", "VENDAS", "TOTAL"], data.sales, (x) => `<tr><td>${esc(x.day)}</td><td>${x.count}</td><td>${fmt(x.total)}</td></tr>`)}</div><div class="panel"><h3>Produtos mais vendidos</h3>${table(["PRODUTO", "QTD", "TOTAL"], data.top, (x) => `<tr><td>${esc(x.product_name)}</td><td>${x.quantity}</td><td>${fmt(x.total)}</td></tr>`)}</div><div class="panel"><h3>Formas de pagamento</h3>${table(["FORMA", "VENDAS", "TOTAL"], data.payment, (x) => `<tr><td>${esc(x.method)}</td><td>${x.count}</td><td>${fmt(x.total)}</td></tr>`)}</div><div class="panel"><h3>Compras por dia</h3>${table(["DATA", "COMPRAS", "TOTAL"], data.purchases, (x) => `<tr><td>${esc(x.day)}</td><td>${x.count}</td><td>${fmt(x.total)}</td></tr>`)}</div><div class="panel"><h3>Estoque baixo</h3>${table(
      ["PRODUTO", "VARIAÇÃO", "DISP."],
      data.stock.filter((x) => x.available <= x.minimum_stock),
      (x) =>
        `<tr><td>${esc(x.name)}</td><td>${esc(x.color)} · ${esc(x.size)}</td><td>${x.available}</td></tr>`,
    )}</div><div class="panel"><h3>Movimentações</h3>${table(["TIPO", "EVENTOS", "UNIDADES"], data.movements, (x) => `<tr><td>${esc(x.type)}</td><td>${x.count}</td><td>${x.quantity}</td></tr>`)}</div></div>`;
  $("#report-apply").onclick = () => {
    filters.reportStart = $("#report-start").value;
    filters.reportEnd = $("#report-end").value;
    filters.reportProductId = $("#report-product").value;
    filters.reportCategoryId = $("#report-category").value;
    reports();
  };
}
async function settings() {
  const audit = await api("/api/admin/audit");
  $("#view-content").innerHTML =
    `<div class="panel"><h3>Registro de atividades</h3><p style="margin-bottom:18px;color:#858a82">Operações importantes ficam registradas para conferência.</p>${table(["DATA", "USUÁRIO", "AÇÃO", "ENTIDADE", "ID"], audit, (x) => `<tr><td>${date(x.created_at)}</td><td>${esc(x.user_name || "Sistema")}</td><td>${esc(x.action)}</td><td>${esc(x.entity)}</td><td>${esc(x.entity_id || "—")}</td></tr>`)}</div>`;
}
async function boot() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;
    $("#sidebar-name").textContent = currentUser.name;
    $("#sidebar-role").textContent = currentUser.role;
    const initials = currentUser.name
      .split(" ")
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase();
    $("#sidebar-avatar").textContent = initials;
    $("#header-avatar").textContent = initials;
    $("#header-date").textContent = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
    }).format(new Date());
    const permissions = {
      dashboard: "dashboard.view",
      pos: "sales.create",
      orders: "orders.view",
      sales: "sales.view",
      products: "products.view",
      stock: "stock.view",
      purchases: "purchases.view",
      suppliers: "suppliers.view",
      customers: "customers.view",
      users: "users.manage",
      reports: "reports.view",
      settings: "settings.view",
    };
    document
      .querySelectorAll("#side-nav [data-view], #mobile-nav [data-view]")
      .forEach((btn) => (btn.hidden = !can(permissions[btn.dataset.view])));
    document.querySelectorAll(".nav-section").forEach((group) => {
      group.hidden = !group.querySelector("button:not([hidden])");
    });
    $("#mobile-nav").hidden = !$("#mobile-nav").querySelector(
      "button:not([hidden])",
    );
    let view = location.hash.slice(1);
    if (!permissions[view] || !can(permissions[view]))
      view =
        Object.keys(permissions).find((key) => can(permissions[key])) ||
        "dashboard";
    setView(view);
  } catch {
    $("#login-screen").hidden = false;
    $("#app-shell").hidden = true;
    $("#mobile-nav").hidden = true;
  }
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const f = new FormData(e.target);
  try {
    await api("/api/auth/login", "POST", {
      email: f.get("email"),
      password: f.get("password"),
    });
    e.target.reset();
    boot();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
};
$("#logout-button").onclick = async () => {
  try {
    await api("/api/auth/logout", "POST", {});
  } finally {
    location.hash = "";
    currentUser = null;
    closeSidebar(false);
    $("#mobile-nav").hidden = true;
    $("#app-shell").hidden = true;
    $("#login-screen").hidden = false;
  }
};
const compactLayout = window.matchMedia("(max-width: 1024px)");
function closeSidebar(restoreFocus = true) {
  const wasOpen = $("#sidebar").classList.contains("open");
  $("#sidebar").classList.remove("open");
  $("#sidebar-shade").hidden = true;
  $("#menu-button").setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
  document.querySelector(".main-column").inert = false;
  $("#mobile-nav").inert = false;
  $("#sidebar").inert = compactLayout.matches;
  if (compactLayout.matches) $("#sidebar").setAttribute("aria-hidden", "true");
  else $("#sidebar").removeAttribute("aria-hidden");
  if (wasOpen && restoreFocus) $("#menu-button").focus();
}
document
  .querySelectorAll("#side-nav [data-view], #mobile-nav [data-view]")
  .forEach((btn) => {
    btn.onclick = () => {
      setView(btn.dataset.view);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
  });
$("#menu-button").onclick = () => {
  $("#sidebar").inert = false;
  $("#sidebar").removeAttribute("aria-hidden");
  $("#sidebar").classList.add("open");
  $("#sidebar-shade").hidden = false;
  $("#menu-button").setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
  document.querySelector(".main-column").inert = true;
  $("#mobile-nav").inert = true;
  $("#sidebar-close").focus();
};
$("#sidebar-close").onclick = () => closeSidebar();
$("#sidebar-shade").onclick = () => closeSidebar();
document.addEventListener("keydown", (event) => {
  if (!$("#sidebar").classList.contains("open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSidebar();
  }
  if (event.key === "Tab") {
    const buttons = [
      ...$("#sidebar").querySelectorAll("a,button:not([hidden])"),
    ].filter((el) => el.getClientRects().length);
    const first = buttons[0],
      last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
compactLayout.addEventListener("change", () => closeSidebar());
closeSidebar(false);
boot();
