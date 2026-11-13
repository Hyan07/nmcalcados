# N&M Calçados

Sistema de loja de calçados para uma operação pequena: catálogo público, reservas e painel interno no mesmo backend e no mesmo MySQL. É um monólito modular em Node.js, Express, MySQL e HTML/CSS/JavaScript. Não há checkout ou pagamento online.

## Arquitetura

```text
Navegador (catálogo / painel)
           ↓
Rotas Express → Controllers → Services → Repositories → MySQL
                                  ↓
                         CloudinaryStorageService
```

- `src/config`: ambiente.
- `src/database`: pool, migrations, seed e tarefa de expiração.
- `src/routes`: rotas públicas, autenticação e administração.
- `src/controllers`: entrada HTTP e validação.
- `src/services`: regras de pedido, venda, estoque, compra, produto, imagem, usuário e relatórios.
- `src/repositories`: SQL parametrizado e bloqueio de variações.
- `src/middlewares`: autenticação, permissões, CSRF e erros.
- `src/validators`: contratos Zod de entrada.
- `public`: páginas e scripts sem framework. O arquivo `public/images/atelier-hero.webp` é uma peça decorativa da interface; fotos de produtos vão somente para Cloudinary.
- `tests`: testes de regras e integração com banco de teste.

O modelo separa `products`, `product_variants` e `product_images`. Cada variação tem cor, numeração, SKU e código de barras únicos quando informados, preço opcional e estoque físico/reservado. Pedidos, vendas e compras têm tabelas de itens com valores e descrições gravados no momento da operação. `stock_movements`, `order_status_history` e `audit_logs` registram o histórico.

**Fonte de verdade:** `product_variants.physical_stock` e `reserved_stock`. Disponível = físico − reservado. O catálogo consulta exatamente essa diferença; não existe outro estoque para a vitrine. Reserva, venda, conversão, cancelamento, compra e ajuste usam transações MySQL. A variação é lida com `SELECT ... FOR UPDATE` antes de modificar estoque, em ordem de ID quando há vários itens. Restrições do banco e a política de estoque impedem valores negativos e reserva acima do físico.

**Pedido → venda:** `PENDENTE → EM_ATENDIMENTO → CONFIRMADO → CONVERTIDO_EM_VENDA`. Cancelamento e expiração são estados terminais. Na conversão, uma transação verifica a reserva, cria venda/itens/pagamento, reduz físico e reservado, registra movimentações, histórico e auditoria. Uma falha reverte tudo. Venda presencial pula o pedido e reduz apenas o estoque disponível. Cancelar venda devolve o físico e preserva o histórico.

## Requisitos e instalação local

- Node.js 20 ou superior, npm, MySQL 8.0 ou superior.
- Conta Cloudinary apenas para upload de fotos de produtos.

```bash
npm install
cp .env.example .env
```

Edite `.env`. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `APP_ORIGIN` e uma `SESSION_SECRET` aleatória com no mínimo 32 caracteres. Para o seed, configure `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` com senha de no mínimo 12 caracteres. Não publique `.env`; ele está no `.gitignore`.

```bash
npm run migrate
npm run seed
npm run dev
```

Abra `http://localhost:3000/` para a vitrine e `http://localhost:3000/admin` para o painel. `npm start` executa o servidor sem observação de arquivos. `npm run migrate` cria o banco quando o usuário MySQL pode fazê-lo; se o provedor restringir essa permissão, crie o banco pelo painel do provedor e rode o comando novamente. O script aplica apenas migrations ainda não registradas. O seed pode ser executado novamente sem duplicar papéis, permissões, marcas e categorias; não substitui a senha de um administrador existente.

Em ambiente local com socket Unix, `DB_SOCKET_PATH` pode ser usado no lugar de host/porta.

## Primeiros passos na loja

