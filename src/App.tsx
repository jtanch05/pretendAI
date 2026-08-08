import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Lottie from "lottie-react";
import { gameSession, type Player } from "./services/gameSession";
import { gameApi, type AssignedQuestion, type ModerationReport, type PendingDelivery, type WaitingQuestion } from "./services/gameApi";
import { history, type WaitingHistoryEntry } from "./services/history";
import { getSupabaseClient } from "./services/supabase";
import aiOrbLoader from "./assets/ai-orb-loader.json";

type TurnstileApi = {
  render: (element: HTMLElement, options: {
    sitekey: string;
    theme: "light" | "dark" | "auto";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type View =
  | { screen: "restoring" }
  | { screen: "home"; player: Player }
  | { screen: "waiting"; player: Player; question: WaitingQuestion }
  | { screen: "ai-ready"; player: Player }
  | { screen: "finding-question"; player: Player }
  | { screen: "answering"; player: Player; assignment: AssignedQuestion }
  | { screen: "empty-queue"; player: Player; error: string | null }
  | { screen: "delivered"; player: Player; delivery: PendingDelivery }
  | { screen: "delivery-retry"; player: Player; delivery: PendingDelivery; error: string }
  | { screen: "expired"; player: Player }
  | { screen: "unavailable"; player: Player }
  | { screen: "activity"; player: Player }
  | { screen: "moderation"; player: Player }
  | { screen: "rules"; player: Player };

function pluralisedCredits(balance: number): string {
  return `${balance} credit${balance === 1 ? "" : "s"}`;
}

export default function App() {
  const [hasConsent, setHasConsent] = useState(() => localStorage.getItem("pretend-ai.consent-v1") === "true");
  const [hasReadInstructions, setHasReadInstructions] = useState(() => localStorage.getItem("pretend-ai.instructions-v1") === "true");
  const [view, setView] = useState<View>(() => hasConsent
    ? { screen: "restoring" }
    : { screen: "home", player: { creditBalance: 1, activeQuestion: null } });
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [lastDelivery, setLastDelivery] = useState<PendingDelivery | null>(null);
  const [deliveredHistory, setDeliveredHistory] = useState<PendingDelivery[]>([]);
  const [realtimeRefresh, setRealtimeRefresh] = useState(0);
  const answerPollingBlocked = useRef(false);

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
          void history.all().then((entries) => {
            if (!isCurrent) return;
            const restoredDeliveries = entries
              .filter((entry) => entry.role === "asker" && entry.status === "delivered" && entry.answerId && entry.answerText)
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              .map((entry) => ({
                answerId: entry.answerId!, questionId: entry.questionId, questionText: entry.questionText,
                answerText: entry.answerText!, answeredAt: entry.createdAt
              }));
            setDeliveredHistory((current) => {
              const byAnswerId = new Map(current.map((delivery) => [delivery.answerId, delivery]));
              restoredDeliveries.forEach((delivery) => byAnswerId.set(delivery.answerId, delivery));
              return [...byAnswerId.values()].sort((left, right) => left.answeredAt.localeCompare(right.answeredAt));
            });
          }).catch(() => undefined);
          if (restoredPlayer.activeQuestion) {
            setView({ screen: "waiting", player: restoredPlayer, question: restoredPlayer.activeQuestion });
            return;
          }
          const reservation = await gameApi.getCurrentReservation();
          if (!isCurrent) return;
          if (reservation) {
            answerPollingBlocked.current = false;
            setView({ screen: "answering", player: restoredPlayer, assignment: reservation });
            return;
          }
          const delivery = await gameApi.retrievePendingDelivery();
          if (!isCurrent) return;
          if (!delivery) {
            const expiredQuestion = await gameApi.getLatestExpiredQuestion();
            if (!isCurrent) return;
            if (expiredQuestion) {
              setView({ screen: "expired", player: restoredPlayer });
              return;
            }
            const unavailableDelivery = await gameApi.getLatestUnavailableDelivery();
            if (!isCurrent) return;
            if (unavailableDelivery) {
              setView({ screen: "unavailable", player: restoredPlayer });
              return;
            }
            const localDelivery = await history.latestDeliveredAnswer();
            if (localDelivery?.answerId && localDelivery.answerText && isCurrent) {
              const restoredDelivery = {
                answerId: localDelivery.answerId, questionId: localDelivery.questionId,
                questionText: localDelivery.questionText, answerText: localDelivery.answerText,
                answeredAt: localDelivery.createdAt
              };
              rememberDelivery(restoredDelivery);
              setView({ screen: "delivered", player: { ...restoredPlayer, activeQuestion: null }, delivery: restoredDelivery });
            } else if (isCurrent) {
              setView({ screen: "home", player: restoredPlayer });
            }
            return;
          }
          await saveAndAcknowledgeDelivery(restoredPlayer, delivery, isCurrent);
        } else {
          void enter(undefined, true);
        }
      })
      .catch((restoreError: unknown) => {
        if (!isCurrent) return;
        setView({ screen: "home", player: { creditBalance: 1, activeQuestion: null } });
      });

    return () => {
      isCurrent = false;
    };
  }, [view.screen]);

  async function enter(captchaToken?: string, returnToConsentOnFailure = false) {
    try {
      const player = await gameSession.enter(captchaToken);
      setView({ screen: "home", player });
    } catch (entryError: unknown) {
      if (returnToConsentOnFailure) {
        localStorage.removeItem("pretend-ai.consent-v1");
        setHasConsent(false);
        setEntryError(messageFor(entryError));
      }
      setView({ screen: "home", player: { creditBalance: 1, activeQuestion: null } });
    }
  }

  useEffect(() => {
    const hasWaitingQuestion = view.screen === "waiting" || (view.screen === "home" && Boolean(view.player.activeQuestion));
    if (!hasWaitingQuestion && view.screen !== "answering") return;
    let current = true;
    const poll = async () => {
      try {
        if (view.screen === "waiting" || (view.screen === "home" && view.player.activeQuestion)) {
          const delivery = await gameApi.retrievePendingDelivery();
          if (!current) return;
          if (delivery) { await saveAndAcknowledgeDelivery(view.player, delivery, current); return; }
          if (await gameApi.getLatestExpiredQuestion()) { if (current) setView({ screen: "expired", player: view.player }); return; }
          if (await gameApi.getLatestUnavailableDelivery()) { if (current) setView({ screen: "unavailable", player: view.player }); return; }
        } else {
          const reservation = await gameApi.getCurrentReservation();
          if (current && !answerPollingBlocked.current && !reservation) setView({ screen: "home", player: view.player });
        }
        if (current) setConnectionNotice(null);
      } catch { if (current) setConnectionNotice("Connection lost. We’ll retry automatically; your server state is safe."); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15000);
    return () => { current = false; window.clearInterval(timer); };
  }, [view, realtimeRefresh]);

  useEffect(() => {
    const activeQuestion = view.screen === "waiting"
      ? view.question
      : view.screen === "home"
        ? view.player.activeQuestion
        : null;
    if (!activeQuestion) return;

    let current = true;
    let supabase: ReturnType<typeof getSupabaseClient> | null = null;
    let channel: RealtimeChannel | null = null;

    try {
      const client = getSupabaseClient();
      supabase = client;
      void client.auth.getUser().then(({ data, error }) => {
        if (!current || error || !data.user) return;
        channel = client
          .channel(`question-state:${activeQuestion.id}`)
          .on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "question_jobs",
            filter: `asker_id=eq.${data.user.id}`
          }, () => {
            if (current) {
              setRealtimeRefresh((value) => value + 1);
            }
          })
          .subscribe((status) => {
            if (!current) return;
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setConnectionNotice("Live updates disconnected. We’ll keep checking automatically.");
            }
          });
      });
    } catch {
      // Polling remains the correctness path when Realtime is unavailable.
    }

    return () => {
      current = false;
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [view]);

  async function findQuestion(player: Player, showLoading = true) {
    if (showLoading) setView({ screen: "finding-question", player });
    try {
      const assignment = await gameApi.getAndReserveQuestion();
      if (assignment) answerPollingBlocked.current = false;
      setView(assignment
        ? { screen: "answering", player, assignment }
        : { screen: "empty-queue", player, error: null });
    } catch (assignmentError: unknown) {
      setView({ screen: "empty-queue", player, error: messageFor(assignmentError) });
    }
  }

  async function submitQuestion(player: Player, text: string) {
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
  }

  async function saveAndAcknowledgeDelivery(player: Player, delivery: PendingDelivery, isCurrent = true) {
    try {
      await history.saveDeliveredAnswer({ questionId: delivery.questionId, role: "asker", questionText: delivery.questionText, answerId: delivery.answerId, answerText: delivery.answerText, createdAt: delivery.answeredAt });
      await gameApi.acknowledgeDelivery(delivery.answerId);
      if (isCurrent) {
        rememberDelivery(delivery);
        setView({ screen: "delivered", player: { ...player, activeQuestion: null }, delivery });
      }
    } catch (error: unknown) {
      if (isCurrent) setView({ screen: "delivery-retry", player, delivery, error: messageFor(error) });
    }
  }

  function rememberDelivery(delivery: PendingDelivery) {
    setLastDelivery(delivery);
    setDeliveredHistory((current) => current.some((item) => item.answerId === delivery.answerId)
      ? current
      : [...current, delivery]);
  }

  if (view.screen === "home" || view.screen === "waiting" || view.screen === "delivered") {
    const pendingQuestion = view.screen === "delivered" ? null : view.screen === "waiting" ? view.question : view.player.activeQuestion;
    const currentDelivery = view.screen === "delivered" ? view.delivery : view.screen === "home" ? lastDelivery : null;
    const deliveredAnswers = currentDelivery && !deliveredHistory.some((delivery) => delivery.answerId === currentDelivery.answerId)
      ? [...deliveredHistory, currentDelivery]
      : deliveredHistory;
    return <>
      <Home
        player={view.player}
        locked={!hasConsent || !hasReadInstructions}
        onSubmit={(text) => submitQuestion(view.player, text)}
        pendingQuestion={pendingQuestion}
        deliveredAnswers={deliveredAnswers}
        connectionNotice={view.screen === "waiting" ? connectionNotice : null}
        onActivity={() => setView({ screen: "activity", player: view.player })}
        onModerate={() => setView({ screen: "moderation", player: view.player })}
        onRules={() => setView({ screen: "rules", player: view.player })}
        onAnswer={() => setView({ screen: "ai-ready", player: view.player })}
      />
      {!hasConsent ? <ConsentGate error={entryError} onRules={() => setView({ screen: "rules", player: view.player })} onAccept={(captchaToken) => {
        localStorage.setItem("pretend-ai.consent-v1", "true");
        setHasConsent(true);
        setEntryError(null);
        void enter(captchaToken, true);
      }} /> : !hasReadInstructions ? <InstructionsModal onDone={() => {
        localStorage.setItem("pretend-ai.instructions-v1", "true"); setHasReadInstructions(true);
      }} /> : null}
    </>;
  }

  if (view.screen === "answering") {
    return <AnswerQuestion player={view.player} assignment={view.assignment} connectionNotice={connectionNotice} onReport={async (reason) => {
      await gameApi.reportAssignedQuestion(reason);
      setView({ screen: "home", player: view.player });
    }} onSkip={async () => {
      await gameApi.skipQuestion();
      setView({ screen: "empty-queue", player: view.player, error: null });
    }} onSubmissionStart={() => { answerPollingBlocked.current = true; }} onSubmissionFailure={() => { answerPollingBlocked.current = false; }} onNext={(player) => void findQuestion(player)} onLeave={(player) => setView({ screen: "home", player })} />;
  }

  if (view.screen === "ai-ready") {
    return <MachineReady player={view.player} onStart={() => void findQuestion(view.player)} onHuman={() => setView({ screen: "home", player: view.player })} onActivity={() => setView({ screen: "activity", player: view.player })} />;
  }

  if (view.screen === "empty-queue") {
    return <EmptyQueue
      player={view.player}
      error={view.error}
      onCheckAgain={() => void findQuestion(view.player, false)}
      onHuman={() => setView({ screen: "home", player: view.player })}
      onLeaveQueue={() => setView({ screen: "ai-ready", player: view.player })}
      onActivity={() => setView({ screen: "activity", player: view.player })}
    />;
  }

  if (view.screen === "delivery-retry") {
    return <DeliveryRetry player={view.player} error={view.error} onRetry={() => void saveAndAcknowledgeDelivery(view.player, view.delivery)} />;
  }

  if (view.screen === "expired") {
    return <ExpiredQuestion player={view.player} onContinue={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "unavailable") {
    return <UnavailableDelivery player={view.player} onContinue={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "activity") {
    return <Activity player={view.player} onBack={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "moderation") {
    return <ModerationConsole player={view.player} onBack={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "rules") return <Rules player={view.player} onBack={() => setView({ screen: "home", player: view.player })} />;

  if (view.screen === "finding-question") {
    return <LoadingCard message="Finding a question that needs a human answer…" />;
  }

  return <LoadingCard message="Loading Pretend AI…" />;
}

function Home({ player, locked, pendingQuestion, deliveredAnswers, connectionNotice, onSubmit, onAnswer, onActivity, onModerate, onRules }: { player: Player; locked: boolean; pendingQuestion: WaitingQuestion | null; deliveredAnswers: PendingDelivery[]; connectionNotice: string | null; onSubmit: (text: string) => Promise<void>; onAnswer: () => void; onActivity: () => void; onModerate: () => void; onRules: () => void }) {
  const [isModerator, setIsModerator] = useState(false);
  const [question, setQuestion] = useState("");
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => { void gameSession.isModerator().then(setIsModerator).catch(() => setIsModerator(false)); }, []);
  useEffect(() => {
    if (pendingQuestion || deliveredAnswers.length > 0) {
      setQuestion("");
      setQuestionError(null);
      setIsSubmitting(false);
    }
  }, [pendingQuestion, deliveredAnswers.length]);
  function focusQuestion() { document.getElementById("home-question")?.focus(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || isSubmitting) return;
    setQuestionError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(text);
    } catch (error: unknown) {
      setQuestionError(messageFor(error));
      setIsSubmitting(false);
    }
  }
  return (
    <main className="app-page" inert={locked} aria-hidden={locked || undefined}>
      <nav className="site-nav" aria-label="Site links">
        <span className="nav-brand">pretend.ai</span>
        <button type="button" onClick={onRules}>conduct</button>
        <button type="button" onClick={onActivity}>activity</button>
        <button type="button" onClick={onRules}>terms</button>
        <button type="button" onClick={onRules}>privacy</button>
        {isModerator && <button type="button" onClick={onModerate}>moderate</button>}
      </nav>
      <section className="game-shell" aria-labelledby="home-title">
        <h1 className="sr-only" id="home-title">What would you like to do?</h1>
        <div className="mode-tabs" role="group" aria-label="Choose a role">
          <button className="mode-tab active" aria-label="Ask a Question" type="button" onClick={focusQuestion}>ask a human</button>
          <button className="mode-tab" aria-label="Pretend to Be AI" type="button" onClick={onAnswer}>play as ai</button>
        </div>
        <div className="community-banner"><strong>humans only</strong><span>be kind. no personal info, links, or meetups.</span></div>
        {deliveredAnswers.length > 0 || pendingQuestion ? <div className="game-stage chat-stage">
          <div className="chat-heading"><div className="mini-scribble" aria-hidden="true" /><h2>pretend ai</h2><button className="help-button" type="button" onClick={onRules} aria-label="How Pretend AI works">?</button></div>
          <div className="chat-feed" aria-live="polite">
            {deliveredAnswers.map((delivery) => <Fragment key={delivery.answerId}>
              <article className="user-message"><small>you asked</small><p>{delivery.questionText}</p></article>
              <DeliveredChat delivery={delivery} />
            </Fragment>)}
            {pendingQuestion && <><article className="user-message"><small>you asked</small><p>{pendingQuestion.text}</p></article>
              <div className="waiting-message" role="status"><span className="waiting-spinner" aria-hidden="true">◔</span><span>waiting for a human…</span></div></>}
            {connectionNotice && <p className="form-error connection-message">{connectionNotice}</p>}
          </div>
        </div> : <div className="game-stage">
          <div className="scribble-mark" aria-hidden="true"><i /><i /><i /><i /></div>
          <p className="stage-kicker">human answers, suspiciously formatted</p>
          <h2>pretend ai</h2>
          <button className="help-button" type="button" onClick={onRules} aria-label="How Pretend AI works">?</button>
          <p className="stage-copy">Ask a stranger. Or earn credits by becoming the “AI”.</p>
        </div>}
        <div className="composer-panel">
          <div className="composer-tabs"><button className="selected" type="button" onClick={focusQuestion}>write something</button><button type="button" onClick={onAnswer}>answer something</button></div>
          <span className="credit-chip" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}><span aria-hidden="true">◉ {player.creditBalance}c</span><span className="sr-only">{pluralisedCredits(player.creditBalance)}</span></span>
          <form className="prompt-bar" onSubmit={submit}>
            <label className="sr-only" htmlFor="home-question">Your question</label>
            <input id="home-question" value={question} maxLength={500} placeholder={pendingQuestion ? "answer someone to earn another credit…" : "ask anything a human can answer…"} onChange={(event) => setQuestion(event.target.value)} />
            <button className="send-glyph" type="submit" aria-label="Send question" disabled={isSubmitting || !question.trim() || Boolean(pendingQuestion)}>{isSubmitting ? "…" : "↗"}</button>
          </form>
          <div className="composer-meta"><span>{question.length}/500</span><span>{pendingQuestion ? "one question is already pending" : "sending uses one credit"}</span></div>
          {questionError && <p className="form-error composer-error" role="alert">{questionError}</p>}
        </div>
      </section>
      <p className="online-note">anonymous guests · answers are written by people</p>
    </main>
  );
}

