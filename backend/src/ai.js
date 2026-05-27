'use strict';
const axios = require('axios');
const { query } = require('./db');

async function fetchUserStats(userId) {
  const rows = await query(
    'SELECT points, completionRate, avgScore FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] || { points: 0, completionRate: 0, avgScore: null };
}

async function fetchRecentEvals(userId) {
  return query(
    `SELECT score, content FROM evaluations
     WHERE toId = ? ORDER BY createdAt DESC LIMIT 5`,
    [userId]
  );
}

async function fetchCategoryStats(userId) {
  return query(
    `SELECT p.category,
       SUM(CASE WHEN p.status = '已完成' THEN 1 ELSE 0 END) AS doneCount,
       SUM(CASE WHEN p.status = '已放弃' THEN 1 ELSE 0 END) AS abandonCount
     FROM post_buddies pb
     JOIN posts p ON p.id = pb.postId
     WHERE pb.userId = ?
     GROUP BY p.category`,
    [userId]
  );
}

function buildPrompt(stats, evals, categoryRows) {
  const { points, completionRate, avgScore } = stats;

  const recentEvals = evals.length > 0
    ? evals.map(e => `${e.content}（${e.score}分）`).join('、')
    : '暂无';

  const sorted = [...categoryRows].sort((a, b) => b.doneCount - a.doneCount);
  const topCategories = sorted.slice(0, 2).map(r => r.category).join('、') || '暂无';
  const weakCategories = [...categoryRows]
    .sort((a, b) => b.abandonCount - a.abandonCount)
    .slice(0, 2)
    .map(r => r.category)
    .join('、') || '暂无';

  return `你是一个任务激励助手。请根据以下用户数据，用中文写一句简短的个性化激励评语（50字以内，语气友善，不要重复数据本身）。

用户数据：
- 当前积分：${points} 分
- 任务完成率：${completionRate}%
- 互评平均分：${avgScore != null ? avgScore : '暂无'}（满分5分）
- 近期收到的评价：${recentEvals}
- 完成较多的任务类别：${topCategories}
- 完成较少的任务类别：${weakCategories}

只输出评语本身，不要加任何前缀或解释。`;
}

async function generateAiComment(userId) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[AI] DEEPSEEK_API_KEY not set, AI comment generation disabled');
    return;
  }

  try {
    const [stats, evals, categoryRows] = await Promise.all([
      fetchUserStats(userId),
      fetchRecentEvals(userId),
      fetchCategoryStats(userId)
    ]);

    const prompt = buildPrompt(stats, evals, categoryRows);
    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const comment = response.data?.choices?.[0]?.message?.content?.trim();
    if (!comment) {
      console.warn(`[AI] empty response for user ${userId}`);
      return;
    }

    await query('UPDATE users SET aiComment = ? WHERE id = ?', [comment, userId]);
  } catch (err) {
    console.error(`[AI] generateAiComment failed for user ${userId}:`, err.message);
  }
}

module.exports = { generateAiComment };
