const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { initDb, mapPost, query, withTransaction, getUserRank } = require('./db');
const { generateAiComment } = require('./ai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const uploadsDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${createId('img')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('只允许上传图片'), { status: 400 }));
    }
  }
});

async function insertPointLog(connection, userId, delta, reason) {
  const [[user]] = await connection.execute('SELECT points FROM users WHERE id = ?', [userId]);
  const balance = user ? user.points : 0;
  const logId = createId('pl');
  await connection.execute(
    'INSERT INTO point_logs (id, userId, delta, balance, reason) VALUES (?, ?, ?, ?, ?)',
    [logId, userId, delta, balance, reason]
  );
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

async function isParticipant(postId, userId, post) {
  if (post.publisherId === userId) return true;
  const rows = await query(
    'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
    [postId, userId]
  );
  return rows.length > 0;
}

async function syncPostStatus(postId) {
  const rows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) return;

  const now = new Date();

  if (post.status === '招募中') {
    if (post.startTime && now >= new Date(post.startTime) && post.currentBuddies >= 1) {
      await query('UPDATE posts SET status = ? WHERE id = ?', ['进行中', postId]);
    }
    return;
  }

  if (post.status === '进行中') {
    if (post.endTime && now >= new Date(post.endTime)) {
      const deadline = new Date(now.getTime() + 32 * 60 * 60 * 1000);
      await query(
        'UPDATE posts SET status = ?, evaluationDeadline = ? WHERE id = ?',
        ['待评价', deadline, postId]
      );
    }
    return;
  }

  if (post.status === '待评价') {
    if (post.evaluationDeadline && now >= new Date(post.evaluationDeadline)) {
      await settlePost(postId);
    }
  }
}

async function settlePost(postId) {
  let participants = [];
  let settled = false;

  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE posts SET status = '已完成', progress = 100 WHERE id = ? AND status = '待评价'",
      [postId]
    );
    if (result.affectedRows === 0) return;

    const [[post]] = await connection.execute('SELECT * FROM posts WHERE id = ?', [postId]);
    const [buddyRows] = await connection.execute(
      'SELECT userId FROM post_buddies WHERE postId = ?',
      [postId]
    );
    participants = [post.publisherId, ...buddyRows.map(b => b.userId)];
    const N = participants.length;

    for (const targetId of participants) {
      const [[{ rejectCount }]] = await connection.execute(
        `SELECT COUNT(*) AS rejectCount FROM completion_votes
         WHERE postId = ? AND targetId = ? AND vote = 'incomplete'`,
        [postId, targetId]
      );
      const voterCount = N - 1;
      const isComplete = (voterCount === 0 || Number(rejectCount) * 2 < voterCount) ? 1 : 0;

      if (targetId === post.publisherId) {
        await connection.execute(
          'UPDATE posts SET publisherComplete = ? WHERE id = ?',
          [isComplete, postId]
        );
      } else {
        await connection.execute(
          'UPDATE post_buddies SET isComplete = ? WHERE postId = ? AND userId = ?',
          [isComplete, postId, targetId]
        );
      }

      if (isComplete) {
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [post.reward || 0, targetId]
        );
        await insertPointLog(connection, targetId, post.reward || 0, `完成任务《${post.title}》`);
      }
    }

    settled = true;
  });

  if (!settled) return;

  for (const targetId of participants) {
    await recalcCompletionRate(targetId);
  }

  const evaluated = await query(
    'SELECT DISTINCT toId FROM evaluations WHERE postId = ?',
    [postId]
  );
  for (const { toId } of evaluated) {
    setImmediate(() => generateAiComment(toId).catch(err =>
      console.error(`[AI] setImmediate error for ${toId}:`, err)
    ));
  }
}

