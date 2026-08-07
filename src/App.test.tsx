import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { gameSession } from "./services/gameSession";

vi.mock("./services/gameSession", () => ({
  gameSession: {
    enter: vi.fn(),
    restore: vi.fn()
  }
}));

describe("first-visit session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("creates an anonymous player with one authoritative starter credit after age confirmation", async () => {
    vi.mocked(gameSession.enter).mockResolvedValue({ creditBalance: 1 });

    render(<App />);

    fireEvent.click(screen.getByRole("checkbox", { name: /at least 13/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter pretend ai/i }));

    await waitFor(() => {
      expect(gameSession.enter).toHaveBeenCalledOnce();
    });

    expect(screen.getByText("1 credit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask a question/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /pretend to be ai/i })).toBeEnabled();
  });

  it("restores the existing session and authoritative balance on a returning visit", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 3 });

    render(<App />);

    await waitFor(() => {
      expect(gameSession.restore).toHaveBeenCalledOnce();
    });

    expect(screen.getByText("3 credits")).toBeInTheDocument();
  });
});
