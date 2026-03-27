(function () {
  "use strict";

  // ââ Config ââ
  var DOMAIN = location.origin;
  var APPS = {
    products: { id: 1, label: "Products Master", icon: "ð¦", color: "#E8740C", desc: "Catalog, pricing & stock" },
    dealers: { id: 2, label: "Dealers Master", icon: "ðª", color: "#1a7fa8", desc: "Accounts, regions & credit" },
    orders: { id: 3, label: "Orders", icon: "ð", color: "#8b5cf6", desc: "Processing & fulfillment" },
    news: { id: 4, label: "Announcements", icon: "ð£", color: "#d97706", desc: "News, promos & updates" },
    holidays: { id: 5, label: "Holiday Calendar", icon: "ð", color: "#059669", desc: "PH holidays & business days" }
  };

  var WORKFLOW_MAIN = [
    { id: "new", label: "New", status: "New", color: "#94a3b8" },
    { id: "submitted", label: "Submitted", status: "Submitted", color: "#3b82f6" },
    { id: "pending", label: "Pending", status: "Pending ONB Approval", color: "#f59e0b", sub: "ONB Approval" },
    { id: "approved", label: "Approved", status: "Approved", color: "#10b981" },
    { id: "sap", label: "Posted", status: "Posted to SAP", color: "#8b5cf6", sub: "to SAP" },
    { id: "picking", label: "Picking", status: "Picking", color: "#f97316" },
    { id: "ready", label: "Ready", status: "Ready for Pickup", color: "#06b6d4", sub: "for Pickup" },
    { id: "completed", label: "Completed", status: "Completed", color: "#059669" }
  ];
  var WORKFLOW_REJECTED = { id: "rejected", label: "Rejected", status: "Rejected", color: "#ef4444" };
  var ALL_WORKFLOW = WORKFLOW_MAIN.concat([WORKFLOW_REJECTED]);

  // ââ CSS ââ
  var CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');

    #zagu-portal *, #zagu-portal *::before, #zagu-portal *::after { box-sizing: border-box; margin: 0; padding: 0; }
    #zagu-portal {
      --zp-orange: #E8740C;
      --zp-surface: #ffffff;
      --zp-border: #e8e5e0;
      --zp-text: #1c1917;
      --zp-text-secondary: #78716c;
      --zp-text-muted: #a8a29e;
      --zp-radius: 12px;
      --zp-shadow-sm: 0 1px 2px rgba(28,25,23,0.04), 0 1px 3px rgba(28,25,23,0.06);
      --zp-shadow-md: 0 2px 4px rgba(28,25,23,0.04), 0 4px 12px rgba(28,25,23,0.08);
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      max-width: 1080px; margin: 0 auto; padding: 20px 20px 40px;
      color: var(--zp-text); -webkit-font-smoothing: antialiased;
    }

    /* Header */
    .zp-header {
      display: flex; align-items: center; gap: 20px;
      margin-bottom: 28px; padding: 28px 32px;
      background: linear-gradient(135deg, #E8740C 0%, #d4650a 50%, #bf5808 100%);
      border-radius: 16px; color: #fff;
      box-shadow: 0 8px 32px rgba(232,116,12,0.25);
      position: relative; overflow: hidden;
    }
    .zp-header::before {
      content: ''; position: absolute; inset: 0;
      background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
      pointer-events: none;
    }
    .zp-header::after {
      content: ''; position: absolute; right: -40px; bottom: -40px;
      width: 200px; height: 200px; border-radius: 50%;
      background: rgba(255,255,255,0.07); pointer-events: none;
    }
    .zp-logo {
      width: 56px; height: 56px; border-radius: 14px;
      background: rgba(255,255,255,0.2); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 700; flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .zp-header-text { flex: 1; position: relative; z-index: 1; }
    .zp-header-text h1 { font-size: 21px; font-weight: 700; letter-spacing: -0.3px; }
    .zp-header-text p { font-size: 13px; opacity: 0.75; margin-top: 3px; }
    .zp-greeting { position: absolute; top: 20px; right: 28px; z-index: 1; font-size: 12px; opacity: 0.85; }
    .zp-greeting strong { font-weight: 600; }

    /* KPIs */
    .zp-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .zp-kpi {
      background: var(--zp-surface); border-radius: var(--zp-radius);
      padding: 20px; box-shadow: var(--zp-shadow-sm);
      border: 1px solid var(--zp-border);
      text-decoration: none; color: inherit; display: block;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .zp-kpi:hover { transform: translateY(-2px); box-shadow: var(--zp-shadow-md); }
    .zp-kpi-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 2px; vertical-align: middle; }
    .zp-kpi-val { font-size: 32px; font-weight: 700; line-height: 1; letter-spacing: -1px; margin-top: 8px; }
    .zp-kpi-lbl { font-size: 11px; color: var(--zp-text-secondary); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 500; }
    .zp-kpi-alert { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; margin-left: 8px; vertical-align: middle; }
    .zp-kpi .zp-loading { color: var(--zp-text-muted); animation: zp-pulse 1.5s ease infinite; }
    @keyframes zp-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    /* Section */
    .zp-sh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .zp-sh-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
    .zp-sh-meta { font-size: 11px; color: var(--zp-text-muted); }

    /* Apps */
    .zp-apps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .zp-app {
      background: var(--zp-surface); border-radius: var(--zp-radius);
      padding: 20px 18px; box-shadow: var(--zp-shadow-sm);
      border: 1px solid var(--zp-border);
      text-decoration: none; color: inherit;
      transition: transform 0.2s, box-shadow 0.2s;
      display: flex; flex-direction: column; gap: 10px;
    }
    .zp-app:hover { transform: translateY(-2px); box-shadow: var(--zp-shadow-md); }
    .zp-app-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 19px; }
    .zp-app-name { font-size: 14px; font-weight: 600; }
    .zp-app-desc { font-size: 12px; color: var(--zp-text-secondary); line-height: 1.4; }
    .zp-app-meta { font-size: 11px; color: var(--zp-text-muted); margin-top: auto; }

    /* Workflow */
    .zp-wf-wrap {
      background: var(--zp-surface); border-radius: var(--zp-radius);
      padding: 24px 20px 20px; box-shadow: var(--zp-shadow-sm);
      border: 1px solid var(--zp-border); margin-bottom: 28px;
      overflow-x: auto;
    }
    .zp-wf-svg { width: 100%; min-width: 760px; display: block; }
    .zp-wf-node { cursor: pointer; }
    .zp-wf-node:hover .wf-bg { filter: brightness(1.12); }
    .zp-wf-edge { fill: none; stroke: #d6d3d1; stroke-width: 1.5; }
    .zp-wf-edge-head { fill: #d6d3d1; }
    .zp-wf-rej-edge { stroke: #fca5a5; stroke-dasharray: 5,4; stroke-width: 1.5; }

    /* ââ Drilldown Modal ââ */
    .zp-modal-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(28,25,23,0.45); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .zp-modal-overlay.zp-modal-open { opacity: 1; pointer-events: all; }
    .zp-modal {
      background: #fff; border-radius: 16px;
      width: 90%; max-width: 820px; max-height: 80vh;
      box-shadow: 0 24px 64px rgba(28,25,23,0.2), 0 4px 16px rgba(28,25,23,0.1);
      display: flex; flex-direction: column;
      transform: translateY(12px) scale(0.98);
      transition: transform 0.2s ease;
    }
    .zp-modal-open .zp-modal { transform: translateY(0) scale(1); }
    .zp-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px; border-bottom: 1px solid #e8e5e0; flex-shrink: 0;
    }
    .zp-modal-header-left { display: flex; align-items: center; gap: 12px; }
    .zp-modal-badge {
      display: inline-block; padding: 5px 14px; border-radius: 8px;
      font-size: 13px; font-weight: 600; color: #fff;
    }
    .zp-modal-count { font-size: 13px; color: #78716c; font-weight: 500; }
    .zp-modal-close {
      width: 32px; height: 32px; border-radius: 8px; border: 1px solid #e8e5e0;
      background: #fff; cursor: pointer; display: flex; align-items: center;
      justify-content: center; font-size: 16px; color: #78716c;
      transition: background 0.15s;
    }
    .zp-modal-close:hover { background: #f5f5f4; }
    .zp-modal-body {
      overflow-y: auto; flex: 1; padding: 0;
    }
    .zp-modal-loading {
      padding: 48px; text-align: center; color: #a8a29e; font-size: 13px;
    }
    .zp-modal-empty {
      padding: 48px; text-align: center; color: #a8a29e; font-size: 14px;
    }

    /* Modal Table */
    .zp-dt { width: 100%; border-collapse: collapse; font-size: 13px; }
    .zp-dt thead { position: sticky; top: 0; z-index: 1; }
    .zp-dt th {
      background: #fafaf9; padding: 10px 16px; text-align: left;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: #78716c; border-bottom: 1px solid #e8e5e0;
      white-space: nowrap;
    }
    .zp-dt td {
      padding: 12px 16px; border-bottom: 1px solid #f5f5f4;
      color: #1c1917; vertical-align: middle;
    }
    .zp-dt tbody tr { transition: background 0.1s; cursor: pointer; }
    .zp-dt tbody tr:hover { background: #fafaf9; }
    .zp-dt tbody tr:last-child td { border-bottom: none; }
    .zp-dt .zp-dt-order { font-weight: 600; color: var(--zp-orange); text-decoration: none; }
    .zp-dt .zp-dt-order:hover { text-decoration: underline; }
    .zp-dt .zp-dt-amount { font-weight: 600; font-variant-numeric: tabular-nums; }
    .zp-dt .zp-dt-pill {
      display: inline-block; padding: 2px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 500;
    }

    /* Modal footer */
    .zp-modal-footer {
      padding: 14px 24px; border-top: 1px solid #e8e5e0;
      display: flex; justify-content: space-between; align-items: center;
      flex-shrink: 0;
    }
    .zp-modal-footer a {
      font-size: 12px; font-weight: 500; color: var(--zp-orange);
      text-decoration: none;
    }
    .zp-modal-footer a:hover { text-decoration: underline; }
    .zp-modal-footer span { font-size: 11px; color: #a8a29e; }

    /* Announcements */
    .zp-ann { margin-bottom: 28px; }
    .zp-ann-item {
      background: var(--zp-surface); border-radius: 10px;
      padding: 12px 16px; box-shadow: var(--zp-shadow-sm);
      border: 1px solid var(--zp-border); margin-bottom: 6px;
      display: flex; align-items: center; gap: 12px;
      text-decoration: none; color: inherit; transition: background 0.15s;
    }
    .zp-ann-item:hover { background: #fafaf9; }
    .zp-ann-pin { color: var(--zp-orange); font-size: 13px; flex-shrink: 0; }
    .zp-ann-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 6px; white-space: nowrap; flex-shrink: 0; }
    .zp-ann-title { flex: 1; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .zp-ann-date { font-size: 11px; color: var(--zp-text-muted); flex-shrink: 0; }
    .zp-ann-more { display: block; text-align: right; font-size: 12px; color: var(--zp-text-secondary); text-decoration: none; margin-top: 8px; font-weight: 500; }
    .zp-ann-more:hover { color: var(--zp-orange); }

    /* Quick Actions */
    .zp-qa { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 28px; }
    .zp-qa-item {
      background: var(--zp-surface); border-radius: 10px;
      padding: 14px 16px; box-shadow: var(--zp-shadow-sm);
      border: 1px solid var(--zp-border);
      text-decoration: none; color: inherit;
      display: flex; align-items: center; gap: 12px;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .zp-qa-item:hover { background: #fafaf9; box-shadow: var(--zp-shadow-md); }
    .zp-qa-icon { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
    .zp-qa-text { font-size: 12px; font-weight: 500; line-height: 1.3; }
    .zp-qa-sub { font-size: 11px; color: var(--zp-text-muted); }

    /* Footer */
    .zp-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 0 0; border-top: 1px solid var(--zp-border);
      font-size: 11px; color: var(--zp-text-muted);
    }
    .zp-refresh {
      background: var(--zp-surface); border: 1px solid var(--zp-border);
      border-radius: 6px; padding: 4px 12px; font-size: 11px;
      color: var(--zp-text-secondary); cursor: pointer; font-family: inherit;
    }
    .zp-refresh:hover { background: #f5f5f4; }

    @media (max-width: 960px) {
      .zp-kpis, .zp-apps { grid-template-columns: repeat(2, 1fr); }
      .zp-qa { grid-template-columns: repeat(2, 1fr); }
      .zp-greeting { display: none; }
      .zp-modal { width: 96%; max-height: 85vh; }
    }
    @media (max-width: 600px) {
      .zp-kpis, .zp-apps, .zp-qa { grid-template-columns: 1fr; }
      #zagu-portal { padding: 12px 12px 32px; }
    }
  `;

  // ââ Helpers ââ
  function fetchCount(appId, query) {
    var q = (query ? query + " " : "") + "limit 0";
    return kintone.api(kintone.api.url("/k/v1/records.json", true), "GET", { app: appId, query: q, totalCount: true })
      .then(function (r) { return parseInt(r.totalCount, 10) || 0; });
  }

  function fetchRecords(appId, query, fields) {
    return kintone.api(kintone.api.url("/k/v1/records.json", true), "GET", {
      app: appId, query: query, fields: fields
    }).then(function (r) { return r.records; });
  }

  function greet() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }

  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s);
    var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[d.getMonth()] + " " + d.getDate();
  }

  function fmtTime() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h >= 12 ? "PM" : "AM");
  }

  function fmtPeso(v) {
    var n = parseFloat(v) || 0;
    return "â±" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var CAT_COLORS = {
    General: { bg: "#f0f0ee", fg: "#57534e" },
    Promo: { bg: "#fef3c7", fg: "#b45309" },
    "Product Update": { bg: "#d1fae5", fg: "#047857" },
    Policy: { bg: "#ede9fe", fg: "#6d28d9" },
    Maintenance: { bg: "#fee2e2", fg: "#b91c1c" },
    "System Update": { bg: "#dbeafe", fg: "#1d4ed8" }
  };

  var PAYMENT_COLORS = {
    Paid: { bg: "#d1fae5", fg: "#047857" },
    Pending: { bg: "#fef3c7", fg: "#b45309" },
    Unpaid: { bg: "#fee2e2", fg: "#b91c1c" },
    "COD Pending": { bg: "#fef3c7", fg: "#b45309" },
    Partial: { bg: "#fef3c7", fg: "#b45309" }
  };

  // ââââââââââââââââââââââââââââââââââââââ
  // DRILLDOWN MODAL
  // ââââââââââââââââââââââââââââââââââââââ

  var modal = null;

  function createModal() {
    if (modal) return modal;

    var overlay = document.createElement("div");
    overlay.className = "zp-modal-overlay";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    overlay.innerHTML =
      '<div class="zp-modal">' +
        '<div class="zp-modal-header">' +
          '<div class="zp-modal-header-left">' +
            '<span class="zp-modal-badge" data-modal-badge></span>' +
            '<span class="zp-modal-count" data-modal-count></span>' +
          '</div>' +
          '<button class="zp-modal-close" data-modal-close>â</button>' +
        '</div>' +
        '<div class="zp-modal-body" data-modal-body>' +
          '<div class="zp-modal-loading">Loading orders...</div>' +
        '</div>' +
        '<div class="zp-modal-footer">' +
          '<a href="' + DOMAIN + '/k/3/" data-modal-link>Open in Orders app â</a>' +
          '<span data-modal-hint>Click any row to open the order</span>' +
        '</div>' +
      '</div>';

    overlay.querySelector("[data-modal-close]").addEventListener("click", closeModal);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    document.body.appendChild(overlay);
    modal = overlay;
    return overlay;
  }

  function openModal(node) {
    var overlay = createModal();
    var badge = overlay.querySelector("[data-modal-badge]");
    var countEl = overlay.querySelector("[data-modal-count]");
    var body = overlay.querySelector("[data-modal-body]");

    badge.textContent = node.status;
    badge.style.background = node.color;
    countEl.textContent = "Loading...";
    body.innerHTML = '<div class="zp-modal-loading">Loading orders...</div>';

    // Show modal
    requestAnimationFrame(function () {
      overlay.classList.add("zp-modal-open");
    });

    // Fetch records for this status
    var q = 'Status in ("' + node.status + '") order by order_date desc limit 50';
    var fields = ["Record_number", "order_number", "order_date", "dealer_name_display",
                  "store_name_order", "dealer_region_display", "total_amount",
                  "payment_method", "payment_status", "fulfillment_status",
                  "rejection_reason", "sap_sales_order_no"];

    fetchRecords(3, q, fields).then(function (records) {
      countEl.textContent = records.length + " order" + (records.length !== 1 ? "s" : "");

      if (records.length === 0) {
        body.innerHTML = '<div class="zp-modal-empty">No orders in this status</div>';
        return;
      }

      // Build table
      var isRejected = node.status === "Rejected";
      var isSAP = node.status === "Posted to SAP";

      var html = '<table class="zp-dt"><thead><tr>' +
        '<th>Order #</th><th>Date</th><th>Dealer</th><th>Store</th><th>Amount</th>';

      if (isRejected) {
        html += '<th>Reason</th>';
      } else if (isSAP) {
        html += '<th>SAP #</th>';
      } else {
        html += '<th>Payment</th>';
      }

      html += '</tr></thead><tbody>';

      records.forEach(function (r) {
        var recId = r.Record_number.value;
        var orderNum = r.order_number.value || "#" + recId;
        var date = fmtDate(r.order_date.value);
        var dealer = r.dealer_name_display.value || "â";
        var store = r.store_name_order.value || "â";
        var amount = fmtPeso(r.total_amount.value);
        var recUrl = DOMAIN + "/k/3/show#record=" + recId;

        var extraCol;
        if (isRejected) {
          extraCol = '<td>' + (r.rejection_reason.value || "â") + '</td>';
        } else if (isSAP) {
          extraCol = '<td>' + (r.sap_sales_order_no.value || "â") + '</td>';
        } else {
          var ps = r.payment_status.value || "â";
          var pc = PAYMENT_COLORS[ps] || { bg: "#f0f0ee", fg: "#57534e" };
          extraCol = '<td><span class="zp-dt-pill" style="background:' + pc.bg + ';color:' + pc.fg + '">' + ps + '</span></td>';
        }

        html += '<tr onclick="window.location.href=\'' + recUrl + '\'">' +
          '<td><a class="zp-dt-order" href="' + recUrl + '" onclick="event.stopPropagation()">' + orderNum + '</a></td>' +
          '<td>' + date + '</td>' +
          '<td>' + dealer + '</td>' +
          '<td>' + store + '</td>' +
          '<td class="zp-dt-amount">' + amount + '</td>' +
          extraCol +
          '</tr>';
      });

      html += '</tbody></table>';
      body.innerHTML = html;

    }).catch(function (err) {
      body.innerHTML = '<div class="zp-modal-empty">Error loading orders. Please try again.</div>';
      console.error("Portal drilldown error:", err);
    });
  }

  function closeModal() {
    if (modal) {
      modal.classList.remove("zp-modal-open");
    }
  }

  // ââââââââââââââââââââââââââââââââââââââ
  // BUILD FUNCTIONS
  // ââââââââââââââââââââââââââââââââââââââ

  function buildKPIs() {
    var el = document.createElement("div");
    el.className = "zp-kpis";

    var items = [
      { key: "today", label: "Today's Orders", color: "#8b5cf6", query: "order_date = TODAY()", app: 3, urgency: null, view: "%F0%9F%93%85%20Today's%20Orders" },
      { key: "pending", label: "Pending Approval", color: "#f59e0b", query: 'Status in ("Pending ONB Approval")', app: 3, urgency: { warn: 5, crit: 10 }, view: "%F0%9F%93%8B%20Pending%20My%20Approval" },
      { key: "products", label: "Active Products", color: "#E8740C", query: 'product_status in ("Active")', app: 1, urgency: null, view: "%F0%9F%9F%A2%20Active%20Products" },
      { key: "dealers", label: "Active Dealers", color: "#1a7fa8", query: 'Status in ("Active")', app: 2, urgency: null, view: "%E2%9C%85%20Active%20Dealers" }
    ];

    items.forEach(function (kpi) {
      var card = document.createElement("a");
      card.className = "zp-kpi";
      card.href = DOMAIN + "/k/" + kpi.app + "/" + (kpi.view ? "?view=" + kpi.view : "");
      card.innerHTML =
        '<div class="zp-kpi-lbl"><span class="zp-kpi-dot" style="background:' + kpi.color + '"></span> ' + kpi.label + '</div>' +
        '<div class="zp-kpi-val zp-loading" data-k="' + kpi.key + '">â</div>';
      el.appendChild(card);

      fetchCount(kpi.app, kpi.query).then(function (n) {
        var v = card.querySelector("[data-k='" + kpi.key + "']");
        v.textContent = n; v.classList.remove("zp-loading");
        v.style.color = kpi.color;
        if (kpi.urgency && n >= kpi.urgency.warn) {
          var a = document.createElement("span");
          a.className = "zp-kpi-alert";
          a.textContent = n >= kpi.urgency.crit ? "Urgent" : "Action needed";
          a.style.background = n >= kpi.urgency.crit ? "#fef2f2" : "#fffbeb";
          a.style.color = n >= kpi.urgency.crit ? "#dc2626" : "#d97706";
          v.appendChild(a);
        }
      }).catch(function () {});
    });
    return el;
  }

  function buildApps() {
    var el = document.createElement("div");
    el.className = "zp-apps";
    Object.keys(APPS).forEach(function (key) {
      var app = APPS[key];
      var card = document.createElement("a");
      card.className = "zp-app";
      card.href = DOMAIN + "/k/" + app.id + "/";
      card.innerHTML =
        '<div class="zp-app-icon" style="background:' + app.color + '10;color:' + app.color + '">' + app.icon + '</div>' +
        '<div class="zp-app-name">' + app.label + '</div>' +
        '<div class="zp-app-desc">' + app.desc + '</div>' +
        '<div class="zp-app-meta" data-ac="' + app.id + '">â</div>';
      el.appendChild(card);
      fetchCount(app.id, "").then(function (n) { card.querySelector("[data-ac]").textContent = n + " records"; });
    });
    return el;
  }

  function buildWorkflow() {
    var wrap = document.createElement("div");
    wrap.className = "zp-wf-wrap";

    var W = 780, H = 185, nw = 76, nh = 40, gap = 12, mainY = 35, rejY = 130, startX = 12;
    var pos = {};
    WORKFLOW_MAIN.forEach(function (n, i) { pos[n.id] = { x: startX + i * (nw + gap), y: mainY }; });
    pos.rejected = { x: pos.pending.x, y: rejY };

    var s = [];
    s.push('<svg class="zp-wf-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">');
    s.push('<text x="' + W / 2 + '" y="16" text-anchor="middle" fill="#a8a29e" font-size="10" font-family="DM Sans,sans-serif" font-weight="500" letter-spacing="0.5">Click any stage to view orders</text>');

    // Edges
    for (var i = 0; i < WORKFLOW_MAIN.length - 1; i++) {
      var a = pos[WORKFLOW_MAIN[i].id], b = pos[WORKFLOW_MAIN[i + 1].id];
      var x1 = a.x + nw + 1, y1 = a.y + nh / 2, x2 = b.x - 1, y2 = b.y + nh / 2;
      s.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + (x2 - 4) + '" y2="' + y2 + '" class="zp-wf-edge"/>');
      s.push('<polygon points="' + x2 + ',' + y2 + ' ' + (x2 - 5) + ',' + (y2 - 3) + ' ' + (x2 - 5) + ',' + (y2 + 3) + '" class="zp-wf-edge-head"/>');
    }

    // Rejected edge
    var pp = pos.pending, rp = pos.rejected;
    var pcx = pp.x + nw / 2;
    s.push('<line x1="' + pcx + '" y1="' + (pp.y + nh) + '" x2="' + pcx + '" y2="' + (rp.y - 1) + '" class="zp-wf-edge zp-wf-rej-edge"/>');
    s.push('<polygon points="' + pcx + ',' + rp.y + ' ' + (pcx - 3) + ',' + (rp.y - 5) + ' ' + (pcx + 3) + ',' + (rp.y - 5) + '" fill="#fca5a5"/>');

    // Resubmit curve
    var rx = rp.x + nw + 2, ry = rp.y + nh / 2, px2 = pp.x + nw + 2, py2 = pp.y + nh / 2;
    s.push('<path d="M' + rx + ',' + ry + ' C' + (rx + 28) + ',' + ry + ' ' + (px2 + 28) + ',' + py2 + ' ' + px2 + ',' + py2 + '" class="zp-wf-edge zp-wf-rej-edge"/>');
    s.push('<text x="' + (rx + 6) + '" y="' + (ry - 16) + '" fill="#fca5a5" font-size="9" font-family="DM Sans,sans-serif" font-style="italic" font-weight="500">Resubmit</text>');

    // Nodes â using data-status attribute for click handling instead of <a> links
    ALL_WORKFLOW.forEach(function (node) {
      var p = pos[node.id], cx = p.x + nw / 2, cy = p.y + nh / 2;

      s.push('<g class="zp-wf-node" data-wf-click="' + node.id + '">');
      s.push('<rect class="wf-bg" x="' + p.x + '" y="' + p.y + '" width="' + nw + '" height="' + nh + '" rx="8" fill="' + node.color + '" style="transition:filter 0.15s"/>');

      if (node.sub) {
        s.push('<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="10" font-weight="600" font-family="DM Sans,sans-serif">' + node.label + '</text>');
        s.push('<text x="' + cx + '" y="' + (cy + 7) + '" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,0.75)" font-size="8.5" font-weight="500" font-family="DM Sans,sans-serif">' + node.sub + '</text>');
      } else {
        s.push('<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="10" font-weight="600" font-family="DM Sans,sans-serif">' + node.label + '</text>');
      }

      s.push('<text x="' + cx + '" y="' + (p.y + nh + 13) + '" text-anchor="middle" fill="' + node.color + '" font-size="11" font-weight="700" font-family="DM Sans,sans-serif" data-ws="' + node.status + '"></text>');
      s.push('</g>');
    });

    s.push('</svg>');
    wrap.innerHTML = s.join("");

    // Attach click handlers to SVG nodes
    ALL_WORKFLOW.forEach(function (node) {
      var g = wrap.querySelector('[data-wf-click="' + node.id + '"]');
      if (g) {
        g.addEventListener("click", function (e) {
          e.preventDefault();
          openModal(node);
        });
      }
    });

    // Load counts
    ALL_WORKFLOW.forEach(function (node) {
      fetchCount(3, 'Status in ("' + node.status + '")').then(function (n) {
        var el = wrap.querySelector('[data-ws="' + node.status + '"]');
        if (el && n > 0) el.textContent = n;
      });
    });

    return wrap;
  }

  function buildAnnouncements() {
    var container = document.createElement("div");
    container.className = "zp-ann";
    fetchRecords(4, 'is_active in ("Yes") order by is_pinned desc, priority asc limit 5',
      ["title", "category", "is_pinned", "publish_date", "Record_number"]
    ).then(function (records) {
      records.forEach(function (r) {
        var cat = r.category.value || "General";
        var cc = CAT_COLORS[cat] || CAT_COLORS.General;
        var pinned = r.is_pinned.value === "Yes";
        var item = document.createElement("a");
        item.className = "zp-ann-item";
        item.href = DOMAIN + "/k/4/show#record=" + r.Record_number.value;
        item.innerHTML =
          (pinned ? '<span class="zp-ann-pin">ð</span>' : '') +
          '<span class="zp-ann-badge" style="background:' + cc.bg + ';color:' + cc.fg + '">' + cat + '</span>' +
          '<span class="zp-ann-title">' + r.title.value + '</span>' +
          '<span class="zp-ann-date">' + fmtDate(r.publish_date.value) + '</span>';
        container.appendChild(item);
      });
      var more = document.createElement("a");
      more.className = "zp-ann-more";
      more.href = DOMAIN + "/k/4/";
      more.textContent = "View all announcements â";
      container.appendChild(more);
    }).catch(function () {});
    return container;
  }

  function buildQuickActions() {
    var el = document.createElement("div");
    el.className = "zp-qa";
    var actions = [
      { icon: "ð", bg: "#fef3c7", text: "Pending My Approval", sub: "Awaiting your action", href: "/k/3/?view=%F0%9F%93%8B%20Pending%20My%20Approval" },
      { icon: "ð³", bg: "#fce7f3", text: "Unpaid Orders", sub: "Payment follow-ups", href: "/k/3/?view=%F0%9F%92%B3%20Unpaid%20Orders" },
      { icon: "ð¦", bg: "#dbeafe", text: "Warehouse Pipeline", sub: "Picking â Ready â Done", href: "/k/3/?view=%F0%9F%93%A6%20Warehouse%20Pipeline" },
      { icon: "ð¢", bg: "#d1fae5", text: "Active Products", sub: "Full catalog", href: "/k/1/?view=%F0%9F%9F%A2%20Active%20Products" },
      { icon: "â ï¸", bg: "#fef9c3", text: "Low Stock Items", sub: "â¤ 50 units left", href: "/k/1/?view=%E2%9A%A0%EF%B8%8F%20Low%20Stock%20(%E2%89%A450)" },
      { icon: "ð°", bg: "#fee2e2", text: "Outstanding Balances", sub: "Dealers with balances", href: "/k/2/?view=%E2%9A%A0%EF%B8%8F%20Outstanding%20Balances" },
      { icon: "ð", bg: "#d1fae5", text: "Holiday Calendar", sub: "2026 PH holidays", href: "/k/5/?view=%F0%9F%93%85%20All%20Holidays" },
      { icon: "ð", bg: "#ede9fe", text: "Dealer User Guide", sub: "Ordering manual", href: "/k/4/?view=%F0%9F%93%96%20Guides" }
    ];
    actions.forEach(function (a) {
      var card = document.createElement("a");
      card.className = "zp-qa-item";
      card.href = DOMAIN + a.href;
      card.innerHTML =
        '<div class="zp-qa-icon" style="background:' + a.bg + '">' + a.icon + '</div>' +
        '<div><div class="zp-qa-text">' + a.text + '</div><div class="zp-qa-sub">' + a.sub + '</div></div>';
      el.appendChild(card);
    });
    return el;
  }

  function sectionHead(title, meta) {
    var el = document.createElement("div");
    el.className = "zp-sh";
    el.innerHTML = '<div class="zp-sh-title">' + title + '</div>' + (meta ? '<div class="zp-sh-meta">' + meta + '</div>' : '');
    return el;
  }

  // ââââââââââââââââââââââââââââââââââââââ
  // RENDER
  // ââââââââââââââââââââââââââââââââââââââ
  kintone.events.on("portal.show", function () {
    var space = kintone.portal.getContentSpaceElement();
    if (!space) return;

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = document.createElement("div");
    root.id = "zagu-portal";

    var user = kintone.getLoginUser();

    var hdr = document.createElement("div");
    hdr.className = "zp-header";
    hdr.innerHTML =
      '<div class="zp-logo">Z</div>' +
      '<div class="zp-header-text"><h1>Zagu Ordering System</h1><p>Dealer Order Management & Fulfillment</p></div>' +
      '<div class="zp-greeting">' + greet() + ', <strong>' + (user.name || "User") + '</strong></div>';
    root.appendChild(hdr);

    root.appendChild(buildKPIs());
    root.appendChild(sectionHead("Applications"));
    root.appendChild(buildApps());
    root.appendChild(sectionHead("Order Workflow"));
    root.appendChild(buildWorkflow());
    root.appendChild(sectionHead("Latest Announcements", "News & Updates"));
    root.appendChild(buildAnnouncements());
    root.appendChild(sectionHead("Quick Actions"));
    root.appendChild(buildQuickActions());

    var ft = document.createElement("div");
    ft.className = "zp-footer";
    ft.innerHTML =
      '<span>Zagu Ordering System Â· Powered by Kintone Â· Built by Edamame Inc.</span>' +
      '<span>Updated ' + fmtTime() + ' &nbsp;<button class="zp-refresh" onclick="location.reload()">â» Refresh</button></span>';
    root.appendChild(ft);

    space.appendChild(root);
  });
})();