1. Entre no painel com o administrador criado pelo seed.
2. Cadastre um produto, escolha marca/categoria e salve.
3. Adicione uma variação por cor e numeração. Informe SKU e código de barras, se houver.
4. Use **Estoque → Ajustar estoque** para registrar a entrada inicial com motivo; ou receba uma compra de fornecedor.
5. Envie fotos JPEG, PNG ou WEBP pelo produto, depois marque a principal. O upload exige Cloudinary configurado.
6. O produto ativo aparece no catálogo. Um cliente escolhe uma variação disponível, reserva e o pedido aparece no painel.

Para o exemplo Nike Revolution preto 37/38/39/40, crie um produto e quatro variações. Faça entradas de 1, 2, 1 e 0 unidades. O tamanho 40 aparecerá esgotado.

## Autenticação e segurança

O painel usa sessão opaca em cookie `HttpOnly`, `Secure` em produção e `SameSite=Lax`. O banco guarda somente HMAC do token e do token CSRF, nunca os tokens em claro. O JavaScript envia o token CSRF no cabeçalho `X-CSRF-Token` para escritas administrativas. O servidor verifica a origem, a sessão e a permissão granular em cada rota. Alterações de permissão são refletidas na próxima requisição. Senhas usam bcrypt (12 rounds). Login e pedidos públicos têm limite de tentativas; entradas são validadas com Zod; SQL usa parâmetros. `helmet` fornece cabeçalhos de segurança. Não há API pública de clientes ou vendas.

O catálogo guarda no `localStorage` somente slug, ID da variação e quantidade da sacola. Nome, telefone, e-mail e CPF não são guardados no navegador. CPF e e-mail são opcionais no pedido; nome e telefone são necessários para contato. Em produção, use HTTPS e configure `APP_ORIGIN` com a origem exata do site.

## Fotos e Cloudinary

Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`. O upload aceita até 8 imagens por envio, 5 MB por arquivo, somente JPEG/PNG/WEBP com assinatura compatível. O `CloudinaryStorageService` transforma imagens para WebP e limita a dimensão. URLs e `storage_key` ficam no MySQL. A interface permite enviar, definir principal, editar posição pela API e excluir. A abstração `StorageService` permite trocar o provedor no futuro.

Fotos de produtos nunca são gravadas dentro da pasta Node: deployments não apagam as imagens. Sem credenciais Cloudinary, o catálogo mostra uma identidade visual neutra para produtos sem foto.

A foto decorativa da capa foi gerada pelo ImageGen integrado e salva em `public/images/atelier-hero.webp`. Prompt usado:

> Use case: product-mockup. Asset type: wide home page hero photograph for a Brazilian contemporary footwear boutique. Primary request: one elegant pair of unbranded cream and warm caramel leather women's sneakers resting on a pale travertine plinth in a sunlit minimalist studio. Composition: landscape, shoes dominant on the right two thirds, generous clean warm off-white negative space on the left for HTML headline overlay. Natural late-afternoon directional light, subtle shadows, tactile leather and suede, editorial fashion photography, premium but approachable, restrained sand, ecru and burnt terracotta palette. No people, no logo, no text, no watermark, no collage.

## Leitor USB e câmera

No PDV, mantenha o foco no campo de código. Leitores USB que emulam teclado enviam os dígitos e Enter; leituras repetidas aumentam a quantidade até o limite disponível. A busca usa `GET /api/admin/products/barcode/:barcode`.

No celular, o botão **Ler código** abre a câmera em HTTPS. O navegador usa `BarcodeDetector` quando disponível e carrega ZXing como fallback. Permita acesso à câmera para o site. Se a câmera ou a biblioteca não estiver disponível, o campo manual e a busca continuam funcionando.

## Expiração de reservas

`RESERVATION_EXPIRATION_HOURS` define o prazo, padrão 24 horas. A tarefa abaixo expira pedidos ainda abertos e devolve o reservado. Configure-a no cron da hospedagem, por exemplo a cada 5 minutos:

```bash
npm run expire-reservations
```

A tarefa trabalha em lotes de 100 e repete até esvaziar a fila. O serviço também impede a conversão de reservas vencidas antes do cron processá-las.

## Deploy na Hostinger

1. Crie um site Node.js e um banco MySQL no hPanel. Anote host, porta, banco, usuário e senha reais.
2. Faça upload/deploy do projeto sem `node_modules` e sem `.env`. Configure as variáveis do `.env.example` no ambiente do aplicativo. Use `NODE_ENV=production`, `APP_ORIGIN=https://seu-dominio` e `SESSION_SECRET` forte.
3. Defina o comando de instalação como `npm install` e o de inicialização como `npm start`. O app escuta `PORT` do ambiente. Se houver proxy reverso, ajuste `TRUST_PROXY` conforme o número de proxies confiáveis.
4. Execute `npm run migrate` e `npm run seed` no ambiente da hospedagem. Para segurança, remova `ADMIN_PASSWORD` das variáveis depois de criar o administrador.
5. Configure as três variáveis Cloudinary e teste upload. Ative HTTPS antes de usar a câmera no celular.
6. Programe `npm run expire-reservations` no cron do hPanel. Garanta que o cron use o mesmo diretório e variáveis do app.

