import { render, screen } from "@testing-library/react";
import { AgentTheater } from "./AgentTheater";

describe("AgentTheater", () => {
  it("renders all four agent names", () => {
    render(<AgentTheater />);
    expect(screen.getAllByText("Dev").length).toBeGreaterThan(0);
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("E2E")).toBeInTheDocument();
    expect(screen.getByText("Verifier")).toBeInTheDocument();
  });

  it("renders the theater heading", () => {
    render(<AgentTheater />);
    expect(screen.getByText(/Live Agent Theater/i)).toBeInTheDocument();
  });

  it("renders all pipeline stage labels", () => {
    render(<AgentTheater />);
    expect(screen.getAllByText("Dev").length).toBeGreaterThan(0);
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByText("Final Signoff")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("shows the replay demo button", () => {
    render(<AgentTheater />);
    expect(
      screen.getByRole("button", { name: /replay demo/i }),
    ).toBeInTheDocument();
  });

  it("shows demo disclaimer text when no live data", () => {
    render(<AgentTheater />);
    expect(screen.getByText(/demo simulation/i)).toBeInTheDocument();
  });

  it("shows Live badge and hides replay button when live data is provided", () => {
    const liveState = {
      id: "abc123",
      task: "add dark mode toggle",
      stage: "dev",
      iteration: 1,
      max_iters: 8,
      pr_number: null,
      branch: "dev/abc123",
      repo: "owner/repo",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    };
    render(<AgentTheater pipelineState={liveState} />);
    // The "🔴 Live" badge should appear (distinct from the heading "Live Agent Theater")
    expect(screen.getByText(/🔴 Live/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /replay demo/i }),
    ).not.toBeInTheDocument();
  });

  it("shows iteration counter", () => {
    render(<AgentTheater />);
    expect(screen.getByText(/iteration 1/i)).toBeInTheDocument();
  });
});
