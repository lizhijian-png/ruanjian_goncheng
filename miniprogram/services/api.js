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

function login(nickname) {
  return request({
    url: '/api/auth/login',
    method: 'POST',
    data: { nickname }
  });
}

function getFeed() {
  return request({ url: '/api/posts' });
}

function getPostDetail(id) {
  return request({ url: `/api/posts/${id}` });
}

function getRanking() {
  return request({ url: '/api/ranking' });
}

function getProfile(userId) {
  return request({ url: `/api/users/${userId}/profile` });
}

function createPost(payload) {
  return request({
    url: '/api/posts',
    method: 'POST',
    data: payload
  });
}

function updatePost(id, payload) {
  return request({
    url: `/api/posts/${id}`,
    method: 'PUT',
    data: payload
  });
}

function deletePost(id) {
  return request({
    url: `/api/posts/${id}`,
    method: 'DELETE'
  });
}

function completePost(id) {
  return request({
    url: `/api/posts/${id}/complete`,
    method: 'POST'
  });
}

module.exports = {
  login,
  getFeed,
  getPostDetail,
  getRanking,
  getProfile,
  createPost,
  updatePost,
  deletePost,
  completePost
};
