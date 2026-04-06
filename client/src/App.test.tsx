import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import App from "./App";

jest.mock("@auth0/auth0-react");

const mockUseAuth0 = useAuth0 as jest.MockedFunction<typeof useAuth0>;

describe("App", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows loading spinner when auth is loading", () => {
    mockUseAuth0.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    } as ReturnType<typeof useAuth0>);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows home page when auth is loaded and user is not authenticated", () => {
    mockUseAuth0.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      loginWithRedirect: jest.fn(),
    } as unknown as ReturnType<typeof useAuth0>);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText("Tmpo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});
