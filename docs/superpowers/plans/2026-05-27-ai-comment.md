# 动态 AI 评价模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务结算后，对本次任务中被他人评价过的参与者，异步调用 DeepSeek 大模型生成个性化激励评语，写入 `users.aiComment`。

**Architecture:** 新增 `backend/src/ai.js` 封装 DeepSeek 调用与 prompt 拼装；修改 `backend/src/server.js` 的 `settlePost()` 在结算事务完成后用 `setImmediate` 异步触发 AI 更新；AI 调用失败不影响主流程。

**Tech Stack:** Node.js/Express (`backend/src/server.js`), axios（已有依赖）, DeepSeek Chat API（兼容 OpenAI `/chat/completions` 格式）, MySQL (`backend/src/db.js`)

---

## 文件变更一览

| 文件 | 操作 |
|------|------|
| `backend/src/ai.js` | 新建：封装 `generateAiComment(userId)`，查数据、拼 prompt、调 DeepSeek、写库 |
| `backend/src/server.js` | 修改：`settlePost()` 末尾触发 AI 更新 |
| `backend/.env` | 修改：新增 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_BASE_URL` |

---

## Task 1: 新增 `backend/src/ai.js` — 数据查询与 prompt 拼装

**Files:**
- Create: `backend/src/ai.js`

背景：`backend/src/db.js` 导出 `query` 函数，签名为 `query(sql, params) → Promise<rows[]>`。项目已有 `axios` 依赖。`users` 表有 `points INT`, `completionRate INT`, `avgScore DECIMAL(3,1)` 字段。`evaluations` 表有 `toId`, `score INT`, `content TEXT`, `createdAt DATETIME`。`post_buddies` 表有 `userId`, `postId`；`posts` 表有 `category VARCHAR(50)`, `status VARCHAR(50)`。

- [ ] **Step 1: 创建 `backend/src/ai.js`，实现数据查询函数**

```javascript
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

module.exports = { fetchUserStats, fetchRecentEvals, fetchCategoryStats };
```

- [ ] **Step 2: 在同一文件追加 prompt 拼装函数**

```javascript
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
```

- [ ] **Step 3: 在同一文件追加 DeepSeek 调用与主函数**

```javascript
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
```

- [ ] **Step 4: 验证文件语法**

```bash
cd backend && node -e "require('./src/ai')" && echo "OK"
```

期望输出：`OK`（无报错）

- [ ] **Step 5: 提交**

```bash
git add backend/src/ai.js
git commit -m "feat: add ai.js with generateAiComment using DeepSeek"
```

---

## Task 2: 修改 `.env` — 新增 DeepSeek 配置

**Files:**
- Modify: `backend/.env`

背景：`.env` 已有 `MYSQL_HOST`、`WX_APPID` 等配置，由 `dotenv` 在 `server.js` 启动时加载。`.gitignore` 已包含 `.env`，不会进入 git。

- [ ] **Step 1: 在 `backend/.env` 末尾追加以下两行**

打开 `backend/.env`，在文件末尾添加：

```
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

将 `your_key_here` 替换为你的真实 DeepSeek API Key（从 [platform.deepseek.com](https://platform.deepseek.com) 获取）。

- [ ] **Step 2: 验证环境变量能被读取**

```bash
cd backend && node -e "require('dotenv').config(); console.log(process.env.DEEPSEEK_API_KEY ? 'key set' : 'key missing')"
```

期望输出：`key set`

---

## Task 3: 修改 `settlePost()` — 结算后触发 AI 更新

**Files:**
- Modify: `backend/src/server.js:65-95`

背景：`settlePost(postId)` 当前结构：先执行事务（更新状态、发积分），事务后调用 `recalcCompletionRate(publisherId)`。需要在 `recalcCompletionRate` 之后，查询本次任务被评价的用户列表，对每人异步触发 `generateAiComment`。

`settlePost` 当前末尾代码（第 93-95 行）：
```javascript
  });
  if (publisherId) await recalcCompletionRate(publisherId);
}
```

- [ ] **Step 1: 在 `server.js` 顶部 require 区域追加 ai.js 引入**

在第 4 行 `const { initDb, ... } = require('./db');` 之后插入：

```javascript
const { generateAiComment } = require('./ai');
```

- [ ] **Step 2: 替换 `settlePost` 末尾，追加 AI 触发逻辑**

将第 93-95 行：
```javascript
  });
  if (publisherId) await recalcCompletionRate(publisherId);
}
```

替换为：
```javascript
  });
  if (publisherId) await recalcCompletionRate(publisherId);

  const evaluated = await query(
    'SELECT DISTINCT toId FROM evaluations WHERE postId = ?',
    [postId]
  );
  for (const { toId } of evaluated) {
    setImmediate(() => generateAiComment(toId));
  }
}
```

- [ ] **Step 3: 启动后端，验证无语法错误**

```bash
cd backend && node src/server.js &
sleep 2 && curl -s http://localhost:3000/api/health
```

期望输出：`{"success":true,"message":"backend is running"}`

停止后端：`kill %1`

- [ ] **Step 4: 提交**

```bash
git add backend/src/server.js backend/.env
git commit -m "feat: trigger generateAiComment after settlePost for evaluated users"
```

---

## Task 4: 手动集成验证

**Files:**（只读，不修改）
- Read: `backend/src/server.js`
- Read: `backend/src/ai.js`

背景：没有自动化测试框架，通过日志验证 AI 调用链路是否正常。

- [ ] **Step 1: 启动后端，观察启动日志**

```bash
cd backend && node src/server.js
```

若 `DEEPSEEK_API_KEY` 已配置，无警告输出。
若未配置，应看到：`[AI] DEEPSEEK_API_KEY not set, AI comment generation disabled`

- [ ] **Step 2: 用数据库直接触发一次结算，观察 AI 日志**

在 MySQL 中找一条 `status = '待评价'` 且 `evaluations` 表中有 `toId` 记录的帖子，手动将其 `evaluationDeadline` 设为过去时间：

```sql
UPDATE posts SET evaluationDeadline = '2020-01-01 00:00:00'
WHERE status = '待评价' LIMIT 1;
```

然后调用任意会触发 `syncPostStatus` 的接口（如 `GET /api/posts/:id`），观察后端日志：

- 正常：无 `[AI]` 错误，数秒后数据库 `users.aiComment` 被更新
- 失败：看到 `[AI] generateAiComment failed for user xxx: ...`，检查 API Key 和网络

- [ ] **Step 3: 验证数据库中 aiComment 已更新**

```sql
SELECT id, nickname, aiComment FROM users WHERE id = '<被评价的userId>';
```

期望：`aiComment` 不再是注册时的固定欢迎语，而是 DeepSeek 生成的个性化评语。

- [ ] **Step 4: 最终提交（如有遗漏文件）**

```bash
git status
git add -p  # 只添加确认的改动
git commit -m "chore: verify AI comment integration"
```
