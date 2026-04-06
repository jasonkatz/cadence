import { describe, it, expect, beforeEach, mock } from "bun:test";
import type React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = mock(() => {});
const mockPost = mock(() => Promise.resolve({ id: "wf-123" }));
const mockLogout = mock(() => {});

mock.module("react-router-dom", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = require("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

mock.module("../hooks/useAuth", () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    user: { email: "test@example.com" },
    getAccessTokenSilently: mock(() => Promise.resolve("token")),
    logout: mockLogout,
  }),
  withAuthenticationRequired: <P extends object>(Component: React.ComponentType<P>) => Component,
}));

mock.module("../hooks/useApi", () => ({
  useApi: () => ({
    post: mockPost,
  }),
}));

const { default: NewWorkflowPage } = await import("./NewWorkflowPage");

function renderPage() {
  return render(
    <MemoryRouter>
      <NewWorkflowPage />
    </MemoryRouter>
  );
}

describe("NewWorkflowPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockPost.mockClear();
    mockPost.mockImplementation(() => Promise.resolve({ id: "wf-123" }));
  });

  it("renders the form with required fields", () => {
    renderPage();

    expect(screen.getByLabelText(/task/i)).toBeDefined();
    expect(screen.getByLabelText(/repository/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /create workflow/i })).toBeDefined();
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

  it("validates repo field rejects values not matching owner/repo format", () => {
    renderPage();

    const repoField = screen.getByLabelText(/repository/i) as HTMLInputElement;

    // Invalid: no slash
    fireEvent.change(repoField, { target: { value: "invalid-repo" } });
    expect(repoField.validity.patternMismatch).toBe(true);

    // Invalid: empty after slash
    fireEvent.change(repoField, { target: { value: "owner/" } });
    expect(repoField.validity.patternMismatch).toBe(true);

    // Valid: owner/repo
    fireEvent.change(repoField, { target: { value: "owner/repo" } });
    expect(repoField.validity.patternMismatch).toBe(false);
  });

  it("submits the form and navigates to the new workflow", async () => {
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
    mockPost.mockImplementation(() => Promise.reject(new Error("Bad request")));
    renderPage();

    fireEvent.change(screen.getByLabelText(/task/i), {
      target: { value: "Implement feature X" },
    });
    fireEvent.change(screen.getByLabelText(/repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create workflow/i }));

    await waitFor(() => {
      expect(screen.getByText("Bad request")).toBeDefined();
    });
  });
});
