import java.util.Map;

public class RecommendationService {

    /**
     * 计算帖子推荐分（0~100 整数）。
     * 翻译自 backend/src/server.js calcRecommendedScore()。
     *
     * @param post           被评分的帖子
     * @param publisherUser  发布者信息，若未知则传 null
     * @param preferenceMap  当前用户的分类偏好表，key=分类名，若未登录则传 null
     * @return 推荐分（Math.round 后的整数）
     */
    public static int calcRecommendedScore(Post post, User publisherUser,
                                           Map<String, Preference> preferenceMap) {
        // 发布者质量分：完成率权重 0.6，积分权重 0.4（积分/10，上限 100）
        double cr  = publisherUser != null ? publisherUser.completionRate : 0;
        double pts = publisherUser != null ? Math.min(publisherUser.points / 10.0, 100) : 0;
        double publisherScore = cr * 0.6 + pts * 0.4;

        // 帖子内容分：悬赏(/2 上限50) + 违约金(/2 上限30) + 热度加成(>=80%满员 +20)
        double rewardScore  = Math.min(post.reward  / 2.0, 50);
        double penaltyScore = Math.min(post.penalty / 2.0, 30);
        int maxBuddiesSafe  = post.maxBuddies == 0 ? 1 : post.maxBuddies;  // 对应 JS 的 || 1
        double hotBonus     = post.currentBuddies >= maxBuddiesSafe * 0.8 ? 20 : 0;
        double postScore    = rewardScore + penaltyScore + hotBonus;

        // 偏好匹配分：用户对该分类的完成/放弃比率（无记录默认 50）
        double prefScore = 50;
        if (preferenceMap != null) {
            Preference pref = preferenceMap.get(post.category);
            if (pref != null) {
                int total = pref.doneCount * 2 + pref.abandonCount;
                prefScore = total > 0 ? ((double) pref.doneCount * 2 / total) * 100 : 50;
            }
        }

        return (int) Math.round(publisherScore * 0.4 + postScore * 0.3 + prefScore * 0.3);
    }
}
