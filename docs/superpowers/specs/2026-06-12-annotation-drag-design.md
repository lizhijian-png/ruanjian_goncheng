# 帖子批注拖拽微调功能 — 设计文档

> 状态:设计已确认
> 日期:2026-06-12
> 适用项目:「行途有伴」任务搭子小程序(微信原生小程序 + Express + MySQL)
> 前置:批注协作互动功能阶段一 MVP(见 `2026-06-04-post-annotation-design.md`)

## 1. 背景与目标

批注 MVP(2026-06-04)用「点击定位」放置批注与表情印章,放置后位置即固定,
无法调整。原设计第 8 节已将「拖拽定位(放置后可拖动微调)」列为后续增强。

本功能让**有权限的用户**对已存在的批注/印章进行**拖拽移动**,松手后新坐标
持久化到后端。复用现有 `x/y` 百分比坐标体系,不改表结构。

### 成功标准

- 有权限的用户长按批注可拖动,松手后批注停在新位置
- 松手即保存,刷新/重进详情页位置保持一致
- 轻点批注仍是「查看作者/时间」(现有行为不变)
- 无权限的批注长按无反应,但仍可轻点查看
- 拖拽中接口失败能回滚到原位置,不影响其他功能

### 已确认的关键决策

| 决策点 | 选择 |
|---|---|
| 保存时机 | 松手时保存(一次 PATCH,拖拽中不发请求) |
| 拖动权限 | 作者本人 + 楼主(与删除权限一致) |
| 触发方式 | 长按进入拖拽,轻点查看(两者区分) |

## 2. 整体架构

沿用 MVP 既有边界,不新增组件、不改表:

```
annotation-layer 组件(改)
  └─ 每条批注加 touchstart / touchmove / touchend 手势
       长按 ~400ms → 进入拖拽态(视觉反馈:放大+阴影)
       touchmove(拖拽态)→ 按位移换算百分比增量,实时更新该条 x/y(本地)
       touchend:
         拖拽态     → 抛 bind:dragend { id, x, y }
         未达阈值   → 抛 bind:tapannotation { id }(现有轻点查看)
post-detail 详情页(改)
  └─ 收到 dragend → 调 api.updateAnnotationPosition
       成功 → 用返回值更新本地 annotations
       失败 → 回滚坐标 + 轻提示
services/api.js(改)
  └─ 新增 updateAnnotationPosition(postId, annId, userId, x, y)
后端 server.js(改)
  └─ 新增 PATCH /api/posts/:id/annotations/:annId  仅更新 x/y
test_annotations.js(改)
  └─ 加 PATCH 用例
```

**模块边界(不变):** annotation-layer 管手势与渲染;详情页管数据、坐标基准与接口;后端管持久化与鉴权。

## 3. 数据模型

**无需改表。** `annotations.x` / `annotations.y` 已是 `DECIMAL(5,2)`,
拖拽只是更新这两列的值,复用 MVP 的百分比 0~100 坐标体系。

## 4. 后端接口设计

### 4.1 PATCH /api/posts/:id/annotations/:annId — 更新坐标

```
请求体: { userId, x, y }
响应:   { success: true, annotation: { id, userId, nickname, type, content, style, x, y, createdAt } }
```

校验(复用现有 DELETE 接口的鉴权模式):
- 批注存在且属于该帖(404)
- `userId === annotation.userId`(作者)**或** `userId === post.publisherId`(楼主),否则 403
- `x`、`y` 为数字且 ∈ [0,100],否则 400

实现:`UPDATE annotations SET x = ?, y = ? WHERE id = ?`,再查回该行返回。
路由位置:紧接现有 DELETE 批注路由之后,沿用 `next(error)` 统一错误处理。

### 4.2 前端 API 封装

`services/api.js` 复用 `request()` 新增:
```javascript
function updateAnnotationPosition(postId, annId, userId, x, y) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, x, y }
  });
}
```
并加入 `module.exports`。

