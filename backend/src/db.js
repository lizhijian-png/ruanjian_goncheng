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

  // 兼容旧表：若 openid 列不存在则补加
  const cols = await query(`SHOW COLUMNS FROM users LIKE 'openid'`);
  if (cols.length === 0) {
    await query(`ALTER TABLE users ADD COLUMN openid VARCHAR(100) UNIQUE AFTER id`);
  }

  // 兼容旧表：avatarUrl 扩展为 TEXT 以支持 Base64 头像
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
      buddyName VARCHAR(100) NOT NULL DEFAULT '',
      progress INT NOT NULL DEFAULT 0,
      recommendedScore INT NOT NULL DEFAULT 80,
      startTime DATETIME DEFAULT NULL,
      endTime DATETIME DEFAULT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_posts_user FOREIGN KEY (publisherId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 兼容旧表：若 startTime/endTime 列不存在则补加
  const startCol = await query(`SHOW COLUMNS FROM posts LIKE 'startTime'`);
  if (startCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN startTime DATETIME DEFAULT NULL`);
    await query(`ALTER TABLE posts ADD COLUMN endTime DATETIME DEFAULT NULL`);
  }

  // 兼容旧表：搭子人数限制字段
  const maxBuddiesCol = await query(`SHOW COLUMNS FROM posts LIKE 'maxBuddies'`);
  if (maxBuddiesCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN maxBuddies INT NOT NULL DEFAULT 1 AFTER buddyName`);
    await query(`ALTER TABLE posts ADD COLUMN currentBuddies INT NOT NULL DEFAULT 0 AFTER maxBuddies`);
  }

  // 兼容旧表：互评标志位
  const pubEvalCol = await query(`SHOW COLUMNS FROM posts LIKE 'publisherEvaluated'`);
  if (pubEvalCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN publisherEvaluated TINYINT(1) NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE posts ADD COLUMN buddyEvaluated TINYINT(1) NOT NULL DEFAULT 0`);
  }

  // 搭子关联表：记录每个加入的搭子
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

  // 兼容旧表：evaluations 加 fromId
  const fromIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'fromId'`);
  if (fromIdCol.length === 0) {
    await query(`ALTER TABLE evaluations ADD COLUMN fromId VARCHAR(64) NULL AFTER postId`);
  }

  // 兼容旧表：搭子完成申请记录
  const completionRequestsCol = await query(`SHOW COLUMNS FROM posts LIKE 'completionRequests'`);
  if (completionRequestsCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN completionRequests TEXT NULL`);
  }

  // 兼容旧表：evidences 加 submitterId / submitterName / unique key
  const evidenceSubmitterCol = await query(`SHOW COLUMNS FROM evidences LIKE 'submitterId'`);
  if (evidenceSubmitterCol.length === 0) {
    await query(`
      ALTER TABLE evidences
        ADD COLUMN submitterId VARCHAR(64) NOT NULL DEFAULT '' AFTER postId,
        ADD COLUMN submitterName VARCHAR(100) NOT NULL DEFAULT '' AFTER submitterId
    `);
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

  // 兼容旧表：post_buddies 加 evaluated 标志位（替代 posts.buddyEvaluated）
  const pbEvaluatedCol = await query(`SHOW COLUMNS FROM post_buddies LIKE 'evaluated'`);
  if (pbEvaluatedCol.length === 0) {
    await query(`ALTER TABLE post_buddies ADD COLUMN evaluated TINYINT(1) NOT NULL DEFAULT 0`);
  }

  // 迁移：evaluations 加 toId（被评价者）
  // 假设旧数据中 (postId, fromId) 无重复行；若有重复，ADD UNIQUE KEY 会报错需手动清理
  const evalToIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'toId'`);
  if (evalToIdCol.length === 0) {
    await query(`ALTER TABLE evaluations ADD COLUMN toId VARCHAR(64) NOT NULL DEFAULT '' AFTER fromId`);
    await query(`ALTER TABLE evaluations ADD UNIQUE KEY uq_eval_from_to (postId, fromId, toId)`);
  }

  // 迁移：posts 加 evaluationDeadline
  const evalDeadlineCol = await query(`SHOW COLUMNS FROM posts LIKE 'evaluationDeadline'`);
  if (evalDeadlineCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN evaluationDeadline DATETIME DEFAULT NULL`);
  }

  // 迁移：users 加 avgScore
  const avgScoreCol = await query(`SHOW COLUMNS FROM users LIKE 'avgScore'`);
  if (avgScoreCol.length === 0) {
    await query(`ALTER TABLE users ADD COLUMN avgScore DECIMAL(3,1) DEFAULT NULL`);
  }

  // 迁移：evaluations.toId 加独立索引，加速 WHERE toId=? 查询
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
      INDEX idx_annotations_post (postId),
      CONSTRAINT fk_annotations_post FOREIGN KEY (postId)
        REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_annotations_user FOREIGN KEY (userId)
        REFERENCES users(id) ON DELETE CASCADE
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

module.exports = {
  dbConfig,
  initDb,
  mapPost,
  query,
  withTransaction,
  getUserRank
};
