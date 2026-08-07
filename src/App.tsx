import { type FormEvent, useEffect, useState } from "react";
import { gameSession, type Player } from "./services/gameSession";
import { gameApi, type AssignedQuestion, type PendingDelivery, type WaitingQuestion } from "./services/gameApi";
import { history, type WaitingHistoryEntry } from "./services/history";

const AGE_CONFIRMATION_KEY = "pretend-ai.age-confirmed";

type View =
  | { screen: "age-gate"; error: string | null }
  | { screen: "entering" }
  | { screen: "restoring" }
  | { screen: "home"; player: Player }
  | { screen: "ask"; player: Player; error: string | null }
  | { screen: "waiting"; player: Player; question: WaitingQuestion }
  | { screen: "finding-question"; player: Player }
  | { screen: "answering"; player: Player; assignment: AssignedQuestion }
  | { screen: "empty-queue"; player: Player; error: string | null }
  | { screen: "delivered"; player: Player; delivery: PendingDelivery }
  | { screen: "activity"; player: Player };

function pluralisedCredits(balance: number): string {
  return `${balance} credit${balance === 1 ? "" : "s"}`;
}

export default function App() {
  const [view, setView] = useState<View>(() =>
    localStorage.getItem(AGE_CONFIRMATION_KEY) === "true"
      ? { screen: "restoring" }
      : { screen: "age-gate", error: null }
  );
  const [isOldEnough, setIsOldEnough] = useState(false);

  useEffect(() => {
    if (view.screen !== "restoring") {
      return;
    }

    let isCurrent = true;

    gameSession
      .restore()
      .then(async (restoredPlayer) => {
        if (!isCurrent) return;
        if (restoredPlayer) {
          if (restoredPlayer.activeQuestion) {
            setView({ screen: "waiting", player: restoredPlayer, question: restoredPlayer.activeQuestion });
            return;
          }
          const delivery = await gameApi.retrievePendingDelivery();
          if (!isCurrent) return;
          if (!delivery) {
            const localDelivery = await history.latestDeliveredAnswer();
            if (localDelivery?.answerId && localDelivery.answerText && isCurrent) {
              setView({ screen: "delivered", player: restoredPlayer, delivery: {
                answerId: localDelivery.answerId, questionId: localDelivery.questionId,
                questionText: localDelivery.questionText, answerText: localDelivery.answerText,
                answeredAt: localDelivery.createdAt
              } });
            } else if (isCurrent) {
              setView({ screen: "home", player: restoredPlayer });
            }
            return;
          }
          await history.saveDeliveredAnswer({ questionId: delivery.questionId, role: "asker", questionText: delivery.questionText, answerId: delivery.answerId, answerText: delivery.answerText, createdAt: delivery.answeredAt });
          await gameApi.acknowledgeDelivery(delivery.answerId);
          if (isCurrent) setView({ screen: "delivered", player: restoredPlayer, delivery });
        } else {
          localStorage.removeItem(AGE_CONFIRMATION_KEY);
          setView({ screen: "age-gate", error: null });
        }
      })
      .catch((restoreError: unknown) => {
        if (!isCurrent) return;
        setView({ screen: "age-gate", error: messageFor(restoreError) });
      });

    return () => {
      isCurrent = false;
    };
  }, [view.screen]);

  async function enter() {
    setView({ screen: "entering" });

    try {
      const newPlayer = await gameSession.enter();
      localStorage.setItem(AGE_CONFIRMATION_KEY, "true");
      setView({ screen: "home", player: newPlayer });
    } catch (entryError: unknown) {
      setView({ screen: "age-gate", error: messageFor(entryError) });
    }
  }

  if (view.screen === "home") {
    return <Home
      player={view.player}
      onAsk={() => setView({ screen: "ask", player: view.player, error: null })}
      onActivity={() => setView({ screen: "activity", player: view.player })}
      onAnswer={async () => {
        setView({ screen: "finding-question", player: view.player });
        try {
          const assignment = await gameApi.getAndReserveQuestion();
          setView(assignment
            ? { screen: "answering", player: view.player, assignment }
            : { screen: "empty-queue", player: view.player, error: null });
        } catch (assignmentError: unknown) {
          setView({ screen: "empty-queue", player: view.player, error: messageFor(assignmentError) });
        }
      }}
    />;
  }

  if (view.screen === "ask") {
    return <AskQuestion
      player={view.player}
      error={view.error}
      onCancel={() => setView({ screen: "home", player: view.player })}
      onSubmit={async (text) => {
        try {
          const question = await gameApi.createQuestion(text);
          await history.saveWaitingQuestion({
            questionId: question.id,
            role: "asker",
            questionText: question.text,
            status: question.status,
            createdAt: question.createdAt
          });
          setView({
            screen: "waiting",
            player: { creditBalance: question.creditBalance, activeQuestion: question },
            question
          });
        } catch (questionError: unknown) {
          setView({ screen: "ask", player: view.player, error: messageFor(questionError) });
        }
      }}
    />;
  }

  if (view.screen === "waiting") {
    return <WaitingQuestion player={view.player} question={view.question} />;
  }

  if (view.screen === "answering") {
    return <AnswerQuestion player={view.player} assignment={view.assignment} onSkip={async () => {
      await gameApi.skipQuestion();
      setView({ screen: "home", player: view.player });
    }} />;
  }

  if (view.screen === "empty-queue") {
    return <EmptyQueue player={view.player} error={view.error} />;
  }

  if (view.screen === "delivered") {
    return <DeliveredAnswer player={view.player} delivery={view.delivery} />;
  }

  if (view.screen === "activity") {
    return <Activity player={view.player} onBack={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "finding-question") {
    return <LoadingCard message="Finding a question that needs a human answer…" />;
  }

  const isWorking = view.screen === "entering" || view.screen === "restoring";

  return (
    <main className="gate-shell" aria-busy={isWorking}>
      <section className="gate-card" aria-labelledby="gate-title">
        <p className="eyebrow">Pretend AI</p>
        <h1 id="gate-title">Human intelligence. Artificially presented.</h1>
        <p className="lede">
          Ask anything. A random person will answer as the AI.
        </p>
        {view.screen === "age-gate" ? (
          <>
            <label className="age-check">
              <input
                type="checkbox"
                checked={isOldEnough}
                onChange={(event) => setIsOldEnough(event.target.checked)}
              />
              <span>I confirm that I am at least 13 years old.</span>
            </label>
            {view.error && <p className="form-error" role="alert">{view.error}</p>}
            <button className="primary-action" type="button" disabled={!isOldEnough} onClick={enter}>
              Enter Pretend AI
            </button>
          </>
        ) : (
          <p className="status-message" role="status">
            {view.screen === "restoring" ? "Restoring your session…" : "Creating your anonymous player…"}
          </p>
        )}
        <p className="fine-print">Powered by people, not AI. For entertainment only.</p>
      </section>
    </main>
  );
}

function Home({ player, onAsk, onAnswer, onActivity }: { player: Player; onAsk: () => void; onAnswer: () => void; onActivity: () => void }) {
  return (
    <main className="home-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Pretend AI home">Pretend AI</a>
        <button className="nav-button" type="button" onClick={onActivity}>Activity</button><span className="credit-balance" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}>
          {pluralisedCredits(player.creditBalance)}
        </span>
      </header>

      <section className="home-card" aria-labelledby="home-title">
        <p className="eyebrow">A game of human answers</p>
        <h1 id="home-title">What would you like to do?</h1>
        <p className="lede">One question. One stranger. One fake AI answer.</p>
        <div className="action-grid">
          <button className="role-action" type="button" onClick={onAsk}>
            <span>Ask a Question</span>
            <small>Spend one credit to ask a random human.</small>
          </button>
          <button className="role-action" type="button" onClick={onAnswer}>
            <span>Pretend to Be AI</span>
            <small>Answer someone else’s question and earn a credit.</small>
          </button>
        </div>
        <p className="notice">Answers come from random people. Do not rely on them for important decisions.</p>
      </section>
    </main>
  );
}

