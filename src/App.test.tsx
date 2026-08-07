import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { gameSession } from "./services/gameSession";
import { gameApi } from "./services/gameApi";
import { history } from "./services/history";

vi.mock("./services/gameSession", () => ({
  gameSession: {
    enter: vi.fn(),
    restore: vi.fn()
  }
}));

vi.mock("./services/gameApi", () => ({
  gameApi: {
    createQuestion: vi.fn(),
    getAndReserveQuestion: vi.fn(),
    submitAnswer: vi.fn(),
    retrievePendingDelivery: vi.fn().mockResolvedValue(null),
    acknowledgeDelivery: vi.fn()
  }
}));
vi.mock("./services/history", () => ({ history: { saveWaitingQuestion: vi.fn() } }));

describe("first-visit session", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("creates an anonymous player with one authoritative starter credit after age confirmation", async () => {
    vi.mocked(gameSession.enter).mockResolvedValue({ creditBalance: 1, activeQuestion: null });

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
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 3, activeQuestion: null });

    render(<App />);

    await waitFor(() => {
      expect(gameSession.restore).toHaveBeenCalledOnce();
    });

    expect(screen.getByText("3 credits")).toBeInTheDocument();
  });

  it("spends a credit and saves the waiting question locally", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.createQuestion).mockResolvedValue({
      id: "question-1", text: "How are you?", status: "pending", createdAt: "2026-08-07T00:00:00Z", creditBalance: 0
    });

    render(<App />);
    await screen.findByRole("button", { name: /ask a question/i });
    fireEvent.click(screen.getByRole("button", { name: /ask a question/i }));
    fireEvent.change(screen.getByLabelText(/your question/i), { target: { value: "How are you?" } });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => expect(history.saveWaitingQuestion).toHaveBeenCalledOnce());
    expect(screen.getByText(/your question is waiting/i)).toBeInTheDocument();
    expect(screen.getByText("0 credits")).toBeInTheDocument();
  });
});
