const cloud = require('wx-server-sdk');

cloud.init();
const db = cloud.database();

const COLLECTION_DEFINITIONS = {
  users: {
    sample: {
      openid: 'init-openid',
      nickname: '初始化用户',
      avatarUrl: '',
      points: 0,
      finishedCount: 0,
      failedCount: 0,
      completionRate: 0,
      aiComment: '',
      createdAt: new Date()
    },
    description: '用户信息、积分、完成率'
  },
  posts: {
    sample: {
      publisherId: 'init-user-id',
      publisherName: '初始化发布者',
      title: '初始化任务帖',
      content: '这是一条用于创建集合的初始化帖子。',
      category: '学习',
      reward: 10,
      penalty: 5,
      partnerChat: true,
      evaluationOpen: true,
      status: '招募中',
      buddyId: '',
      buddyName: '',
      progress: 0,
      recommendedScore: 0,
      createdAt: new Date()
    },
    description: '任务帖子主表'
  },
  evidences: {
    sample: {
      postId: 'init-post-id',
      userId: 'init-user-id',
      imageList: [],
      text: '初始化证据记录',
      auditStatus: 'pending',
      createdAt: new Date()
    },
    description: '任务完成证据'
  },
  evaluations: {
    sample: {
      postId: 'init-post-id',
      fromUserId: 'init-user-id',
      toUserId: 'target-user-id',
      score: 5,
      content: '初始化评价记录',
      createdAt: new Date()
    },
    description: '任务互评记录'
  }
};

async function ensureCollection(name, definition) {
  try {
    await db.collection(name).count();
    return {
      name,
      created: false,
      description: definition.description,
      message: '集合已存在'
    };
  } catch (error) {
    const addResult = await db.collection(name).add({
      data: {
        ...definition.sample,
        __isInitRecord: true
      }
    });

    await db.collection(name).doc(addResult._id).remove();

    return {
      name,
      created: true,
      description: definition.description,
      message: '集合创建成功'
    };
  }
}

exports.main = async () => {
  const collectionNames = Object.keys(COLLECTION_DEFINITIONS);
  const results = [];

  for (const name of collectionNames) {
    const result = await ensureCollection(name, COLLECTION_DEFINITIONS[name]);
    results.push(result);
  }

  return {
    success: true,
    message: '数据库集合初始化完成',
    collections: results
  };
};