function Activity({ player, onBack }: { player: Player; onBack: () => void }) {
  const [entries, setEntries] = useState<WaitingHistoryEntry[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { void history.all().then(setEntries); }, []);
  async function deleteEntry(id: number) { await history.deleteEntry(id); setEntries((current) => current.filter((entry) => entry.id !== id)); }
  async function clearEntries() { await history.clear(); setEntries([]); setConfirming(false); }

  return <main className="home-shell"><section className="home-card" aria-labelledby="activity-title">
    <p className="eyebrow">Activity</p><h1 id="activity-title">Saved on this browser.</h1>
    <p className="notice">History is saved only on this browser. Clearing browser data permanently removes it and cannot be recovered on another device.</p>
    {entries.length === 0 ? <p className="lede">No local activity yet.</p> : <ul className="activity-list">{entries.map((entry) => <li key={entry.id}><strong>{entry.role === "asker" ? "You asked" : "You answered"}</strong><p>{entry.questionText}</p>{entry.answerText && <p>{entry.answerText}</p>}<button className="secondary-action" type="button" onClick={() => void deleteEntry(entry.id!)}>Delete</button></li>)}</ul>}
    <div className="form-actions"><button className="secondary-action" type="button" onClick={onBack}>Back home</button>{entries.length > 0 && <button className="secondary-action" type="button" onClick={() => setConfirming(true)}>Clear all history</button>}</div>
    {confirming && <div className="confirm-panel" role="alert"><p>Delete all local history? This cannot be undone.</p><button className="primary-action" type="button" onClick={() => void clearEntries()}>Delete all</button><button className="secondary-action" type="button" onClick={() => setConfirming(false)}>Cancel</button></div>}
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function AnswerQuestion({ player, assignment, onSkip }: { player: Player; assignment: AssignedQuestion; onSkip: () => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [balance, setBalance] = useState(player.creditBalance);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const accepted = await gameApi.submitAnswer(answer.trim());
      setBalance(accepted.creditBalance);
      try {
        await history.saveSubmittedAnswer({
          questionId: assignment.id, role: "answerer", questionText: assignment.text,
          answerId: accepted.id, answerText: answer.trim(), createdAt: accepted.acceptedAt
        });
        setMessage("Answer submitted. You earned one credit.");
      } catch {
        setMessage("Answer submitted and credit earned, but it could not be saved to this browser.");
      }
    } catch (submitError: unknown) {
      setMessage(messageFor(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="home-shell"><section className="home-card" aria-labelledby="answer-title">
    <p className="eyebrow">Pretend to be AI</p>
    <h1 id="answer-title">Answer this question.</h1>
    <p className="question-preview">“{assignment.text}”</p>
    <ReservationTimer expiresAt={assignment.reservationExpiresAt} serverNow={assignment.serverNow} />
    <form onSubmit={submit}><label className="question-label" htmlFor="answer">Your answer</label>
      <textarea id="answer" value={answer} maxLength={750} required onChange={(event) => setAnswer(event.target.value)} />
      <p className="fine-print">{answer.length}/750 characters</p>
      {message && <p className={message.startsWith("Answer submitted") ? "status-message" : "form-error"} role="status">{message}</p>}
      <div className="form-actions"><button className="primary-action" type="submit" disabled={submitting || !answer.trim()}>{submitting ? "Submitting…" : "Submit answer"}</button>
      <button className="secondary-action" type="button" disabled={skipping || submitting} onClick={async () => { setSkipping(true); try { await onSkip(); } catch (error: unknown) { setMessage(messageFor(error)); setSkipping(false); } }}>Skip</button></div>
    </form>
    <p className="notice">Write the answer as a helpful, funny, absurd, sincere, or convincingly AI-like human.</p>
    <span className="credit-balance">{pluralisedCredits(balance)}</span>
  </section></main>;
}

function ReservationTimer({ expiresAt, serverNow }: { expiresAt: string; serverNow: string }) {
  const [elapsed, setElapsed] = useState(0);
  const remaining = Math.max(0, Date.parse(expiresAt) - Date.parse(serverNow) - elapsed);
  const seconds = Math.ceil(remaining / 1000);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <p className="timer" role="timer" aria-live="off">Time remaining: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>;
}

function EmptyQueue({ player, error }: { player: Player; error: string | null }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="empty-title">
    <p className="eyebrow">No assignment available</p><h1 id="empty-title">No questions need answers right now.</h1>
    <p className="lede">Try again shortly, ask a question, or review your activity.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="primary-action" type="button">Check Again</button><button className="secondary-action" type="button">Ask a Question</button><button className="secondary-action" type="button">View Activity</button></div>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function DeliveredAnswer({ player, delivery }: { player: Player; delivery: PendingDelivery }) {
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  return <main className="home-shell"><section className="home-card" aria-labelledby="delivery-title">
    <p className="eyebrow">Your answer is ready</p><h1 id="delivery-title">A human answered your question.</h1>
    <p className="question-preview">“{delivery.questionText}”</p>
    <p className="lede">{delivery.answerText}</p><p>Did you enjoy this answer?</p>
    <div className="form-actions"><button className="secondary-action" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "like"); setRating("like"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>Like</button><button className="secondary-action" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "dislike"); setRating("dislike"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>Dislike</button></div>
    {rating && <p className="status-message" role="status">Thanks for your feedback.</p>}{ratingError && <p className="form-error" role="alert">{ratingError}</p>}<p className="notice">Saved to this browser before the server copy was removed.</p>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function LoadingCard({ message }: { message: string }) {
  return <main className="gate-shell" aria-busy="true"><section className="gate-card"><p className="status-message" role="status">{message}</p></section></main>;
}

function AskQuestion({
  player,
  error,
  onCancel,
  onSubmit
}: {
  player: Player;
  error: string | null;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    await onSubmit(text.trim());
    setIsSubmitting(false);
  }

  return <main className="home-shell"><section className="home-card" aria-labelledby="ask-title">
    <p className="eyebrow">Ask a question</p>
    <h1 id="ask-title">What would you like a stranger to answer?</h1>
    <p className="lede">Answers come from random people and are for entertainment.</p>
    <form onSubmit={submit}>
      <label className="question-label" htmlFor="question">Your question</label>
      <textarea id="question" value={text} maxLength={500} required onChange={(event) => setText(event.target.value)} />
      <p className="fine-print">{text.length}/500 characters</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-action" disabled={isSubmitting || !text.trim()} type="submit">{isSubmitting ? "Sending…" : "Send question"}</button><button className="secondary-action" type="button" onClick={onCancel}>Cancel</button></div>
    </form>
    <p className="notice">{pluralisedCredits(player.creditBalance)} available. Sending uses one credit.</p>
  </section></main>;
}

function WaitingQuestion({ player, question }: { player: Player; question: WaitingQuestion }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="waiting-title">
    <p className="eyebrow">Your question is waiting</p>
    <h1 id="waiting-title">A human will answer when they are ready.</h1>
    <p className="question-preview">“{question.text}”</p>
    <p className="lede">You can leave this page. We’ll restore the authoritative status when you return.</p>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
