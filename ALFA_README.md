# ALFA — WhatsApp AI SaaS Platform

> Self-hosted WhatsApp bot platform with AI training, CRM, e-commerce, and Google Sheets sync.

---

## 🚀 Run Locally in 5 Minutes

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- [Node.js 20+](https://nodejs.org/) installed
- [Git](https://git-scm.com/) installed

### Step 1 — Clone & Setup

```bash
git clone https://github.com/YOUR_USERNAME/alfa-platform.git
cd alfa-platform
cp .env.example .env
```

### Step 2 — Start All Services (Docker)

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

This starts:
- ✅ PostgreSQL (database)
- ✅ Redis (cache/queues)
- ✅ ChromaDB (vector database for AI)
- ✅ Ollama (local AI model)

### Step 3 — Pull Ollama Models

```bash
# Wait ~2 min for Ollama to start, then:
docker exec alfa_ollama ollama pull llama3
docker exec alfa_ollama ollama pull nomic-embed-text
```

> ⏱ First time only — downloads ~5GB. Go make a chai ☕

### Step 4 — Setup Database

```bash
cd backend
npm install
npx prisma db push
npx prisma db seed
```

### Step 5 — Start Backend

```bash
cd backend
npm run dev
# API running at http://localhost:3001
```

### Step 6 — Start Frontend

```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:3000
```

---

## 🧪 Testing Without a Real WhatsApp Number

Use the built-in **Mock WhatsApp Mode** — sends fake messages to test all bot features without connecting to Meta.

```bash
# In a new terminal:
cd backend
npm run mock:whatsapp
```

Then open http://localhost:3000/mock-chat to send test messages.

---

## 📁 Project Structure

```
alfa-platform/
├── backend/          # Node.js + Express API
│   ├── src/
│   │   ├── modules/  # Feature modules
│   │   ├── jobs/     # Background workers
│   │   └── config/   # DB, Redis, etc.
│   ├── prisma/       # Database schema
│   └── package.json
├── frontend/         # Next.js dashboard
├── docker/           # Docker configs
│   ├── docker-compose.dev.yml   # Local dev
│   └── docker-compose.prod.yml  # Production
├── database/         # SQL migrations
├── .env.example      # Environment template
└── README.md
```

---

## 🔑 Default Login (after seed)

```
Email:    admin@alfa.demo
Password: alfa123
```

---

## ✅ Feature Checklist (Test Each One)

- [ ] Register a new tenant business
- [ ] Connect WhatsApp API (or use Mock mode)
- [ ] Upload a knowledge document
- [ ] Train AI and test responses in Mock Chat
- [ ] Create an appointment via bot
- [ ] Place an order via bot
- [ ] View CRM contacts
- [ ] Add products to e-commerce store
- [ ] Send a test broadcast
- [ ] See analytics dashboard
- [ ] Test auto-learning (correct a bot reply)
- [ ] Connect Google Sheets (optional)

---

## 🐛 Common Issues

**Ollama is slow on first response** → Normal. CPU inference takes 5-15s for first response, faster after model is loaded in memory.

**Port already in use** → Run `docker compose down` then try again.

**Database connection error** → Wait 30s after `docker compose up` for Postgres to fully start.

---

## 📞 Support
Open a GitHub Issue for bugs or feature requests.
