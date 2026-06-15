import java.util.Map;

// 辅助方法演示：从 calcRecommendedScore 中提取的"偏好分计算"子方法
// 用于任务二 2.2 绘制辅助方法控制流图
public class PrefScoreHelper {

    // 辅助方法：计算某分类的偏好匹配分（0~100），逻辑等价于主方法第 29~36 行
    public static double computePrefScore(Map<String, Preference> preferenceMap, String category) {
        double prefScore = 50;                       // L1 默认值
        if (preferenceMap != null) {                 // D1
            Preference pref = preferenceMap.get(category);  // L2
            if (pref != null) {                      // D2
                int total = pref.doneCount * 2 + pref.abandonCount;  // L3
                prefScore = total > 0                // D3
                        ? ((double) pref.doneCount * 2 / total) * 100
                        : 50;
            }
        }
        return prefScore;                            // L4
    }

    public static void main(String[] args) {
        java.util.Map<String, Preference> m = new java.util.HashMap<>();
        m.put("study", new Preference(8, 4));
        System.out.println("有记录: " + computePrefScore(m, "study"));   // 期望 80
        System.out.println("无该分类: " + computePrefScore(m, "game"));  // 期望 50
        System.out.println("map为null: " + computePrefScore(null, "study")); // 期望 50
        java.util.Map<String, Preference> z = new java.util.HashMap<>();
        z.put("study", new Preference(0, 0));
        System.out.println("total=0: " + computePrefScore(z, "study"));  // 期望 50
    }
}
