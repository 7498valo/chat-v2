const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// In-memory message store (replace with DB for production)
let messages = [];

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// GET /messages  – 全メッセージ取得
// ─────────────────────────────────────────
app.get('/messages', (req, res) => {
  res.json({ success: true, messages });
});

// ─────────────────────────────────────────
// POST /messages  – メッセージ送信
// ─────────────────────────────────────────
app.post('/messages', (req, res) => {
  const { to, subject, body, from } = req.body;

  if (!to || !body) {
    return res.status(400).json({
      success: false,
      error: '宛先(to)と本文(body)は必須です'
    });
  }

  const message = {
    id: uuidv4(),
    from: from || '(自分)',
    to,
    subject: subject || '(件名なし)',
    body,
    sentAt: new Date().toISOString(),
    status: 'sent'
  };

  messages.push(message);

  console.log(`[${message.sentAt}] 📨 ${message.from} → ${message.to}: ${message.subject}`);

  res.status(201).json({ success: true, message });
});

// ─────────────────────────────────────────
// DELETE /messages/:id  – メッセージ削除
// ─────────────────────────────────────────
app.delete('/messages/:id', (req, res) => {
  const { id } = req.params;
  const before = messages.length;
  messages = messages.filter(m => m.id !== id);

  if (messages.length === before) {
    return res.status(404).json({ success: false, error: 'メッセージが見つかりません' });
  }

  res.json({ success: true });
});

// ─────────────────────────────────────────
// Health check
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`✅ メッセージサーバー起動中: http://localhost:${PORT}`);
  console.log(`   GET    /messages       - メッセージ一覧`);
  console.log(`   POST   /messages       - メッセージ送信`);
  console.log(`   DELETE /messages/:id   - メッセージ削除`);
});
