/**
 * LINE風チャット バックエンド
 * Express + WebSocket (ws)
 * Render対応: process.env.PORT を使用
 */

const express   = require("express");
const http      = require("http");
const WebSocket = require("ws");
const cors      = require("cors");
const { v4: uuid } = require("uuid");

// ─────────────────────────────────────────
//  App setup
// ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
//  In-memory store
// ─────────────────────────────────────────

/**
 * users: Map<userId, { id, name, avatar, ws }>
 * rooms: Map<roomId, { id, members:[uid,uid], messages:[], unread:{uid:n} }>
 */
const users = new Map();
const rooms = new Map();

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

// 2人のルームIDを決定論的に生成
const roomId = (a, b) => "r:" + [a, b].sort().join(":");

// WebSocketが開いているか
const isOpen = (ws) => ws && ws.readyState === WebSocket.OPEN;

// 特定ユーザーへ送信
const sendTo = (uid, data) => {
  const u = users.get(uid);
  if (u && isOpen(u.ws)) u.ws.send(JSON.stringify(data));
};

// 全ユーザーへ送信（除外あり）
const broadcast = (data, excludeId = null) => {
  const raw = JSON.stringify(data);
  users.forEach((u, uid) => {
    if (uid !== excludeId && isOpen(u.ws)) u.ws.send(raw);
  });
};

// ルームの両メンバーへ送信
const broadcastRoom = (rid, data) => {
  const room = rooms.get(rid);
  if (!room) return;
  const raw = JSON.stringify(data);
  room.members.forEach((uid) => {
    const u = users.get(uid);
    if (u && isOpen(u.ws)) u.ws.send(raw);
  });
};

// ユーザーの公開情報（ws除外）
const pubUser = (u) => ({ id: u.id, name: u.name, avatar: u.avatar });

// ルームの公開情報（myIdから見た情報）
const pubRoom = (room, myId) => {
  const partnerId = room.members.find((id) => id !== myId);
  const partner   = users.get(partnerId);
  const lastMsg   = room.messages[room.messages.length - 1] ?? null;
  return {
    id:          room.id,
    partnerId,
    partner:     partner ? pubUser(partner) : { id: partnerId, name: "（退出済み）", avatar: "👻" },
    online:      !!partner,
    lastMessage: lastMsg,
    unread:      room.unread[myId] ?? 0,
  };
};

// ─────────────────────────────────────────
//  REST endpoints
// ─────────────────────────────────────────

// ヘルスチェック / ルート
app.get("/", (_req, res) => res.json({ status: "ok", service: "line-chat", users: users.size }));

// オンラインユーザー一覧
app.get("/api/users", (_req, res) => {
  res.json([...users.values()].map(pubUser));
});

// 自分のルーム一覧
app.get("/api/rooms/:userId", (req, res) => {
  const list = [];
  rooms.forEach((room) => {
    if (room.members.includes(req.params.userId)) {
      list.push(pubRoom(room, req.params.userId));
    }
  });
  list.sort((a, b) => (b.lastMessage?.ts ?? 0) - (a.lastMessage?.ts ?? 0));
  res.json(list);
});

// メッセージ一覧
app.get("/api/rooms/:roomId/messages", (req, res) => {
  const room = rooms.get(req.params.roomId);
  res.json(room ? room.messages : []);
});

// ─────────────────────────────────────────
//  WebSocket
// ─────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  let myId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ─── ログイン ───────────────────────
      case "LOGIN": {
        const { name, avatar } = msg;
        if (!name?.trim()) return;

        myId = uuid();
        users.set(myId, { id: myId, name: name.trim(), avatar: avatar || "😊", ws });

        // ① 自分にセッション情報を返す
        ws.send(JSON.stringify({
          type:  "SESSION",
          me:    pubUser(users.get(myId)),
          users: [...users.values()]
                   .filter((u) => u.id !== myId)
                   .map(pubUser),
        }));

        // ② 全員に新規ユーザーを通知
        broadcast({ type: "USER_JOINED", user: pubUser(users.get(myId)) }, myId);

        console.log(`[+] ${name} (${myId})`);
        break;
      }

      // ─── ルーム開始 ────────────────────
      case "OPEN_ROOM": {
        if (!myId) return;
        const { partnerId } = msg;
        const rid = roomId(myId, partnerId);

        if (!rooms.has(rid)) {
          rooms.set(rid, {
            id:      rid,
            members: [myId, partnerId],
            messages: [],
            unread:  { [myId]: 0, [partnerId]: 0 },
          });
        }

        const room = rooms.get(rid);
        room.unread[myId] = 0;

        // 開いた本人に履歴を返す
        ws.send(JSON.stringify({
          type:     "ROOM_OPENED",
          room:     pubRoom(room, myId),
          messages: room.messages,
        }));
        break;
      }

      // ─── メッセージ送信 ─────────────────
      case "SEND_MESSAGE": {
        if (!myId) return;
        const { rid, text, kind = "text" } = msg;
        if (!text?.trim() && kind === "text") return;

        const room = rooms.get(rid);
        if (!room || !room.members.includes(myId)) return;

        const newMsg = {
          id:       uuid(),
          rid,
          senderId: myId,
          text:     text.trim(),
          kind,
          ts:       Date.now(),
        };

        room.messages.push(newMsg);

        // 相手の未読を増やす
        room.members.forEach((uid) => {
          if (uid !== myId) room.unread[uid] = (room.unread[uid] ?? 0) + 1;
        });

        // ルーム全員に新着通知
        broadcastRoom(rid, { type: "NEW_MESSAGE", msg: newMsg });
        break;
      }

      // ─── 既読 ──────────────────────────
      case "READ": {
        const room = rooms.get(msg.rid);
        if (room && myId) room.unread[myId] = 0;
        break;
      }

      // ─── タイピング ─────────────────────
      case "TYPING": {
        if (!myId) return;
        const room = rooms.get(msg.rid);
        if (!room) return;
        room.members.forEach((uid) => {
          if (uid !== myId) sendTo(uid, { type: "TYPING", rid: msg.rid });
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!myId) return;
    const u = users.get(myId);
    users.delete(myId);
    console.log(`[-] ${u?.name} (${myId})`);
    broadcast({ type: "USER_LEFT", userId: myId });
  });

  ws.on("error", (err) => console.error("WS error:", err.message));
});

// ─────────────────────────────────────────
//  Start
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ LINE-chat server running on port ${PORT}`);
});
