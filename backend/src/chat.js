const { WebSocketServer } = require('ws');
const { query, insertMessage, insertNotification } = require('./db');
const url = require('url');

const MAX_CONTENT_LENGTH = 500;

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// rooms: Map<postId, Set<WebSocket>>
const rooms = new Map();

async function isParticipant(postId, userId) {
  const postRows = await query('SELECT publisherId FROM posts WHERE id = ?', [postId]);
  if (!postRows[0]) return false;
  if (postRows[0].publisherId === userId) return true;
  const buddyRows = await query(
    'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
    [postId, userId]
  );
  return buddyRows.length > 0;
}

function broadcast(postId, data) {
  const room = rooms.get(postId);
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function addToRoom(postId, ws) {
  if (!rooms.has(postId)) rooms.set(postId, new Set());
  rooms.get(postId).add(ws);
}

function removeFromRoom(postId, ws) {
  const room = rooms.get(postId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(postId);
}

function closeRoom(postId, reason) {
  const room = rooms.get(postId);
  if (!room) return;
  const msg = JSON.stringify({ type: 'room_closed', reason });
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
      ws.close(1000, 'room closed');
    }
  }
  rooms.delete(postId);
}

function createChatServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/chat' });

  wss.on('connection', async (ws, req) => {
    const params = new url.URL(req.url, 'http://localhost').searchParams;
    const postId = params.get('postId');
    const userId = params.get('userId');

    if (!postId || !userId) {
      ws.close(4001, 'missing postId or userId');
      return;
    }

    let participant;
    try {
      participant = await isParticipant(postId, userId);
    } catch {
      ws.close(4001, 'auth error');
      return;
    }

    if (!participant) {
      ws.close(4001, 'not a participant');
      return;
    }

    const userRows = await query('SELECT nickname FROM users WHERE id = ?', [userId]);
    const senderName = userRows[0] ? userRows[0].nickname : userId;

    addToRoom(postId, ws);

    ws.on('message', async (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (parsed.type !== 'message') return;

      const content = String(parsed.content || '').trim();
      if (!content || content.length > MAX_CONTENT_LENGTH) return;

      let insertId;
      try {
        insertId = await insertMessage(postId, userId, senderName, content);
      } catch (e) {
        console.error('[chat] insertMessage error:', e);
        return;
      }

      // 插入 new_chat 通知(给除发送者外的其他参与者)
      try {
        const participants = await query(
          `SELECT userId FROM post_buddies WHERE postId = ? AND userId != ?
           UNION SELECT publisherId FROM posts WHERE id = ? AND publisherId != ?`,
          [postId, userId, postId, userId]
        );
        for (const p of participants) {
          await insertNotification({
            id: createId('n'),
            userId: p.userId,
            postId,
            type: 'new_chat',
            relatedUserId: userId,
            content: `${senderName}：${content.slice(0, 50)}`
          });
        }
      } catch (e) {
        console.error('[chat] insertNotification error:', e);
      }

      broadcast(postId, {
        type: 'message',
        id: insertId,
        senderId: userId,
        senderName,
        content,
        createdAt: new Date().toISOString()
      });
    });

    ws.on('close', () => removeFromRoom(postId, ws));
    ws.on('error', () => removeFromRoom(postId, ws));
  });

  return { closeRoom };
}

module.exports = { createChatServer, closeRoom };
