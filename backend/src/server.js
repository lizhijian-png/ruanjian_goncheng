const express = require('express');
const cors = require('cors');
const axios = require('axios');
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

// 解析微信 code → openid，开发环境自动降级
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
    // 开发环境 / 模拟器降级：用传入的 key 构造固定 openid
    if (!devFallbackKey) return null;
    return `dev_${devFallbackKey}`;
  }
  return wxRes.data.openid;
}

// 登录：openid 已存在返回用户，新用户返回 isNewUser:true
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: '缺少微信登录 code' });
    }

    // 开发降级时 openid 为 null（无法确定身份），直接告知前端是新用户
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

// 绑定：首次登录时创建用户（昵称 + 头像来自微信授权）
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

    // 开发降级：用昵称作为 key
    const openid = await resolveOpenid(code, displayName);
    if (!openid) {
      return res.status(400).json({ message: '无法获取微信身份，请检查 AppID/Secret 配置' });
    }

    // 若已存在（重复绑定），直接返回已有用户
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
    const { category, startAfter, endBefore, keyword } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;

    const conditions = [];
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

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM posts p LEFT JOIN users u ON p.publisherId = u.id ${where}`,
      params
    );
    const total = countRows[0].total;

    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       ${where} ORDER BY p.createdAt DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      list: rows.map(mapPost),
      total,
      page,
      pageSize,
      hasMore: offset + rows.length < total
    });
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
      'SELECT fromId, fromName AS `from`, score, content FROM evaluations WHERE postId = ? ORDER BY createdAt ASC',
      [req.params.id]
    );
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
    const hasEvidence = evidenceList.length > 0;

    return res.json({
      post: mapPost(postRow),
      evidenceList,
      evaluations,
      buddies,
      hasEvidence
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
        partnerChat, evaluationOpen, evidenceText, status, buddyName, progress, recommendedScore,
        maxBuddies, currentBuddies, startTime, endTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.status !== '招募中') {
      return res.status(400).json({ message: '该帖子当前不在招募中' });
    }
    if (post.publisherId === userId) {
      return res.status(400).json({ message: '发布者不能加入自己的任务' });
    }
    if (post.currentBuddies >= post.maxBuddies) {
      return res.status(400).json({ message: '搭子人数已满，无法加入' });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }

    const existing = await query(
      'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: '你已经加入了该任务' });
    }

    await withTransaction(async (connection) => {
      const pbId = createId('pb');
      await connection.execute(
        'INSERT INTO post_buddies (id, postId, userId, nickname) VALUES (?, ?, ?, ?)',
        [pbId, req.params.id, userId, user.nickname]
      );

      const newCount = post.currentBuddies + 1;
      const newStatus = newCount >= post.maxBuddies ? '进行中' : '招募中';
      // buddyName 记录最后一位（保持向后兼容）
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, user.nickname, newStatus, req.params.id]
      );
    });

    const fresh = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
    res.json({ post: mapPost(fresh[0]), buddies });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/quit', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.status !== '招募中' && post.status !== '进行中') {
      return res.status(400).json({ message: '当前状态无法退出' });
    }

    const existing = await query(
      'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
    if (existing.length === 0) {
      return res.status(400).json({ message: '你不是该任务的搭子' });
    }

    await withTransaction(async (connection) => {
      await connection.execute(
        'DELETE FROM post_buddies WHERE postId = ? AND userId = ?',
        [req.params.id, userId]
      );

      const newCount = Math.max(0, post.currentBuddies - 1);
      // 退出后回到招募中；buddyName 退回到剩余最后一位，若无则清空
      const remaining = await connection.execute(
        'SELECT nickname FROM post_buddies WHERE postId = ? ORDER BY joinedAt DESC LIMIT 1',
        [req.params.id]
      );
      const lastNickname = remaining[0][0] ? remaining[0][0].nickname : '';
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, lastNickname, '招募中', req.params.id]
      );
    });

    const fresh = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
    res.json({ post: mapPost(fresh[0]), buddies });
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/evidence', async (req, res, next) => {
  try {
    const { userId, content } = req.body;
    if (!userId || !String(content || '').trim()) {
      return res.status(400).json({ message: '缺少 userId 或证据内容' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    // 只有参与者（发布者或搭子）才能提交
    const buddyRows = await query(
      'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
    const isPublisher = post.publisherId === userId;
    const isBuddy = buddyRows.length > 0;
    if (!isPublisher && !isBuddy) {
      return res.status(403).json({ message: '只有参与者才能提交证据' });
    }

    // 允许提交的条件：状态为"已完成"，或已过 endTime
    const now = new Date();
    const ended = post.endTime && new Date(post.endTime) <= now;
    if (post.status !== '已完成' && !ended) {
      const endStr = post.endTime
        ? new Date(post.endTime).toLocaleString('zh-CN')
        : '未设置结束时间';
      return res.status(400).json({
        message: `任务尚未结束，证据须在任务完成后或到达结束时间（${endStr}）后提交`
      });
    }

    const id = createId('e');
    await query(
      'INSERT INTO evidences (id, postId, type, value) VALUES (?, ?, ?, ?)',
      [id, req.params.id, '文字', String(content).trim()]
    );

    const evidence = { id, type: '文字', value: String(content).trim() };
    res.status(201).json(evidence);
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/complete', async (req, res, next) => {
  try {
    const { userId } = req.body;
    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const current = rows[0];

    if (!current) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (current.status !== '进行中') {
      return res.status(400).json({ message: '只有进行中的任务才能标记完成' });
    }
    if (userId && current.publisherId !== userId) {
      return res.status(403).json({ message: '只有发布者可以标记完成' });
    }

    // 进行中 → 待评价（积分在双方互评完成后结算）
    await query('UPDATE posts SET status = ? WHERE id = ?', ['待评价', req.params.id]);

    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/api/posts/:id/evaluate', async (req, res, next) => {
  try {
    const { userId, score, content } = req.body;
    if (!userId || !score || !String(content || '').trim()) {
      return res.status(400).json({ message: '缺少 userId、score 或评价内容' });
    }
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      return res.status(400).json({ message: '评分须为 1-5 的整数' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.status !== '待评价') {
      return res.status(400).json({ message: '只有待评价状态的任务才能提交互评' });
    }

    // 判断当前用户是发布者还是搭子
    const isPublisher = post.publisherId === userId;
    const buddyRows = await query(
      'SELECT userId, nickname FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
    const isBuddy = buddyRows.length > 0;
    if (!isPublisher && !isBuddy) {
      return res.status(403).json({ message: '只有参与者才能提交互评' });
    }

    // 防重复提交
    if (isPublisher && post.publisherEvaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }
    if (isBuddy && post.buddyEvaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }

    // 必须：已过结束时间 且 已有证据
    const now = new Date();
    if (post.endTime && new Date(post.endTime) > now) {
      return res.status(400).json({ message: '任务尚未到结束时间，不能提交互评' });
    }
    const evidences = await query('SELECT id FROM evidences WHERE postId = ? LIMIT 1', [req.params.id]);
    if (evidences.length === 0) {
      return res.status(400).json({ message: '对方尚未上传证据，不能提交互评' });
    }

    const user = await getUserById(userId);
    const evalId = createId('ev');
    await query(
      'INSERT INTO evaluations (id, postId, fromId, fromName, score, content) VALUES (?, ?, ?, ?, ?, ?)',
      [evalId, req.params.id, userId, user.nickname, s, String(content).trim()]
    );

    // 更新对应标志位
    const flagField = isPublisher ? 'publisherEvaluated' : 'buddyEvaluated';
    await query(`UPDATE posts SET ${flagField} = 1 WHERE id = ?`, [req.params.id]);

    // 重新读取最新 post 状态
    const freshPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];

    // 双方都已评价 → 已完成，结算积分
    if (freshPost.publisherEvaluated && freshPost.buddyEvaluated) {
      await withTransaction(async (connection) => {
        await connection.execute(
          'UPDATE posts SET status = ?, progress = 100 WHERE id = ?',
          ['已完成', req.params.id]
        );
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [freshPost.reward, freshPost.publisherId]
        );
      });
      await recalcCompletionRate(freshPost.publisherId);
    }

    const finalPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];
    res.status(201).json({ post: mapPost(finalPost) });
  } catch (error) {
    next(error);
  }
});

async function recalcCompletionRate(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS total, SUM(status = '已完成') AS done FROM posts WHERE publisherId = ?`,
    [userId]
  );
  const { total, done } = rows[0];
  const rate = total > 0 ? Math.round(((done || 0) / total) * 100) : 0;
  await query('UPDATE users SET completionRate = ? WHERE id = ?', [rate, userId]);
}

app.post('/api/posts/:id/abandon', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.publisherId !== userId) {
      return res.status(403).json({ message: '只有发布者可以放弃任务' });
    }
    if (post.status !== '招募中' && post.status !== '进行中') {
      return res.status(400).json({ message: '当前状态无法放弃' });
    }

    await withTransaction(async (connection) => {
      await connection.execute(
        'UPDATE posts SET status = ? WHERE id = ?',
        ['已放弃', req.params.id]
      );
      await connection.execute(
        'UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?',
        [post.penalty, post.publisherId]
      );
    });

    await recalcCompletionRate(post.publisherId);

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
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const nickname = String(req.body.nickname || '').trim();
    const avatarUrl = String(req.body.avatarUrl || '').trim();

    if (!nickname) {
      return res.status(400).json({ message: '昵称不能为空' });
    }

    await query(
      'UPDATE users SET nickname = ?, avatarUrl = ? WHERE id = ?',
      [nickname, avatarUrl || user.avatarUrl, req.params.id]
    );

    await query(
      'UPDATE posts SET publisherName = ? WHERE publisherId = ?',
      [nickname, req.params.id]
    );

    const updated = await getUserById(req.params.id);
    return res.json({ user: await buildUserResponse(updated) });
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
