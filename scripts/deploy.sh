#!/usr/bin/env bash
# ===========================================================================
#  Sheva Platform – Deploy inicial num VPS Ubuntu limpo
#  Uso: scp este script para o servidor e rode:
#    chmod +x deploy.sh && sudo ./deploy.sh
# ===========================================================================
set -euo pipefail

APP_DIR="/home/sheva"
REPO_URL="${1:-}"  # Passa a URL do repo como argumento, ou faz upload manual
NODE_MAJOR=20

echo "============================================="
echo "  Sheva Platform – Deploy Automatizado"
echo "============================================="

# ---- 1. Dependências do sistema -------------------------------------------
echo ""
echo "[1/8] Instalando dependencias do sistema..."
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx build-essential

# ---- 2. Node.js -----------------------------------------------------------
echo ""
echo "[2/8] Instalando Node.js ${NODE_MAJOR}..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt $NODE_MAJOR ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v)  npm: $(npm -v)"

# ---- 3. PM2 ---------------------------------------------------------------
echo ""
echo "[3/8] Instalando PM2..."
npm install -g pm2 --silent

# ---- 4. Projeto -----------------------------------------------------------
echo ""
echo "[4/8] Configurando projeto em ${APP_DIR}..."
if [ -n "$REPO_URL" ]; then
  if [ -d "$APP_DIR/.git" ]; then
    echo "  Repo ja existe, fazendo pull..."
    cd "$APP_DIR"
    git pull --ff-only
  else
    echo "  Clonando repo..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
else
  if [ ! -d "$APP_DIR" ]; then
    echo "  ERRO: Diretorio ${APP_DIR} nao encontrado e nenhum REPO_URL fornecido."
    echo "  Uso: ./deploy.sh https://github.com/seu/repo.git"
    echo "  Ou copie o projeto para ${APP_DIR} manualmente antes de rodar."
    exit 1
  fi
  cd "$APP_DIR"
fi

# ---- 5. Dependências do projeto ------------------------------------------
echo ""
echo "[5/9] Instalando dependencias do projeto..."
npm ci --omit=dev 2>/dev/null || npm install

# ---- 6. Arquivo .env ------------------------------------------------------
echo ""
echo "[6/9] Verificando .env..."
if [ ! -f ".env" ]; then
  if [ -f ".env.production" ]; then
    cp .env.production .env
    echo "  .env.production copiado para .env"
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════╗"
    echo "  ║  ACAO NECESSARIA: Edite o .env com seus dados reais!    ║"
    echo "  ║  nano ${APP_DIR}/.env                                   ║"
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo ""
    read -p "  Pressione ENTER quando tiver editado o .env..." _
  else
    echo "  ERRO: Nenhum .env ou .env.production encontrado!"
    exit 1
  fi
else
  echo "  .env ja existe, mantendo."
fi

# ---- 7. Prisma Generate ---------------------------------------------------
echo ""
echo "[7/9] Gerando Prisma Client..."
npm run prisma:generate
echo "  Prisma Client gerado."

# ---- 8. Build --------------------------------------------------------------
echo ""
echo "[8/9] Buildando o projeto..."
npm run build
echo "  Build concluido."

# ---- 9. Nginx --------------------------------------------------------------
echo ""
echo "[9/9] Configurando Nginx e PM2..."
if [ -f "scripts/nginx-sheva.conf" ]; then
  cp scripts/nginx-sheva.conf /etc/nginx/sites-available/sheva
  ln -sf /etc/nginx/sites-available/sheva /etc/nginx/sites-enabled/sheva
  # Remove default site if it exists
  rm -f /etc/nginx/sites-enabled/default
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  Nginx configurado e recarregado."
  else
    echo "  AVISO: nginx -t falhou. Verifique /etc/nginx/sites-available/sheva"
  fi
else
  echo "  AVISO: scripts/nginx-sheva.conf nao encontrado, Nginx nao configurado."
fi

# ---- PM2 -------------------------------------------------------------------
pm2 stop ecosystem.config.cjs 2>/dev/null || true
pm2 delete ecosystem.config.cjs 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Auto-start PM2 on boot
pm2 startup systemd -u root --hp /root 2>/dev/null || true
pm2 save

echo ""
echo "============================================="
echo "  Deploy concluido!"
echo "  API:    http://localhost:4013"
echo "  Portal: http://localhost:3005"
echo "============================================="

# Auto-start no boot
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "============================================="
echo "  Deploy concluido!"
echo ""
echo "  API:    http://localhost:4013/api/health"
echo "  Portal: http://localhost:3005"
echo ""
echo "  Comandos uteis:"
echo "    pm2 status          – ver processos"
echo "    pm2 logs            – ver logs em tempo real"
echo "    pm2 restart all     – reiniciar tudo"
echo ""
echo "  Proximo passo: configurar Nginx + HTTPS"
echo "    nano /etc/nginx/sites-available/sheva"
echo "    sudo certbot --nginx"
echo "============================================="
