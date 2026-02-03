# 🥤 Zagu Shakes — Dealer Ordering Portal

A Kintone-powered online ordering system for Zagu Shakes authorized dealers. Built with React + Express, backed by Kintone apps for products, dealers, and order management.

![Zagu Portal](https://img.shields.io/badge/Kintone-Powered-F5A623?style=flat-square) ![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square) ![Express](https://img.shields.io/badge/Express-4-000?style=flat-square)

## Features

- **Dealer Authentication** — Login with dealer code & password, validated against Kintone
- **Product Catalog** — Browse products by category, search, view stock levels
- **Shopping Cart** — Add/remove items, adjust quantities, running totals
- **Checkout** — Payment method selection (Online/Cash/Credit Terms), order notes
- **Order Submission** — Creates records in Kintone Orders app with subtable line items
- **Process Management** — Orders follow: New → Pending Approval → Approved/Rejected
- **Order History** — View past orders with status tracking
- **Mobile Responsive** — Works on phones, tablets, and desktops

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React Frontend │────▶│ Express Proxy │────▶│ Kintone REST API│
│  (Vite + React) │     │  (Node.js)   │     │                 │
│  Port 5173      │     │  Port 3001   │     │  Products (#1)  │
└─────────────────┘     └──────────────┘     │  Dealers  (#2)  │
                                              │  Orders   (#3)  │
                                              └─────────────────┘
```

The Express proxy handles Kintone API authentication server-side, keeping API tokens secure and bypassing CORS restrictions.

## Quick Start

### Prerequisites
- Node.js 18+
- A Kintone environment with Products, Dealers, and Orders apps configured

### 1. Clone & Install

```bash
git clone https://github.com/your-org/zagu-ordering-portal.git
cd zagu-ordering-portal
npm run install:all
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Kintone credentials:

```env
KINTONE_BASE_URL=https://your-subdomain.kintone.com
KINTONE_PRODUCTS_APP_ID=1
KINTONE_DEALERS_APP_ID=2
KINTONE_ORDERS_APP_ID=3
KINTONE_PRODUCTS_TOKEN=your_token_here
KINTONE_DEALERS_TOKEN=your_token_here
KINTONE_ORDERS_TOKEN=your_token_here
```

### 3. Run Development

```bash
npm run dev
```

This starts both the Express proxy (port 3001) and Vite dev server (port 5173) concurrently.

Open **http://localhost:5173**

### 4. Demo Login

| Dealer Code | Store | Password |
|-------------|-------|----------|
| DLR-001 | Zagu SM North EDSA | zagu2026 |
| DLR-002 | Zagu Robinsons Galleria | zagu2026 |
| DLR-003 | Zagu SM Megamall | zagu2026 |
| DLR-004 | Zagu Ayala Center Cebu | zagu2026 |
| DLR-005 | Zagu SM Lanang Davao | zagu2026 |

## Production Build

```bash
npm run build     # Builds React client
npm start         # Starts Express serving the built client
```

The Express server serves the React build from `client/dist/` and proxies API calls to Kintone.

## Kintone App Structure

### Products Master (App #1)
| Field | Code | Type |
|-------|------|------|
| Product Code | `product_code` | Text (unique) |
| Product Name | `product_name` | Text |
| Description | `description` | Text Area |
| Category | `category` | Dropdown |
| Unit Price | `unit_price` | Number |
| Stock Quantity | `stock_qty` | Number |
| Product Image | `product_image` | Attachment |
| Status | `product_status` | Dropdown |

### Dealers Master (App #2)
| Field | Code | Type |
|-------|------|------|
| Dealer Code | `dealer_code` | Text (unique) |
| Store Name | `dealer_name` | Text |
| Contact Person | `contact_person` | Text |
| Email | `email` | Text |
| Phone | `phone` | Text |
| Login Password | `login_password` | Text |
| Region | `region` | Dropdown |
| Address | `address` | Text Area |
| Status | `dealer_status` | Dropdown |

### Orders (App #3)
| Field | Code | Type |
|-------|------|------|
| Order Date | `order_date` | Date |
| Dealer Code | `dealer_lookup` | Lookup → Dealers |
| Dealer Name | `dealer_name_display` | Text (auto) |
| Region | `dealer_region_display` | Text (auto) |
| Payment Method | `payment_method` | Dropdown |
| **Subtable: Order Items** | `order_items` | |
| ↳ Product Code | `product_lookup` | Lookup → Products |
| ↳ Product Name | `product_name_display` | Text (auto) |
| ↳ Qty | `quantity` | Number |
| ↳ Unit Price | `item_unit_price` | Number (auto) |
| ↳ Line Total | `line_total` | Calc |
| Total Amount | `total_amount` | Calc (SUM) |
| Notes | `notes` | Text Area |

**Process Management:** New → Pending Approval → Approved / Rejected

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Dealer login |
| GET | `/api/:app/records` | Get records |
| GET | `/api/:app/record/:id` | Get single record |
| POST | `/api/:app/record` | Create record |
| PUT | `/api/:app/record` | Update record |

## Tech Stack

- **Frontend:** React 18, Vite, Lucide Icons
- **Backend:** Express.js, Node.js
- **Database:** Kintone (No-Code Platform)
- **Fonts:** DM Sans, Playfair Display

## License

MIT

---

Built by [Edamame Inc.](https://edamame-jp.com) — Cybozu/Kintone Partner, Philippines
