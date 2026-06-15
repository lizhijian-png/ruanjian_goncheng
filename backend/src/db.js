require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '123456',
  database: process.env.MYSQL_DATABASE || 'task_buddy',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};


let pool;

function createPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }

  return pool;
}

function mapPost(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    publisherId: row.publisherId,
    publisher: row.publisherName,
    publisherAvatarUrl: row.publisherAvatarUrl || '',
    title: row.title,
    content: row.content,
    reward: row.reward,
    penalty: row.penalty,
    category: row.category,
    partnerChat: Boolean(row.partnerChat),
    evaluationOpen: Boolean(row.evaluationOpen),
    evidenceText: row.evidenceText,
    status: row.status,
    auditStatus: row.auditStatus || '正常', // 新增：审核状态
    buddy: row.buddyName,
    progress: row.progress,
    recommendedScore: row.recommendedScore,
    maxBuddies: row.maxBuddies != null ? row.maxBuddies : 1,
    currentBuddies: row.currentBuddies != null ? row.currentBuddies : 0,
    startTime: row.startTime || null,
    endTime: row.endTime || null,
    createdAt: row.createdAt,
    completionRequests: (() => {
      try { return JSON.parse(row.completionRequests || '[]'); } catch { return []; }
    })(),
    evaluationDeadline: row.evaluationDeadline || null,
  };
}

