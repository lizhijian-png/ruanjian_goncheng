const mysql = require('mysql2/promise');
const dbConfig = {
  host: '127.0.0.1', port: 3306, user: 'root', password: '051031',
  database: 'task_buddy', charset: 'utf8mb4'
};

async function run() {
  const pool = mysql.createPool(dbConfig);
  let pass = 0, fail = 0;
  const ok = (c, m) => c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m));
  try {
    // 1. 表存在
    const [t] = await pool.execute("SHOW TABLES LIKE 'annotations'");
    ok(t.length === 1, 'annotations 表存在');

    // 2. 取一个帖子和其发布者
    const [[post]] = await pool.execute('SELECT id, publisherId FROM posts LIMIT 1');
    if (!post) { console.log('SKIP: 库中无帖子,请先在小程序造数据'); await pool.end(); return; }

    // 3. 插入一条参与者(发布者)的批注
    const annId = 'test_ann_' + Date.now();
    await pool.execute(
      `INSERT INTO annotations (id, postId, userId, nickname, type, content, style, x, y)
       VALUES (?, ?, ?, ?, 'text', '测试批注', '{"color":"#c0392b"}', 50, 50)`,
      [annId, post.id, post.publisherId, '测试者']
    );
    const [[ins]] = await pool.execute('SELECT * FROM annotations WHERE id = ?', [annId]);
    ok(ins && ins.content === '测试批注', '插入批注成功');
    ok(Number(ins.x) === 50 && Number(ins.y) === 50, '坐标正确存储');

    // 4. 按 postId 查询
    const [list] = await pool.execute('SELECT id FROM annotations WHERE postId = ?', [post.id]);
    ok(list.some(r => r.id === annId), '按帖子查到批注');

    // 5. 删除
    await pool.execute('DELETE FROM annotations WHERE id = ?', [annId]);
    const [after] = await pool.execute('SELECT id FROM annotations WHERE id = ?', [annId]);
    ok(after.length === 0, '删除批注成功');

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}
run();
