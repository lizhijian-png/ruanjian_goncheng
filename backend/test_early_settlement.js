// backend/test_early_settlement.js
// 前置：另开终端 `npm start` 启动后端；本脚本直连 DB 造数 + HTTP 触发投票
// 用法：node test_early_settlement.js
//       BASE=http://127.0.0.1:3000 node test_early_settlement.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '123456',
  database: process.env.MYSQL_DATABASE || 'task_buddy',
  charset: 'utf8mb4'
};

async function run() {
  const pool = mysql.createPool(dbConfig);
  let pass = 0, fail = 0, pbSeq = 0;
  const ok = (c, m) => c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m));

  const ts = Date.now();
  const ids = { users: [], posts: [] };

  // 造用户：users 表 NOT NULL 无默认值的列: nickname, avatarUrl, aiComment
  async function mkUser(suffix) {
    const id = `t_es_u_${ts}_${suffix}`;
    await pool.execute(
      'INSERT INTO users (id, nickname, avatarUrl, aiComment) VALUES (?, ?, ?, ?)',
      [id, `测试用户${suffix}`, '', '']
    );
    ids.users.push(id);
    return id;
  }

  // 造帖子：posts NOT NULL 无默认值的列: publisherName, title, content, reward, penalty, category, evidenceText, status
  // post_buddies NOT NULL 无默认值的列: id (PK), nickname
  async function mkPost(publisherId, buddyIds) {
    const id = `t_es_p_${ts}_${buddyIds.length}_${ids.posts.length}`;
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    await pool.execute(
      `INSERT INTO posts
         (id, publisherId, publisherName, title, content, reward, penalty, category,
          evidenceText, status, evaluationDeadline, maxBuddies, currentBuddies)
       VALUES (?, ?, ?, ?, ?, 10, 0, '其他', '', '待评价', ?, 9, ?)`,
      [id, publisherId, '提前结算测试发布者', '提前结算测试帖', '测试内容', future, buddyIds.length]
    );
    for (const buddyId of buddyIds) {
      const pbId = `t_es_pb_${ts}_${++pbSeq}`;
      await pool.execute(
        'INSERT INTO post_buddies (id, postId, userId, nickname) VALUES (?, ?, ?, ?)',
        [pbId, id, buddyId, '测试搭子']
      );
    }
    ids.posts.push(id);
    return id;
  }

  const statusOf = async (postId) => {
    const [[row]] = await pool.execute('SELECT status FROM posts WHERE id = ?', [postId]);
    return row ? row.status : null;
  };

  const vote = (postId, userId, targetId) =>
    axios.post(`${BASE}/api/posts/${postId}/completion-vote`,
      { userId, targetId, vote: 'complete' },
      { validateStatus: () => true }
    );

  try {
    console.log('造测试用户...');
    const u1 = await mkUser('1');
    const u2 = await mkUser('2');
    const u3 = await mkUser('3');

    // ── 场景 A：N=2（发布者 u1 + 搭子 u2，需 2×1=2 票）──
    console.log('\n场景 A（N=2）:');
    const pA = await mkPost(u1, [u2]);

    const r1 = await vote(pA, u1, u2);
    ok(r1.status === 204, '投票请求 1 返回 204');
    ok(await statusOf(pA) === '待评价', 'N=2 仅投 1 票(u1→u2)未结算');

    const r2 = await vote(pA, u2, u1);
    ok(r2.status === 204, '投票请求 2 返回 204');
    ok(await statusOf(pA) === '已完成', 'N=2 投满 2 票(u2→u1)后已完成');

    // ── 场景 B：N=3（发布者 u1 + 搭子 u2, u3，需 3×2=6 票）──
    console.log('\n场景 B（N=3）:');
    const pB = await mkPost(u1, [u2, u3]);

    // 按顺序投前 5 票
    const first5 = [
      [u1, u2], [u1, u3],
      [u2, u1], [u2, u3],
      [u3, u1]
    ];
    for (const [v, t] of first5) {
      const r = await vote(pB, v, t);
      ok(r.status === 204, `投票 ${v.slice(-3)}→${t.slice(-3)} 返回 204`);
    }
    ok(await statusOf(pB) === '待评价', 'N=3 投 5 票未结算');

    // 第 6 票触发结算
    const r6 = await vote(pB, u3, u2);
    ok(r6.status === 204, '第 6 票返回 204');
    ok(await statusOf(pB) === '已完成', 'N=3 投满 6 票后已完成');

  } catch (e) {
    console.error('ERROR', e.response ? JSON.stringify(e.response.data) : e.message);
    fail++;
  } finally {
    console.log('\n清理测试数据...');
    for (const p of ids.posts) {
      await pool.execute('DELETE FROM completion_votes WHERE postId = ?', [p]);
      await pool.execute('DELETE FROM post_buddies WHERE postId = ?', [p]);
      await pool.execute('DELETE FROM posts WHERE id = ?', [p]);
    }
    for (const u of ids.users) {
      await pool.execute('DELETE FROM users WHERE id = ?', [u]);
    }
    await pool.end();
    console.log(`\n结果: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

run();
