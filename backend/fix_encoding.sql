SET NAMES utf8mb4;

UPDATE posts SET
  title='番茄钟专注挑战：连续 7 天每日 4 个番茄',
  content='每天完成 4 个 25 分钟专注番茄，截图 Forest / 潮汐 App 记录上传。适合备考或论文冲刺期。',
  category='学习',
  evidenceText='上传 Forest/潮汐 当日专注时长截图，需含日期水印。',
  publisherName='晨间推进器'
WHERE id='p_101';

UPDATE posts SET
  title='高数期末刷题组：每日 10 道真题',
  content='期末季拼了！每天至少完成 10 道高数历年真题并拍照上传，坚持到考前一天。互相监督不划水。',
  category='学习',
  evidenceText='拍照上传当日题目完成页，需包含日期和题号范围。',
  buddyName='DDL 守门员',
  publisherName='高数突击手'
WHERE id='p_102';

UPDATE posts SET
  title='冥想打卡 10 天，每天 10 分钟',
  content='找一个搭子一起养成睡前冥想习惯。每晚完成后在群里打卡文字，简单有效。',
  category='健康',
  evidenceText='打卡文字"今日已冥想 Day X"，附上当日感受（1-2 句话）。',
  buddyName='晨间推进器',
  publisherName='DDL 守门员'
WHERE id='p_103';

UPDATE posts SET
  title='素描基础练习：30 天线条与几何体',
  content='跟着《素描的诀窍》每天完成一个练习页，拍照上传。欢迎零基础，重在坚持而非水平。',
  category='创作',
  evidenceText='拍照上传当日练习成果，可附简短自评。',
  buddyName='晨间推进器',
  publisherName='凌晨自习搭子'
WHERE id='p_104';

UPDATE posts SET
  title='英语四级口语每日跟读 5 天',
  content='每天跟读一篇 VOA 慢速英语，录音上传。5 天后互评发音和流利度。短期冲刺，门槛低。',
  category='学习',
  evidenceText='上传当日跟读录音文件或微信语音截图。',
  buddyName='DDL 守门员',
  publisherName='高数突击手'
WHERE id='p_105';

UPDATE posts SET
  title='每日手写日记挑战 21 天',
  content='每天手写至少半页日记，拍照上传。戒掉手机依赖，找回思考习惯。',
  category='生活',
  evidenceText='拍照上传当日手写日记页，需清晰可读。',
  publisherName='DDL 守门员'
WHERE id='p_106';
