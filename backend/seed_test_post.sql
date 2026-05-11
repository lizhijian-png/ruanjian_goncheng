-- 测试帖子：允许2名搭子加入，状态招募中
-- 发布者：u_1001（凌晨自习搭子）
-- 可用搭子：u_1、u_2、u_4（任意两人加入后自动进入"进行中"）

INSERT IGNORE INTO posts (
  id, publisherId, publisherName,
  title, content,
  reward, penalty, category,
  partnerChat, evaluationOpen,
  evidenceText, status,
  buddyName, progress, recommendedScore,
  maxBuddies, currentBuddies,
  startTime, endTime
) VALUES (
  'p_test_01', 'u_1001', '凌晨自习搭子',
  '【测试用】组队备考四六级',
  '找2名搭子一起备考，每天打卡学习进度截图。人满2人后任务自动开始。',
  20, 10, '学习',
  1, 1,
  '每天上传学习打卡截图，并写一句当日总结。', '招募中',
  '', 0, 85,
  2, 0,
  '2026-05-08 09:00:00', '2026-06-08 23:00:00'
);
