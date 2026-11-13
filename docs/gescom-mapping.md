# Mapeamento GescomPro validado

Inspeção remota em 13/11/2026, exclusivamente SELECT em INFORMATION_SCHEMA, sys.foreign_key_columns e tabelas operacionais. O comando `npm run inspect:gescom` reproduz a inspeção e grava metadados privados em `reports/gescom-schema.json`. O importador valida as colunas antes de ler os dados. Divergências de esquema/estado interrompem a execução.

| Fonte dbo | Chave preservada | Destino / regra |
| --- | --- | --- |
| Fabricante | Fabr | brands, Nome |
| Grupo_Produto | Grup | categories, Dscr |
| Produto | Prod, como texto com zeros | products; Fabr/Grup resolvidos pelas chaves anteriores; Dscr, Vend, Cust; ativo quando Situ=S |
| Grade_Medida_Produto_Detalhamento | Grade + RefHorizontal + RefVertical (PK composta real) | product_variants; Produto aponta para Prod; CodigoGrade=sku, GtinGrade=barcode, Atual=physical_stock |
| Grade_Medida_Produto_Eixo1 | CodigoCategoria=1 + Codigo | RefHorizontal → descrição da cor |
| Grade_Medida_Produto_Eixo2 | CodigoCategoria=2 + Codigo | RefVertical → descrição do tamanho |
| Produto sem linha de grade | default + Prod | variação Padrão/Único, Qtde como saldo, Gtin ou Cean como barcode |
| Cliente | Clie | customers, Nome/Ncpf/Fone/Emai; Situ=I fica inativo; outros estados preservados na origem |
| Fornecedor | Forn | suppliers, Raso/Fant/Cnpj ou Ncpf/Fone/Emai |
| Pre_Venda | Ndoc | sales históricas; Clie → Cliente; Emis como data original; Tota/Desc/TotaFinal como subtotal/desconto/total |
| Pre_Venda_Itens | Ndoc + Nite | sale_items; Prod → Produto; Qtde, Valo (preço unitário antes do rateio), Vtot (líquido); Vuni e percentuais originais preservados |
| Grade_Medida_Pre_Venda_Itens | Ndoc + Nite, com Produto/eixos | resolve variante de item quando há uma grade com quantidade compatível; todas as linhas ficam no snapshot do item |
| Pre_Venda_FormaPagamento | Id | payments, Ndoc → venda; Valor original; DIN/PIX/CTC/CTD → DINHEIRO/PIX/CREDITO/DEBITO; demais → OUTROS com espécie original preservada |

O legado tem **Vendas, Vendas_Produto e Vendas_Grade_Medida vazias**. Importá-las perderia todo o histórico. Se Vendas passar a conter dados, o importador interrompe para revisão. Pre_Venda contém 3.456 documentos Canc=A e 76 Canc=S, todos Stat=X/Tipo=B. Esses estados são aceitos explicitamente; estados novos bloqueiam a importação. Canceladas entram como CANCELADA; a data de cancelamento não é inventada. Emis é uma data civil preservada sem conversão adicional de fuso; Fechamento original permanece no snapshot.

Valo e Vuni diferem em registros reais (por exemplo, 90 e 88); usa-se Valo como preço negociado antes do rateio. Vtot já inclui descontos/acréscimos rateados: a diferença entre Valo × Qtde e Vtot é gravada em discount ou surcharge do item. O cabeçalho preserva Tota, Desc, Acre (surcharge) e TotaFinal. Não se aplica novamente Desc/Acre à soma líquida dos itens. A soma dos Vtot conciliou com TotaFinal em todos os 3.532 documentos analisados. Troco, devoluções e condições financeiras permanecem no snapshot. Pagamentos históricos têm reconciliation_status=LEGADO_NAO_CONCILIADO: uma promissória não é convertida em comprovante de recebimento. Este importador não cria contas a receber nem interpreta parcelas como quitação.

## Resultado do dry-run validado

- 130 fabricantes, 93 grupos, 710 produtos cadastrados.
- 4.328 grades, 3.810 unidades, sem SKU duplicado; seis colisões de barcode tratadas.
- Seis grades apontam para três produtos ausentes (cinco unidades). São criados três produtos inativos, sem descartar as grades.
- 177 produtos sem grade → 177 variações padrão, saldo agregado zero.
- Destino planejado: 713 produtos e 4.505 variações, saldo físico total 3.810.
- 297 clientes, um fornecedor, 3.532 vendas, 5.513 itens, 4.936 formas de pagamento.
- Nenhuma divergência entre a soma líquida dos itens e o total final; 178 itens com devolução; 22 itens sem vínculo inequívoco com uma variante atual; 1.746 formas de pagamento classificadas em OUTROS.
- O destino de teste com seed apresentou oito colisões de nome de marca e três de categoria, além dos seis barcodes. Quantidades podem mudar conforme o destino e a operação do Gescom.

Os 22 itens sem variante identificável mantêm variant_id=NULL, product_id apontando para o produto correto, descrição, valores e snapshot completo das grades. Os relatórios usam product_id como alternativa ao vínculo pela variante. Não é escolhida uma cor/tamanho arbitrária. Nomes/combinações colidentes recebem sufixo determinístico; SKU colidente recebe código GSC determinístico. Barcode/CPF/documento duplicado ficam NULL na ocorrência posterior. Os valores originais permanecem em legacy_records.source_data e no relatório de exceções; a primeira ocorrência é determinística. O leitor consulta apenas o barcode único restante: corrija os códigos na nova operação após conferência física.

## Garantias e limites

legacy_records guarda origem, entidade, chave JSON, SHA-256 da chave, ID do destino, hash e snapshot dos campos lidos. A chave primária impede duplicação de uma origem/entidade/chave. Nenhum vínculo usa o ID numérico do destino como se fosse o código antigo.

A migração é **insert-only**: registros já mapeados são ignorados, inclusive seu saldo. Se a origem mudou, SOURCE_CHANGED_NOT_OVERWRITTEN exige conciliação; uma repetição não repõe estoque vendido no sistema novo. Destino removido ou estado novo do legado bloqueia a execução. Não apague legacy_records para forçar repetição.

O lock MySQL impede dois importadores simultâneos. Toda a importação real (incluindo mapeamentos) usa uma transação; erro reverte tudo. Não se chama saleService, orderService ou stockService. Não são criadas movimentações de estoque para vendas antigas. Cancelamento pelo painel/API é bloqueado para vendas históricas.

**Congele gravações no Gescom e no novo sistema durante a extração final/importação.** As tabelas são lidas por SELECTs separados; não há snapshot transacional global no SQL Server. O dry-run não escreve no MySQL nem cria tabelas; exige migrations e seed previamente aplicados. A validação de colisões em memória é conservadora; constraints MySQL são a verificação final e falhas revertem a transação.

Os relatórios e snapshots podem conter documentos pessoais e códigos comerciais: reports/ é ignorado no Git, arquivos são criados com modo 0600, diretório 0700. Guarde-os fora da hospedagem pública, com acesso restrito. Um ensaio completo com a origem real pode ser executado com `RUN_GESCOM_LIVE_TESTS=1 npm run test:gescom:live` **somente em banco isolado terminado em _test**, previamente migrado e com seed, sem registros em legacy_records; o teste sempre executa ROLLBACK.
