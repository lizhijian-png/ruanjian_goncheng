public class User {
    public double completionRate; // 0.0 ~ 1.0
    public double points;         // >= 0

    public User(double completionRate, double points) {
        this.completionRate = completionRate;
        this.points = points;
    }
}
