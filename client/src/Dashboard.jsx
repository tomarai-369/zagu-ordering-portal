import { useState, useMemo } from "react";
import Chart from "react-apexcharts";
import {
  TrendingUp, Package, DollarSign, Clock, CheckCircle, XCircle,
  BarChart3, ShoppingBag,
} from "lucide-react";

const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export default function Dashboard({ orders, dealer }) {
  const [timeRange, setTimeRange] = useState("all");

  const filteredOrders = useMemo(() => {
    if (timeRange === "all") return orders;
    const now = new Date();
    const cutoff = new Date();
    if (timeRange === "7d") cutoff.setDate(now.getDate() - 7);
    else if (timeRange === "30d") cutoff.setDate(now.getDate() - 30);
    else if (timeRange === "90d") cutoff.setDate(now.getDate() - 90);
    return orders.filter((o) => new Date(o.date) >= cutoff);
  }, [orders, timeRange]);

  const submitted = filteredOrders.filter((o) => !o.isDraft);
  const totalSpent = submitted.reduce((s, o) => s + o.total, 0);
  const avgOrder = submitted.length > 0 ? totalSpent / submitted.length : 0;
  const pendingCount = submitted.filter((o) => ["Submitted", "Pending ONB Approval"].includes(o.status)).length;
  const completedCount = submitted.filter((o) => o.status === "Completed").length;
  const rejectedCount = submitted.filter((o) => o.status === "Rejected").length;

  // Status distribution (pie)
  const statusCounts = {};
  submitted.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const statusLabels = Object.keys(statusCounts);
  const statusSeries = Object.values(statusCounts);
  const STATUS_COLORS = {
    "Submitted": "#3B82F6", "Pending ONB Approval": "#F59E0B", "Approved": "#22C55E",
    "Posted to SAP": "#8B5CF6", "Picking": "#06B6D4", "Ready for Pickup": "#10B981",
    "Completed": "#059669", "Rejected": "#DC2626",
  };

  // Spending over time (area)
  const monthlySpend = {};
  submitted.forEach((o) => {
    const month = o.date?.substring(0, 7); // YYYY-MM
    if (month) monthlySpend[month] = (monthlySpend[month] || 0) + o.total;
  });
  const spendMonths = Object.keys(monthlySpend).sort();
  const spendValues = spendMonths.map((m) => monthlySpend[m]);

  // Top products
  const productTotals = {};
  submitted.forEach((o) => {
    o.items?.forEach((item) => {
      const key = item.name || item.code;
      if (!productTotals[key]) productTotals[key] = { name: key, qty: 0, total: 0 };
      productTotals[key].qty += item.qty;
      productTotals[key].total += item.total;
    });
  });
  const topProducts = Object.values(productTotals).sort((a, b) => b.total - a.total).slice(0, 8);

  // Orders by payment method
  const paymentCounts = {};
  submitted.forEach((o) => { paymentCounts[o.payment] = (paymentCounts[o.payment] || 0) + 1; });

  const chartTheme = {
    chart: { toolbar: { show: false }, fontFamily: "Varela Round, sans-serif", background: "transparent" },
    colors: ["#D4A017", "#8B5E3C", "#2E86AB", "#A23B72", "#16A34A", "#F59E0B"],
    grid: { borderColor: "#F0E8D8", strokeDashArray: 3 },
  };

  return (
    <div className="dashboard">
      <div className="dash-header">
        <h2 className="section-title"><BarChart3 size={20} /> Dashboard</h2>
        <div className="time-filters">
          {[["7d", "7 Days"], ["30d", "30 Days"], ["90d", "90 Days"], ["all", "All Time"]].map(([val, label]) => (
            <button key={val} className={`time-btn ${timeRange === val ? "active" : ""}`} onClick={() => setTimeRange(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#D4A01715", color: "#D4A017" }}><ShoppingBag size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{submitted.length}</div><div className="kpi-label">Total Orders</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#8B5E3C15", color: "#8B5E3C" }}><DollarSign size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{peso(totalSpent)}</div><div className="kpi-label">Total Spent</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#2E86AB15", color: "#2E86AB" }}><TrendingUp size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{peso(avgOrder)}</div><div className="kpi-label">Avg Order Value</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#F59E0B15", color: "#F59E0B" }}><Clock size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{pendingCount}</div><div className="kpi-label">Pending</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#22C55E15", color: "#22C55E" }}><CheckCircle size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{completedCount}</div><div className="kpi-label">Completed</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#DC262615", color: "#DC2626" }}><XCircle size={20} /></div>
          <div className="kpi-info"><div className="kpi-value">{rejectedCount}</div><div className="kpi-label">Rejected</div></div>
        </div>
      </div>

      {/* Charts row */}
      <div className="charts-row">
        {spendMonths.length > 1 && (
          <div className="card chart-card">
            <div className="card-header">Spending Over Time</div>
            <Chart type="area" height={260} options={{
              ...chartTheme, xaxis: { categories: spendMonths.map((m) => { const [y, mo] = m.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo)-1]} ${y}`; }) },
              yaxis: { labels: { formatter: (v) => `₱${(v/1000).toFixed(0)}K` } },
              dataLabels: { enabled: false },
              stroke: { curve: "smooth", width: 2 },
              fill: { type: "gradient", gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
              tooltip: { y: { formatter: (v) => peso(v) } },
            }} series={[{ name: "Spending", data: spendValues }]} />
          </div>
        )}

        {statusLabels.length > 0 && (
          <div className="card chart-card">
            <div className="card-header">Orders by Status</div>
            <Chart type="donut" height={260} options={{
              ...chartTheme, labels: statusLabels,
              colors: statusLabels.map((s) => STATUS_COLORS[s] || "#888"),
              legend: { position: "bottom", fontSize: "11px" },
              plotOptions: { pie: { donut: { size: "60%", labels: { show: true, total: { show: true, label: "Orders", fontSize: "12px" } } } } },
            }} series={statusSeries} />
          </div>
        )}
      </div>

      {/* Top products + payment methods */}
      <div className="charts-row">
        {topProducts.length > 0 && (
          <div className="card chart-card wide">
            <div className="card-header">Top Products</div>
            <Chart type="bar" height={280} options={{
              ...chartTheme, plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "65%" } },
              xaxis: { categories: topProducts.map((p) => p.name.length > 25 ? p.name.substring(0, 25) + "…" : p.name) },
              yaxis: { labels: { style: { fontSize: "10px" } } },
              dataLabels: { enabled: true, formatter: (v) => peso(v), style: { fontSize: "10px" } },
              tooltip: { y: { formatter: (v) => peso(v) } },
            }} series={[{ name: "Revenue", data: topProducts.map((p) => p.total) }]} />
          </div>
        )}

        {Object.keys(paymentCounts).length > 0 && (
          <div className="card chart-card">
            <div className="card-header">Payment Methods</div>
            <Chart type="pie" height={260} options={{
              ...chartTheme, labels: Object.keys(paymentCounts),
              legend: { position: "bottom", fontSize: "11px" },
            }} series={Object.values(paymentCounts)} />
          </div>
        )}
      </div>

      {orders.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "60px 20px", color: "#999" }}>
          <Package size={48} strokeWidth={1} />
          <p style={{ marginTop: 12 }}>No order data yet. Place orders to see your analytics.</p>
        </div>
      )}
    </div>
  );
}
