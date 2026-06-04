public class Post {
    public String category;
    public double reward;
    public double penalty;
    public int currentBuddies;
    public int maxBuddies;

    public Post(String category, double reward, double penalty, int currentBuddies, int maxBuddies) {
        this.category = category;
        this.reward = reward;
        this.penalty = penalty;
        this.currentBuddies = currentBuddies;
        this.maxBuddies = maxBuddies;
    }
}
