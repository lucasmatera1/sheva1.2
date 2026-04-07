#!/usr/bin/env bash
# ===========================================================================
#  Sheva Platform – Redeploy / Update
#  Uso: ./redeploy.sh          (pull + build + restart)
#        ./redeploy.sh --quick  (pull + restart, sem rebuild)
# ===========================================================================
set -euo pipefail

APP_DIR="/home/sheva"
QUICK=false

if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

cd "$APP_DIR"

echo ""
echo "=== Sheva Redeploy $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

# ---- 1. Pull ---------------------------------------------------------------
echo "[1] Atualizando codigo..."
git pull --ff-only
echo ""

# ---- 2. Dependencias -------------------------------------------------------
if [ "$QUICK" = false ]; then
  echo "[2] Instalando dependencias..."
  npm ci --omit=dev 2>/dev/null || npm install
  echo ""

  # ---- 3. Build ---------------------------------------------------------------
  echo "[3] Buildando..."
  npm run build
  echo ""
else
  echo "[2] --quick: Pulando install + build"
  echo ""
fi

# ---- 4. Restart PM2 --------------------------------------------------------
echo "[4] Reiniciando PM2..."
pm2 restart ecosystem.config.cjs
echo ""

# ---- 5. Health Check -------------------------------------------------------
echo "[5] Verificando health..."
sleep 3

API_OK=false
for i in 1 2 3 4 5; do
  if curl -sf http://localhost:4013/api/health > /dev/null 2>&1; then
    API_OK=true
    break
  fi
  sleep 2
done

if [ "$API_OK" = true ]; then
  echo "  API: OK"
else
  echo "  API: FALHOU (verifique: pm2 logs sheva-api)"
fi

PORTAL_OK=false
for i in 1 2 3 4 5; do
  if curl -sf http://localhost:3005 > /dev/null 2>&1; then
    PORTAL_OK=true
    break
  fi
  sleep 2
done

if [ "$PORTAL_OK" = true ]; then
  echo "  Portal: OK"
else
  echo "  Portal: FALHOU (verifique: pm2 logs sheva-portal)"
fi

echo ""
echo "=== Redeploy concluido ==="
pm2 status
