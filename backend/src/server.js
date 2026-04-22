const express = require('express');
const cors = require('cors');
const { initDb, mapPost, query, withTransaction, getUserRank } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function buildUserResponse(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    points: user.points,
    completionRate: user.completionRate,
    rank: await getUserRank(user.id),
    aiComment: user.aiComment
  };
}

async function getUserById(userId) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'backend is running' });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const nickname = String(req.body.nickname || '').trim() || `微信用户${Date.now().toString().slice(-4)}`;
    const users = await query('SELECT * FROM users WHERE nickname = ?', [nickname]);
    let user = users[0];

    if (!user) {
      const id = createId('u');
      const avatarUrl = `https://dummyimage.com/120x120/0f172a/ffffff&text=${encodeURIComponent(nickname.slice(0, 1) || 'U')}`;
      const aiComment = '欢迎加入任务搭子系统，先从一个可完成的小目标开始。';

      await query(
        'INSERT INTO users (id, nickname, avatarUrl, points, completionRate, aiComment) VALUES (?, ?, ?, ?, ?, ?)',
        [id, nickname, avatarUrl, 0, 0, aiComment]
      );

      user = {
        id,
        nickname,
        avatarUrl,
        points: 0,
        completionRate: 0,
        aiComment
      };
    }

    res.json({
      token: `demo-token-${user.id}`,
      user: await buildUserResponse(user)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts', async (_req, res, next) => {
  try {
    const rows = await query('SELECT * FROM posts ORDER BY createdAt DESC');
    res.json(rows.map(mapPost));
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts/:id', async (req, res, next) => {
  try {
    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const postRow = postRows[0];

    if (!postRow) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    const evidenceList = await query(
      'SELECT type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
      [req.params.id]
    );
    const evaluations = await query(
      'SELECT fromName AS `from`, score, content FROM evaluations WHERE postId = ? ORDER BY createdAt ASC',
      [req.params.id]
    );

    return res.json({
      post: mapPost(postRow),
      evidenceList,
      evaluations
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts', async (req, res, next) => {
  try {
    const {
      publisherId,
      title,
      content,
      reward,
      penalty,
      category,
      partnerChat,
      evaluationOpen,
      evidenceText
    } = req.body;

    const user = await getUserById(publisherId);
    if (!user) {
      return res.status(400).json({ message: '发布用户不存在' });
    }

    if (!title || !content) {
      return res.status(400).json({ message: '标题和内容不能为空' });
    }

    const post = {
      id: createId('p'),
      publisherId: user.id,
      publisherName: user.nickname,
      title: String(title).trim(),
      content: String(content).trim(),
      reward: Number(reward) || 0,
      penalty: Number(penalty) || 0,
      category: String(category || '学习'),
      partnerChat: partnerChat ? 1 : 0,
      evaluationOpen: evaluationOpen ? 1 : 0,
      evidenceText: String(evidenceText || ''),
      status: '招募中',
      buddyName: '',
      progress: 0,
      recommendedScore: 80
    };

    await query(
      `INSERT INTO posts (
        id, publisherId, publisherName, title, content, reward, penalty, category,
        partnerChat, evaluationOpen, evidenceText, status, buddyName, progress, recommendedScore
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        post.id,
        post.publisherId,
        post.publisherName,
        post.title,
        post.content,
        post.reward,
        post.penalty,
        post.category,
        post.partnerChat,
        post.evaluationOpen,
        post.evidenceText,
        post.status,
        post.buddyName,
        post.progress,
        post.recommendedScore
      ]
    );

    const rows = await query('SELECT * FROM posts WHERE id = ?', [post.id]);
    res.status(201).json(mapPost(rows[0]));
  } catch (error) {
    next(error);
  }
});

app.put('/api/posts/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const current = rows[0];

    if (!current) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    const nextPost = {
      ...current,
      title: String(req.body.title || current.title).trim(),
      content: String(req.body.content || current.content).trim(),
      reward: req.body.reward === undefined ? current.reward : Number(req.body.reward) || 0,
      penalty: req.body.penalty === undefined ? current.penalty : Number(req.body.penalty) || 0,
      category: String(req.body.category || current.category),
      partnerChat: req.body.partnerChat === undefined ? current.partnerChat : (req.body.partnerChat ? 1 : 0),
      evaluationOpen: req.body.evaluationOpen === undefined ? current.evaluationOpen : (req.body.evaluationOpen ? 1 : 0),
      evidenceText: req.body.evidenceText === undefined ? current.evidenceText : String(req.body.evidenceText)
    };

    await query(
      `UPDATE posts
       SET title = ?, content = ?, reward = ?, penalty = ?, category = ?,
           partnerChat = ?, evaluationOpen = ?, evidenceText = ?
       WHERE id = ?`,
      [
        nextPost.title,
        nextPost.content,
        nextPost.reward,
        nextPost.penalty,
        nextPost.category,
        nextPost.partnerChat,
        nextPost.evaluationOpen,
        nextPost.evidenceText,
        nextPost.id
      ]
    );

    const updatedRows = await query('SELECT * FROM posts WHERE id = ?', [nextPost.id]);
    res.json(mapPost(updatedRows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/posts/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const current = rows[0];

    if (!current) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    await withTransaction(async (connection) => {
      await connection.execute('DELETE FROM evidences WHERE postId = ?', [req.params.id]);
      await connection.execute('DELETE FROM evaluations WHERE postId = ?', [req.params.id]);
      await connection.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/complete', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const current = rows[0];

    if (!current) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    await withTransaction(async (connection) => {
      await connection.execute('UPDATE posts SET status = ?, progress = ? WHERE id = ?', ['已完成', 100, req.params.id]);
      await connection.execute('UPDATE users SET points = points + ? WHERE id = ?', [current.reward, current.publisherId]);
    });

    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/ranking', async (_req, res, next) => {
  try {
    const rows = await query('SELECT id, nickname, points, completionRate FROM users ORDER BY points DESC, createdAt ASC');
    res.json(rows.map((item) => ({
      id: item.id,
      name: item.nickname,
      points: item.points,
      rate: item.completionRate
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:id/profile', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const posts = await query('SELECT * FROM posts WHERE publisherId = ? ORDER BY createdAt DESC', [req.params.id]);
    return res.json({
      user: await buildUserResponse(user),
      posts: posts.map(mapPost)
    });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || '服务器内部错误' });
});

async function startServer() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Task Buddy backend listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

startServer();