Não inclua arquivos de imagens de produtos no deploy. O arquivo decorativo do hero faz parte do código, enquanto as fotos cadastradas são persistidas no Cloudinary.

## Endpoints principais

| Público                          | Função                                |
| -------------------------------- | ------------------------------------- |
| `GET /api/public/products`       | Busca, filtros e paginação            |
| `GET /api/public/products/:slug` | Produto, fotos e estoque por variação |
| `GET /api/public/filters`        | Categorias, marcas, tamanhos e cores  |
| `POST /api/public/orders`        | Cria reserva pendente                 |

| Interno                                                                                  | Função                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------ |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`                      | Sessão                               |
| `GET/POST/PUT /api/admin/products`                                                       | Produtos (detalhe/edição com `/:id`) |
| `POST/PUT /api/admin/variants`                                                           | Variações                            |
| `POST/PATCH/DELETE /api/admin/products/:id/images`                                       | Fotos (PATCH/DELETE com `/:imageId`) |
| `GET /api/admin/products/barcode/:barcode`                                               | Consulta de leitor                   |
| `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`                            | Pedidos                              |
| `POST /api/admin/orders/:id/convert`                                                     | Conversão em venda                   |
| `GET/POST /api/admin/sales`, `POST /api/admin/sales/:id/cancel`                          | Vendas                               |
| `GET /api/admin/stock`, `GET /api/admin/stock/movements`, `POST /api/admin/stock/adjust` | Estoque                              |
| `GET/POST /api/admin/purchases`, `POST /api/admin/purchases/:id/receive`                 | Compras                              |
| `GET/POST/PUT /api/admin/suppliers`, `/customers`                                        | Cadastros                            |
| `GET/POST/PATCH /api/admin/users`                                                        | Usuários e permissões                |
| `GET /api/admin/dashboard`, `GET /api/admin/reports`, `GET /api/admin/audit`             | Indicadores e histórico              |

Parâmetros comuns de listagem: `page`, `limit`, `q`; o catálogo aceita `category`, `brand`, `min`, `max`, `size`, `color` e `available=true`. Respostas de erro usam `{ "error": "...", "code": "..." }`.

## Testes

```bash
npm test
```

Testa invariantes de estoque, estados do pedido, centavos, CPF e permissão. Para testar transações reais, configure um MySQL separado com nome terminado em `_test`, rode migrations e seed nesse banco e execute:

```bash
RUN_DB_TESTS=1 npm run test:db
```

O teste de integração disputa a última unidade com duas reservas simultâneas e verifica conversão, cancelamento, venda presencial, compra e liberação de reserva. Nunca use o banco de produção para esse teste.

## Decisões de escopo

- Uma loja e um caixa, com papéis ADMIN/VENDEDOR e permissões granulares editáveis.
- Um pagamento por venda nesta versão; a tabela `payments` permite evolução futura.
- Sem ERP financeiro, pagamento online ou integração fiscal.
- Catálogo sem login; a reserva não cria venda automaticamente.
