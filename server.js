require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const app        = express();
const PORT       = process.env.PORT || 3000;
const ADMIN_KEY  = process.env.ADMIN_KEY || 'admin';
const ONLINE_TTL = 35 * 1000; // 35秒以内にハートビートがあればオンライン

app.use(cors());
app.use(express.json());

// ── インメモリストア ──────────────────────
let messages = [];
let users    = {};   // { [userId]: { id, name, lastSeen, pendingCommands[] } }

// ── 管理者認証ミドルウェア ────────────────
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ success: false, error: '管理者権限がありません' });
  }
  next();
}

// ─────────────────────────────────────────
// POST /heartbeat — オンライン登録
// ─────────────────────────────────────────
app.post('/heartbeat', (req, res) => {
  const { userId, name } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: 'userIdが必要です' });

  if (!users[userId]) {
    users[userId] = { id: userId, name: name || 'ゲスト', lastSeen: Date.now(), pendingCommands: [] };
    console.log(`[USER] 新規接続: ${name} (${userId})`);
  } else {
    users[userId].lastSeen = Date.now();
    if (name) users[userId].name = name;
  }

  // ペンディングコマンドを返して消去
  const cmds = users[userId].pendingCommands.splice(0);
  res.json({ success: true, commands: cmds });
});

// ─────────────────────────────────────────
// GET /users — ユーザー一覧（オンライン状態付き）
// ─────────────────────────────────────────
app.get('/users', (req, res) => {
  const now  = Date.now();
  const list = Object.values(users).map(u => ({
    id:     u.id,
    name:   u.name,
    online: (now - u.lastSeen) < ONLINE_TTL,
    lastSeen: u.lastSeen
  }));
  res.json({ success: true, users: list });
});

// ─────────────────────────────────────────
// GET /messages — メッセージ一覧
// ─────────────────────────────────────────
app.get('/messages', (req, res) => {
  res.json({ success: true, messages });
});

// ─────────────────────────────────────────
// POST /messages — メッセージ送信
// ─────────────────────────────────────────
app.post('/messages', (req, res) => {
  const { body, from } = req.body;
  if (!body?.trim()) {
    return res.status(400).json({ success: false, error: '本文(body)は必須です' });
  }

  const message = {
    id:      uuidv4(),
    from:    (from || '自分').trim(),
    body:    body.trim(),
    sentAt:  new Date().toISOString()
  };

  messages.push(message);
  console.log(`[MSG] ${message.from}: ${message.body.slice(0, 50)}`);
  res.status(201).json({ success: true, message });
});

// ─────────────────────────────────────────
// DELETE /messages/:id — メッセージ削除
// ─────────────────────────────────────────
app.delete('/messages/:id', (req, res) => {
  const before = messages.length;
  messages = messages.filter(m => m.id !== req.params.id);
  if (messages.length === before) {
    return res.status(404).json({ success: false, error: 'メッセージが見つかりません' });
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────
// [管理者] POST /admin/volume — 音量コマンド送信
// ─────────────────────────────────────────
app.post('/admin/volume', adminAuth, (req, res) => {
  const { userId, volume } = req.body;  // volume: 0.0〜1.0
  const vol = parseFloat(volume);

  if (!userId || isNaN(vol) || vol < 0 || vol > 1) {
    return res.status(400).json({ success: false, error: 'userId と volume(0-1) が必要です' });
  }

  if (!users[userId]) {
    return res.status(404).json({ success: false, error: 'ユーザーが見つかりません' });
  }

  users[userId].pendingCommands.push({ type: 'SET_VOLUME', volume: vol });
  console.log(`[ADMIN] ${users[userId].name} の音量を ${vol} に設定`);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// [管理者] PUT /admin/user/:id — ユーザー名変更
// ─────────────────────────────────────────
app.put('/admin/user/:id', adminAuth, (req, res) => {
  const { name } = req.body;
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ success: false, error: 'ユーザーが見つかりません' });
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'name が必要です' });

  user.name = name.trim();
  res.json({ success: true, user });
});

// ─────────────────────────────────────────
// [管理者] DELETE /admin/user/:id — ユーザー削除
// ─────────────────────────────────────────
app.delete('/admin/user/:id', adminAuth, (req, res) => {
  if (!users[req.params.id]) return res.status(404).json({ success: false, error: 'ユーザーが見つかりません' });
  delete users[req.params.id];
  res.json({ success: true });
});

// ─────────────────────────────────────────
// Health check
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), users: Object.keys(users).length });
});

app.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  console.log(`   管理者キー: ${ADMIN_KEY}`);
});
