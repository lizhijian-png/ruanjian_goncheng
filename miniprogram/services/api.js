const config = require('../env');

function request({ url, method = 'GET', data }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl}${url}`,
      method,
      data,
      success: (res) => {
        const { statusCode, data: responseData } = res;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(responseData);
          return;
        }

        reject(new Error(responseData && responseData.message ? responseData.message : '请求失败'));
      },
      fail: (error) => {
        reject(error);
      }
    });
  });
}

function login({ code }) {
  return request({ url: '/api/auth/login', method: 'POST', data: { code } });
}

function bind({ code, nickname, avatarUrl }) {
  return request({ url: '/api/auth/bind', method: 'POST', data: { code, nickname, avatarUrl } });
}

function getFeed({ category = '', startAfter = '', endBefore = '', keyword = '', userId = '', page = 1, pageSize = 10 } = {}) {
  const params = [];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (startAfter) params.push(`startAfter=${encodeURIComponent(startAfter)}`);
  if (endBefore) params.push(`endBefore=${encodeURIComponent(endBefore)}`);
  if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
  if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return request({ url: `/api/posts?${params.join('&')}` });
}

function getPostDetail(id, viewerId) {
  const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : '';
  return request({ url: `/api/posts/${id}${qs}` });
}

function getRanking() {
  return request({ url: '/api/ranking' });
}

function getProfile(userId) {
  return request({ url: `/api/users/${userId}/profile` });
}

function createPost(payload) {
  return request({ url: '/api/posts', method: 'POST', data: payload });
}

function updatePost(id, payload) {
  return request({ url: `/api/posts/${id}`, method: 'PUT', data: payload });
}

function deletePost(id) {
  return request({ url: `/api/posts/${id}`, method: 'DELETE' });
}

function completePost(id, userId) {
  return request({ url: `/api/posts/${id}/complete`, method: 'POST', data: { userId } });
}

function submitEvidence(postId, userId, submitterName, content, imageUrls = []) {
  const relativeUrls = imageUrls.map(u => u.startsWith(config.apiBaseUrl) ? u.slice(config.apiBaseUrl.length) : u);
  return request({ url: `/api/posts/${postId}/evidence`, method: 'POST', data: { userId, submitterName, content, imageUrls: relativeUrls } });
}

function joinPost(id, userId) {
  return request({ url: `/api/posts/${id}/join`, method: 'POST', data: { userId } });
}

function quitPost(id, userId) {
  return request({ url: `/api/posts/${id}/quit`, method: 'POST', data: { userId } });
}

function abandonPost(id, userId) {
  return request({ url: `/api/posts/${id}/abandon`, method: 'POST', data: { userId } });
}

function submitEvaluation(postId, userId, toId, score, content) {
  return request({ url: `/api/posts/${postId}/evaluate`, method: 'POST', data: { userId, toId, score, content } });
}

function submitCompletionVote(postId, userId, targetId, vote) {
  return request({
    url: `/api/posts/${postId}/completion-vote`,
    method: 'POST',
    data: { userId, targetId, vote }
  });
}

function startPost(postId, userId) {
  return request({ url: `/api/posts/${postId}/start`, method: 'POST', data: { userId } });
}

function requestComplete(postId, userId) {
  return request({ url: `/api/posts/${postId}/request-complete`, method: 'POST', data: { userId } });
}

function updateProfile(userId, payload) {
  return request({ url: `/api/users/${userId}/profile`, method: 'PUT', data: payload });
}

function getEvaluationsReceived(userId) {
  return request({ url: `/api/users/${userId}/evaluations-received` });
}

function getPointLogs(userId) {
  return request({ url: `/api/users/${userId}/point-logs` });
}

function getAnnotations(postId) {
  return request({ url: `/api/posts/${postId}/annotations` });
}

function createAnnotation(postId, payload) {
  return request({
    url: `/api/posts/${postId}/annotations`,
    method: 'POST',
    data: payload
  });
}

function deleteAnnotation(postId, annId, userId) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'DELETE',
    data: { userId }
  });
}

function uploadEvidenceImage(localPath, userId) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${config.apiBaseUrl}/api/upload?userId=${encodeURIComponent(userId)}`,
      filePath: localPath,
      name: 'file',
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300 && data.url) {
            resolve(config.apiBaseUrl + data.url);
          } else {
            reject(new Error(data.message || '上传失败'));
          }
        } catch (e) {
          reject(new Error('上传响应解析失败'));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '上传失败'))
    });
  });
}

// ================== 管理员专用 API ==================

function adminLogin(password) {
  return request({ url: `/api/admin/login`, method: 'POST', data: { password } });
}

function getAdminFeed() {
  return request({ url: `/api/admin/posts` });
}

function updatePostAuditStatus(id, auditStatus) {
  return request({ url: `/api/admin/posts/${id}/audit-status`, method: 'PUT', data: { auditStatus } });
}

function getChatHistory(postId, userId) {
  return request({ url: `/api/chat/${postId}/history?userId=${encodeURIComponent(userId)}` });
}

function updateAnnotationPosition(postId, annId, userId, x, y) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, x, y }
  });
}

function updateAnnotationRotate(postId, annId, userId, rotate) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, rotate }
  });
}

function updateAnnotationScale(postId, annId, userId, scale) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, scale }
  });
}

function updateAnnotationContent(postId, annId, userId, patch) {
  // patch 可含 content / color / fontSize,各自可选
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, ...patch }
  });
}

module.exports = {
  login,
  bind,
  getFeed,
  getPostDetail,
  getRanking,
  getProfile,
  updateProfile,
  createPost,
  updatePost,
  deletePost,
  completePost,
  submitEvidence,
  uploadEvidenceImage,
  joinPost,
  quitPost,
  abandonPost,
  submitEvaluation,
  submitCompletionVote,
  startPost,
  requestComplete,
  getEvaluationsReceived,
  getPointLogs,
  getAnnotations,
  createAnnotation,
  deleteAnnotation,
  adminLogin,
  getAdminFeed,
  updatePostAuditStatus,
  getChatHistory,
  updateAnnotationPosition,
  updateAnnotationRotate,
  updateAnnotationScale,
  updateAnnotationContent
};