function calcRecommendedScore(post, publisherUser, preferenceMap) {
  const cr = publisherUser ? (publisherUser.completionRate || 0) : 0;
  const pts = publisherUser ? Math.min((publisherUser.points || 0) / 10, 100) : 0;
  const publisherScore = cr * 0.6 + pts * 0.4;

  const rewardScore = Math.min((post.reward || 0) / 2, 50);
  const penaltyScore = Math.min((post.penalty || 0) / 2, 30);
  const hotBonus = (post.currentBuddies || 0) >= (post.maxBuddies || 1) * 0.8 ? 20 : 0;
  const postScore = rewardScore + penaltyScore + hotBonus;

  const pref = preferenceMap ? preferenceMap.get(post.category) : null;
  let prefScore = 50;
  if (pref) {
    const total = pref.doneCount * 2 + pref.abandonCount;
    prefScore = total > 0 ? (pref.doneCount * 2 / total) * 100 : 50;
  }

  return Math.round(publisherScore * 0.4 + postScore * 0.3 + prefScore * 0.3);
}

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'backend is running' });
});

async function resolveOpenid(code, devFallbackKey) {
  let wxRes;
  try {
    wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: process.env.WX_APPID,
        secret: process.env.WX_SECRET,
        js_code: code,
        grant_type: 'authorization_code'
      },
      timeout: 3000
    });
  } catch (_) {
    wxRes = { data: { errcode: -1 } };
  }

  if (wxRes.data.errcode) {
    if (!devFallbackKey) return null;
    return `dev_${devFallbackKey}`;
  }
  return wxRes.data.openid;
}

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: '缺少微信登录 code' });
    }

    const openid = await resolveOpenid(code, null);
    if (!openid) {
      return res.json({ isNewUser: true, devMode: true });
    }

    const users = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    const user = users[0];

    if (!user) {
      return res.json({ isNewUser: true });
    }

    res.json({ token: `token-${user.id}`, user: await buildUserResponse(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/bind', async (req, res, next) => {
  try {
    const { code, nickname, avatarUrl } = req.body;
    if (!code) {
      return res.status(400).json({ message: '缺少微信登录 code' });
    }
    const displayName = String(nickname || '').trim();
    if (!displayName) {
      return res.status(400).json({ message: '昵称不能为空' });
    }

    const openid = await resolveOpenid(code, displayName);
    if (!openid) {
      return res.status(400).json({ message: '无法获取微信身份，请检查 AppID/Secret 配置' });
    }

    const existing = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (existing[0]) {
      return res.json({ token: `token-${existing[0].id}`, user: await buildUserResponse(existing[0]) });
    }

    const id = createId('u');
    const displayAvatar = avatarUrl || `https://dummyimage.com/120x120/0f172a/ffffff&text=${encodeURIComponent(displayName.slice(0, 1) || 'U')}`;
    const aiComment = '欢迎加入任务搭子系统，先从一个可完成的小目标开始。';

    await query(
      'INSERT INTO users (id, openid, nickname, avatarUrl, points, completionRate, aiComment) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, openid, displayName, displayAvatar, 0, 0, aiComment]
    );

    const user = { id, openid, nickname: displayName, avatarUrl: displayAvatar, points: 0, completionRate: 0, aiComment };
    res.json({ token: `token-${id}`, user: await buildUserResponse(user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts', async (req, res, next) => {
  try {
    const { category, startAfter, endBefore, keyword, userId } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));

    // 默认只获取正常的帖子，隐藏被管理员判定为违规的
    const conditions = ["p.auditStatus = '正常'"];
    const params = [];

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }
    if (startAfter) {
      conditions.push('p.startTime >= ?');
      params.push(startAfter);
    }
    if (endBefore) {
      conditions.push('p.endTime <= ?');
      params.push(endBefore + ' 23:59:59');
    }
    if (keyword) {
      conditions.push('(p.title LIKE ? OR p.publisherName LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereClause = where ? ` ${where}` : '';

    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl,
              u.completionRate AS publisherCompletionRate,
              u.points AS publisherPoints
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id${whereClause}
       ORDER BY p.createdAt DESC`,
      params
    );

    let preferenceMap = null;
    if (userId) {
      const prefRows = await query(
        `SELECT p.category,
           SUM(CASE WHEN p.status = '已完成' THEN 1 ELSE 0 END) AS doneCount,
           SUM(CASE WHEN p.status = '已放弃' THEN 1 ELSE 0 END) AS abandonCount
         FROM post_buddies pb
         JOIN posts p ON p.id = pb.postId
         WHERE pb.userId = ?
         GROUP BY p.category`,
        [userId]
      );
      preferenceMap = new Map(
        prefRows.map(r => [r.category, { doneCount: Number(r.doneCount), abandonCount: Number(r.abandonCount) }])
      );
    }

    const scored = rows.map(row => {
      const publisherUser = row.publisherCompletionRate != null
        ? { completionRate: row.publisherCompletionRate, points: row.publisherPoints }
        : null;
      const score = calcRecommendedScore(row, publisherUser, preferenceMap);
      return { row, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const offset = (page - 1) * pageSize;
    const pageSlice = scored.slice(offset, offset + pageSize);

    res.json({
      list: pageSlice.map(({ row, score }) => ({ ...mapPost(row), recommendedScore: score })),
      total,
      page,
      pageSize,
      hasMore: offset + pageSlice.length < total
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts/:id', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const postRows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl,
              u.completionRate AS publisherCompletionRate,
              u.points AS publisherPoints
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    const postRow = postRows[0];
    if (!postRow) return res.status(404).json({ message: '帖子不存在' });

    const evidenceList = await query(
      'SELECT submitterId, submitterName, type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
      [req.params.id]
    );
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );

    const viewerId = req.query.viewerId || '';
    let evaluationsSent = [];
    let evaluationsReceived = [];
    let myCompletionVotes = {};
    if (viewerId) {
      let voteRows;
      [evaluationsSent, evaluationsReceived, voteRows] = await Promise.all([
        query(
          `SELECT e.toId, u.nickname AS toName, e.score, e.content, e.createdAt
           FROM evaluations e LEFT JOIN users u ON e.toId = u.id
           WHERE e.postId = ? AND e.fromId = ? ORDER BY e.createdAt ASC`,
          [req.params.id, viewerId]
        ),
        query(
          `SELECT e.fromId, e.fromName, e.score, e.content, e.createdAt
           FROM evaluations e
           WHERE e.postId = ? AND e.toId = ? ORDER BY e.createdAt ASC`,
          [req.params.id, viewerId]
        ),
        query(
          'SELECT targetId, vote FROM completion_votes WHERE postId = ? AND voterId = ?',
          [req.params.id, viewerId]
        )
      ]);
      myCompletionVotes = Object.fromEntries(voteRows.map(r => [r.targetId, r.vote]));
    }

    const participantIds = new Set([postRow.publisherId, ...buddies.map(b => b.userId)]);
    const evidenceSubmitters = new Set(evidenceList.map(e => e.submitterId));
    const hasEvidence = participantIds.size > 0 && [...participantIds].every(id => evidenceSubmitters.has(id));

    const publisherUser = postRow.publisherCompletionRate != null
      ? { completionRate: postRow.publisherCompletionRate, points: postRow.publisherPoints }
      : null;
    const dynamicScore = calcRecommendedScore(postRow, publisherUser, null);

    return res.json({
      post: { ...mapPost(postRow), recommendedScore: dynamicScore },
      evidenceList,
      buddies,
      hasEvidence,
      evaluationsSent,
      evaluationsReceived,
      myCompletionVotes
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
      evidenceText,
      startTime,
      endTime,
      maxBuddies
    } = req.body;

    const user = await getUserById(publisherId);
    if (!user) {
      return res.status(400).json({ message: '发布用户不存在' });
    }

    if (!title || !content) {
      return res.status(400).json({ message: '标题和内容不能为空' });
    }

    const toDatetime = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
    };

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
      auditStatus: '正常',
      buddyName: '',
      progress: 0,
      recommendedScore: 80,
      maxBuddies: Math.max(1, Number(maxBuddies) || 1),
      currentBuddies: 0,
      startTime: toDatetime(startTime),
      endTime: toDatetime(endTime)
    };

    await query(
      `INSERT INTO posts (
        id, publisherId, publisherName, title, content, reward, penalty, category,
        partnerChat, evaluationOpen, evidenceText, status, auditStatus, buddyName, progress, recommendedScore,
        maxBuddies, currentBuddies, startTime, endTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        post.auditStatus,
        post.buddyName,
        post.progress,
        post.recommendedScore,
        post.maxBuddies,
        post.currentBuddies,
        post.startTime,
        post.endTime
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

app.post('/api/posts/:id/join', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '招募中') return res.status(400).json({ message: '该帖子当前不在招募中' });
    if (post.publisherId === userId) return res.status(400).json({ message: '发布者不能加入自己的任务' });
    if (post.currentBuddies >= post.maxBuddies) return res.status(400).json({ message: '搭子人数已满，无法加入' });

    const user = await getUserById(userId);
    if (!user) return res.status(400).json({ message: '用户不存在' });

    const existing = await query('SELECT id FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    if (existing.length > 0) return res.status(400).json({ message: '你已经加入了该任务' });

    await withTransaction(async (connection) => {
      const pbId = createId('pb');
      await connection.execute(
        'INSERT INTO post_buddies (id, postId, userId, nickname) VALUES (?, ?, ?, ?)',
        [pbId, req.params.id, userId, user.nickname]
      );
      const newCount = post.currentBuddies + 1;
      const now = new Date();
      const startReached = !post.startTime || new Date(post.startTime) <= now;
      const newStatus = (newCount >= post.maxBuddies && startReached) ? '进行中' : '招募中';
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, user.nickname, newStatus, req.params.id]
      );
    });

    const fresh = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const buddies = await query('SELECT userId, nickname, joinedAt, evaluated FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC', [req.params.id]);
    res.json({ post: mapPost(fresh[0]), buddies });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/quit', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: '缺少 userId' });

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '招募中' && post.status !== '进行中') return res.status(400).json({ message: '当前状态无法退出' });

    const existing = await query('SELECT id FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    if (existing.length === 0) return res.status(400).json({ message: '你不是该任务的搭子' });

    await syncPostStatus(req.params.id);
    await withTransaction(async (connection) => {
      await connection.execute('DELETE FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
      const newCount = Math.max(0, post.currentBuddies - 1);
      const remaining = await connection.execute('SELECT nickname FROM post_buddies WHERE postId = ? ORDER BY joinedAt DESC LIMIT 1', [req.params.id]);
      const lastNickname = remaining[0][0] ? remaining[0][0].nickname : '';
      const [statusRows] = await connection.execute('SELECT status FROM posts WHERE id = ?', [req.params.id]);
      const currentStatus = statusRows[0]?.status;
      const newStatus = (currentStatus === '进行中' && newCount >= 1) ? '进行中' : '招募中';
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, lastNickname, newStatus, req.params.id]
      );
    });

    const fresh = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const buddies = await query('SELECT userId, nickname, joinedAt, evaluated FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC', [req.params.id]);
    res.json({ post: mapPost(fresh[0]), buddies });
  } catch (error) {
    next(error);
  }
});

async function requireUserId(req, res, next) {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) return res.status(400).json({ message: '缺少 userId' });
    const userRows = await query('SELECT id FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) return res.status(403).json({ message: '用户不存在' });
    req.verifiedUserId = userId;
    next();
  } catch (err) {
    next(err);
  }
}

app.post('/api/upload', requireUserId, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: '未收到文件' });
    res.json({ url: `/uploads/${req.file.filename}` });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/evidence', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId, submitterName, content } = req.body;
    if (!userId || !String(content || '').trim()) return res.status(400).json({ message: '缺少 userId 或证据内容' });
    const safeSubmitterName = String(submitterName || userId).trim();

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });

    const buddyRows = await query('SELECT id FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    const isPublisher = post.publisherId === userId;
    const isBuddy = buddyRows.length > 0;
    if (!isPublisher && !isBuddy) return res.status(403).json({ message: '只有参与者才能提交证据' });

    const now = new Date();
    const ended = post.endTime && new Date(post.endTime) <= now;
    if (post.status !== '已完成' && !ended) {
      const endStr = post.endTime ? new Date(post.endTime).toLocaleString('zh-CN') : '未设置结束时间';
      return res.status(400).json({ message: `任务尚未结束，证据须在任务完成后或到达结束时间（${endStr}）后提交` });
    }

    const id = createId('e');
    const trimmedValue = String(content).trim();
    const result = await query(
      `INSERT INTO evidences (id, postId, submitterId, submitterName, type, value) VALUES (?, ?, ?, ?, '文字', ?)
       ON DUPLICATE KEY UPDATE id = VALUES(id), submitterName = VALUES(submitterName), value = VALUES(value), createdAt = NOW()`,
      [id, req.params.id, userId, safeSubmitterName, trimmedValue]
    );

    const evidence = { id, submitterId: userId, submitterName: safeSubmitterName, type: '文字', value: trimmedValue };
    const statusCode = result.affectedRows === 1 ? 201 : 200;
    res.status(statusCode).json(evidence);
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/complete', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const current = rows[0];

    if (!current) return res.status(404).json({ message: '帖子不存在' });
    if (current.status !== '进行中') return res.status(400).json({ message: '只有进行中的任务才能标记完成' });
    if (userId && current.publisherId !== userId) return res.status(403).json({ message: '只有发布者可以标记完成' });

    await query('UPDATE posts SET status = ? WHERE id = ?', ['待评价', req.params.id]);
    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/evaluate', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId, toId, score, content } = req.body;
    if (!userId || !toId || !score || !String(content || '').trim()) return res.status(400).json({ message: '缺少参数' });
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) return res.status(400).json({ message: '评分须为 1-5 的整数' });
    if (userId === toId) return res.status(400).json({ message: '不能评价自己' });

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '待评价') return res.status(400).json({ message: '只有待评价状态的任务才能提交互评' });

    const allBuddies = await query('SELECT userId FROM post_buddies WHERE postId = ?', [req.params.id]);
    const participantIds = new Set([post.publisherId, ...allBuddies.map(b => b.userId)]);
    if (!participantIds.has(userId)) return res.status(403).json({ message: '只有参与者才能提交互评' });
    if (!participantIds.has(toId)) return res.status(400).json({ message: '被评价者不是该任务参与者' });

    const existing = await query('SELECT id FROM evaluations WHERE postId = ? AND fromId = ? AND toId = ?', [req.params.id, userId, toId]);
    if (existing.length > 0) return res.status(400).json({ message: '你已经评价过该参与者了' });

    const user = await getUserById(userId);
    const evalId = createId('ev');
    await query(
      'INSERT INTO evaluations (id, postId, fromId, fromName, toId, score, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [evalId, req.params.id, userId, user.nickname, toId, s, String(content).trim()]
    );

    await updateUserAvgScore(toId);
    const finalPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];
    res.status(201).json({ post: mapPost(finalPost) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/completion-vote', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId, targetId, vote } = req.body;
    if (!userId || !targetId || !['complete', 'incomplete'].includes(vote)) {
      return res.status(400).json({ message: '缺少参数或 vote 值非法' });
    }
    if (userId === targetId) {
      return res.status(400).json({ message: '不能对自己投票' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '待评价') {
      return res.status(400).json({ message: '只有待评价状态的任务才能投票' });
    }
    if (post.evaluationDeadline && new Date() >= new Date(post.evaluationDeadline)) {
      return res.status(403).json({ message: '评价窗口已关闭' });
    }

    const allBuddies = await query('SELECT userId FROM post_buddies WHERE postId = ?', [req.params.id]);
    const participantIds = new Set([post.publisherId, ...allBuddies.map(b => b.userId)]);
    if (!participantIds.has(userId)) {
      return res.status(403).json({ message: '只有参与者才能投票' });
    }
    if (!participantIds.has(targetId)) {
      return res.status(400).json({ message: '被投票者不是该任务参与者' });
    }

    // ON DUPLICATE KEY fires on uq_vote(postId,voterId,targetId); id is only used for new rows
    const voteId = createId('cv');
    await query(
      `INSERT INTO completion_votes (id, postId, voterId, targetId, vote)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
      [voteId, req.params.id, userId, targetId, vote]
    );

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:id/evaluations-received', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.postId, e.fromId, e.fromName, e.score, e.content, e.createdAt
       FROM evaluations e
       WHERE e.toId = ? ORDER BY e.createdAt DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

async function recalcCompletionRate(userId) {
  const [pubRows, buddyRows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total, SUM(publisherComplete = 1) AS done
       FROM posts WHERE publisherId = ? AND publisherComplete IS NOT NULL`,
      [userId]
    ),
    query(
      `SELECT COUNT(*) AS total, SUM(isComplete = 1) AS done
       FROM post_buddies WHERE userId = ? AND isComplete IS NOT NULL`,
      [userId]
    )
  ]);

  const pubTotal = Number(pubRows[0].total) || 0;
  const pubDone = Number(pubRows[0].done) || 0;
  const buddyTotal = Number(buddyRows[0].total) || 0;
  const buddyDone = Number(buddyRows[0].done) || 0;

  const total = pubTotal + buddyTotal;
  const done = pubDone + buddyDone;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;
  await query('UPDATE users SET completionRate = ? WHERE id = ?', [rate, userId]);
}

async function updateUserAvgScore(userId) {
  const rows = await query('SELECT AVG(score) AS avg FROM evaluations WHERE toId = ?', [userId]);
  const avg = rows[0] && rows[0].avg != null ? Number(rows[0].avg).toFixed(1) : null;
  await query('UPDATE users SET avgScore = ? WHERE id = ?', [avg, userId]);
}

app.post('/api/posts/:id/abandon', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: '缺少 userId' });

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.publisherId !== userId) return res.status(403).json({ message: '只有发布者可以放弃任务' });
    if (post.status !== '招募中' && post.status !== '进行中') return res.status(400).json({ message: '当前状态无法放弃' });

    await withTransaction(async (connection) => {
      await connection.execute(
        'UPDATE posts SET status = ? WHERE id = ?',
        ['已放弃', req.params.id]
      );
      await connection.execute(
        'UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?',
        [post.penalty, post.publisherId]
      );
      await insertPointLog(connection, post.publisherId, -post.penalty, `放弃任务《${post.title}》`);
    });

    await recalcCompletionRate(post.publisherId);
    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/start', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: '缺少 userId' });

    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.publisherId !== userId) return res.status(403).json({ message: '只有发布者可以手动开始任务' });
    if (post.status !== '招募中') return res.status(400).json({ message: '只有招募中的任务才能手动开始' });
    if (post.currentBuddies < 1) return res.status(400).json({ message: '至少需要一名搭子才能开始任务' });

    await query('UPDATE posts SET status = ? WHERE id = ?', ['进行中', req.params.id]);
    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/request-complete', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: '缺少 userId' });

    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '进行中') return res.status(400).json({ message: '只有进行中的任务才能申请完成' });

    const buddyRows = await query('SELECT id FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    if (buddyRows.length === 0) return res.status(403).json({ message: '只有搭子才能申请完成' });

    let requests;
    try { requests = JSON.parse(post.completionRequests || '[]'); } catch { requests = []; }
    if (requests.includes(userId)) return res.status(400).json({ message: '你已申请过完成' });

    requests.push(userId);
    await query('UPDATE posts SET completionRequests = ? WHERE id = ?', [JSON.stringify(requests), req.params.id]);

    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/ranking', async (_req, res, next) => {
  try {
    const rows = await query('SELECT id, nickname, avatarUrl, points, completionRate FROM users ORDER BY points DESC, createdAt ASC');
    res.json(rows.map((item) => ({
      id: item.id,
      name: item.nickname,
      avatarUrl: item.avatarUrl,
      points: item.points,
      rate: item.completionRate
    })));
  } catch (error) {
    next(error);
  }
});

