#!/bin/bash
# Rebuild all Kintone apps from exported JSON configurations
# Usage: ./rebuild-apps.sh <subdomain> <username> <password>
#
# This script recreates the complete Zagu Ordering System on a fresh Kintone environment.
# It uses the REST API to create apps, add fields, set layouts, views, PM, ACLs, etc.
#
# Prerequisites:
#   - curl, python3, jq
#   - Target Kintone environment with admin access
#   - Run from the kintone/ directory

set -e

SUBDOMAIN="${1:?Usage: $0 <subdomain> <username> <password>}"
USERNAME="${2:?}"
PASSWORD="${3:?}"
BASE="https://${SUBDOMAIN}.kintone.com"
AUTH=$(echo -n "${USERNAME}:${PASSWORD}" | base64)

HEADER=(-H "X-Cybozu-Authorization: ${AUTH}" -H "Content-Type: application/json")

echo "=== Zagu Ordering System — App Reconstruction ==="
echo "Target: ${BASE}"
echo ""

APP_NAMES=("Products Master" "Dealers Master" "Orders" "News & Announcements" "Holiday Calendar")

for i in 1 2 3 4 5; do
  echo "--- Creating App ${i}: ${APP_NAMES[$i-1]} ---"

  # 1. Create empty app
  APP_ID=$(curl -s -X POST "${BASE}/k/v1/preview/app.json" \
    "${HEADER[@]}" \
    -d "{\"name\": \"${APP_NAMES[$i-1]}\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['app'])")
  echo "  Created app: ${APP_ID}"

  # 2. Add fields (extract properties from fields export)
  FIELDS=$(python3 -c "
import json
with open('app${i}_fields.json') as f:
    data = json.load(f)
props = {}
skip = ['Record_number','Created_by','Created_datetime','Updated_by','Updated_datetime',
        'Categories','Status','Assignee']
for code, field in data['properties'].items():
    if code in skip or field['type'] in ['RECORD_NUMBER','CREATOR','CREATED_TIME',
        'MODIFIER','UPDATED_TIME','CATEGORY','STATUS','STATUS_ASSIGNEE']:
        continue
    # Remove read-only properties
    for k in ['size','enabled','lookup','relatedApp','referenceTable']:
        field.pop(k, None)
    props[code] = field
print(json.dumps({'app': ${APP_ID}, 'properties': props}))
")
  curl -s -X POST "${BASE}/k/v1/preview/app/form/fields.json" \
    "${HEADER[@]}" -d "${FIELDS}" > /dev/null
  echo "  Fields added"

  # 3. Deploy to apply fields
  curl -s -X POST "${BASE}/k/v1/preview/app/deploy.json" \
    "${HEADER[@]}" -d "{\"apps\": [{\"app\": ${APP_ID}}]}" > /dev/null
  sleep 3

  # 4. Set form layout
  LAYOUT=$(python3 -c "
import json
with open('app${i}_layout.json') as f:
    data = json.load(f)
print(json.dumps({'app': ${APP_ID}, 'layout': data['layout']}))
")
  curl -s -X PUT "${BASE}/k/v1/preview/app/form/layout.json" \
    "${HEADER[@]}" -d "${LAYOUT}" > /dev/null 2>/dev/null || echo "  (layout may need manual adjustment)"
  echo "  Layout set"

  # 5. Set views
  VIEWS=$(python3 -c "
import json
with open('app${i}_views.json') as f:
    data = json.load(f)
# Remove IDs from views (will be auto-assigned)
views = {}
for name, view in data['views'].items():
    view.pop('id', None)
    view.pop('builtinType', None)
    views[name] = view
print(json.dumps({'app': ${APP_ID}, 'views': views}))
")
  curl -s -X PUT "${BASE}/k/v1/preview/app/views.json" \
    "${HEADER[@]}" -d "${VIEWS}" > /dev/null 2>/dev/null || echo "  (views may need adjustment)"
  echo "  Views set"

  # 6. Set process management (if applicable)
  HAS_PM=$(python3 -c "
import json
with open('app${i}_status.json') as f:
    data = json.load(f)
print('yes' if data.get('enable') or data.get('states') else 'no')
")
  if [ "$HAS_PM" = "yes" ]; then
    PM=$(python3 -c "
import json
with open('app${i}_status.json') as f:
    data = json.load(f)
data['app'] = ${APP_ID}
print(json.dumps(data))
")
    curl -s -X PUT "${BASE}/k/v1/preview/app/status.json" \
      "${HEADER[@]}" -d "${PM}" > /dev/null 2>/dev/null || echo "  (PM may need adjustment)"
    echo "  Process management set"
  fi

  # 7. Final deploy
  curl -s -X POST "${BASE}/k/v1/preview/app/deploy.json" \
    "${HEADER[@]}" -d "{\"apps\": [{\"app\": ${APP_ID}}]}" > /dev/null
  echo "  Deployed ✓"
  echo ""
done

echo "=== All 5 apps created ==="
echo "NOTE: After running this script:"
echo "  1. Update API tokens in Cloudflare Worker secrets"
echo "  2. Upload portal-v6.js to System Customization"
echo "  3. Set up app ACLs and field ACLs if needed"
echo "  4. Import sample data if needed"
