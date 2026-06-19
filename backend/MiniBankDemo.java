import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * MiniBankDemo —— 一个完全自包含的演示程序，模拟一个极简银行系统。
 *
 * 该文件不依赖项目中的任何其他类，可单独编译运行：
 *   javac MiniBankDemo.java
 *   java  MiniBankDemo
 *
 * 功能：开户、存款、取款、转账，并维护一份简单的流水记录。
 */
public class MiniBankDemo {

    /** 账户实体：持有人、余额与本账户的流水。 */
    static class Account {
        private final String id;
        private final String owner;
        private double balance;
        private final List<String> history = new ArrayList<>();

        Account(String id, String owner, double opening) {
            this.id = id;
            this.owner = owner;
            this.balance = opening;
            history.add("开户，初始余额 " + format(opening));
        }

        String getId() {
            return id;
        }

        String getOwner() {
            return owner;
        }

        double getBalance() {
            return balance;
        }

        void deposit(double amount) {
            if (amount <= 0) {
                throw new IllegalArgumentException("存款金额必须为正：" + amount);
            }
            balance += amount;
            history.add("存入 " + format(amount) + "，余额 " + format(balance));
        }

        void withdraw(double amount) {
            if (amount <= 0) {
                throw new IllegalArgumentException("取款金额必须为正：" + amount);
            }
            if (amount > balance) {
                throw new IllegalStateException("余额不足，当前 " + format(balance) + "，请求 " + format(amount));
            }
            balance -= amount;
            history.add("取出 " + format(amount) + "，余额 " + format(balance));
        }

        List<String> getHistory() {
            return history;
        }
    }

    /** 银行：管理多个账户并提供转账。 */
    static class Bank {
        private final Map<String, Account> accounts = new HashMap<>();
        private int seq = 1000;

        Account open(String owner, double opening) {
            String id = "ACC" + (seq++);
            Account account = new Account(id, owner, opening);
            accounts.put(id, account);
            return account;
        }

        Account get(String id) {
            Account account = accounts.get(id);
            if (account == null) {
                throw new IllegalArgumentException("账户不存在：" + id);
            }
            return account;
        }

        void transfer(String fromId, String toId, double amount) {
            if (fromId.equals(toId)) {
                throw new IllegalArgumentException("不能向同一账户转账");
            }
            Account from = get(fromId);
            Account to = get(toId);
            from.withdraw(amount);
            to.deposit(amount);
            from.getHistory().add("向 " + toId + " 转账 " + format(amount));
            to.getHistory().add("收到 " + fromId + " 转账 " + format(amount));
        }

        double totalAssets() {
            double sum = 0;
            for (Account account : accounts.values()) {
                sum += account.getBalance();
            }
            return sum;
        }

        int count() {
            return accounts.size();
        }
    }

    /** 统一的金额格式，保留两位小数。 */
    static String format(double amount) {
        return String.format("%.2f", amount);
    }

    static void printAccount(Account account) {
        System.out.println("账户 " + account.getId() + " (" + account.getOwner()
                + ") 余额 " + format(account.getBalance()));
        for (String line : account.getHistory()) {
            System.out.println("    - " + line);
        }
    }

    public static void main(String[] args) {
        Bank bank = new Bank();

        Account alice = bank.open("Alice", 1000.0);
        Account bob = bank.open("Bob", 250.0);

        alice.deposit(500.0);
        bob.deposit(100.0);
        alice.withdraw(200.0);

        bank.transfer(alice.getId(), bob.getId(), 300.0);

        // 演示异常处理：取款超出余额。
        try {
            bob.withdraw(99999.0);
        } catch (IllegalStateException e) {
            System.out.println("捕获预期异常：" + e.getMessage());
        }

        System.out.println();
        System.out.println("===== 账户明细 =====");
        printAccount(alice);
        printAccount(bob);

        System.out.println();
        System.out.println("银行共有账户 " + bank.count() + " 个，总资产 " + format(bank.totalAssets()));
    }
}