async function query(sql, params = []) {
  const db = createPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function withTransaction(callback) {
  const db = createPool();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createDatabaseIfNeeded() {
  const { host, port, user, password, database } = dbConfig;
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    charset: 'utf8mb4'
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

async function createTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      openid VARCHAR(100) UNIQUE,
      nickname VARCHAR(100) NOT NULL,
      avatarUrl TEXT NOT NULL,
      points INT NOT NULL DEFAULT 0,
      completionRate INT NOT NULL DEFAULT 0,
      aiComment TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const cols = await query(`SHOW COLUMNS FROM users LIKE 'openid'`);
  if (cols.length === 0) {
    await query(`ALTER TABLE users ADD COLUMN openid VARCHAR(100) UNIQUE AFTER id`);
  }

  const avatarCol = await query(`SHOW COLUMNS FROM users LIKE 'avatarUrl'`);
  if (avatarCol.length > 0 && avatarCol[0].Type.toLowerCase().includes('varchar')) {
    await query(`ALTER TABLE users MODIFY COLUMN avatarUrl TEXT NOT NULL`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id VARCHAR(64) PRIMARY KEY,
      publisherId VARCHAR(64) NOT NULL,
      publisherName VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      reward INT NOT NULL,
      penalty INT NOT NULL,
      category VARCHAR(50) NOT NULL,
      partnerChat TINYINT(1) NOT NULL DEFAULT 1,
      evaluationOpen TINYINT(1) NOT NULL DEFAULT 1,
      evidenceText TEXT NOT NULL,
      status VARCHAR(50) NOT NULL,
      auditStatus ENUM('正常', '违规') NOT NULL DEFAULT '正常',
      buddyName VARCHAR(100) NOT NULL DEFAULT '',
      progress INT NOT NULL DEFAULT 0,
      recommendedScore INT NOT NULL DEFAULT 80,
      startTime DATETIME DEFAULT NULL,
      endTime DATETIME DEFAULT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_posts_user FOREIGN KEY (publisherId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const startCol = await query(`SHOW COLUMNS FROM posts LIKE 'startTime'`);
  if (startCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN startTime DATETIME DEFAULT NULL`);
    await query(`ALTER TABLE posts ADD COLUMN endTime DATETIME DEFAULT NULL`);
  }

  // 兼容旧表：管理员状态枚举
  const auditStatusCol = await query(`SHOW COLUMNS FROM posts LIKE 'auditStatus'`);
  if (auditStatusCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN auditStatus ENUM('正常', '违规') NOT NULL DEFAULT '正常' AFTER status`);
  }

  const maxBuddiesCol = await query(`SHOW COLUMNS FROM posts LIKE 'maxBuddies'`);
  if (maxBuddiesCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN maxBuddies INT NOT NULL DEFAULT 1 AFTER buddyName`);
    await query(`ALTER TABLE posts ADD COLUMN currentBuddies INT NOT NULL DEFAULT 0 AFTER maxBuddies`);
  }

  const pubEvalCol = await query(`SHOW COLUMNS FROM posts LIKE 'publisherEvaluated'`);
  if (pubEvalCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN publisherEvaluated TINYINT(1) NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE posts ADD COLUMN buddyEvaluated TINYINT(1) NOT NULL DEFAULT 0`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS post_buddies (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      userId VARCHAR(64) NOT NULL,
      nickname VARCHAR(100) NOT NULL,
      joinedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_post_user (postId, userId),
      CONSTRAINT fk_pb_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_pb_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS evidences (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      submitterId VARCHAR(64) NOT NULL DEFAULT '',
      submitterName VARCHAR(100) NOT NULL DEFAULT '',
      type VARCHAR(50) NOT NULL,
      value TEXT NOT NULL,
      imageUrls TEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_evidence_post_user (postId, submitterId),
      CONSTRAINT fk_evidences_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      fromId VARCHAR(64) NULL,
      fromName VARCHAR(100) NOT NULL,
      score INT NOT NULL,
      content TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_evaluations_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const fromIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'fromId'`);
  if (fromIdCol.length === 0) {
    await query(`ALTER TABLE evaluations ADD COLUMN fromId VARCHAR(64) NULL AFTER postId`);
  }

  const completionRequestsCol = await query(`SHOW COLUMNS FROM posts LIKE 'completionRequests'`);
  if (completionRequestsCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN completionRequests TEXT NULL`);
  }

  const evidenceSubmitterCol = await query(`SHOW COLUMNS FROM evidences LIKE 'submitterId'`);
  if (evidenceSubmitterCol.length === 0) {
    await query(`
      ALTER TABLE evidences
        ADD COLUMN submitterId VARCHAR(64) NOT NULL DEFAULT '' AFTER postId,
        ADD COLUMN submitterName VARCHAR(100) NOT NULL DEFAULT '' AFTER submitterId
    `);
  }
  const evidenceImageUrlsCol = await query(`SHOW COLUMNS FROM evidences LIKE 'imageUrls'`);
  if (evidenceImageUrlsCol.length === 0) {
    await query(`ALTER TABLE evidences ADD COLUMN imageUrls TEXT NULL AFTER value`);
  }

  const evidenceUniqueKey = await query(`
    SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'evidences'
      AND CONSTRAINT_NAME = 'uq_evidence_post_user'
  `);
  if (evidenceUniqueKey.length === 0) {
    await query(`UPDATE evidences SET submitterId = CONCAT('legacy_', id) WHERE submitterId = ''`);
    await query(`
      ALTER TABLE evidences
        ADD UNIQUE KEY uq_evidence_post_user (postId, submitterId)
    `);
  }

  const pbEvaluatedCol = await query(`SHOW COLUMNS FROM post_buddies LIKE 'evaluated'`);
  if (pbEvaluatedCol.length === 0) {
    await query(`ALTER TABLE post_buddies ADD COLUMN evaluated TINYINT(1) NOT NULL DEFAULT 0`);
  }

  const evalToIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'toId'`);
  if (evalToIdCol.length === 0) {
    await query(`ALTER TABLE evaluations ADD COLUMN toId VARCHAR(64) NOT NULL DEFAULT '' AFTER fromId`);
    await query(`ALTER TABLE evaluations ADD UNIQUE KEY uq_eval_from_to (postId, fromId, toId)`);
  }

  const evalDeadlineCol = await query(`SHOW COLUMNS FROM posts LIKE 'evaluationDeadline'`);
  if (evalDeadlineCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN evaluationDeadline DATETIME DEFAULT NULL`);
  }

  const avgScoreCol = await query(`SHOW COLUMNS FROM users LIKE 'avgScore'`);
  if (avgScoreCol.length === 0) {
    await query(`ALTER TABLE users ADD COLUMN avgScore DECIMAL(3,1) DEFAULT NULL`);
  }

  const evalToIdIdx = await query(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evaluations' AND INDEX_NAME = 'idx_eval_toId'
  `);
  if (evalToIdIdx.length === 0) {
    await query(`ALTER TABLE evaluations ADD INDEX idx_eval_toId (toId)`);
  }

  // 积分历史记录表
  await query(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id VARCHAR(64) PRIMARY KEY,
      userId VARCHAR(64) NOT NULL,
      delta INT NOT NULL,
      balance INT NOT NULL,
      reason VARCHAR(255) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_point_logs_userId (userId),
      CONSTRAINT fk_pl_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 帖子批注表(文字批注 + 表情印章)
  await query(`
    CREATE TABLE IF NOT EXISTS annotations (
      id          VARCHAR(64) PRIMARY KEY,
      postId      VARCHAR(64) NOT NULL,
      userId      VARCHAR(64) NOT NULL,
      nickname    VARCHAR(100) NOT NULL,
      type        VARCHAR(20) NOT NULL,
      content     TEXT NOT NULL,
      style       TEXT NOT NULL,
      x           DECIMAL(5,2) NOT NULL,
      y           DECIMAL(5,2) NOT NULL,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deletedAt   DATETIME NULL DEFAULT NULL,
      INDEX idx_annotations_post (postId),
      CONSTRAINT fk_annotations_post FOREIGN KEY (postId)
        REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_annotations_user FOREIGN KEY (userId)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 批注点赞表(一个用户对一条批注最多一个赞,UNIQUE 实现切换)
  await query(`
    CREATE TABLE IF NOT EXISTS annotation_likes (
      id          VARCHAR(64) PRIMARY KEY,
      annId       VARCHAR(64) NOT NULL,
      userId      VARCHAR(64) NOT NULL,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_anno_like (annId, userId),
      INDEX idx_anno_like_ann (annId),
      CONSTRAINT fk_anno_like_ann FOREIGN KEY (annId)
        REFERENCES annotations(id) ON DELETE CASCADE,
      CONSTRAINT fk_anno_like_user FOREIGN KEY (userId)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 批注回复表(一条批注多条回复)
  await query(`
    CREATE TABLE IF NOT EXISTS annotation_replies (
      id          VARCHAR(64) PRIMARY KEY,
      annId       VARCHAR(64) NOT NULL,
      userId      VARCHAR(64) NOT NULL,
      nickname    VARCHAR(100) NOT NULL,
      content     VARCHAR(200) NOT NULL,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_anno_reply_ann (annId),
      CONSTRAINT fk_anno_reply_ann FOREIGN KEY (annId)
        REFERENCES annotations(id) ON DELETE CASCADE,
      CONSTRAINT fk_anno_reply_user FOREIGN KEY (userId)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // completion_votes 表：记录参与者对他人完成情况的投票
  await query(`
    CREATE TABLE IF NOT EXISTS completion_votes (
      id        VARCHAR(64) PRIMARY KEY,
      postId    VARCHAR(64) NOT NULL,
      voterId   VARCHAR(64) NOT NULL,
      targetId  VARCHAR(64) NOT NULL,
      vote      ENUM('complete', 'incomplete') NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vote (postId, voterId, targetId),
      INDEX idx_cv_post_target (postId, targetId),
      CONSTRAINT fk_cv_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_cv_voter FOREIGN KEY (voterId) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_cv_target FOREIGN KEY (targetId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // post_buddies 表新增 isComplete 字段（NULL=未结算, 0=未完成, 1=已完成）
  const pbIsCompleteCol = await query(`SHOW COLUMNS FROM post_buddies LIKE 'isComplete'`);
  if (pbIsCompleteCol.length === 0) {
    await query(`ALTER TABLE post_buddies ADD COLUMN isComplete TINYINT(1) DEFAULT NULL`);
  }

  // posts 表新增 publisherComplete 字段（NULL=未结算, 0=未完成, 1=已完成）
  const publisherCompleteCol = await query(`SHOW COLUMNS FROM posts LIKE 'publisherComplete'`);
  if (publisherCompleteCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN publisherComplete TINYINT(1) DEFAULT NULL`);
  }

  // annotations 表新增 deletedAt 字段（软删除：NULL=正常, 非空=已进回收站）
  const annoDeletedAtCol = await query(`SHOW COLUMNS FROM annotations LIKE 'deletedAt'`);
  if (annoDeletedAtCol.length === 0) {
    await query(`ALTER TABLE annotations ADD COLUMN deletedAt DATETIME NULL DEFAULT NULL`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      postId      VARCHAR(64) NOT NULL,
      senderId    VARCHAR(64) NOT NULL,
      senderName  VARCHAR(100) NOT NULL,
      content     TEXT NOT NULL,
      createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_postId_createdAt (postId, createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 通知表
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            VARCHAR(64) PRIMARY KEY,
      userId        VARCHAR(64) NOT NULL,
      postId        VARCHAR(64) NOT NULL,
      type          VARCHAR(30) NOT NULL,
      relatedUserId VARCHAR(64) DEFAULT NULL,
      content       TEXT NOT NULL,
      isRead        TINYINT(1) NOT NULL DEFAULT 0,
      createdAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notify_user_read (userId, isRead, createdAt),
      INDEX idx_notify_user_post (userId, postId, type, isRead),
      CONSTRAINT fk_notify_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notify_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 聊天已读标记表
  await query(`
    CREATE TABLE IF NOT EXISTS chat_read_markers (
      userId      VARCHAR(64) NOT NULL,
      postId      VARCHAR(64) NOT NULL,
      lastReadAt  DATETIME NOT NULL,
      UNIQUE KEY uq_chat_read (userId, postId),
      CONSTRAINT fk_crm_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getUserRank(userId) {
  const rows = await query(
    `SELECT COUNT(*) + 1 AS \`rank\`
     FROM users AS a
     INNER JOIN users AS b ON b.id = ?
     WHERE a.points > b.points
        OR (a.points = b.points AND a.createdAt < b.createdAt)`,
    [userId]
  );
  return rows[0] ? rows[0].rank : null;
}

async function initDb() {
  await createDatabaseIfNeeded();
  createPool();
  await createTables();
}

async function insertMessage(postId, senderId, senderName, content) {
  const [result] = await createPool().execute(
    'INSERT INTO messages (postId, senderId, senderName, content) VALUES (?, ?, ?, ?)',
    [postId, senderId, senderName, content]
  );
  return result.insertId;
}

async function getRecentMessages(postId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await query(
    `SELECT id, senderId, senderName, content, createdAt
     FROM messages WHERE postId = ? ORDER BY createdAt ASC LIMIT ${safeLimit}`,
    [postId]
  );
  return rows;
}

async function deleteMessagesByPost(postId) {
  await query('DELETE FROM messages WHERE postId = ?', [postId]);
}

// ================== 通知相关 ==================

async function insertNotification(notification) {
  const { id, userId, postId, type, relatedUserId, content } = notification;
  await query(
    'INSERT INTO notifications (id, userId, postId, type, relatedUserId, content) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, postId, type, relatedUserId || null, content]
  );
}

async function getUnreadCounts(userId, postId) {
  const notifRows = await query(
    `SELECT type, COUNT(*) AS cnt FROM notifications
     WHERE userId = ? AND postId = ? AND isRead = 0
     GROUP BY type`,
    [userId, postId]
  );
  const byType = {};
  let total = 0;
  for (const row of notifRows) {
    const n = Number(row.cnt);
    byType[row.type] = n;
    total += n;
  }

  // 聊天未读数: 只算他人的消息,自己的不计入未读
  const markerRows = await query(
    'SELECT lastReadAt FROM chat_read_markers WHERE userId = ? AND postId = ?',
    [userId, postId]
  );
  let chatCount = 0;
  if (markerRows[0]) {
    const [chatRows] = await createPool().execute(
      'SELECT COUNT(*) AS cnt FROM messages WHERE postId = ? AND createdAt > ? AND senderId != ?',
      [postId, markerRows[0].lastReadAt, userId]
    );
    chatCount = Number(chatRows[0].cnt);
  } else {
    const [chatRows] = await createPool().execute(
      'SELECT COUNT(*) AS cnt FROM messages WHERE postId = ? AND senderId != ?',
      [postId, userId]
    );
    chatCount = Number(chatRows[0].cnt);
  }

  return { ...byType, chat: chatCount, total: total + chatCount };
}

async function markNotificationsRead(userId, postId, type) {
  await query(
    'UPDATE notifications SET isRead = 1 WHERE userId = ? AND postId = ? AND type = ? AND isRead = 0',
    [userId, postId, type]
  );
}

async function upsertChatReadMarker(userId, postId) {
  await query(
    `INSERT INTO chat_read_markers (userId, postId, lastReadAt) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE lastReadAt = NOW()`,
    [userId, postId]
  );
}

module.exports = {
  dbConfig,
  initDb,
  mapPost,
  query,
  withTransaction,
  getUserRank,
  insertMessage,
  getRecentMessages,
  deleteMessagesByPost,
  insertNotification,
  getUnreadCounts,
  markNotificationsRead,
  upsertChatReadMarker
};