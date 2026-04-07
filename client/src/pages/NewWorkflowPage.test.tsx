import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const mockPost = jest.fn().mockResolvedValue({ id: "wf-123" });
jest.mock("../hooks/useApi", () => ({
  useApi: () => ({
    post: mockPost,
  }),
}));

import NewWorkflowPage from "./NewWorkflowPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <NewWorkflowPage />
    </MemoryRouter>
  );
}

describe("NewWorkflowPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ id: "wf-123" });
  });

  it("renders the form with required fields", () => {
    renderPage();

    expect(screen.getByLabelText(/task/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repository/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create workflow/i })
    ).toBeInTheDocument();
  });

  it("marks task as required", () => {
    renderPage();

    const taskField = screen.getByLabelText(/task/i) as HTMLTextAreaElement;
    expect(taskField.required).toBe(true);
  });

  it("marks repo as required", () => {
    renderPage();

    const repoField = screen.getByLabelText(/repository/i) as HTMLInputElement;
    expect(repoField.required).toBe(true);
  });

  it("validates repo field has owner/repo pattern", () => {
    renderPage();

    const repoField = screen.getByLabelText(/repository/i) as HTMLInputElement;
    expect(repoField.pattern).toBe("[\\w.\\-]+/[\\w.\\-]+");
  });

  it("submits the form and navigates on success", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(/task/i), {
      target: { value: "Implement feature X" },
    });
    fireEvent.change(screen.getByLabelText(/repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create workflow/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/v1/workflows", {
        task: "Implement feature X",
        repo: "owner/repo",
      });
      expect(mockNavigate).toHaveBeenCalledWith("/workflows/wf-123");
    });
  });

  it("shows error message on submission failure", async () => {
    mockPost.mockRejectedValue(new Error("Bad request"));
    renderPage();

    fireEvent.change(screen.getByLabelText(/task/i), {
      target: { value: "Implement feature X" },
    });
    fireEvent.change(screen.getByLabelText(/repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create workflow/i }));

    await waitFor(() => {
      expect(screen.getByText("Bad request")).toBeInTheDocument();
    });
  });
});
