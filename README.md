# 🥤 Zagu Shakes — Dealer Ordering Portal

A Kintone-powered online ordering system for Zagu Shakes' 465+ authorized dealers. Built with React (Vite) on GitHub Pages, proxied through a Cloudflare Worker to Kintone REST API.

![Kintone](https://img.shields.io/badge/Kintone-Powered-F5A623?style=flat-square) ![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square) ![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square) ![Firebase](https://img.shields.io/badge/Firebase-FCM-FFCA28?style=flat-square)

**Live:** [tomarai-369.github.io/zagu-ordering-portal](https://tomarai-369.github.io/zagu-ordering-portal/)

## Architecture

```
GitHub Pages (React SPA)
        │
        ▼
Cloudflare Worker (API proxy + business logic)
        │
        ├──▶ Kintone REST API (zagushakes.kintone.com)
        │       Apps: Products (#1), Dealers (#2), Orders (#3), News (#4)
        │
        ├──▶ Firebase Cloud Messaging (push notifications)
        │
        └──▶ Resend (transactional email — password reset, order status)
```

## Features

### Dealer-Facing Portal (React SPA)
- **Authentication** — Dealer code + password login, session management, auto-logout
- **MFA** — TOTP via Google Authenticator / Authy
- **Password Management** — Self-service reset via email link, change password, 90-day rotation
- **Product Catalog** — ~300 SKUs organized by category, search, product images
- **Shopping Cart** — Add/remove items, MOQ enforcement (5-pack regular, 1 promo), draft save
- **Order Submission** — Auto-generated order numbers, Sales Order PDF generation
- **Order History** — Full history with status tracking, search, filters
- **Dashboard** — Order summaries, spending trends, ApexCharts visualizations
- **Notifications** — FCM push notifications + email for all order status changes
- **Reports** — Export to Excel (CSV) and PDF, time-based filtering
- **PWA** — Installable on mobile home screen, service worker caching
- **Mobile Responsive** — Phone, tablet, desktop optimized

### Cloudflare Worker API (v2.4)
- **Auth:** `/api/auth/login`, `/api/auth/register`, `/api/auth/change-password`, `/api/auth/forgot-password`, `/api/auth/reset-password`
- **MFA:** `/api/auth/mfa/setup`, `/api/auth/mfa/verify-setup`, `/api/auth/mfa/verify-login`, `/api/auth/mfa/disable`
- **Orders:** `/api/orders/submit-order`, `/api/orders/status`
- **Dealers:** `/api/dealers/status`
- **Data:** `/api/news`, `/api/holidays`, `/api/file`
- **FCM:** `/api/fcm/register`, `/api/fcm/send`
- **Kintone Portal:** `/portal.js` (custom portal dashboard JS)

### Kintone Back-Office
- **Products Master (App #1)** — Item code, description, category, UoM, pricing, images
- **Dealers Master (App #2)** — Dealer profiles, store locations, credentials, FCM tokens, MFA secrets
- **Orders (App #3)** — Order records with line item subtables, status workflow, approval
- **News & Announcements (App #4)** — Broadcast messages to dealers on login

## Project Structure

```
zagu-ordering-portal/
├── client/                  # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx          # Main application (routes, pages, components)
│   │   ├── api.js           # API client (Cloudflare Worker endpoints)
│   │   ├── Dashboard.jsx    # Dealer dashboard with charts
│   │   ├── DealerProfile.jsx # Profile management
│   │   ├── OrderPDF.js      # PDF generation (Sales Orders, Delivery Receipts)
│   │   ├── main.jsx         # Entry point
│   │   └── styles.css       # Global styles
│   ├── public/              # PWA assets, icons, service worker, manifest
│   ├── index.html           # SPA shell
│   ├── package.json
│   └── vite.config.js
├── worker.js                # Cloudflare Worker source (API proxy v2.4)
├── wrangler.toml            # Worker configuration
└── .github/workflows/
    └── deploy.yml           # GitHub Actions → GitHub Pages CI/CD
```

## Development

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm i -g wrangler`) for Worker deployment

### Frontend (React)
```bash
cd client
npm install
npm run dev          # http://localhost:5173
```

### Worker (Cloudflare)
```bash
# Local dev (requires wrangler login)
wrangler dev worker.js

# Deploy to production
wrangler deploy
```

### CI/CD
Push to `main` triggers GitHub Actions which builds the React app and deploys to GitHub Pages. The Cloudflare Worker is deployed separately via `wrangler deploy`.

## Environment

### Worker Secrets (set via `wrangler secret put`)
| Secret | Description |
|--------|-------------|
| `KINTONE_PRODUCTS_TOKEN` | API token for Products app |
| `KINTONE_DEALERS_TOKEN` | API token for Dealers app |
| `KINTONE_ORDERS_TOKEN` | API token for Orders app |
| `KINTONE_AUTH` | Base64-encoded admin credentials |
| `FCM_SERVICE_ACCOUNT` | Firebase service account JSON |
| `FCM_VAPID_KEY` | Web push VAPID public key |
| `RESEND_API_KEY` | Resend.com API key for email |
| `EMAIL_FROM_DOMAIN` | Sender domain for emails |
| `PORTAL_BASE_URL` | Frontend URL for email links |

## Phased Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Core ordering, auth (MFA), notifications, dashboard, reporting, PDF generation | ✅ Complete |
| **Phase 2** | SAP Business One integration (via Direc Business Inc. cloud tunnel) | 🔲 Pending |
| **Phase 3** | Payment gateway (PayMongo — GCash, Maya, credit card, bank transfer) | 🔲 Pending |

## Built By

**Edamame Inc.** — Cybozu Kintone Partner, Philippines
