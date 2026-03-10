#!/bin/bash
# ============================================================
# ALFA Platform — Server Setup Script
# For: Ubuntu 22.04 LTS on your own CPU machine
# Run as root: bash server-setup.sh
# ============================================================

set -e  # Exit on error
echo "🚀 ALFA Server Setup Starting..."

# ─── 1. SYSTEM UPDATE ────────────────────────────────────────
echo "📦 Updating system..."
apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban htop unzip net-tools

# ─── 2. DOCKER INSTALL ───────────────────────────────────────
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose v2
apt install -y docker-compose-plugin

# ─── 3. NODE.JS 20 ───────────────────────────────────────────
echo "📗 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# ─── 4. FIREWALL SETUP ───────────────────────────────────────
echo "🔒 Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
# Block direct access to internal services
# PostgreSQL, Redis, ChromaDB, Ollama only accessible via Docker network
ufw --force enable

# ─── 5. FAIL2BAN (brute force protection) ────────────────────
echo "🛡️ Configuring Fail2Ban..."
systemctl enable fail2ban
systemctl start fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
maxretry = 5
bantime  = 3600
findtime = 600

[sshd]
enabled = true

[nginx-http-auth]
enabled = true
EOF

systemctl restart fail2ban

# ─── 6. SWAP SPACE (Critical for 8-16GB RAM with Ollama) ─────
echo "💾 Setting up swap space..."
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Reduce swappiness for server use
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ─── 7. OPTIMIZE SYSTEM FOR OLLAMA ───────────────────────────
echo "⚡ Optimizing system for Ollama CPU inference..."
# Increase file descriptors
cat >> /etc/security/limits.conf << 'EOF'
* soft nofile 65536
* hard nofile 65536
EOF

# CPU performance mode
apt install -y cpufrequtils
echo 'GOVERNOR="performance"' > /etc/default/cpufrequtils

# ─── 8. CREATE ALFA DIRECTORY ────────────────────────────────
echo "📁 Creating ALFA application directory..."
mkdir -p /opt/alfa
cd /opt/alfa

# ─── 9. ENVIRONMENT FILE ─────────────────────────────────────
echo "🔧 Creating environment configuration..."
cat > /opt/alfa/.env << 'ENVEOF'
# ============================================================
# ALFA Platform — Environment Variables
# IMPORTANT: Change ALL values before production!
# ============================================================

# Database
POSTGRES_PASSWORD=CHANGE_THIS_STRONG_PASSWORD_123

# Redis
REDIS_PASSWORD=CHANGE_THIS_REDIS_PASSWORD_456

# ChromaDB
CHROMA_TOKEN=CHANGE_THIS_CHROMA_TOKEN_789

# JWT (generate with: openssl rand -hex 64)
JWT_SECRET=CHANGE_THIS_JWT_SECRET_MINIMUM_64_CHARS_LONG

# Webhook
WEBHOOK_VERIFY_TOKEN=CHANGE_THIS_WEBHOOK_TOKEN

# Encryption key for storing API tokens (generate: openssl rand -hex 32)
ENCRYPTION_KEY=CHANGE_THIS_32_CHAR_HEX_KEY

# Razorpay
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXX

# Frontend URL (your domain)
FRONTEND_URL=https://yourdomain.com

# Email (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youremail@gmail.com
SMTP_PASS=your_app_password

# Optional: Sentry for error tracking
SENTRY_DSN=

ENVEOF

chmod 600 /opt/alfa/.env
echo "⚠️  IMPORTANT: Edit /opt/alfa/.env with your actual values!"

# ─── 10. PULL OLLAMA MODELS ──────────────────────────────────
echo ""
echo "=================================================="
echo "✅ Server setup complete!"
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Edit environment file:"
echo "   nano /opt/alfa/.env"
echo ""
echo "2. Clone ALFA code:"
echo "   cd /opt/alfa && git clone YOUR_REPO_URL ."
echo ""
echo "3. Start all services:"
echo "   docker compose -f docker/docker-compose.yml --env-file .env up -d"
echo ""
echo "4. Pull Ollama models (first time only, ~5GB download):"
echo "   docker exec alfa_ollama ollama pull llama3"
echo "   docker exec alfa_ollama ollama pull nomic-embed-text"
echo ""
echo "5. Setup SSL certificate:"
echo "   docker compose run certbot certonly --webroot \\"
echo "     -w /var/www/certbot -d yourdomain.com"
echo ""
echo "6. Check all services are running:"
echo "   docker compose ps"
echo ""
echo "📊 RAM Usage Estimate:"
echo "   PostgreSQL:  ~500MB"
echo "   Redis:       ~100MB"
echo "   ChromaDB:    ~300MB"
echo "   Ollama (Llama3 8B): ~5.5GB"
echo "   API Server:  ~300MB"
echo "   Frontend:    ~200MB"
echo "   OS + Buffer: ~1GB"
echo "   ──────────────────"
echo "   TOTAL:       ~8GB  ← Fits in 8GB RAM with swap"
echo "   (16GB RAM = comfortable with headroom)"
echo "=================================================="
