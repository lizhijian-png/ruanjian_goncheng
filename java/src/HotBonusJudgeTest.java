import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class HotBonusJudgeTest {

    // ===对应 4.3 条件覆盖的用例：只测 TF 和 FT===
    @Test
    public void test_calcHotBonus_cc01_FalseTrue() {
        assertEquals(0, HotBonusJudge.calcHotBonus(5, 10)); // CC-01
    }
    @Test
    public void test_calcHotBonus_cc02_TrueFalse() {
        assertEquals(0, HotBonusJudge.calcHotBonus(10, 10)); // CC-02
    }

    // ===对应 4.4 判定-条件覆盖的补充用例：补一个 TT，让整体变成 True===
    @Test
    public void test_calcHotBonus_dcc01_TrueTrue() {
        assertEquals(20, HotBonusJudge.calcHotBonus(8, 10)); // DCC-01 
    }

    // ===对应 4.5 条件组合覆盖的用例：跑完 TT/TF/FT，因为 FF 不存在===
    @Test
    public void test_calcHotBonus_mcc_AllCombinations() {
        assertEquals(20, HotBonusJudge.calcHotBonus(8, 10)); // TT
        assertEquals(0, HotBonusJudge.calcHotBonus(10, 10)); // TF
        assertEquals(0, HotBonusJudge.calcHotBonus(5, 10));  // FT
        // FF 不可达
    }
}