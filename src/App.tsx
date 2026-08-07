import { useEffect, useState } from "react";
import { gameSession, type Player } from "./services/gameSession";

const AGE_CONFIRMATION_KEY = "pretend-ai.age-confirmed";

type View =
  | { screen: "age-gate"; error: string | null }
  | { screen: "entering" }
  | { screen: "restoring" }
  | { screen: "home"; player: Player };

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
          setView({ screen: "home", player: restoredPlayer });
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
    return <Home player={view.player} />;
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

function Home({ player }: { player: Player }) {
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
          <button className="role-action" type="button">
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

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