app.put('/api/users/:id/profile', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });

    const nickname = String(req.body.nickname || '').trim();
    const avatarUrl = String(req.body.avatarUrl || '').trim();
    if (!nickname) return res.status(400).json({ message: '昵称不能为空' });

    await query('UPDATE users SET nickname = ?, avatarUrl = ? WHERE id = ?', [nickname, avatarUrl || user.avatarUrl, req.params.id]);
    await query('UPDATE posts SET publisherName = ? WHERE publisherId = ?', [nickname, req.params.id]);

    const updated = await getUserById(req.params.id);
    return res.json({ user: await buildUserResponse(updated) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:id/profile', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });

    const getPublished = () => query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       WHERE p.publisherId = ? ORDER BY p.createdAt DESC`, [req.params.id]
    );
    const getJoined = () => query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p JOIN post_buddies pb ON p.id = pb.postId LEFT JOIN users u ON p.publisherId = u.id
       WHERE pb.userId = ? ORDER BY p.createdAt DESC`, [req.params.id]
    );

    const allRows = [...(await getPublished()), ...(await getJoined())];
    for (const row of allRows) await syncPostStatus(row.id);

    const posts = [
      ...(await getPublished()).map(row => ({ ...mapPost(row), role: 'publisher' })),
      ...(await getJoined()).map(row => ({ ...mapPost(row), role: 'buddy' }))
    ];

    return res.json({ user: await buildUserResponse(user), posts });
  } catch (error) {
    next(error);
  }
});

