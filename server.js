const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

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
// body と from だけ受け取る（to・subject は不要）
// ─────────────────────────────────────────
app.post('/messages', (req, res) => {
  const { body, from } = req.body;

  if (!body || !body.trim()) {
    return res.status(400).json({
      success: false,
      error: '本文(body)は必須です'
    });
  }

  const message = {
    id: uuidv4(),
    from: (from || '自分').trim(),
    body: body.trim(),
    sentAt: new Date().toISOString()
  };

  messages.push(message);

  console.log(`[${message.sentAt}] 💬 ${message.from}: ${message.body.slice(0, 50)}`);

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
  console.log(`   POST   /messages       - メッセージ送信 { body, from }`);
  console.log(`   DELETE /messages/:id   - メッセージ削除`);
});
