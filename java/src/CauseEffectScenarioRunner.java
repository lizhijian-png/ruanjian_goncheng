import java.util.HashMap;
import java.util.Map;

// 临时测试驱动：跑因果图 8 种场景，输出真实推荐分
public class CauseEffectScenarioRunner {
    public static void main(String[] args) {
        // 固定值：reward=100, penalty=60, 分类 "study"
        // c1=T 时发布者 completionRate=1.0, points=1000
        // c2=T 时 maxBuddies=10, currentBuddies=8 (>=80%)；c2=F 时 currentBuddies=4
        // c3=T 时 preferenceMap{study: done=8, abandon=4}；c3=F 时 preferenceMap=null
        boolean[] tf = {true, false};
        System.out.println("场景\tc1\tc2\tc3\t推荐分");
        int idx = 1;
        for (boolean c1 : tf)
            for (boolean c2 : tf)
                for (boolean c3 : tf) {
                    User pub = c1 ? new User(1.0, 1000) : null;
                    int cur = c2 ? 8 : 4;
                    Post post = new Post("study", 100, 60, cur, 10);
                    Map<String, Preference> pref = null;
                    if (c3) {
                        pref = new HashMap<>();
                        pref.put("study", new Preference(8, 4));
                    }
                    int score = RecommendationService.calcRecommendedScore(post, pub, pref);
                    System.out.printf("S%d\t%s\t%s\t%s\t%d%n", idx++,
                            c1 ? "T" : "F", c2 ? "T" : "F", c3 ? "T" : "F", score);
                }
    }
}
