import { render, screen } from "@testing-library/react";
import { AchievementBadges } from "./AchievementBadges";

describe("AchievementBadges", () => {
  it("renders the achievements heading", () => {
    render(<AchievementBadges earned={[]} />);
    expect(screen.getByText(/Achievements/i)).toBeInTheDocument();
  });

  it("shows all five achievement labels", () => {
    render(<AchievementBadges earned={[]} />);
    expect(screen.getByText("First Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Zero-Comment Review")).toBeInTheDocument();
    expect(screen.getByText("Workflow Veteran")).toBeInTheDocument();
    expect(screen.getByText("Survived Max Iterations")).toBeInTheDocument();
    expect(screen.getByText("Speed Run")).toBeInTheDocument();
  });

  it("shows 0/5 earned when no achievements", () => {
    render(<AchievementBadges earned={[]} />);
    expect(screen.getByText("0/5 earned")).toBeInTheDocument();
  });

  it("shows correct earned count with some achievements", () => {
    render(
      <AchievementBadges earned={["first-workflow", "speed-run"]} />,
    );
    expect(screen.getByText("2/5 earned")).toBeInTheDocument();
  });

  it("shows Earned label for earned achievements", () => {
    render(<AchievementBadges earned={["first-workflow"]} />);
    expect(screen.getByText("Earned")).toBeInTheDocument();
  });

  it("shows prompt to run first pipeline when nothing earned", () => {
    render(<AchievementBadges earned={[]} />);
    expect(
      screen.getByText(/run your first pipeline/i),
    ).toBeInTheDocument();
  });

  it("does not show first pipeline prompt when badges earned", () => {
    render(<AchievementBadges earned={["first-workflow"]} />);
    expect(
      screen.queryByText(/run your first pipeline/i),
    ).not.toBeInTheDocument();
  });
});
