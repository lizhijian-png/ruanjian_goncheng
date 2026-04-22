module.exports = {
  currentUser: {
    id: 'u_1001',
    nickname: '凌晨自习搭子',
    avatarUrl: 'https://dummyimage.com/120x120/0f172a/ffffff&text=A',
    points: 128,
    completionRate: 86,
    rank: 3,
    aiComment: '你是高执行力型用户，擅长把公开承诺转化成完成记录，适合担任任务发起人。'
  },
  feed: [
    {
      id: 'p_001',
      title: '早八背单词打卡 14 天',
      content: '每天 7:20 上传 50 个单词截图，想找一起早起监督的搭子。',
      reward: 15,
      penalty: 8,
      category: '学习',
      partnerChat: true,
      evaluationOpen: true,
      progress: 71,
      recommendedScore: 96,
      images: ['https://dummyimage.com/300x200/1e293b/e2e8f0&text=Evidence'],
      publisher: '晨读引擎',
      buddy: '图书馆常驻选手',
      status: '进行中'
    },
    {
      id: 'p_002',
      title: '晚跑 5 公里互相监督',
      content: '上传跑步记录和配速截图，连续一周完成可加积分。',
      reward: 20,
      penalty: 10,
      category: '运动',
      partnerChat: false,
      evaluationOpen: true,
      progress: 43,
      recommendedScore: 88,
      images: ['https://dummyimage.com/300x200/1f2937/f8fafc&text=Run+Proof'],
      publisher: '夜跑计划员',
      buddy: '塑形冲刺中',
      status: '招募中'
    }
  ],
  ranking: [
    { id: 'u_1', name: '晨间推进器', points: 186, rate: 92 },
    { id: 'u_2', name: 'DDL 守门员', points: 154, rate: 89 },
    { id: 'u_1001', name: '凌晨自习搭子', points: 128, rate: 86 },
    { id: 'u_4', name: '高数突击手', points: 116, rate: 82 }
  ]
};
