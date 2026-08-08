import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { gameSession } from "./services/gameSession";
import { gameApi } from "./services/gameApi";
import { history } from "./services/history";

vi.mock("./services/gameSession", () => ({
  gameSession: {
    enter: vi.fn(),
    restore: vi.fn().mockResolvedValue(null),
    isModerator: vi.fn().mockResolvedValue(false)
  }
}));

vi.mock("./services/gameApi", () => ({
  gameApi: {
    createQuestion: vi.fn(),
    getAndReserveQuestion: vi.fn(),
    getCurrentReservation: vi.fn().mockResolvedValue(null),
    skipQuestion: vi.fn(),
    getLatestExpiredQuestion: vi.fn().mockResolvedValue(null),
    getLatestUnavailableDelivery: vi.fn().mockResolvedValue(null),
    submitAnswer: vi.fn(),
    retrievePendingDelivery: vi.fn().mockResolvedValue(null),
    acknowledgeDelivery: vi.fn(),
    rateAnswer: vi.fn(),
    reportAssignedQuestion: vi.fn(),
    reportAnswer: vi.fn(),
    getOpenReports: vi.fn().mockResolvedValue([]),
    resolveReport: vi.fn()
  }
}));
vi.mock("./services/history", () => ({
  history: { saveWaitingQuestion: vi.fn(), saveSubmittedAnswer: vi.fn(), saveDeliveredAnswer: vi.fn(), latestDeliveredAnswer: vi.fn().mockResolvedValue(undefined), all: vi.fn().mockResolvedValue([]), deleteEntry: vi.fn(), clear: vi.fn() }
}));
vi.mock("lottie-react", () => ({
  default: () => <div data-testid="loading-orb" />
}));

