# Profile 页帖子分类 Tab 设计

**日期:** 2026-05-17

## 背景

用户在个人主页（profile）只能看到自己发布的帖子，且没有按生命周期状态分类。本次改动在 profile 页新增三 Tab，展示用户以发布者和搭子两种身份参与的所有帖子，并按状态归类。

---

## 后端改动

### `GET /api/users/:id/profile`

在现有逻辑基础上，额外查询 `post_buddies JOIN posts` 获取该用户作为搭子参与的帖子。

**查询逻辑：**

1. 查发布的帖子：`SELECT * FROM posts WHERE publisherId = ?`（现有）
2. 查参与的帖子：`SELECT posts.* FROM posts JOIN post_buddies ON posts.id = post_buddies.postId WHERE post_buddies.userId = ?`
3. 对两个列表中的每条帖子调用 `syncPostStatus`（懒更新，保证状态最新）
4. 合并两个列表，每条帖子附加 `role` 字段

**返回结构：**

```json
{
  "user": { "...": "..." },
  "posts": [
    { "id": "...", "title": "...", "status": "招募中", "role": "publisher", "...": "..." },
    { "id": "...", "title": "...", "status": "进行中", "role": "buddy",     "...": "..." }
  ]
}
```

`role` 取值：`"publisher"` | `"buddy"`

---

## 前端改动

### profile.js

- `posts` 数组结构不变，新增 `role` 字段
- 新增 `activeTab` 数据项，默认值 `"active"`
- 新增 `switchTab(e)` 方法，切换 Tab 时更新 `activeTab`
- 新增计算属性风格的过滤逻辑：每次 `setData` 后根据 `activeTab` 过滤出 `filteredPosts`

**Tab 映射：**

| activeTab 值 | 包含状态 |
|-------------|---------|
| `"active"` | 招募中、进行中、待评价 |
| `"done"` | 已完成 |
| `"abandoned"` | 已放弃 |

### profile.wxml

将「我的帖子操作」区块改造为：

1. **Tab 栏**：三个 Tab 按钮（活跃 / 已完成 / 已放弃），当前选中项高亮
2. **帖子列表**：遍历 `filteredPosts`，每张卡片显示：
   - 标题
   - 状态标签（招募中 / 进行中 / 待评价 / 已完成 / 已放弃）
   - 角色标签：`role === "publisher"` 显示灰色「发布」，`role === "buddy"` 显示蓝色「参与」
   - 积分奖惩（+reward / -penalty）
   - 删除按钮：仅 `role === "publisher"` 时显示
3. **空状态**：当 `filteredPosts.length === 0` 时显示「暂无相关帖子」

---

## 边界情况

- **重复帖子**：发布者不能加入自己的帖子，两个查询结果无重叠，无需去重
- **空 Tab**：显示「暂无相关帖子」提示
- **状态同步**：profile 接口对每条帖子调用 `syncPostStatus`，与其他接口保持一致的懒更新策略
- **删除权限**：删除操作仅对 `role === "publisher"` 的帖子开放，搭子身份的帖子不显示删除按钮
