// ============================================================
//  LINE拡張機能 バックエンドサーバー
//  Express (REST API) + ws (WebSocket) on port 3000
// ============================================================

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

// ──────────────────────────────────────────────────────────
//  In-Memory DB
// ──────────────────────────────────────────────────────────
const db = {
  users: [
    { id: "user-1", name: "田中さくら", avatar: "🌸", status: "online" },
    { id: "user-2", name: "鈴木健太",   avatar: "🎮", status: "offline" },
    { id: "user-3", name: "佐藤花子",   avatar: "🌺", status: "online" },
    { id: "user-4", name: "山田グループ", avatar: "👥", status: "online", isGroup: true, members: ["user-1","user-2","user-3"] },
    { id: "user-5", name: "Work Team",  avatar: "💼", status: "offline", isGroup: true },
  ],
  // roomId → message[]
  messages: {
    "room-1": [
      { id: uuidv4(), roomId: "room-1", senderId: "user-1", text: "こんにちは！", type: "text", ts: Date.now() - 3600000 },
      { id: uuidv4(), roomId: "room-1", senderId: "me",     text: "やあ！元気？", type: "text", ts: Date.now() - 3500000 },
      { id: uuidv4(), roomId: "room-1", senderId: "user-1", text: "元気だよ〜週末どうだった？", type: "text", ts: Date.now() - 3400000 },
    ],
    "room-2": [
      { id: uuidv4(), roomId: "room-2", senderId: "user-2", text: "ゲームしようぜ！", type: "text", ts: Date.now() - 7200000 },
      { id: uuidv4(), roomId: "room-2", senderId: "me",     text: "いいね！何時から？", type: "text", ts: Date.now() - 7100000 },
    ],
    "room-3": [
      { id: uuidv4(), roomId: "room-3", senderId: "user-4", text: "明日の予定は？", type: "text", ts: Date.now() - 86400000 },
    ],
    "room-4": [
      { id: uuidv4(), roomId: "room-4", senderId: "user-3", text: "また話しましょう！", type: "text", ts: Date.now() - 172800000 },
    ],
    "room-5": [
      { id: uuidv4(), roomId: "room-5", senderId: "user-5", text: "会議は3時からです", type: "text", ts: Date.now() - 259200000 },
    ],
  },
  // roomId → { contactId, unread }
  rooms: [
    { id: "room-1", contactId: "user-1", unread: 2 },
    { id: "room-2", contactId: "user-2", unread: 0 },
    { id: "room-3", contactId: "user-4", unread: 5 },
    { id: "room-4", contactId: "user-3", unread: 0 },
    { id: "room-5", contactId: "user-5", unread: 1 },
  ],
};

// ──────────────────────────────────────────────────────────
//  REST API
// ──────────────────────────────────────────────────────────

// GET /api/rooms  — トーク一覧
app.get("/api/rooms", (req, res) => {
  const result = db.rooms.map((room) => {
    const contact = db.users.find((u) => u.id === room.contactId);
    const msgs = db.messages[room.id] || [];
    const lastMsg = msgs[msgs.length - 1] || null;
    return {
      ...room,
      contact,
      lastMessage: lastMsg,
    };
  });
  // 最新メッセージ順で並び替え
  result.sort((a, b) => {
    const ta = a.lastMessage?.ts || 0;
    const tb = b.lastMessage?.ts || 0;
    return tb - ta;
  });
  res.json(result);
});

// GET /api/rooms/:roomId/messages  — メッセージ一覧
app.get("/api/rooms/:roomId/messages", (req, res) => {
  const msgs = db.messages[req.params.roomId] || [];
  res.json(msgs);
});

// POST /api/rooms/:roomId/messages  — メッセージ送信 (REST fallback)
app.post("/api/rooms/:roomId/messages", (req, res) => {
  const { text, type = "text" } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const msg = {
    id: uuidv4(),
    roomId: req.params.roomId,
    senderId: "me",
    text,
    type,
    ts: Date.now(),
  };

  if (!db.messages[req.params.roomId]) db.messages[req.params.roomId] = [];
  db.messages[req.params.roomId].push(msg);

  // unread reset for "me"
  const room = db.rooms.find((r) => r.id === req.params.roomId);
  if (room) room.unread = 0;

  // WebSocket broadcast
  broadcastToRoom(req.params.roomId, { type: "NEW_MESSAGE", payload: msg });

  res.status(201).json(msg);
});

// PATCH /api/rooms/:roomId/read  — 既読
app.patch("/api/rooms/:roomId/read", (req, res) => {
  const room = db.rooms.find((r) => r.id === req.params.roomId);
  if (room) room.unread = 0;
  res.json({ ok: true });
});

// GET /api/contacts  — 連絡先一覧
app.get("/api/contacts", (req, res) => {
  res.json(db.users);
});

// ──────────────────────────────────────────────────────────
//  HTTP + WebSocket サーバー
// ──────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// roomId → Set<WebSocket>
const roomClients = new Map();

function broadcastToRoom(roomId, data) {
  const clients = roomClients.get(roomId) || new Set();
  const payload = JSON.stringify(data);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

wss.on("connection", (ws) => {
  let currentRoom = null;

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {
      // ルームに参加
      case "JOIN_ROOM": {
        // 前のルームから離脱
        if (currentRoom) {
          const prev = roomClients.get(currentRoom);
          if (prev) prev.delete(ws);
        }
        currentRoom = data.roomId;
        if (!roomClients.has(currentRoom)) roomClients.set(currentRoom, new Set());
        roomClients.get(currentRoom).add(ws);

        // 既読にする
        const room = db.rooms.find((r) => r.id === currentRoom);
        if (room) room.unread = 0;

        // 最新メッセージを返す
        ws.send(JSON.stringify({
          type: "ROOM_HISTORY",
          payload: db.messages[currentRoom] || [],
        }));
        break;
      }

      // メッセージ送信
      case "SEND_MESSAGE": {
        const { roomId, text, msgType = "text" } = data;
        const msg = {
          id: uuidv4(),
          roomId,
          senderId: "me",
          text,
          type: msgType,
          ts: Date.now(),
        };
        if (!db.messages[roomId]) db.messages[roomId] = [];
        db.messages[roomId].push(msg);

        const rm = db.rooms.find((r) => r.id === roomId);
        if (rm) rm.unread = 0;

        broadcastToRoom(roomId, { type: "NEW_MESSAGE", payload: msg });

        // 相手の自動返信（デモ用）
        setTimeout(() => {
          const replies = ["なるほど！", "了解です〜", "ありがとう！", "いいね！", "😊", "そうですね！", "わかった！"];
          const reply = {
            id: uuidv4(),
            roomId,
            senderId: data.contactId || "user-1",
            text: replies[Math.floor(Math.random() * replies.length)],
            type: "text",
            ts: Date.now(),
          };
          db.messages[roomId].push(reply);
          broadcastToRoom(roomId, { type: "NEW_MESSAGE", payload: reply });
        }, 800 + Math.random() * 1200);
        break;
      }

      // タイピング中
      case "TYPING": {
        broadcastToRoom(data.roomId, { type: "TYPING", senderId: "me" });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (currentRoom) {
      const clients = roomClients.get(currentRoom);
      if (clients) clients.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅  LINE拡張機能 バックエンド起動中 → http://localhost:${PORT}`);
  console.log(`🔌  WebSocket → ws://localhost:${PORT}`);
});