// ======================= 新增管理员接口 ======================= //

// 管理员登录（示例使用简单的密码验证，可替换成生产环节的秘钥验证）
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    res.json({ success: true, token: 'admin_mock_token' });
  } else {
    res.status(401).json({ message: '管理员密码错误' });
  }
});

// 管理员获取全量任务列表（包含被隐藏/违规的）
app.get('/api/admin/posts', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       ORDER BY p.createdAt DESC`
    );
    res.json({ list: rows.map(mapPost) });
  } catch (error) {
    next(error);
  }
});

// 管理员更新任务审核状态（正常/违规）
app.put('/api/admin/posts/:id/audit-status', async (req, res, next) => {
  try {
    const { auditStatus } = req.body;
    if (!['正常', '违规'].includes(auditStatus)) {
      return res.status(400).json({ message: '非法状态' });
    }
    await query('UPDATE posts SET auditStatus = ? WHERE id = ?', [auditStatus, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users/:id/point-logs', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, delta, balance, reason, createdAt FROM point_logs WHERE userId = ? ORDER BY createdAt DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/posts/:id/annotations', async (req, res, next) => {
  try {
    const annotations = await query(
      `SELECT id, userId, nickname, type, content, style, x, y, createdAt
       FROM annotations WHERE postId = ? ORDER BY createdAt ASC`,
      [req.params.id]
    );
    res.json({ success: true, annotations });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/annotations', async (req, res, next) => {
  try {
    const postId = req.params.id;
    const { userId, type, content, style, x, y } = req.body;

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });

    if (!userId || !(await isParticipant(postId, userId, post))) {
      return res.status(403).json({ message: '只有任务参与者可以批注' });
    }
    if (type !== 'text' && type !== 'stamp') {
      return res.status(400).json({ message: 'type 不合法' });
    }
    if (!String(content || '').trim()) {
      return res.status(400).json({ message: '批注内容不能为空' });
    }
    const nx = Number(x), ny = Number(y);
    if (!(nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100)) {
      return res.status(400).json({ message: '坐标超出范围' });
    }

    const countRows = await query(
      'SELECT COUNT(*) AS cnt FROM annotations WHERE postId = ? AND userId = ?',
      [postId, userId]
    );
    if (countRows[0].cnt >= 20) {
      return res.status(400).json({ message: '你在该帖的批注已达上限(20 条)' });
    }

    const user = await getUserById(userId);
    if (!user) return res.status(400).json({ message: '用户不存在' });

    const id = createId('ann');
    const styleStr = typeof style === 'string' ? style : JSON.stringify(style || {});
    await query(
      `INSERT INTO annotations (id, postId, userId, nickname, type, content, style, x, y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, postId, userId, user.nickname, type, String(content), styleStr, nx, ny]
    );

    const rows = await query(
      `SELECT id, userId, nickname, type, content, style, x, y, createdAt
       FROM annotations WHERE id = ?`,
      [id]
    );
    res.json({ success: true, annotation: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/posts/:id/annotations/:annId', async (req, res, next) => {
  try {
    const { id: postId, annId } = req.params;
    const { userId } = req.body;

    const annRows = await query('SELECT * FROM annotations WHERE id = ? AND postId = ?', [annId, postId]);
    const ann = annRows[0];
    if (!ann) return res.status(404).json({ message: '批注不存在' });

    const postRows = await query('SELECT publisherId FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    const isOwner = ann.userId === userId;
    const isPublisher = post && post.publisherId === userId;
    if (!isOwner && !isPublisher) {
      return res.status(403).json({ message: '无权删除该批注' });
    }

    await query('DELETE FROM annotations WHERE id = ?', [annId]);
    res.json({ success: true });
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