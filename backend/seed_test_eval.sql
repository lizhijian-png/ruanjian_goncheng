SET NAMES utf8mb4;

-- 插入一条专门用于测试互评的帖子（结束时间设为过去）
INSERT INTO posts (
  id, publisherId, publisherName,
  title, content,
  reward, penalty, category,
  partnerChat, evaluationOpen, evidenceText,
  status, buddyName, progress, recommendedScore,
  maxBuddies, currentBuddies,
  startTime, endTime,
  publisherEvaluated, buddyEvaluated,
  createdAt
) VALUES (
  'p_test_eval', 'u_1', '晨间推进器',
  '【互评测试帖】已到结束时间',
  '这是专门用来测试互评流程的帖子，结束时间已过，已有证据。',
  20, 10, '学习',
  1, 1, '测试证据',
  '待评价', 'DDL 守门员', 100, 90,
  1, 1,
  '2026-05-01 00:00:00', '2026-05-07 00:00:00',
  0, 0,
  '2026-05-01 00:00:00'
);

-- 插入搭子记录（u_2 是搭子）
INSERT IGNORE INTO post_buddies (id, postId, userId, nickname, joinedAt)
VALUES ('pb_test_eval', 'p_test_eval', 'u_2', 'DDL 守门员', '2026-05-01 08:00:00');

-- 插入一条证据
INSERT INTO evidences (id, postId, type, value)
VALUES ('e_test_eval', 'p_test_eval', '文字', '测试证据：任务已完成，附上今日总结。');
