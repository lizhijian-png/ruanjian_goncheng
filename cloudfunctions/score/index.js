wx.cloud.init();
const db = wx.cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { userId, delta, taskFinished } = event;

  await db.collection('users').doc(userId).update({
    data: {
      points: _.inc(delta),
      finishedCount: _.inc(taskFinished ? 1 : 0),
      failedCount: _.inc(taskFinished ? 0 : 1)
    }
  });

  return db.collection('users').orderBy('points', 'desc').limit(20).get();
};
