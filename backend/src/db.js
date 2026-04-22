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

const seedUsers = [
  {
    id: 'u_1',
    nickname: '晨间推进器',
    avatarUrl: 'https://dummyimage.com/120x120/f97316/ffffff&text=1',
    points: 186,
    completionRate: 92,
    aiComment: '执行节奏稳定，适合带动长期任务打卡。'
  },
  {
    id: 'u_2',
    nickname: 'DDL 守门员',
    avatarUrl: 'https://dummyimage.com/120x120/0f172a/ffffff&text=2',
    points: 154,
    completionRate: 89,
    aiComment: '擅长以 deadline 驱动行动，适合中短期冲刺任务。'
  },
  {
    id: 'u_1001',
    nickname: '凌晨自习搭子',
    avatarUrl: 'https://dummyimage.com/120x120/0f172a/ffffff&text=A',
    points: 128,
    completionRate: 86,
    aiComment: '你是高执行力型用户，擅长把公开承诺转化成完成记录，适合担任任务发起人。'
  },
  {
    id: 'u_4',
    nickname: '高数突击手',
    avatarUrl: 'https://dummyimage.com/120x120/1d4ed8/ffffff&text=4',
    points: 116,
    completionRate: 82,
    aiComment: '适合目标明确的知识型任务，后劲较强。'
  }
];

const seedPosts = [
  {
    id: 'p_001',
    publisherId: 'u_1001',
    publisherName: '凌晨自习搭子',
    title: '早八背单词打卡 14 天',
    content: '每天 7:20 上传 50 个单词截图，想找一起早起监督的搭子。',
    reward: 15,
    penalty: 8,
    category: '学习',
    partnerChat: 1,
    evaluationOpen: 1,
    evidenceText: '上传 50 个单词截图，并补充当天复盘。',
    status: '进行中',
    buddyName: '图书馆常驻选手',
    progress: 71,
    recommendedScore: 96
  },
  {
    id: 'p_002',
    publisherId: 'u_2',
    publisherName: 'DDL 守门员',
    title: '晚跑 5 公里互相监督',
    content: '上传跑步记录和配速截图，连续一周完成可加积分。',
    reward: 20,
    penalty: 10,
    category: '运动',
    partnerChat: 0,
    evaluationOpen: 1,
    evidenceText: '上传跑步记录截图与当日体感文字。',
    status: '招募中',
    buddyName: '',
    progress: 43,
    recommendedScore: 88
  }
];

const seedEvidences = [
  {
    id: 'e_001',
    postId: 'p_001',
    type: '图片',
    value: '跑步截图 / 学习时长截图'
  },
  {
    id: 'e_002',
    postId: 'p_001',
    type: '文字',
    value: '补充完成过程和反思'
  }
];

const seedEvaluations = [
  {
    id: 'v_001',
    postId: 'p_001',
    fromName: '晨读引擎',
    score: 5,
    content: '反馈及时，任务执行稳定。'
  },
  {
    id: 'v_002',
    postId: 'p_001',
    fromName: '图书馆常驻选手',
    score: 4,
    content: '证据上传清晰，完成情况可信。'
  }
];

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
    createdAt: row.createdAt
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
      nickname VARCHAR(100) NOT NULL UNIQUE,
      avatarUrl VARCHAR(255) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      completionRate INT NOT NULL DEFAULT 0,
      aiComment TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_posts_user FOREIGN KEY (publisherId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS evidences (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      type VARCHAR(50) NOT NULL,
      value TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_evidences_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      fromName VARCHAR(100) NOT NULL,
      score INT NOT NULL,
      content TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_evaluations_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function seedData() {
  const rows = await query('SELECT COUNT(*) AS count FROM users');
  if (rows[0].count > 0) {
    return;
  }

  await withTransaction(async (connection) => {
    for (const user of seedUsers) {
      await connection.execute(
        `INSERT INTO users (id, nickname, avatarUrl, points, completionRate, aiComment) VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, user.nickname, user.avatarUrl, user.points, user.completionRate, user.aiComment]
      );
    }

    for (const post of seedPosts) {
      await connection.execute(
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
    }

    for (const evidence of seedEvidences) {
      await connection.execute(
        'INSERT INTO evidences (id, postId, type, value) VALUES (?, ?, ?, ?)',
        [evidence.id, evidence.postId, evidence.type, evidence.value]
      );
    }

    for (const evaluation of seedEvaluations) {
      await connection.execute(
        'INSERT INTO evaluations (id, postId, fromName, score, content) VALUES (?, ?, ?, ?, ?)',
        [evaluation.id, evaluation.postId, evaluation.fromName, evaluation.score, evaluation.content]
      );
    }
  });
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
  await seedData();
}

module.exports = {
  dbConfig,
  initDb,
  mapPost,
  query,
  withTransaction,
  getUserRank
};
