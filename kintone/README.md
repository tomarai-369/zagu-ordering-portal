# Kintone Configuration Exports

App schema exports from `zagushakes.kintone.com`. These serve as version-controlled backups
and reference documentation for the Kintone back-office configuration.

## Apps

| App | ID | Description |
|-----|-----|-------------|
| Products Master | 1 | SKU catalog, pricing, stock, images |
| Dealers Master | 2 | Dealer accounts, credentials, MFA, FCM tokens, regions |
| Orders | 3 | Order records with line items, workflow, fulfillment |
| Announcements | 4 | News, promos, guides for dealer portal |
| Holiday Calendar | 5 | PH holidays for order blocking |

## Files per App

- `app{N}_fields.json` — Field definitions (codes, types, options)
- `app{N}_views.json` — Saved views/filters
- `app{N}_layout.json` — Form layout (field arrangement, groups, subtables)
- `app{N}_status.json` — Process management (statuses, actions, assignees)
- `app{N}_settings.json` — App name, description, icon, theme
- `app{N}_customize.json` — App-level JS/CSS customization

## Portal Customization

- `portal-v6.js` — Latest portal dashboard (v6: 5 KPIs with revenue, peak banner, animated counts, region drilldown)
- `portal-live.js` — Currently deployed portal JS (served from CF Worker at `/portal.js`)

## System-Wide JS (Kintone Admin > System > Customize)

Currently loaded (in order):
1. `kintone-yellow-bar-theme.js` (contentId=3) — Yellow header bar theme
2. Portal JS (contentId=122) — Custom portal dashboard

## Re-exporting

```bash
# Fields
curl -s "https://zagushakes.kintone.com/k/v1/app/form/fields.json?app=<ID>" \
  -H "X-Cybozu-Authorization: <base64>" | python3 -m json.tool > app<ID>_fields.json

# Views, layout, status, settings, customize — same pattern with respective endpoints
```