## 5. 前端交互与手势设计

### 5.1 annotation-layer 组件改动

组件需要知道**哪些批注当前用户可拖**,以及**卡片宽高**(用于位移→百分比换算):

- 新增 property:
  - `currentUserId`(String)— 当前用户
  - `publisherId`(String)— 楼主 id,用于判定可拖权限
- 每条 item 在 `observers` 里预计算 `canDrag = (userId === currentUserId) || (publisherId === currentUserId)`

每条批注绑定手势(`catchtouchstart/move/end`,catch 阻止冒泡到卡片避免误触发放置):

- **touchstart**:记录起点 `(clientX, clientY)` 与该批注起始 `x/y`;若 `canDrag` 则启 400ms 长按计时器;记 `dragging=false`
- **计时器到点**:`dragging=true`,对该条加视觉反馈(`scale(1.1)` + 阴影)
- **touchmove**:
  - 若未进入拖拽态且位移 > 阈值(如 10px)→ 判定为滑动,清计时器,放弃(既不拖也不点)
  - 若拖拽态:`dx = (clientX-startX)/cardWidth*100`,`dy` 同理;`newX = clamp(startX0+dx, 0, 100)`,`newY` 同理;`setData` 实时更新该条位置
- **touchend**:
  - 拖拽态 → 抛 `dragend { id, x:newX, y:newY }`,清状态
  - 未进入拖拽态且总位移很小 → 抛 `tapannotation { id }`(现有轻点查看)
  - 清长按计时器

### 5.2 卡片宽高来源

详情页已有 `wx.createSelectorQuery().select('.detail-card').boundingClientRect()`
(放置批注时用过)。组件不直接查 DOM,由详情页在批注层渲染后把 `cardWidth/cardHeight`
作为 property 传入;若拖拽开始时尺寸为空,touchstart 内用一次组件内 selectorQuery 兜底。

### 5.3 详情页处理 dragend

```
onAnnotationDragEnd(e):
  const { id, x, y } = e.detail
  保存旧坐标(用于回滚)
  乐观更新本地 annotations 该条 x/y(其实组件已移动,这里同步数据源)
  api.updateAnnotationPosition(postId, id, currentUserId, x, y)
    成功 → 用返回 annotation 覆盖本地该条
    失败 → 回滚为旧坐标 + wx.showToast 轻提示
```

## 6. 错误处理与边界

- **拖拽中接口失败**:回滚到拖拽前坐标 + 轻提示,不留错位
- **无权限批注**:`canDrag=false`,长按不进入拖拽态,仍可轻点查看
- **坐标越界**:前端 clamp 0~100,后端再校验 [0,100];贴边不越界
- **轻点 vs 拖拽**:靠长按计时器 + 位移阈值区分,避免轻点被误判为拖动
- **滑动页面**:touchmove 未达长按时间且位移大 → 判为页面滑动,不拦截
- **并发**:两人同时拖同一条 → 后写覆盖(本功能可接受,不做锁)

## 7. 测试策略

- **后端** `test_annotations.js` 新增 PATCH 用例:
  - 作者更新坐标成功,值正确落库
  - 楼主更新他人批注坐标成功
  - 越权用户更新 → 403
  - 坐标越界(如 x=150)→ 400
- **前端**(微信开发者工具手测):
  - 长按自己的批注 → 拖动 → 松手 → 停在新位置
  - 退出重进详情页 → 位置保持
  - 轻点批注 → 仍弹作者/时间弹层(未被拖拽逻辑破坏)
  - 长按他人批注(非楼主身份)→ 无反应,轻点仍可查看
  - 楼主长按他人批注 → 可拖动

## 8. 不在本次范围

- 拖拽时的对齐辅助线 / 网格吸附
- 多选批注批量移动
- 拖拽缩放、旋转(旋转角已存于 style,本次不做交互调整)
- 阶段二收藏系统、阶段三自定义图片表情(见 MVP 设计文档)