describe("first-visit session", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem("pretend-ai.consent-v1", "true");
    window.localStorage.setItem("pretend-ai.instructions-v1", "true");
    vi.mocked(gameSession.restore).mockResolvedValue(null);
    vi.mocked(gameSession.isModerator).mockResolvedValue(false);
    vi.mocked(gameApi.getAndReserveQuestion).mockResolvedValue(null);
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.getLatestExpiredQuestion).mockResolvedValue(null);
    vi.mocked(gameApi.getLatestUnavailableDelivery).mockResolvedValue(null);
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue(null);
    vi.mocked(gameApi.getOpenReports).mockResolvedValue([]);
    vi.mocked(history.latestDeliveredAnswer).mockResolvedValue(undefined);
    vi.mocked(history.all).mockResolvedValue([]);
  });

  it("shows the animated orb while restoring a session", () => {
    vi.mocked(gameSession.restore).mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByTestId("loading-orb")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading pretend ai/i);
  });

  it("requires consent before creating an anonymous guest and shows instructions once", async () => {
    window.localStorage.clear();
    vi.mocked(gameSession.restore).mockResolvedValue(null);
    vi.mocked(gameSession.enter).mockResolvedValue({ creditBalance: 1, activeQuestion: null });

    render(<App />);

    const consentDialog = screen.getByRole("dialog", { name: /before you enter/i });
    const enterButton = screen.getByRole("button", { name: /enter anonymously/i });
    expect(consentDialog).toBeInTheDocument();
    expect(enterButton).toBeDisabled();
    expect(gameSession.restore).not.toHaveBeenCalled();
    expect(gameSession.enter).not.toHaveBeenCalled();

    const consentChecks = screen.getAllByRole("checkbox");
    fireEvent.click(consentChecks[0]);
    expect(enterButton).toBeDisabled();
    fireEvent.click(consentChecks[1]);
    expect(enterButton).toBeEnabled();
    fireEvent.click(enterButton);

    expect(await screen.findByRole("dialog", { name: /people pretending to be ai/i })).toBeInTheDocument();
    await waitFor(() => expect(gameSession.enter).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.localStorage.getItem("pretend-ai.consent-v1")).toBe("true");
    expect(window.localStorage.getItem("pretend-ai.instructions-v1")).toBe("true");
  });

  it("opens the game directly with an invisible anonymous guest identity", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue(null);
    vi.mocked(gameSession.enter).mockResolvedValue({ creditBalance: 1, activeQuestion: null });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /what would you like to do/i })).toBeInTheDocument();
    });

    expect(gameSession.enter).toHaveBeenCalledOnce();

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
    expect(screen.getByText("How are you?")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for a human/i);
    expect(screen.getByRole("textbox", { name: "Your question" })).toBeInTheDocument();
    expect(screen.getByText("0 credits")).toBeInTheDocument();
  });

  it("keeps a waiting question in the chat after visiting and leaving the AI queue", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.createQuestion).mockResolvedValue({
      id: "question-pending", text: "Still visible?", status: "pending", createdAt: "2026-08-07T00:00:00Z", creditBalance: 0
    });
    vi.mocked(gameApi.getAndReserveQuestion).mockResolvedValue(null);

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/your question/i), { target: { value: "Still visible?" } });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await screen.findByText("Still visible?");

    fireEvent.click(screen.getByRole("button", { name: /pretend to be ai/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start playing/i }));
    await screen.findByRole("button", { name: /leave queue/i });
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValueOnce({
      answerId: "answer-pending", questionId: "question-pending", questionText: "Still visible?", answerText: "Yes, still here.", answeredAt: "2026-08-07T00:01:00Z"
    });
    fireEvent.click(screen.getByRole("button", { name: /leave queue/i }));
    expect(screen.getByRole("button", { name: /start playing/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to human mode/i }));
    expect(await screen.findByRole("heading", { name: /a human answered your question/i })).toBeInTheDocument();
    expect(gameApi.acknowledgeDelivery).toHaveBeenCalledWith("answer-pending");
  });

  it("keeps the question form available with a recoverable safety error", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.createQuestion).mockRejectedValue(new Error("This question needs review before it can be shared"));

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /ask a question/i }));
    fireEvent.change(screen.getByLabelText(/your question/i), { target: { value: "meet me at my home address" } });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs review/i);
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
  });

  it("offers working recovery actions when no question is available", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getAndReserveQuestion).mockResolvedValue(null);

    render(<App />);
    await screen.findByRole("button", { name: /pretend to be ai/i });
    fireEvent.click(screen.getByRole("button", { name: /pretend to be ai/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start playing/i }));
    await screen.findByRole("button", { name: /check now/i });

    fireEvent.click(screen.getByRole("button", { name: /leave queue/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to human mode/i }));
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
  });

  it("keeps a player in the AI queue after skipping an assignment", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getAndReserveQuestion).mockResolvedValue({
      id: "question-to-skip",
      text: "A prompt to skip",
      reservationExpiresAt: "2099-08-07T00:02:00Z",
      serverNow: "2099-08-07T00:00:00Z"
    });
    vi.mocked(gameApi.skipQuestion).mockResolvedValue();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /pretend to be ai/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start playing/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));

    await waitFor(() => expect(gameApi.skipQuestion).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: /check now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave queue/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();
  });

  it("restores a valid answerer reservation with the server deadline", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 2, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue({
      id: "question-2",
      text: "What makes a good weekend?",
      reservationExpiresAt: "2026-08-07T00:02:00Z",
      serverNow: "2026-08-07T00:00:00Z"
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /answer this question/i })).toBeInTheDocument();
    expect(screen.getByText(/time remaining: 2:00/i)).toBeInTheDocument();
  });

  it("shows the machine success panel after an answer earns a credit", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 0, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue({ id: "question-machine", text: "Be an AI", reservationExpiresAt: "2026-08-07T00:02:00Z", serverNow: "2026-08-07T00:00:00Z" });
    vi.mocked(gameApi.submitAnswer).mockResolvedValue({ id: "answer-machine", acceptedAt: "2026-08-07T00:00:30Z", creditBalance: 1 });

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/your answer/i), { target: { value: "Machine-like answer" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    expect(await screen.findByText(/great success/i)).toHaveTextContent(/you now have 1/i);
    expect(screen.getByRole("button", { name: /another one/i })).toBeInTheDocument();
  });

  it("shows an expired question and the refunded authoritative balance on return", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.getLatestExpiredQuestion).mockResolvedValue({ id: "question-3" });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /your unanswered question expired/i })).toBeInTheDocument();
    expect(screen.getByText("1 credit")).toBeInTheDocument();
  });

  it("allows the asker to rate a delivered answer once", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue({
      answerId: "answer-1", questionId: "question-1", questionText: "Question?", answerText: "Answer.", answeredAt: "2026-08-07T00:00:00Z"
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Like" }));

    await waitFor(() => expect(gameApi.rateAnswer).toHaveBeenCalledWith("answer-1", "like"));
    expect(screen.getByRole("button", { name: "Like" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dislike" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Your question" })).toBeInTheDocument();
  });

  it("keeps completed chat exchanges visible when the asker sends another question", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValueOnce({
      answerId: "answer-history", questionId: "question-history", questionText: "First question", answerText: "First answer", answeredAt: "2026-08-07T00:00:00Z"
    }).mockResolvedValue(null);
    vi.mocked(gameApi.createQuestion).mockResolvedValue({
      id: "question-next", text: "Second question", status: "pending", createdAt: "2026-08-07T00:01:00Z", creditBalance: 0
    });

    render(<App />);
    expect(await screen.findByText("First answer")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Second question" } });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => expect(gameApi.createQuestion).toHaveBeenCalledWith("Second question"));
    expect(await screen.findByText("Second question")).toBeInTheDocument();
    expect(screen.getByText("First question")).toBeInTheDocument();
    expect(screen.getByText("First answer")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for a human/i);
  });

  it("keeps a delivered chat visible after visiting and leaving the AI queue", async () => {
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue({
      answerId: "answer-stays", questionId: "question-stays", questionText: "Does this stay?", answerText: "Yes, it stays.", answeredAt: "2026-08-07T00:00:00Z"
    });
    vi.mocked(gameApi.getAndReserveQuestion).mockResolvedValue(null);

    render(<App />);
    expect(await screen.findByText("Yes, it stays.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pretend to be ai/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start playing/i }));
    fireEvent.click(await screen.findByRole("button", { name: /leave queue/i }));
    expect(screen.getByRole("button", { name: /start playing/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to human mode/i }));
    expect(screen.getByText("Does this stay?")).toBeInTheDocument();
    expect(screen.getByText("Yes, it stays.")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for a human/i)).not.toBeInTheDocument();
  });

  it("does not acknowledge a delivery until a failed local save is retried", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue({
      answerId: "answer-retry", questionId: "question-retry", questionText: "Question?", answerText: "Answer.", answeredAt: "2026-08-07T00:00:00Z"
    });
    vi.mocked(history.saveDeliveredAnswer).mockRejectedValueOnce(new Error("IndexedDB is unavailable"));

    render(<App />);
    expect(await screen.findByRole("button", { name: /retry saving answer/i })).toBeInTheDocument();
    expect(gameApi.acknowledgeDelivery).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /retry saving answer/i }));
    await waitFor(() => expect(gameApi.acknowledgeDelivery).toHaveBeenCalledWith("answer-retry"));
  });

  it("shows the unavailable state when an unclaimed delivery was purged", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue(null);
    vi.mocked(gameApi.getLatestExpiredQuestion).mockResolvedValue(null);
    vi.mocked(gameApi.getLatestUnavailableDelivery).mockResolvedValue({ questionId: "question-purged" });

    render(<App />);
    expect(await screen.findByRole("heading", { name: /this answer is no longer available/i })).toBeInTheDocument();
  });

  it("reports an assigned question and returns the reporter to a safe home state", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue({ id: "question-report", text: "Unsafe?", reservationExpiresAt: "2026-08-07T00:02:00Z", serverNow: "2026-08-07T00:00:00Z" });

    render(<App />);
    await screen.findByRole("heading", { name: /answer this question/i });
    fireEvent.click(screen.getByText(/^report$/i));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "This is unsafe" } });
    fireEvent.click(screen.getByRole("button", { name: /report and release/i }));

    await waitFor(() => expect(gameApi.reportAssignedQuestion).toHaveBeenCalledWith("This is unsafe"));
    expect(screen.getByRole("heading", { name: /what would you like to do/i })).toBeInTheDocument();
  });

  it("reports a locally saved delivered answer with only its answer text as evidence", async () => {
    window.localStorage.setItem("pretend-ai.age-confirmed", "true");
    vi.mocked(gameSession.restore).mockResolvedValue({ creditBalance: 1, activeQuestion: null });
    vi.mocked(gameApi.getCurrentReservation).mockResolvedValue(null);
    vi.mocked(gameApi.retrievePendingDelivery).mockResolvedValue({ answerId: "answer-report", questionId: "question-report", questionText: "Question?", answerText: "Saved answer.", answeredAt: "2026-08-07T00:00:00Z" });

    render(<App />);
    await screen.findByRole("heading", { name: /a human answered your question/i });
    fireEvent.click(screen.getByText(/^report$/i));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Harmful answer" } });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(gameApi.reportAnswer).toHaveBeenCalledWith("answer-report", "Harmful answer", "Saved answer."));
  });
});
