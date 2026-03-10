# ALFA — GitHub Setup & Trial Run Guide
# Complete steps to push to GitHub and run locally

## ═══════════════════════════════════════════
## STEP 1: Push to GitHub
## ═══════════════════════════════════════════

# 1a. Create a new repo on github.com
#     Go to: https://github.com/new
#     Name: alfa-platform
#     Visibility: Private (recommended)
#     Do NOT initialize with README (we have our own)

# 1b. In your local terminal:
cd alfa-platform   # or wherever you saved the files

git init
git add .
git commit -m "feat: initial ALFA platform setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/alfa-platform.git
git push -u origin main


## ═══════════════════════════════════════════
## STEP 2: Clone & Run On Any Machine
## ═══════════════════════════════════════════

git clone https://github.com/YOUR_USERNAME/alfa-platform.git
cd alfa-platform

# Copy environment file
cp .env.example .env
# (No changes needed for local trial — defaults work)


## ═══════════════════════════════════════════
## STEP 3: Start Docker Services
## ═══════════════════════════════════════════

docker compose -f docker/docker-compose.dev.yml up -d

# Check all services are running:
docker compose -f docker/docker-compose.dev.yml ps

# Expected output:
# alfa_postgres  running   0.0.0.0:5432->5432/tcp
# alfa_redis     running   0.0.0.0:6379->6379/tcp
# alfa_chroma    running   0.0.0.0:8000->8000/tcp
# alfa_ollama    running   0.0.0.0:11434->11434/tcp


## ═══════════════════════════════════════════
## STEP 4: Pull Ollama Models (First Time Only)
## ═══════════════════════════════════════════

# Wait 30 seconds for Ollama to start, then:
docker exec alfa_ollama ollama pull llama3
docker exec alfa_ollama ollama pull nomic-embed-text

# llama3          → ~4.7GB (the main AI chat model)
# nomic-embed-text → ~274MB (for document embedding)

# Test Ollama is working:
curl http://localhost:11434/api/generate -d '{
  "model": "llama3",
  "prompt": "Say hello in one sentence",
  "stream": false
}'


## ═══════════════════════════════════════════
## STEP 5: Setup Backend
## ═══════════════════════════════════════════

cd backend

# Install dependencies
npm install

# Push database schema
npx prisma db push

# Seed demo data (creates test tenant, products, contacts)
npm run db:seed

# Optional: Open visual database browser
npx prisma studio
# Opens at: http://localhost:5555


## ═══════════════════════════════════════════
## STEP 6: Start Backend API
## ═══════════════════════════════════════════

npm run dev

# Expected output:
# ✓ Database connected
# ✓ Redis connected
# ✓ Embed worker started
# ✓ Reminder worker started
# ✓ Auto-learning worker started
# ALFA API running on port 3001

# Test API is working:
curl http://localhost:3001/health
# Should return: {"status":"ok","version":"1.0.0"}


## ═══════════════════════════════════════════
## STEP 7: Start Frontend Dashboard
## ═══════════════════════════════════════════

# In a NEW terminal:
cd frontend
npm install
npm run dev

# Opens at: http://localhost:3000
# Login with:
#   Email:    admin@alfa.demo
#   Password: alfa123


## ═══════════════════════════════════════════
## STEP 8: Test Bot Features (Mock Mode)
## ═══════════════════════════════════════════

# In a NEW terminal:
cd backend
npm run mock:whatsapp

# Opens at: http://localhost:3002
# This simulates a customer messaging on WhatsApp
# No real WhatsApp number needed!

# Test these flows:
# → Type: "Hi, what are your timings?"
# → Type: "I want to order Butter Chicken"
# → Type: "Book an appointment for tomorrow 3pm"
# → Type: "What is the price of Family Combo?"
# → Type: "Do you have home delivery?"


## ═══════════════════════════════════════════
## STEP 9: Test Each Feature on Dashboard
## ═══════════════════════════════════════════

Open http://localhost:3000 and check:

□ Dashboard     → Stats, live conversations, orders
□ Conversations → See mock chat messages in real time
□ Knowledge     → Upload a text document, watch it index
□ CRM           → View demo contacts, click one for profile
□ Orders        → See demo orders, change status
□ Store         → View products, edit a price
□ Broadcast     → Create a broadcast, see cost estimate
□ Analytics     → View charts (populated from seed data)
□ AI Settings   → Edit system prompt, change model settings
□ Google Sheets → (optional) connect your own sheet
□ Billing       → Shows trial plan (no real payment needed)


## ═══════════════════════════════════════════
## ALL RUNNING URLS
## ═══════════════════════════════════════════

http://localhost:3000        → ALFA Dashboard (tenant view)
http://localhost:3001        → Backend API
http://localhost:3001/health → API health check
http://localhost:3002        → Mock WhatsApp Tester
http://localhost:5555        → Prisma DB Studio (visual DB)
http://localhost:8000        → ChromaDB API
http://localhost:11434       → Ollama API


## ═══════════════════════════════════════════
## TROUBLESHOOTING
## ═══════════════════════════════════════════

# Services not starting?
docker compose -f docker/docker-compose.dev.yml logs

# Database connection error?
docker compose -f docker/docker-compose.dev.yml restart postgres
# Wait 20s then retry

# Ollama slow / no response?
# Normal for first response — model loads into RAM (~30s)
# Subsequent responses: 3-10s on CPU

# Port conflict?
docker compose -f docker/docker-compose.dev.yml down
# Then try again

# Reset everything (fresh start):
docker compose -f docker/docker-compose.dev.yml down -v
docker compose -f docker/docker-compose.dev.yml up -d
cd backend && npm run db:reset


## ═══════════════════════════════════════════
## STOP EVERYTHING
## ═══════════════════════════════════════════

# Stop API: Ctrl+C in terminal
# Stop Frontend: Ctrl+C in terminal
# Stop Docker services:
docker compose -f docker/docker-compose.dev.yml stop
# (Use 'down' to also remove containers, 'down -v' to also remove data)
