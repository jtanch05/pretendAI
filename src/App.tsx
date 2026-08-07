import { type FormEvent, useEffect, useState } from "react";
import { gameSession, type Player } from "./services/gameSession";
import { gameApi, type WaitingQuestion } from "./services/gameApi";
import { history } from "./services/history";

const AGE_CONFIRMATION_KEY = "pretend-ai.age-confirmed";

type View =
  | { screen: "age-gate"; error: string | null }
  | { screen: "entering" }
  | { screen: "restoring" }
  | { screen: "home"; player: Player }
  | { screen: "ask"; player: Player; error: string | null }
  | { screen: "waiting"; player: Player; question: WaitingQuestion };

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
      .then((restoredPlayer) => {
        if (!isCurrent) return;
        if (restoredPlayer) {
          setView(restoredPlayer.activeQuestion
            ? { screen: "waiting", player: restoredPlayer, question: restoredPlayer.activeQuestion }
            : { screen: "home", player: restoredPlayer });
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
    return <Home player={view.player} onAsk={() => setView({ screen: "ask", player: view.player, error: null })} />;
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

function Home({ player, onAsk }: { player: Player; onAsk: () => void }) {
  return (
    <main className="home-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Pretend AI home">Pretend AI</a>
        <span className="credit-balance" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}>
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
          <button className="role-action" type="button">
            <span>Pretend to Be AI</span>
            <small>Answer someone else’s question and earn a credit.</small>
          </button>
        </div>
        <p className="notice">Answers come from random people. Do not rely on them for important decisions.</p>
      </section>
    </main>
  );
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