function ConsentGate({ error, onAccept, onRules }: { error: string | null; onAccept: (captchaToken?: string) => void; onRules: () => void }) {
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const requiresCaptcha = Boolean(turnstileSiteKey && turnstileSiteKey !== "your-turnstile-site-key");
  const markCaptchaUnavailable = useCallback(() => setCaptchaUnavailable(true), []);
  return <div className="modal-backdrop"><section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
    <div className="modal-icon" aria-hidden="true">✦</div><h2 id="entry-title">before you enter</h2><p>you must be at least 13 years old to continue.</p>
    <label className="consent-row"><input type="checkbox" checked={ageAccepted} onChange={(event) => setAgeAccepted(event.target.checked)} /><span>i am over 13 and agree to follow the <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRules(); }}>code of conduct</button></span></label>
    <label className="consent-row"><input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span>i agree to the <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRules(); }}>terms and privacy policy</button></span></label>
    {requiresCaptcha && <TurnstileChallenge siteKey={turnstileSiteKey!} onToken={setCaptchaToken} onUnavailable={markCaptchaUnavailable} />}
    {captchaUnavailable && <p className="form-error" role="alert">The anti-abuse check could not load. Please disable blockers and try again.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="modal-primary" type="button" disabled={!ageAccepted || !policyAccepted || (requiresCaptcha && !captchaToken)} onClick={() => onAccept(captchaToken ?? undefined)}>enter anonymously</button>
    <small>no email, username, password, or profile required.</small>
  </section></div>;
}

