const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// メッセージを一時的にメモリに保存（本番環境ではデータベースを使用）
let messages = [];
const MAX_MESSAGES = 1000; // 最大保存メッセージ数

// ミドルウェア
app.use(cors());
app.use(express.json({ limit: '10kb' })); // JSONサイズ制限

// レート制限設定
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 1000, // 15分あたり最大10リクエスト
  message: { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 不適切な単語のフィルター（基本的なもの）
const containsInappropriate = (text) => {
  const inappropriateWords = ['spam', 'test123']; // 必要に応じて追加
  const lowerText = text.toLowerCase();
  return inappropriateWords.some(word => lowerText.includes(word));
};

// ヘルスチェック
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '匿名メッセージングAPI',
    totalMessages: messages.length 
  });
});

// メッセージ送信エンドポイント
app.post('/api/messages', limiter, (req, res) => {
  try {
    const { message } = req.body;

    // バリデーション
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'メッセージが必要です' });
    }

    if (message.length < 1 || message.length > 500) {
      return res.status(400).json({ error: 'メッセージは1〜500文字で入力してください' });
    }

    // 不適切なコンテンツチェック
    if (containsInappropriate(message)) {
      return res.status(400).json({ error: '不適切なコンテンツが含まれています' });
    }

    // メッセージオブジェクト作成（IPアドレスやユーザー情報は保存しない）
    const newMessage = {
      id: uuidv4(),
      message: message.trim(),
      timestamp: new Date().toISOString(),
    };

    messages.unshift(newMessage); // 新しいメッセージを先頭に追加

    // メッセージ数制限
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(0, MAX_MESSAGES);
    }

    res.status(201).json({ 
      success: true, 
      message: 'メッセージが送信されました',
      id: newMessage.id 
    });

  } catch (error) {
    console.error('メッセージ送信エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// メッセージ取得エンドポイント
app.get('/api/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const paginatedMessages = messages.slice(offset, offset + limit);

    res.json({
      messages: paginatedMessages,
      total: messages.length,
      limit,
      offset
    });

  } catch (error) {
    console.error('メッセージ取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// 統計情報エンドポイント
app.get('/api/stats', (req, res) => {
  res.json({
    totalMessages: messages.length,
    oldestMessage: messages.length > 0 ? messages[messages.length - 1].timestamp : null,
    newestMessage: messages.length > 0 ? messages[0].timestamp : null,
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 匿名メッセージングサーバーが起動しました: http://localhost:${PORT}`);
});

module.exports = app;
