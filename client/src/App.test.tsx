import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

jest.mock("./hooks/useApi", () => ({
  useApi: () => ({
    get: jest.fn().mockResolvedValue({ workflows: [], total: 0 }),
  }),
}));

function renderApp(route = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("App", () => {
  it("redirects / to dashboard", () => {
    renderApp("/");
    expect(screen.getByText("Workflows")).toBeInTheDocument();
  });

  it("renders dashboard at /dashboard", () => {
    renderApp("/dashboard");
    expect(screen.getByText("Tmpo")).toBeInTheDocument();
  });
});
