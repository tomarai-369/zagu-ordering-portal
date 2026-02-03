// Order PDF generation using pdfmake (loaded via CDN)
const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export function generateOrderPDF(order, dealer, store) {
  const pdfMake = window.pdfMake;
  if (!pdfMake) { alert("PDF library not loaded. Please refresh and try again."); return; }

  const STATUS_LABELS = {
    "New": "Draft", "Submitted": "Submitted", "Pending ONB Approval": "Pending Approval",
    "Approved": "Approved", "Posted to SAP": "Posted to SAP", "Picking": "Warehouse Picking",
    "Ready for Pickup": "Ready for Pickup", "Completed": "Completed", "Rejected": "Rejected",
  };

  const itemRows = order.items.map((item, i) => [
    { text: String(i + 1), alignment: "center" },
    item.code,
    item.name,
    { text: String(item.qty), alignment: "center" },
    { text: peso(item.price), alignment: "right" },
    { text: peso(item.total), alignment: "right" },
  ]);

  const docDefinition = {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 60],
    defaultStyle: { fontSize: 9.5, font: "Roboto" },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Generated ${new Date().toLocaleString("en-PH")} — Zagu Shakes Dealer Portal`, fontSize: 7, color: "#999", margin: [40, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: "right", fontSize: 7, color: "#999", margin: [0, 0, 40, 0] },
      ],
    }),
    content: [
      // Header
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "ZAGU SHAKES", fontSize: 22, bold: true, color: "#8B5E3C" },
              { text: "Spencer Foods Corporation", fontSize: 9, color: "#999", margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: "auto",
            stack: [
              { text: "PURCHASE ORDER", fontSize: 16, bold: true, alignment: "right", color: "#D4A017" },
              { text: order.number, fontSize: 11, alignment: "right", color: "#555", margin: [0, 4, 0, 0] },
            ],
          },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 535, y2: 8, lineWidth: 1.5, lineColor: "#E8DCC8" }] },

      // Info row
      {
        margin: [0, 16, 0, 0],
        columns: [
          {
            width: "50%",
            stack: [
              { text: "DEALER INFORMATION", fontSize: 8, bold: true, color: "#999", margin: [0, 0, 0, 6] },
              { text: dealer?.name || "—", fontSize: 11, bold: true },
              { text: `Dealer Code: ${dealer?.code || "—"}`, margin: [0, 3, 0, 0] },
              { text: `Region: ${dealer?.region || "—"}` },
              { text: `Contact: ${dealer?.contact || "—"}` },
              { text: `Email: ${dealer?.email || "—"}` },
              store ? { text: `Store: ${store.name || "—"}`, margin: [0, 3, 0, 0] } : {},
            ],
          },
          {
            width: "50%",
            stack: [
              { text: "ORDER DETAILS", fontSize: 8, bold: true, color: "#999", margin: [0, 0, 0, 6] },
              { text: `Order Date: ${order.date}`, fontSize: 10 },
              { text: `Status: ${STATUS_LABELS[order.status] || order.status}`, margin: [0, 3, 0, 0] },
              { text: `Payment: ${order.payment}` },
              { text: `Payment Status: ${order.paymentStatus || "Pending"}` },
              order.sapOrder ? { text: `SAP Sales Order: ${order.sapOrder}`, margin: [0, 3, 0, 0] } : {},
              order.rejectionReason ? { text: `Rejection: ${order.rejectionReason}`, color: "#DC2626", margin: [0, 3, 0, 0] } : {},
            ],
          },
        ],
      },

      // Items table
      {
        margin: [0, 20, 0, 0],
        table: {
          headerRows: 1,
          widths: [30, 70, "*", 40, 70, 80],
          body: [
            [
              { text: "#", bold: true, alignment: "center", fillColor: "#8B5E3C", color: "#fff" },
              { text: "Item Code", bold: true, fillColor: "#8B5E3C", color: "#fff" },
              { text: "Description", bold: true, fillColor: "#8B5E3C", color: "#fff" },
              { text: "Qty", bold: true, alignment: "center", fillColor: "#8B5E3C", color: "#fff" },
              { text: "Unit Price", bold: true, alignment: "right", fillColor: "#8B5E3C", color: "#fff" },
              { text: "Line Total", bold: true, alignment: "right", fillColor: "#8B5E3C", color: "#fff" },
            ],
            ...itemRows,
          ],
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i <= 1 ? "#8B5E3C" : "#E8DCC8",
          paddingTop: () => 6,
          paddingBottom: () => 6,
          fillColor: (i) => i > 0 && i % 2 === 0 ? "#FBF7EF" : null,
        },
      },

      // Totals
      {
        margin: [0, 12, 0, 0],
        columns: [
          { width: "*", text: "" },
          {
            width: 200,
            table: {
              widths: ["*", "auto"],
              body: [
                [
                  { text: "TOTAL", bold: true, fontSize: 12, border: [false, true, false, false], borderColor: ["", "#8B5E3C", "", ""] },
                  { text: peso(order.total), bold: true, fontSize: 12, alignment: "right", border: [false, true, false, false], borderColor: ["", "#8B5E3C", "", ""], color: "#8B5E3C" },
                ],
              ],
            },
            layout: { paddingTop: () => 8, paddingBottom: () => 8 },
          },
        ],
      },

      // Notes
      order.notes ? {
        margin: [0, 20, 0, 0],
        stack: [
          { text: "NOTES", fontSize: 8, bold: true, color: "#999", margin: [0, 0, 0, 4] },
          { text: order.notes, italics: true, color: "#555" },
        ],
      } : {},

      // Outstanding balance warning
      dealer?.outstandingBalance > 0 ? {
        margin: [0, 16, 0, 0],
        table: {
          widths: ["*"],
          body: [[{
            text: `⚠ Outstanding Balance at time of order: ${peso(dealer.outstandingBalance)}`,
            fontSize: 9, color: "#B45309", fillColor: "#FEF3C7", border: [false, false, false, false],
          }]],
        },
        layout: { paddingTop: () => 8, paddingBottom: () => 8, paddingLeft: () => 12 },
      } : {},
    ],
  };

  pdfMake.createPdf(docDefinition).download(`${order.number}.pdf`);
}
