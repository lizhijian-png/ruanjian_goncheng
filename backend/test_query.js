const mysql = require('mysql2/promise');

const dbConfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'task_buddy',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

async function test() {
  const pool = mysql.createPool(dbConfig);
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       ORDER BY p.createdAt DESC LIMIT ? OFFSET ?`,
      [1, 0]
    );
    console.log('Success:', rows.length);
  } catch (error) {
    console.error('Error:', error.message);
  }
  await pool.end();
}

test();
