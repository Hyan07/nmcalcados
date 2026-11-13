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

- Node.js 22 ou superior, npm, MySQL 8.0 ou superior.
- Conta Cloudinary apenas para upload de fotos de produtos.

```bash
npm ci
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

## Produção na Hostinger

Use um plano com **aplicações Node.js** (Business/Cloud compatível), Node.js 22 ou superior e MySQL 8+. Este projeto Express precisa de processo Node: upload de `public/` como site estático não executa o sistema. Referências oficiais: [aplicação Node.js](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [MySQL com Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/), [variáveis de ambiente](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/).

### 1. Provisionar e configurar MySQL

No hPanel, abra o gerenciamento do site → Bancos de dados → MySQL, crie um banco e um usuário vinculado, com senha forte. Use os **nomes completos com prefixo** exibidos pelo painel em DB_NAME e DB_USER. O banco deve usar utf8mb4. Guarde um backup antes de aplicar migrations sobre um banco existente.

Na aplicação Node da Hostinger, configure as variáveis pelo painel, sem enviar .env ao GitHub:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://seu-dominio.com.br
TRUST_PROXY=1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=nome_completo_do_banco
DB_USER=nome_completo_do_usuario
DB_PASSWORD=senha_definida_no_hpanel
DB_CONNECTION_LIMIT=10
DB_SSL=false
SESSION_SECRET=segredo_aleatorio_gerado_por_voce
RESERVATION_EXPIRATION_HOURS=24
```

DB_HOST=127.0.0.1 é para o aplicativo hospedado junto ao MySQL; use os valores específicos fornecidos pelo hPanel quando diferentes. DB_SOCKET_PATH deve ficar vazio na Hostinger. Para acesso remoto, use o host externo informado em MySQL remoto, libere apenas o IP do computador de migração e habilite TLS validado com DB_SSL=true (DB_SSL_CA_FILE pode apontar para a CA do provedor). Se não houver TLS disponível, utilize um túnel SSH privado, em vez de transmitir credenciais pela internet. Revogue o acesso remoto ao terminar.

Gere SESSION_SECRET com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` e guarde o resultado apenas no gerenciador de segredos/ambiente. APP_ORIGIN precisa ser a origem HTTPS exata, sem barra final. TRUST_PROXY=1 serve para um proxy confiável; confirme a topologia da hospedagem antes de alterá-lo. PORT é fornecida pela plataforma; o servidor escuta em 0.0.0.0. Sem banco acessível, o processo falha na inicialização.

Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET para fotos. O segredo de sessão e as credenciais são obrigatórios em produção; exemplos e valores vazios são rejeitados.

### 2. Instalação, migrations e administrador

Conecte o repositório Hyan07/nmcalcados à aplicação no hPanel, selecione a raiz do repositório, framework Express e entrada **src/server.js**. Instalação: `npm ci --omit=dev`; inicialização: `npm start`. Não há build de frontend. Não configure migrations ou importação de dados como comando automático de build/start.

No terminal que tenha acesso ao MySQL de destino e às mesmas variáveis, dentro da raiz do projeto:

```bash
npm ci --omit=dev
npm run migrate
npm run seed
```

Antes do seed configure ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD (12+ caracteres). Depois remova ADMIN_PASSWORD do ambiente. O seed não substitui a senha de usuário existente. As migrations são registradas em schema_migrations, serializadas por lock MySQL e aplicadas na ordem. O usuário precisa de CREATE/ALTER/INDEX/REFERENCES durante esta etapa; não precisa criar o banco quando ele já foi provisionado no painel. A migration 002 é repetível após interrupção entre seus ALTERs. Faça backup antes de qualquer alteração de esquema; uma falha na migration inicial 001 exige restaurar o banco vazio/backup antes de tentar de novo, pois DDL MySQL não tem rollback global.

Se o plano não oferecer terminal para comandos avulsos, execute-os em um computador autorizado com acesso remoto seguro ao MySQL. Não substitua o host interno do aplicativo pelo endereço externo permanentemente.

### 3. Configurar GescomPro

O servidor web usa apenas MySQL. A conexão SQL Server é separada e carregada somente pelos comandos legados. No ambiente do computador que executará a migração configure:

```dotenv
GESCOM_DB_HOST=host_acessivel_do_sql_server
GESCOM_DB_PORT=1433
GESCOM_DB_NAME=GescomPro
GESCOM_DB_USER=usuario_somente_select
GESCOM_DB_PASSWORD=senha_do_usuario
GESCOM_DB_ENCRYPT=true
GESCOM_DB_TRUST_SERVER_CERTIFICATE=false
```

A conta deve ter apenas SELECT. Nenhum comando cria ou altera objetos no Gescom. Prefira certificado SQL Server confiável. A conexão antiga deste ambiente exigiu GESCOM_DB_ENCRYPT=false e GESCOM_DB_TRUST_SERVER_CERTIFICATE=true, cujo uso foi autorizado apenas na rede privada para a validação; esses valores não são o padrão do código. Não exponha SQL Server na internet para atender ao deploy. Um endereço privado da loja não será acessível diretamente pela Hostinger: rode o importador numa máquina da rede/VPN, conectada de forma segura ao MySQL de destino. Remova as variáveis GESCOM do servidor web depois da migração.

### 4. Inspeção e dry-run

O [mapeamento validado e suas exceções](docs/gescom-mapping.md) documenta as tabelas reais. O histórico está em Pre_Venda, não nas tabelas Vendas vazias.

```bash
npm run inspect:gescom
npm run migrate:gescom -- --dry-run
```

O dry-run lê as duas bases e valida referências, estados, saldos e colisões, sem INSERT/UPDATE/DDL no MySQL. Rode migrations e seed antes. A coluna imported no relatório representa **quantidades projetadas** quando dryRun=true; committed=false confirma que nada foi gravado. Confira o arquivo privado em reports/gescom-*.json, sobretudo exceptions e errors. A saída não imprime nomes, senhas ou documentos de clientes. Os totais de referência são 710 produtos, 4.328 grades e 3.810 unidades; o resultado inclui 177 variações padrão e três produtos inativos para preservar grades órfãs.

### 5. Migração real e conferência

Faça backup do MySQL. Congele gravações no Gescom e no novo sistema, execute novamente o dry-run e confira as exceções antes da importação final. Não opere o caixa durante esta janela.

```bash
npm run migrate:gescom
```

O sucesso exige código de saída zero, errors vazio e committed=true. Erros de execução retornam código 1 e fazem rollback completo. O relatório mantém as quantidades e a indicação rolledBack em falhas de escrita. Não apague os mapeamentos em legacy_records: repetir o comando ignora registros já importados e não redefine o estoque. Alterações posteriores na origem são relatadas, sem sobrescrever a nova operação.

Compare os totais do relatório e execute no MySQL:

```sql
SELECT entity, COUNT(*) FROM legacy_records WHERE source='gescompro' GROUP BY entity;
SELECT SUM(v.physical_stock) AS estoque_importado
FROM product_variants v JOIN legacy_records l
 ON l.entity='product_variants' AND l.target_id=v.id AND l.source='gescompro';
