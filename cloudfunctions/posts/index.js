wx.cloud.init();
const db = wx.cloud.database();

exports.main = async (event) => {
  const { action, payload } = event;

  switch (action) {
    case 'create':
      return db.collection('posts').add({
        data: {
          ...payload,
          createdAt: new Date(),
          status: '招募中'
        }
      });
    case 'remove':
      return db.collection('posts').doc(payload.id).remove();
    case 'list':
    default:
      return db.collection('posts').orderBy('createdAt', 'desc').get();
  }
};
