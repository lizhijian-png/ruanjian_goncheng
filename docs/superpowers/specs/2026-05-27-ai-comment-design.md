---
title: 动态 AI 评价模块设计
date: 2026-05-27
status: approved
---

# 动态 AI 评价模块设计

## 背景

当前 `users.aiComment` 字段在注册时写入固定欢迎语，从未动态更新。本设计将其替换为基于用户真实数据、由 DeepSeek 大模型生成的个性化激励评语。

## 目标

- 任务结算后，对本次任务中被他人评价过的参与者，异步生成并更新其 `aiComment`
- 不影响结算接口的响应速度和可靠性
- AI 调用失败不影响主流程

## 范围

**包含：**
- 新增 `backend/src/ai.js`，封装 DeepSeek 调用与 prompt 拼装
- 修改 `backend/src/server.js` 的 `settlePost()`，在结算后触发 AI 更新
- `.env` 新增 DeepSeek 配置项

**不包含：**
- 前端改动（`profile.wxml` 已有 `aiComment` 展示，无需修改）
- 用户主动刷新入口
- 其他 AI 功能（任务推荐、评价分析）

## 触发条件

`settlePost(postId)` 执行完结算事务后：

1. 查询 `evaluations WHERE postId = postId`，取所有不重复的 `toId`
2. 对每个 `toId`，用 `setImmediate` 异步触发 `generateAiComment(userId)`

只有在本次任务中**被他人评价过**的用户才会触发更新；未被评价的参与者不做处理。

## 数据输入

`generateAiComment(userId)` 从数据库读取以下数据：

| 数据 | 来源 | 字段 |
|------|------|------|
| 基础统计 | `users` | `points`, `completionRate`, `avgScore` |
| 近期收到的评价 | `evaluations WHERE toId = userId` | 最近 5 条 `score`, `content`，按 `createdAt DESC` |
| 任务类别偏好 | `posts JOIN post_buddies` | 按 `category` 分组的完成数、放弃数 |

## 模块设计

### `backend/src/ai.js`

对外暴露单一函数：

```
generateAiComment(userId) → Promise<void>
```

内部流程：
1. 检查 `DEEPSEEK_API_KEY` 是否配置，未配置则打印警告并返回
2. 并行查询上述三类数据
3. 拼装 prompt（见下方模板）
4. POST `${DEEPSEEK_BASE_URL}/chat/completions`，timeout 10 秒，model `deepseek-chat`
5. 取 `choices[0].message.content`，写入 `UPDATE users SET aiComment = ? WHERE id = ?`
6. 任意步骤抛出异常：`console.error` 记录，不向上抛出

依赖：Node.js 内置 `fetch`（Node 18+）或 `axios`（与项目现有依赖一致）。

### Prompt 模板

```
你是一个任务激励助手。请根据以下用户数据，用中文写一句简短的个性化激励评语（50字以内，语气友善，不要重复数据本身）。

用户数据：
- 当前积分：{points} 分
- 任务完成率：{completionRate}%
- 互评平均分：{avgScore}（满分5分）
- 近期收到的评价：{recentEvals}
- 完成较多的任务类别：{topCategories}
- 完成较少的任务类别：{weakCategories}

只输出评语本身，不要加任何前缀或解释。
```

`recentEvals` 格式示例：`"很认真负责（4分）、完成质量高（5分）"`；无评价时填 `"暂无"`。
`topCategories` / `weakCategories` 各取前 2 名；无数据时填 `"暂无"`。

### `backend/src/server.js` 修改点

在 `settlePost()` 事务提交后追加：

```javascript
const { generateAiComment } = require('./ai');

// 查询本次任务被评价的用户
const evaluated = await query(
  'SELECT DISTINCT toId FROM evaluations WHERE postId = ?', [postId]
);
for (const { toId } of evaluated) {
  setImmediate(() => generateAiComment(toId));
}
```

## 配置

`.env` 新增（不进 git，`.gitignore` 已有 `.env`）：

```
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

启动时若 `DEEPSEEK_API_KEY` 为空，打印一次警告：
`[AI] DEEPSEEK_API_KEY not set, AI comment generation disabled`

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| API Key 未配置 | 打印警告，跳过调用，`aiComment` 保持原值 |
| DeepSeek 请求超时（>10s） | 视为失败，打印错误，`aiComment` 保持原值 |
| DeepSeek 返回非 200 | 打印错误含状态码，`aiComment` 保持原值 |
| 数据库查询失败 | 打印错误，`aiComment` 保持原值 |
| 生成内容为空 | 打印警告，`aiComment` 保持原值 |

所有错误均不向上抛出，不影响 `settlePost` 主流程。

## 不涉及的改动

- 数据库 schema 无需变更（`aiComment` 字段已存在）
- 前端无需改动（已有展示逻辑）
- 无需新增 API 端点