SELECT COUNT(*) AS vendas_historicas FROM sales WHERE is_historical=1;
```

Logo após a carga, a soma importada deve ser 3.810 para a fonte analisada. O relatório distingue saldo de grades e de variações padrão. Estoque anterior do destino não é substituído. Vendas antigas não reduzem saldo nem podem ser canceladas pelo fluxo normal; pagamentos e devoluções precisam de conciliação financeira, conforme o documento de mapeamento. Guarde relatório e backup com acesso restrito. Para desfazer uma carga confirmada, restaure o backup durante a janela de manutenção; não use DELETEs avulsos em tabelas relacionadas.

### 6. Iniciar e verificar produção

Depois da migração/conferência, inicie ou reinicie a aplicação pelo hPanel com:

```bash
npm start
```

Ative HTTPS e confira `/`, `/admin`, `/health` (processo) e `/health/ready` (MySQL, responde 503 quando indisponível). Teste login, catálogo e upload; faça operações de caixa apenas em ambiente de teste. SIGTERM/SIGINT encerram o HTTP e o pool de forma controlada.

Configure `npm run expire-reservations` a cada cinco minutos, usando o diretório absoluto do projeto e as mesmas variáveis do aplicativo. Por exemplo, no cron de um ambiente com Node no PATH:

```cron
*/5 * * * * cd /caminho/absoluto/do/projeto && /caminho/absoluto/do/npm run expire-reservations
```

Use os caminhos reais obtidos no terminal da hospedagem. Mantenha backups periódicos MySQL e monitore erros de runtime, disponibilidade e execução do cron. Credenciais, dumps, reports/ e node_modules/ não devem ser enviados no pacote de deploy.

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

Para testar o importador com dados sintéticos, use **outro banco vazio** com nome terminado em `_test`, aplique migrations e seed e execute `RUN_DB_TESTS=1 npm run test:gescom:db`. Esse teste insere uma pequena fixture para validar idempotência e bloqueio de cancelamento; não o execute sobre uma importação de teste existente. O ensaio opcional com fonte real (`RUN_GESCOM_LIVE_TESTS=1 npm run test:gescom:live`) sempre desfaz os INSERTs e exige banco de teste sem mapeamentos anteriores.

O teste de integração disputa a última unidade com duas reservas simultâneas e verifica conversão, cancelamento, venda presencial, compra e liberação de reserva. Nunca use o banco de produção para esse teste.

## Decisões de escopo

- Uma loja e um caixa, com papéis ADMIN/VENDEDOR e permissões granulares editáveis.
- Um pagamento por venda nesta versão; a tabela `payments` permite evolução futura.
- Sem ERP financeiro, pagamento online ou integração fiscal.
- Catálogo sem login; a reserva não cria venda automaticamente.
