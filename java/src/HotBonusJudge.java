public class HotBonusJudge {

    // 含复合条件 (&&) 的方法：判断帖子是否处于"即将爆满"状态，给予热度加成
    // 业务规则：人数达到 80% 阈值(A) 且 尚未真正满员(B) 时返回 20，否则 0
    public static int calcHotBonus(int currentBuddies, int maxBuddies) {
        int safe = maxBuddies == 0 ? 1 : maxBuddies;
        // 复合条件：A && B
        if (currentBuddies >= safe * 0.8 && currentBuddies < safe) {  // A && B
            return 20;
        }
        return 0;
    }

    public static void main(String[] args) {
        System.out.println("8/10 (A真B真): " + calcHotBonus(8, 10));   // 期望 20
        System.out.println("10/10(A真B假): " + calcHotBonus(10, 10));  // 期望 0  (满员，B假)
        System.out.println("4/10 (A假):    " + calcHotBonus(4, 10));   // 期望 0  (A假，短路)
    }
}
