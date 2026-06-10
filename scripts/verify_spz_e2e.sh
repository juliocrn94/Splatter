#!/bin/bash
# E2E: espera build v0.6.0 → re-dispara job → monitorea → verifica .spz formato v2 gzip
set -uo pipefail
cd "/Users/forest/Documents/Developer/Reto 500k/Splatter"

env_get() { grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d ' '; }
APP=$(env_get NEXT_PUBLIC_APP_URL)
PW=$(env_get OPERATOR_PASSWORD)
API=$(env_get RUNPOD_API_KEY)
EP=$(env_get RUNPOD_ENDPOINT_ID)
KEY=$(env_get SUPABASE_SERVICE_ROLE_KEY)
PUB=$(env_get NEXT_PUBLIC_R2_PUBLIC_URL)
PID="4d140d82-b364-406e-9955-153fb9c4c89e"

echo "[1/5] Esperando build de GitHub Actions..."
for i in $(seq 1 16); do
  st=$(gh run list --repo juliocrn94/Splatter --limit 1 --json status,conclusion 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin)[0];print(d['status'],d.get('conclusion',''))" 2>/dev/null)
  echo "  $(date '+%H:%M') $st"
  echo "$st" | grep -q "completed success" && { echo "  build OK, 90s para propagación RunPod"; sleep 90; break; }
  echo "$st" | grep -q "completed failure" && { echo "  BUILD FAILED — abortando"; exit 1; }
  sleep 75
done

echo "[2/5] Re-disparando job (retry)..."
TOKEN=$(curl -s -i -X POST "$APP/api/auth/login" -H "Content-Type: application/json" -d "{\"password\":\"$PW\"}" 2>/dev/null | grep -i "set-cookie" | grep -o 'operator_token=[^;]*' | cut -d= -f2)
curl -s -X POST "$APP/api/projects/$PID/retry" -H "Cookie: operator_token=$TOKEN" >/dev/null 2>&1
sleep 5
JOB=$(curl -s "https://ufbtedxjkibidoqktvcv.supabase.co/rest/v1/projects?id=eq.$PID&select=runpod_job_id" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['runpod_job_id'])")
echo "  job: $JOB"

echo "[3/5] Monitoreando job..."
start=$(date +%s)
while true; do
  st=$(curl -s "https://api.runpod.ai/v2/$EP/status/$JOB" -H "Authorization: Bearer $API" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
  el=$(( $(date +%s) - start ))
  echo "  [${el}s] $st"
  case "$st" in
    COMPLETED) echo "  job COMPLETED"; break;;
    FAILED|CANCELLED|TIMED_OUT) echo "  job $st — abortando"; exit 1;;
  esac
  [ "$el" -gt 1800 ] && { echo "  timeout monitor"; exit 1; }
  sleep 30
done

echo "[4/5] Descargando .spz nuevo y verificando formato..."
sleep 5
curl -s "$PUB/results/$PID.spz" -o /tmp/new.spz
echo "  tamaño: $(ls -la /tmp/new.spz | awk '{print $5}') bytes"
echo "  primeros bytes: $(xxd /tmp/new.spz | head -1)"
python3 -c "
data=open('/tmp/new.spz','rb').read(8)
if data[:2]==b'\x1f\x8b':
    print('  ✅ GZIP detectado (1f 8b) — formato legible por Spark')
    import gzip,struct
    raw=gzip.open('/tmp/new.spz','rb').read(8)
    print('  header descomprimido:', raw.hex(), '| version:', struct.unpack('<I',raw[4:8])[0])
elif data[:4]==b'NGSP':
    print('  ❌ NGSP crudo (sin gzip) — version', __import__('struct').unpack('<I',data[4:8])[0],'— Spark NO lo lee')
else:
    print('  ⚠️ formato desconocido:', data.hex())
"

echo "[5/5] Estado del proyecto:"
curl -s "https://ufbtedxjkibidoqktvcv.supabase.co/rest/v1/projects?id=eq.$PID&select=status,error_message" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -c "import sys,json;d=json.load(sys.stdin)[0];print('  status:',d['status'],'| error:',d['error_message'])"
echo "=== FIN E2E ==="
