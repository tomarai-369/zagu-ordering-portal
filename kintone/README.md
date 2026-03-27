# Kintone Configuration Exports

Full configuration backup from `zagushakes.kintone.com`. These exports enable
complete reconstruction of the Zagu Ordering System on any Kintone environment.

## Apps

| App | ID | Fields | PM | Description |
|-----|-----|--------|-----|-------------|
| Products Master | 1 | 30 | No | SKU catalog, pricing, stock, images |
| Dealers Master | 2 | 33 | Yes (Active/Inactive) | Dealer accounts, credentials, MFA, FCM tokens |
| Orders | 3 | 39 | Yes (8-stage + Rejected) | Order records, line items, workflow, fulfillment |
| Announcements | 4 | 18 | No | News, promos, guides for dealer portal |
| Holiday Calendar | 5 | 14 | No | PH holidays for order date blocking |

## Exports per App (13 files each)

| File | API Endpoint | Purpose |
|------|-------------|---------|
| `app{N}_fields.json` | `/v1/app/form/fields.json` | Field definitions (codes, types, options, defaults) |
| `app{N}_layout.json` | `/v1/app/form/layout.json` | Form layout (rows, groups, subtables) |
| `app{N}_views.json` | `/v1/app/views.json` | Saved views/filters with columns |
| `app{N}_status.json` | `/v1/app/status.json` | Process management (statuses, actions, assignees) |
| `app{N}_settings.json` | `/v1/app/settings.json` | App name, description, icon, theme |
| `app{N}_customize.json` | `/v1/app/customize.json` | App-level JS/CSS customization files |
| `app{N}_acl.json` | `/v1/app/acl.json` | App access permissions |
| `app{N}_record_acl.json` | `/v1/record/acl.json` | Record-level permissions |
| `app{N}_field_acl.json` | `/v1/field/acl.json` | Per-field view/edit permissions |
| `app{N}_actions.json` | `/v1/app/actions.json` | App actions (copy record, etc.) |
| `app{N}_notifications_general.json` | `/v1/app/notifications/general.json` | General notification settings |
| `app{N}_notifications_record.json` | `/v1/app/notifications/perRecord.json` | Per-record notification rules |
| `app{N}_notifications_reminder.json` | `/v1/app/notifications/reminder.json` | Reminder notifications |

## Portal Customization

| File | Lines | Description |
|------|-------|-------------|
| `portal-live.js` | 698 | Currently deployed portal dashboard |
| `portal-v6.js` | 827 | Improved: revenue KPI, peak banner, animated counts, region drilldown |

## Reconstruction

```bash
# Full rebuild on a new Kintone environment
cd kintone/
./rebuild-apps.sh <subdomain> <username> <password>
```

The `rebuild-apps.sh` script creates all 5 apps with fields, layouts, views, and
process management. After running, manually:
1. Generate and set API tokens per app
2. Update Cloudflare Worker secrets with new tokens
3. Upload `portal-v6.js` to System > JavaScript Customization
4. Set app/field/record ACLs if needed
5. Import data (products, dealers, holidays)

## Re-exporting (refresh these files)

```bash
AUTH=$(echo -n "user:pass" | base64)
for APP in 1 2 3 4 5; do
  for EP in fields layout views status settings customize acl actions; do
    URL="form/${EP}" && [[ "$EP" == "views" || "$EP" == "status" || "$EP" == "settings" || "$EP" == "customize" || "$EP" == "acl" || "$EP" == "actions" ]] && URL="$EP"
    [[ "$EP" == "fields" || "$EP" == "layout" ]] && URL="form/$EP"
    curl -s "https://SUBDOMAIN.kintone.com/k/v1/app/${URL}.json?app=$APP" \
      -H "X-Cybozu-Authorization: $AUTH" | python3 -m json.tool > app${APP}_${EP}.json
  done
  # ACLs
  curl -s "https://SUBDOMAIN.kintone.com/k/v1/record/acl.json?app=$APP" -H "X-Cybozu-Authorization: $AUTH" | python3 -m json.tool > app${APP}_record_acl.json
  curl -s "https://SUBDOMAIN.kintone.com/k/v1/field/acl.json?app=$APP" -H "X-Cybozu-Authorization: $AUTH" | python3 -m json.tool > app${APP}_field_acl.json
  # Notifications
  for NT in general perRecord reminder; do
    curl -s "https://SUBDOMAIN.kintone.com/k/v1/app/notifications/${NT}.json?app=$APP" -H "X-Cybozu-Authorization: $AUTH" | python3 -m json.tool > app${APP}_notifications_${NT}.json
  done
done
```