function TurnstileChallenge({ siteKey, onToken, onUnavailable }: { siteKey: string; onToken: (token: string | null) => void; onUnavailable: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const render = () => {
      if (disposed || !container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": onUnavailable
      });
    };
    const existing = document.getElementById("turnstile-api");
    if (existing) {
      if (window.turnstile) render();
      else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.id = "turnstile-api";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", onUnavailable, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      disposed = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [onToken, onUnavailable, siteKey]);

  return <div className="turnstile-challenge" ref={container} aria-label="Anti-abuse check" />;
}

function InstructionsModal({ onDone }: { onDone: () => void }) {
  return <div className="modal-backdrop"><section className="instruction-modal" role="dialog" aria-modal="true" aria-labelledby="instruction-title">
    <p className="eyebrow">how it works</p><h2 id="instruction-title">people pretending to be ai</h2>
    <p>One stranger writes every answer. Treat it as entertainment, never expert advice.</p>
    <ul><li>asking a question costs one credit.</li><li>answer someone else to earn one credit.</li><li>skip anything you do not want to answer.</li><li>never share personal information or arrange meetups.</li><li>report harmful questions or answers.</li></ul>
    <button className="modal-primary" type="button" onClick={onDone}>got it</button><small>you can reread the rules from the top navigation.</small>
  </section></div>;
}

function Rules({ player, onBack }: { player: Player; onBack: () => void }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="rules-title"><p className="eyebrow">Rules & privacy</p><h1 id="rules-title">Human-powered, for entertainment.</h1><p className="lede">Every answer is written by a real person, not AI. Do not rely on Pretend AI for medical, legal, financial, safety, or other important decisions.</p><h2>Who can play</h2><p>Public beta is for people aged 13 or older in Malaysia.</p><h2>Keep it safe</h2><p>Do not share personal or contact details, harassment, threats, doxxing, self-harm encouragement, sexual content involving minors, illegal content, or plans to meet offline. Report an assigned question or saved answer when it breaks these rules.</p><h2>What is retained</h2><p>Activity stays only in this browser until you delete it. Questions are readable on the server for up to one hour; undelivered answers up to seven days. Delivered content is removed after your browser saves it. Report evidence is retained for 30 days, then purged. Operational metadata and provider backups may remain longer.</p><button className="secondary-action" type="button" onClick={onBack}>Back home</button><span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span></section></main>;
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

function MachineFrame({ player, onHuman, children }: { player: Player; onHuman: () => void; children: ReactNode }) {
  return <main className="app-page">
    <nav className="site-nav" aria-label="Site links"><span className="nav-brand">pretend.ai</span><button type="button" onClick={onHuman}>conduct</button><button type="button" onClick={onHuman}>activity</button><button type="button" onClick={onHuman}>terms</button><button type="button" onClick={onHuman}>privacy</button></nav>
    <section className="game-shell machine-shell">
      <div className="mode-tabs" role="group" aria-label="Choose a role"><button className="mode-tab" type="button" onClick={onHuman}>ask a human</button><button className="mode-tab machine-active" type="button">play as ai</button></div>
      <div className="community-banner"><strong>humans only</strong><span>be kind. no personal info, links, or meetups.</span></div>
      <span className="machine-credit" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}>{player.creditBalance}c</span>
      <div className="machine-content">{children}</div>
    </section>
    <p className="online-note">anonymous guests · answers are written by people</p>
  </main>;
}

function MachineReady({ player, onStart, onHuman, onActivity }: { player: Player; onStart: () => void; onHuman: () => void; onActivity: () => void }) {
  return <MachineFrame player={player} onHuman={onHuman}><section className="queue-workspace" aria-labelledby="machine-ready-title">
    <div className="queue-card ready-card"><h1 id="machine-ready-title">become the machine</h1><p>You have two minutes to answer a stranger before the reservation expires.</p><small>+1 credit per answer</small></div>
    <button className="machine-action accent" type="button" onClick={onStart}>start playing</button>
    <button className="machine-action" type="button" onClick={onHuman}>back to human mode</button>
    <button className="machine-action" type="button" onClick={onActivity}>view activity</button>
  </section></MachineFrame>;
}

function AnswerQuestion({ player, assignment, onSkip, onReport, onSubmissionStart, onSubmissionFailure, onNext, onLeave, connectionNotice }: { player: Player; assignment: AssignedQuestion; onSkip: () => Promise<void>; onReport: (reason: string) => Promise<void>; onSubmissionStart: () => void; onSubmissionFailure: () => void; onNext: (player: Player) => void; onLeave: (player: Player) => void; connectionNotice: string | null }) {
  const [answer, setAnswer] = useState("");
  const [balance, setBalance] = useState(player.creditBalance);
  const [message, setMessage] = useState<string | null>(null);
  const [submittedBalance, setSubmittedBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    onSubmissionStart();
    try {
      const accepted = await gameApi.submitAnswer(answer.trim());
      setBalance(accepted.creditBalance);
      setSubmittedBalance(accepted.creditBalance);
      try {
        await history.saveSubmittedAnswer({
          questionId: assignment.id, role: "answerer", questionText: assignment.text,
          answerId: accepted.id, answerText: answer.trim(), createdAt: accepted.acceptedAt
        });
        setMessage(null);
      } catch {
        setMessage("Credit earned, but this answer could not be saved to this browser.");
      }
    } catch (submitError: unknown) {
      setMessage(messageFor(submitError));
      onSubmissionFailure();
    } finally {
      setSubmitting(false);
    }
  }

  const currentPlayer = { ...player, creditBalance: submittedBalance ?? balance };
  if (submittedBalance !== null) return <MachineFrame player={currentPlayer} onHuman={() => onLeave(currentPlayer)}><section className="machine-success" aria-labelledby="answer-success-title">
    <h1 className="sr-only" id="answer-success-title">Answer submitted successfully</h1>
    <p className="success-banner" role="status">great success (+1 credit. you now have {submittedBalance})</p>
    {message && <p className="form-error">{message}</p>}
    <button className="machine-action accent" type="button" onClick={() => onNext(currentPlayer)}>another one</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>no thanks</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>back to human mode</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>view activity</button>
  </section></MachineFrame>;

  return <MachineFrame player={currentPlayer} onHuman={() => onLeave(currentPlayer)}><section className="answer-workspace" aria-labelledby="answer-title">
    <h1 className="sr-only" id="answer-title">Answer this question</h1>
    {connectionNotice && <p className="form-error" role="status">{connectionNotice}</p>}
    <ReservationTimer expiresAt={assignment.reservationExpiresAt} serverNow={assignment.serverNow} />
    <article className="assignment-card"><div><strong>FROM A HUMAN (+1C)</strong><small>asked for text</small></div><p>“{assignment.text}”</p></article>
    <p className="skip-tip"><strong>skip prompts you can’t answer!</strong><span>Skip quickly to receive another available prompt.</span></p>
    <div className="answer-tabs"><strong>write</strong><span>draw</span></div>
    <form onSubmit={submit}><label className="sr-only" htmlFor="answer">Your answer</label>
      <textarea id="answer" placeholder="type your answer here…" value={answer} maxLength={750} required onChange={(event) => setAnswer(event.target.value)} />
      <p className="fine-print">{answer.length}/750 characters</p>
      {message && <p className="form-error" role="status">{message}</p>}
      <div className="answer-actions"><button className="primary-action answer-submit" type="submit" disabled={submitting || !answer.trim()}>{submitting ? "Submitting…" : "Submit"}</button>
      <button className="secondary-action" type="button" disabled={skipping || submitting} onClick={async () => { setSkipping(true); try { await onSkip(); } catch (error: unknown) { setMessage(messageFor(error)); setSkipping(false); } }}>Skip</button>
      <details className="report-menu"><summary>Report</summary><label className="question-label" htmlFor="question-report-reason">Reason</label><textarea id="question-report-reason" value={reportReason} maxLength={500} onChange={(event) => setReportReason(event.target.value)} /><button className="secondary-action" type="button" disabled={reporting || !reportReason.trim()} onClick={async () => { setReporting(true); try { await onReport(reportReason.trim()); } catch (error: unknown) { setMessage(messageFor(error)); setReporting(false); } }}> {reporting ? "Reporting…" : "Report and release"}</button></details></div>
    </form>
  </section></MachineFrame>;
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

  const percent = Math.min(100, (remaining / 120000) * 100);
  return <div className="reservation-timer" role="timer" aria-live="off"><div><span>time left</span><strong>{seconds}s</strong></div><div className="timer-track"><i style={{ width: `${percent}%` }} /></div><span className="sr-only">Time remaining: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></div>;
}

function EmptyQueue({
  player,
  error,
  onCheckAgain,
  onHuman,
  onLeaveQueue,
  onActivity
}: {
  player: Player;
  error: string | null;
  onCheckAgain: () => void;
  onHuman: () => void;
  onLeaveQueue: () => void;
  onActivity: () => void;
}) {
  useEffect(() => {
    const timer = window.setInterval(onCheckAgain, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <MachineFrame player={player} onHuman={onHuman}><section className="queue-workspace" aria-labelledby="empty-title">
    <div className="queue-card"><h1 id="empty-title">become the machine</h1><p>Answer a stranger before the reservation expires.</p><small>+1 credit per answer</small><strong><span aria-hidden="true">◔</span> waiting for a prompt…</strong></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="machine-action" type="button" onClick={onCheckAgain}>check now</button><button className="machine-action" type="button" onClick={onLeaveQueue}>leave queue</button><button className="machine-action" type="button" onClick={onActivity}>view activity</button>
  </section></MachineFrame>;
}

function DeliveredChat({ delivery }: { delivery: PendingDelivery }) {
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  return <article className="assistant-message" aria-labelledby="delivery-title">
    <h2 className="sr-only" id="delivery-title">A human answered your question</h2>
    <small>a human responded</small><p>{delivery.answerText}</p>
    <div className="message-actions"><button type="button" aria-label="Like" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "like"); setRating("like"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👍</button><button type="button" aria-label="Dislike" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "dislike"); setRating("dislike"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👎</button><details className="chat-report"><summary>report</summary><label className="sr-only" htmlFor="answer-report-reason">Reason</label><textarea id="answer-report-reason" placeholder="Why are you reporting this answer?" value={reportReason} maxLength={500} onChange={(event) => setReportReason(event.target.value)} /><button type="button" disabled={!reportReason.trim()} onClick={async () => { try { await gameApi.reportAnswer(delivery.answerId, reportReason.trim(), delivery.answerText); setReportMessage("Report received."); } catch (error: unknown) { setReportMessage(messageFor(error)); } }}>send report</button></details></div>
    {rating && <p className="chat-feedback" role="status">Thanks for your feedback.</p>}{ratingError && <p className="form-error" role="alert">{ratingError}</p>}{reportMessage && <p className="chat-feedback" role="status">{reportMessage}</p>}
  </article>;
}

function ModerationConsole({ player, onBack }: { player: Player; onBack: () => void }) {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  useEffect(() => { void gameApi.getOpenReports().then(setReports).catch((loadError: unknown) => setError(messageFor(loadError))); }, []);
  async function resolve(report: ModerationReport, action: "dismiss" | "remove_content" | "restrict_identity" | "remove_and_restrict", refund = false) {
    setWorking(report.id); setError(null);
    try { await gameApi.resolveReport(report.id, action, refund); setReports((current) => current.filter((item) => item.id !== report.id)); }
    catch (resolveError: unknown) { setError(messageFor(resolveError)); }
    finally { setWorking(null); }
  }
  return <main className="home-shell"><section className="home-card" aria-labelledby="moderation-title"><p className="eyebrow">Protected moderation</p><h1 id="moderation-title">Open reports</h1><p className="notice">Moderation evidence is limited to the reported content and reason.</p>{error && <p className="form-error" role="alert">{error}</p>}{reports.length === 0 ? <p className="lede">No open reports.</p> : <ul className="activity-list">{reports.map((report) => <li key={report.id}><strong>{report.contentType} report</strong><p>Reason: {report.reason}</p><p>Evidence: {report.evidenceSnapshot}</p><div className="form-actions"><button className="secondary-action" disabled={working === report.id} onClick={() => void resolve(report, "dismiss")}>Dismiss</button><button className="secondary-action" disabled={working === report.id} onClick={() => void resolve(report, "remove_content", true)}>Remove & refund</button><button className="primary-action" disabled={working === report.id} onClick={() => void resolve(report, "remove_and_restrict", true)}>Remove & restrict</button></div></li>)}</ul>}<button className="secondary-action" type="button" onClick={onBack}>Back home</button><span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span></section></main>;
}

function DeliveryRetry({ player, error, onRetry }: { player: Player; error: string; onRetry: () => void }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="delivery-retry-title">
    <p className="eyebrow">Answer ready</p><h1 id="delivery-retry-title">Save this answer before we remove it from the server.</h1>
    <p className="form-error" role="alert">{error}</p>
    <button className="primary-action" type="button" onClick={onRetry}>Retry saving answer</button>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function ExpiredQuestion({ player, onContinue }: { player: Player; onContinue: () => void }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="expired-title">
    <p className="eyebrow">Question expired</p>
    <h1 id="expired-title">Your unanswered question expired.</h1>
    <p className="lede">Your credit has been refunded and the temporary question content was removed.</p>
    <button className="primary-action" type="button" onClick={onContinue}>Continue</button>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function UnavailableDelivery({ player, onContinue }: { player: Player; onContinue: () => void }) {
  return <main className="home-shell"><section className="home-card" aria-labelledby="unavailable-title">
    <p className="eyebrow">Answer unavailable</p><h1 id="unavailable-title">This answer is no longer available.</h1>
    <p className="lede">It was not saved to this browser before the temporary server copy expired.</p>
    <button className="primary-action" type="button" onClick={onContinue}>Continue</button>
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function LoadingCard({ message }: { message: string }) {
  return <main className="gate-shell" aria-busy="true">
    <section className="gate-card loading-card" aria-label={message}>
      <Lottie className="loading-orb" animationData={aiOrbLoader} loop aria-hidden="true" />
      <p className="status-message" role="status">{message}</p>
    </section>
  </main>;
}


function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
