// ============================================================
// ALFA — Mock WhatsApp Simulator
// Test ALL bot features without a real WhatsApp number
// Run: npm run mock:whatsapp
// Then open: http://localhost:3002
// ============================================================

import express from 'express';
import path    from 'path';

const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'mock-ui')));

const BACKEND_URL    = process.env.BACKEND_URL || 'http://localhost:3001';
const VERIFY_TOKEN   = process.env.WEBHOOK_VERIFY_TOKEN || 'alfa_webhook_verify_token';
const MOCK_PHONE_ID  = 'mock_phone_number_id_12345';

// Simulate outgoing messages sent by the bot
const outgoingMessages: any[] = [];

// ─── INTERCEPT BOT REPLIES ────────────────────────────────────
// The backend calls this when sending WhatsApp messages
// In mock mode, we redirect to here instead of Meta
app.post('/mock/send', (req, res) => {
  const { to, text, phoneNumberId } = req.body;
  const msg = {
    id:        `bot_${Date.now()}`,
    from:      'BOT',
    to,
    text,
    timestamp: new Date().toISOString(),
    type:      'bot'
  };
  outgoingMessages.push(msg);
  console.log(`\n🤖 BOT → ${to}: ${text}\n`);
  res.json({ success: true, messageId: msg.id });
});

// ─── GET PENDING BOT REPLIES (Polling) ───────────────────────
app.get('/mock/messages', (req, res) => {
  const msgs = [...outgoingMessages];
  outgoingMessages.length = 0; // Clear after reading
  res.json(msgs);
});

