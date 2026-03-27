# Seed Data

Record exports from all 5 Kintone apps. Use these to populate a new environment.

| File | Records | Description |
|------|---------|-------------|
| `products.json` | 20 | SKU catalog with prices, categories, UoM |
| `dealers.json` | 11 | Dealer accounts (passwords/MFA/tokens REDACTED) |
| `orders.json` | 41 | Order history with line items and status |
| `announcements.json` | 7 | News and guide entries |
| `holidays.json` | 23 | 2026 PH holiday calendar |

**Note:** `dealers.json` has sensitive fields redacted. After import, reset passwords
and reconfigure MFA for each dealer account.

## Importing

```bash
# Import records into a Kintone app using the REST API
AUTH=$(echo -n "user:pass" | base64)

# Products (adjust app ID if different)
python3 -c "
import json, subprocess
data = json.load(open('products.json'))
for r in data['records']:
    # Strip system fields
    for k in ['Record_number','Created_by','Created_datetime','Updated_by','Updated_datetime','$id','$revision']:
        r.pop(k, None)
    # Strip type wrappers, keep only value
    clean = {k: {'value': v['value']} for k, v in r.items() if 'value' in v and v.get('type') not in ['RECORD_NUMBER','CREATOR','CREATED_TIME','MODIFIER','UPDATED_TIME','STATUS','STATUS_ASSIGNEE','CATEGORY']}
    payload = json.dumps({'app': APP_ID, 'record': clean})
    subprocess.run(['curl', '-s', '-X', 'POST', 'https://SUBDOMAIN.kintone.com/k/v1/record.json',
        '-H', 'X-Cybozu-Authorization: ' + AUTH, '-H', 'Content-Type: application/json', '-d', payload])
"
```
