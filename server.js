const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// アップロードディレクトリの作成
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// メッセージを一時的にメモリに保存
let messages = [];
const MAX_MESSAGES = 1000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Multer設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // 許可するファイルタイプ
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|txt|doc|docx|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('このファイルタイプは許可されていません'));
    }
  }
});

// ミドルウェア
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(uploadDir));

// レート制限
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 不適切なコンテンツフィルター
const containsInappropriate = (text) => {
  if (!text) return false;
  const inappropriateWords = ['spam'];
  const lowerText = text.toLowerCase();
  return inappropriateWords.some(word => lowerText.includes(word));
};

// URLを検出する関数
const extractUrls = (text) => {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
};

// ヘルスチェック
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '匿名メッセージングAPI',
    totalMessages: messages.length 
  });
});

// メッセージ送信エンドポイント（テキストのみ）
app.post('/api/messages', limiter, (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'メッセージが必要です' });
    }

    if (message.length < 1 || message.length > 2000) {
      return res.status(400).json({ error: 'メッセージは1〜2000文字で入力してください' });
    }

    if (containsInappropriate(message)) {
      return res.status(400).json({ error: '不適切なコンテンツが含まれています' });
    }

    const urls = extractUrls(message);
    
    const newMessage = {
      id: uuidv4(),
      type: 'text',
      message: message.trim(),
      urls: urls,
      timestamp: new Date().toISOString(),
    };

    messages.unshift(newMessage);

    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(0, MAX_MESSAGES);
    }

    res.status(201).json({ 
      success: true, 
      message: 'メッセージが送信されました',
      id: newMessage.id,
      data: newMessage
    });

  } catch (error) {
    console.error('メッセージ送信エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ファイル・画像アップロードエンドポイント
app.post('/api/messages/upload', limiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルが必要です' });
    }

    const message = req.body.message || '';
    
    if (message.length > 500) {
      return res.status(400).json({ error: 'メッセージは500文字以内で入力してください' });
    }

    if (containsInappropriate(message)) {
      fs.unlinkSync(req.file.path); // 不適切な場合はファイルを削除
      return res.status(400).json({ error: '不適切なコンテンツが含まれています' });
    }

    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);
    const isVideo = /\.(mp4|webm)$/i.test(req.file.originalname);
    
    let fileType = 'file';
    if (isImage) fileType = 'image';
    if (isVideo) fileType = 'video';

    const urls = extractUrls(message);

    const newMessage = {
      id: uuidv4(),
      type: fileType,
      message: message.trim(),
      urls: urls,
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: `/uploads/${req.file.filename}`
      },
      timestamp: new Date().toISOString(),
    };

    messages.unshift(newMessage);

    if (messages.length > MAX_MESSAGES) {
      const removed = messages.slice(MAX_MESSAGES);
      // 削除されたメッセージのファイルも削除
      removed.forEach(msg => {
        if (msg.file && msg.file.filename) {
          const filePath = path.join(uploadDir, msg.file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      });
      messages = messages.slice(0, MAX_MESSAGES);
    }

    res.status(201).json({ 
      success: true, 
      message: 'ファイルがアップロードされました',
      id: newMessage.id,
      data: newMessage
    });

  } catch (error) {
    console.error('ファイルアップロードエラー:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message || 'サーバーエラーが発生しました' });
  }
});

// メッセージ取得エンドポイント
app.get('/api/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const since = req.query.since; // タイムスタンプ

    let filteredMessages = messages;
    
    // 指定時刻以降のメッセージのみ取得（ポーリング用）
    if (since) {
      filteredMessages = messages.filter(msg => new Date(msg.timestamp) > new Date(since));
    }

    const paginatedMessages = filteredMessages.slice(offset, offset + limit);

    res.json({
      messages: paginatedMessages,
      total: messages.length,
      limit,
      offset,
      hasNew: filteredMessages.length > 0
    });

  } catch (error) {
    console.error('メッセージ取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// メッセージ削除エンドポイント（管理者用、オプション）
app.delete('/api/messages/:id', (req, res) => {
  try {
    const { id } = req.params;
    const messageIndex = messages.findIndex(msg => msg.id === id);
    
    if (messageIndex === -1) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const message = messages[messageIndex];
    
    // ファイルがある場合は削除
    if (message.file && message.file.filename) {
      const filePath = path.join(uploadDir, message.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    messages.splice(messageIndex, 1);

    res.json({ success: true, message: 'メッセージが削除されました' });

  } catch (error) {
    console.error('メッセージ削除エラー:', error);
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

// エラーハンドリング
app.use((err, req, res, next) => {
  console.error('エラー:', err);
  res.status(500).json({ error: err.message || 'サーバーエラー' });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 匿名メッセージングサーバーが起動しました: http://localhost:${PORT}`);
  console.log(`📁 アップロードディレクトリ: ${uploadDir}`);
});

module.exports = app;
