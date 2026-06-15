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

    // 4.5 更新坐标
    await pool.execute('UPDATE annotations SET x = ?, y = ? WHERE id = ?', [12.5, 80, annId]);
    const [[moved]] = await pool.execute('SELECT x, y FROM annotations WHERE id = ?', [annId]);
    ok(Number(moved.x) === 12.5 && Number(moved.y) === 80, '坐标更新成功');

    // 4.6 更新内容 + 样式(content / style.color / style.fontSize),模拟 PATCH 的 merge 写法
    const newStyle = JSON.stringify({ color: '#27ae60', fontSize: 40, rotate: 0, scale: 1 });
    await pool.execute('UPDATE annotations SET content = ?, style = ? WHERE id = ?', ['改后的内容', newStyle, annId]);
    const [[edited]] = await pool.execute('SELECT content, style FROM annotations WHERE id = ?', [annId]);
    const st = JSON.parse(edited.style || '{}');
    ok(edited.content === '改后的内容', '内容更新成功');
    ok(st.color === '#27ae60' && Number(st.fontSize) === 40, '颜色/字号更新成功');

    // 4.7 点赞:插入一条点赞,再查计数(模拟切换的"赞"分支)
    const likeId = 'test_like_' + Date.now();
    await pool.execute('INSERT INTO annotation_likes (id, annId, userId) VALUES (?, ?, ?)', [likeId, annId, post.publisherId]);
    const [[likeCnt]] = await pool.execute('SELECT COUNT(*) AS cnt FROM annotation_likes WHERE annId = ?', [annId]);
    ok(Number(likeCnt.cnt) === 1, '点赞计数正确');
    // UNIQUE(annId, userId):同一人重复赞应失败
    let dupBlocked = false;
    try {
      await pool.execute('INSERT INTO annotation_likes (id, annId, userId) VALUES (?, ?, ?)', [likeId + '_x', annId, post.publisherId]);
    } catch (e) { dupBlocked = e.code === 'ER_DUP_ENTRY'; }
    ok(dupBlocked, '同一用户重复点赞被 UNIQUE 拦截');

    // 4.8 回复:插入两条回复,按 annId 查列表
    const replyId = 'test_reply_' + Date.now();
    await pool.execute(
      'INSERT INTO annotation_replies (id, annId, userId, nickname, content) VALUES (?, ?, ?, ?, ?)',
      [replyId, annId, post.publisherId, '测试者', '这是一条回复']
    );
    const [replies] = await pool.execute('SELECT id, content FROM annotation_replies WHERE annId = ? ORDER BY createdAt ASC', [annId]);
    ok(replies.length === 1 && replies[0].content === '这是一条回复', '回复插入并查询成功');

    // 4.9 软删除:标记 deletedAt 而非物理删,行仍在
    await pool.execute('UPDATE annotations SET deletedAt = NOW() WHERE id = ?', [annId]);
    const [[soft]] = await pool.execute('SELECT id, deletedAt FROM annotations WHERE id = ?', [annId]);
    ok(soft && soft.deletedAt !== null, '软删除标记 deletedAt(行未物理删除)');

    // 4.10 列表查询应过滤掉已软删的批注
    const [visible] = await pool.execute('SELECT id FROM annotations WHERE postId = ? AND deletedAt IS NULL', [post.id]);
    ok(!visible.some(r => r.id === annId), '列表查询过滤掉已软删批注');

    // 4.11 回收站查询应能查到已软删的批注
    const [trash] = await pool.execute('SELECT id FROM annotations WHERE postId = ? AND deletedAt IS NOT NULL', [post.id]);
    ok(trash.some(r => r.id === annId), '回收站查到已软删批注');

    // 4.12 恢复:deletedAt 置空后,列表又能查到
    await pool.execute('UPDATE annotations SET deletedAt = NULL WHERE id = ?', [annId]);
    const [[restored]] = await pool.execute('SELECT id, deletedAt FROM annotations WHERE id = ?', [annId]);
    ok(restored && restored.deletedAt === null, '恢复后 deletedAt 置空');

    // 5. 物理删除(收尾清理)应级联删除其点赞/回复(外键 ON DELETE CASCADE)
    await pool.execute('DELETE FROM annotations WHERE id = ?', [annId]);
    const [after] = await pool.execute('SELECT id FROM annotations WHERE id = ?', [annId]);
    ok(after.length === 0, '物理删除批注成功');
    const [likesAfter] = await pool.execute('SELECT id FROM annotation_likes WHERE annId = ?', [annId]);
    const [repliesAfter] = await pool.execute('SELECT id FROM annotation_replies WHERE annId = ?', [annId]);
    ok(likesAfter.length === 0 && repliesAfter.length === 0, '物理删批注级联清除点赞/回复');

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}
run();