// ─── SEND USER MESSAGE (Simulates customer messaging) ────────
app.post('/mock/user-message', async (req, res) => {
  const { from, text, name } = req.body;

  // Build the exact same payload structure Meta sends
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'mock_entry',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '+91 98765 43210',
            phone_number_id: MOCK_PHONE_ID
          },
          contacts: [{
            profile: { name: name || 'Test User' },
            wa_id:   from
          }],
          messages: [{
            from,
            id:        `user_${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type:      'text',
            text:      { body: text }
          }]
        }
      }]
    }]
  };

  try {
    // Send to ALFA backend webhook
    const response = await fetch(`${BACKEND_URL}/webhook/whatsapp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(webhookPayload)
    });

    console.log(`\n👤 ${name || from}: ${text}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error forwarding to backend:', err.message);
    res.status(500).json({ error: 'Backend not reachable. Is the API server running?' });
  }
});

// ─── MOCK CHAT UI ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>ALFA Mock WhatsApp Tester</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#111B21;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
    .phone{width:400px;background:#0B141A;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
    .phone-header{background:#1F2C34;padding:16px 20px;display:flex;align-items:center;gap:12px}
    .phone-avatar{width:40px;height:40px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff}
    .phone-info h3{font-size:15px;font-weight:600;color:#E9EDEF}
    .phone-info p{font-size:12px;color:#8696A0}
    .chat-window{height:500px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#0B141A}
    .msg{max-width:75%;padding:8px 12px;border-radius:10px;font-size:14px;line-height:1.5}
    .msg.user{background:#005C4B;color:#E9EDEF;align-self:flex-end;border-radius:10px 0 10px 10px}
    .msg.bot{background:#1F2C34;color:#E9EDEF;align-self:flex-start;border-radius:0 10px 10px 10px}
    .msg-time{font-size:10px;opacity:0.5;text-align:right;margin-top:3px}
    .input-area{background:#1F2C34;padding:12px 16px;display:flex;gap:10px;align-items:center}
    .user-select{background:#2A3942;border:none;border-radius:8px;padding:8px 12px;color:#E9EDEF;font-family:'DM Sans',sans-serif;font-size:13px;width:100%;margin-bottom:8px}
    .input-row{display:flex;gap:8px;width:100%}
    .msg-input{flex:1;background:#2A3942;border:none;border-radius:8px;padding:10px 14px;color:#E9EDEF;font-family:'DM Sans',sans-serif;font-size:14px;outline:none}
    .msg-input::placeholder{color:#8696A0}
    .send-btn{background:#25D366;border:none;border-radius:8px;width:40px;height:40px;cursor:pointer;font-size:18px}
    .status{font-size:11px;text-align:center;padding:8px;color:#8696A0}
    .quick-btns{padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px}
    .qb{background:#1F2C34;border:1px solid #2A3942;color:#8696A0;padding:5px 12px;border-radius:999px;font-size:12px;cursor:pointer;transition:all 0.15s}
    .qb:hover{background:#2A3942;color:#E9EDEF}
    .thinking{display:none;align-self:flex-start;background:#1F2C34;color:#8696A0;padding:8px 14px;border-radius:10px;font-size:13px}
    .thinking.show{display:block}
  </style>
</head>
<body>
  <div class="phone">
    <div class="phone-header">
      <div class="phone-avatar">S</div>
      <div class="phone-info">
        <h3>Spice Garden Restaurant</h3>
        <p>🤖 AI Bot Active · Mock Mode</p>
      </div>
    </div>

    <div class="quick-btns">
      <button class="qb" onclick="quickSend('Hi, what are your timings?')">🕐 Timings</button>
      <button class="qb" onclick="quickSend('I want to place an order')">🛒 Order</button>
      <button class="qb" onclick="quickSend('Book an appointment')">📅 Book</button>
      <button class="qb" onclick="quickSend('What is your menu?')">📋 Menu</button>
      <button class="qb" onclick="quickSend('Do you have home delivery?')">🚚 Delivery</button>
      <button class="qb" onclick="quickSend('What is the price of Butter Chicken?')">💰 Price</button>
    </div>

    <div class="chat-window" id="chat">
      <div class="msg bot">👋 Welcome to ALFA Mock Tester! Send any message to test the AI bot.<div class="msg-time">${new Date().toLocaleTimeString()}</div></div>
    </div>

    <div class="thinking" id="thinking">🤖 Bot is thinking...</div>

    <div class="input-area" style="flex-direction:column">
      <select class="user-select" id="userSelect">
        <option value="919876543001">Priya Kapoor (12 orders)</option>
        <option value="919876543002">Amit Mehta (8 orders)</option>
        <option value="919876543003">Rohit Gupta (new)</option>
        <option value="919999999999">New Customer</option>
      </select>
      <div class="input-row">
        <input class="msg-input" id="msgInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMsg()">
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
    </div>
    <div class="status" id="status">Connected to ALFA backend · localhost:3001</div>
  </div>

  <script>
    const chat     = document.getElementById('chat');
    const input    = document.getElementById('msgInput');
    const thinking = document.getElementById('thinking');
    const status   = document.getElementById('status');

    function addMsg(text, type) {
      const div = document.createElement('div');
      div.className = 'msg ' + type;
      div.innerHTML = text.replace(/\n/g,'<br>') + '<div class="msg-time">' + new Date().toLocaleTimeString() + '</div>';
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    async function sendMsg() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      const from = document.getElementById('userSelect').value;
      const name = document.getElementById('userSelect').selectedOptions[0].text.split('(')[0].trim();

      addMsg(text, 'user');
      thinking.className = 'thinking show';
      status.textContent = 'Sending to AI...';

      try {
        const res = await fetch('/mock/user-message', {
          method:  'POST',
          headers: {'Content-Type':'application/json'},
          body:    JSON.stringify({ from, text, name })
        });

        if (!res.ok) throw new Error('Backend error');
        status.textContent = 'Message sent · Waiting for bot reply...';
        setTimeout(pollForReply, 1500);
      } catch(e) {
        thinking.className = 'thinking';
        addMsg('❌ Error: Backend not running. Start with: npm run dev', 'bot');
        status.textContent = 'Error — is backend running on port 3001?';
      }
    }

    async function pollForReply(attempts = 0) {
      if (attempts > 20) {
        thinking.className = 'thinking';
        addMsg('⏱ Bot took too long to respond. Check if Ollama is running.', 'bot');
        return;
      }
      try {
        const res  = await fetch('/mock/messages');
        const msgs = await res.json();
        if (msgs.length > 0) {
          thinking.className = 'thinking';
          msgs.forEach(m => addMsg(m.text, 'bot'));
          status.textContent = 'Reply received · Ready';
        } else {
          setTimeout(() => pollForReply(attempts + 1), 1000);
        }
      } catch(e) {
        setTimeout(() => pollForReply(attempts + 1), 1500);
      }
    }

    function quickSend(text) {
      input.value = text;
      sendMsg();
    }
  </script>
</body>
</html>`);
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   ALFA Mock WhatsApp Tester            ║
║   Open: http://localhost:${PORT}           ║
║                                        ║
║   Test customers:                      ║
║   • Priya Kapoor  (+919876543001)      ║
║   • Amit Mehta   (+919876543002)      ║
║   • New Customer  (+919999999999)      ║
╚════════════════════════════════════════╝
  `);
});
