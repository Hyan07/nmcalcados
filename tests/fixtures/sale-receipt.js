export function saleReceiptFixture() {
  return {
    id: 1001,
    order_id: null,
    created_at: "2026-11-16T15:30:00.000Z",
    issuedAt: "2026-11-16T15:31:00.000Z",
    status: "CONCLUIDA",
    subtotal: "200.00",
    discount: "20.00",
    surcharge: "0.00",
    total: "180.00",
    is_historical: 0,
    customer_name: "Cliente de exemplo",
    user_name: "Equipe N&M",
    warranty_text:
      "Guarde este comprovante para atendimento de garantia na loja. Consulte as condições e os prazos aplicáveis a cada produto.",
    items: [
      {
        product_name: "Tênis casual",
        color: "Preto",
        size: "39",
        quantity: 1,
        unit_price: "150.00",
        discount: "10.00",
        surcharge: "0.00",
        subtotal: "140.00",
        legacy_cancelled: 0,
      },
      {
        product_name: "Batom rosa",
        color: "Rosa",
        size: "Único",
        quantity: 2,
        unit_price: "25.00",
        discount: "0.00",
        surcharge: "0.00",
        subtotal: "50.00",
        legacy_cancelled: 0,
      },
    ],
    payments: [
      { method: "PIX", amount: "180.00", reconciliation_status: "RECEBIDO" },
    ],
  };
}
