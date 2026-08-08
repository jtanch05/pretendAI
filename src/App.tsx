import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Lottie from "lottie-react";
import { gameSession, type Player } from "./services/gameSession";
import { gameApi, type AssignedQuestion, type ModerationReport, type PendingDelivery, type QuestionKind, type WaitingQuestion } from "./services/gameApi";
import { history, type WaitingHistoryEntry } from "./services/history";
import { getSupabaseClient } from "./services/supabase";
import { DrawingCanvas, DrawingPreview } from "./components/DrawingCanvas";
import { emptyDrawing, type DrawingData } from "./types/drawing";
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
  | { screen: "info"; page: InfoPage; player: Player };

type InfoPage = "conduct" | "terms" | "privacy";

function pluralisedCredits(balance: number): string {
  return `${balance} credit${balance === 1 ? "" : "s"}`;
}

type PresenceMode = "human" | "ai";

function OnlinePresence({ mode }: { mode: PresenceMode }) {
  const [counts, setCounts] = useState({ human: 0, ai: 0 });

  useEffect(() => {
    let isCurrent = true;
    let supabase: ReturnType<typeof getSupabaseClient> | null = null;
    let channel: RealtimeChannel | null = null;
    let presenceKey: string | null = null;
    let connectedUserId: string | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    function refreshCounts() {
      if (!channel || !isCurrent) return;
      const presenceState = channel.presenceState() as Record<string, Array<{ mode?: unknown }>>;
      const hasOwnPresence = Boolean(presenceKey && Object.prototype.hasOwnProperty.call(presenceState, presenceKey));
      const nextCounts = Object.values(presenceState).reduce((total, presences) => {
        if (presences.some((presence) => presence.mode === "ai")) total.ai += 1;
        else total.human += 1;
        return total;
      }, { human: 0, ai: 0 });
      // Realtime confirms our tracked presence asynchronously. Count this browser
      // immediately so the first render does not briefly report zero online.
      if (presenceKey && !hasOwnPresence) nextCounts[mode] += 1;
      setCounts(nextCounts);
    }

    function connectPresence(userId: string) {
      if (!supabase || !isCurrent || connectedUserId === userId) return;
      if (channel) void supabase.removeChannel(channel);
      connectedUserId = userId;
      presenceKey = userId;
      const nextChannel = supabase
        .channel("are-u-human:online", { config: { presence: { key: userId } } })
        .on("presence", { event: "sync" }, refreshCounts)
        .on("presence", { event: "join" }, refreshCounts)
        .on("presence", { event: "leave" }, refreshCounts)
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED" && nextChannel === channel && isCurrent) {
            await nextChannel.track({ mode });
            refreshCounts();
          }
        });
      channel = nextChannel;
    }

    try {
      supabase = getSupabaseClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!isCurrent) return;
        if (session?.user) {
          connectPresence(session.user.id);
        } else if (connectedUserId) {
          connectedUserId = null;
          presenceKey = null;
          if (channel && supabase) void supabase.removeChannel(channel);
          channel = null;
          setCounts({ human: 0, ai: 0 });
        }
      });
      unsubscribeAuth = () => subscription.unsubscribe();
      void supabase.auth.getUser().then(({ data, error }) => {
        if (!isCurrent || error || !data.user) return;
        connectPresence(data.user.id);
      });
    } catch {
      // The rest of the app remains usable when Realtime presence is unavailable.
    }

    return () => {
      isCurrent = false;
      unsubscribeAuth?.();
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [mode]);

  const online = counts.human + counts.ai;
  return <p className="online-note" aria-live="polite"><span>{online} online ({counts.human} human · {counts.ai} ai)</span><br /><span>humans make mistakes because that's what makes us human</span></p>;
}

export default function App() {
  const [hasConsent, setHasConsent] = useState(() => localStorage.getItem("pretend-ai.consent-v1") === "true");
  const [hasReadInstructions, setHasReadInstructions] = useState(() => localStorage.getItem("pretend-ai.instructions-v1") === "true");
  const [showInstructions, setShowInstructions] = useState(false);
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
              .filter((entry) => entry.role === "asker" && entry.status === "delivered" && entry.answerId && (entry.answerText || entry.drawing))
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              .map((entry) => ({
                answerId: entry.answerId!, questionId: entry.questionId, questionText: entry.questionText,
                questionKind: entry.questionKind ?? "text", answerKind: entry.answerKind ?? (entry.drawing ? "drawing" : "text"),
                answerText: entry.answerText ?? null, drawing: entry.drawing ?? null, answeredAt: entry.createdAt
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
            if (localDelivery?.answerId && (localDelivery.answerText || localDelivery.drawing) && isCurrent) {
              const restoredDelivery = {
                answerId: localDelivery.answerId, questionId: localDelivery.questionId,
                questionText: localDelivery.questionText, questionKind: localDelivery.questionKind ?? "text",
                answerKind: localDelivery.answerKind ?? (localDelivery.drawing ? "drawing" : "text"),
                answerText: localDelivery.answerText ?? null, drawing: localDelivery.drawing ?? null,
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
      const existingReservation = await gameApi.getCurrentReservation();
      if (existingReservation) {
        answerPollingBlocked.current = false;
        setView({ screen: "answering", player, assignment: existingReservation });
        return;
      }

      const assignment = await gameApi.getAndReserveQuestion();
      if (assignment) answerPollingBlocked.current = false;
      setView(assignment
        ? { screen: "answering", player, assignment }
        : { screen: "empty-queue", player, error: null });
    } catch (assignmentError: unknown) {
      setView({ screen: "empty-queue", player, error: messageFor(assignmentError) });
    }
  }

  async function openAiMode(player: Player) {
    setView({ screen: "finding-question", player });
    try {
      const existingReservation = await gameApi.getCurrentReservation();
      if (existingReservation) {
        answerPollingBlocked.current = false;
        setView({ screen: "answering", player, assignment: existingReservation });
        return;
      }
    } catch {
      // The start screen remains usable if the reservation lookup is temporarily unavailable.
    }
    setView({ screen: "ai-ready", player });
  }

  async function submitQuestion(player: Player, text: string, kind: QuestionKind) {
    const question = await gameApi.createQuestion(text, kind);
    await history.saveWaitingQuestion({
      questionId: question.id,
      role: "asker",
      questionText: question.text,
      questionKind: question.kind ?? kind,
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
      await history.saveDeliveredAnswer({
        questionId: delivery.questionId, role: "asker", questionText: delivery.questionText,
        questionKind: delivery.questionKind ?? "text", answerId: delivery.answerId,
        answerKind: delivery.answerKind ?? (delivery.drawing ? "drawing" : "text"),
        answerText: delivery.answerText ?? undefined, drawing: delivery.drawing ?? undefined, createdAt: delivery.answeredAt
      });
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
        locked={!hasConsent || !hasReadInstructions || showInstructions}
        onSubmit={(text, kind) => submitQuestion(view.player, text, kind)}
        pendingQuestion={pendingQuestion}
        deliveredAnswers={deliveredAnswers}
        connectionNotice={view.screen === "waiting" ? connectionNotice : null}
        onActivity={() => setView({ screen: "activity", player: view.player })}
        onModerate={() => setView({ screen: "moderation", player: view.player })}
        onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })}
        onTerms={() => setView({ screen: "info", page: "terms", player: view.player })}
        onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })}
        onHelp={() => setShowInstructions(true)}
        onAnswer={() => void openAiMode(view.player)}
      />
      {!hasConsent ? <ConsentGate error={entryError} onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })} onTerms={() => setView({ screen: "info", page: "terms", player: view.player })} onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })} onAccept={(captchaToken) => {
        localStorage.setItem("pretend-ai.consent-v1", "true");
        setHasConsent(true);
        setEntryError(null);
        void enter(captchaToken, true);
      }} /> : (!hasReadInstructions || showInstructions) ? <InstructionsModal onDone={() => {
        localStorage.setItem("pretend-ai.instructions-v1", "true"); setHasReadInstructions(true); setShowInstructions(false);
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
    }} onSubmissionStart={() => { answerPollingBlocked.current = true; }} onSubmissionFailure={() => { answerPollingBlocked.current = false; }} onNext={(player) => void findQuestion(player)} onLeave={(player) => setView({ screen: "home", player })} onActivity={(player) => setView({ screen: "activity", player })} onConduct={(player) => setView({ screen: "info", page: "conduct", player })} onTerms={(player) => setView({ screen: "info", page: "terms", player })} onPrivacy={(player) => setView({ screen: "info", page: "privacy", player })} />;
  }

  if (view.screen === "ai-ready") {
    return <MachineReady player={view.player} onStart={() => void findQuestion(view.player)} onHuman={() => setView({ screen: "home", player: view.player })} onActivity={() => setView({ screen: "activity", player: view.player })} onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })} onTerms={() => setView({ screen: "info", page: "terms", player: view.player })} onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })} />;
  }

  if (view.screen === "empty-queue") {
    return <EmptyQueue
      player={view.player}
      error={view.error}
      onCheckAgain={() => void findQuestion(view.player, false)}
      onHuman={() => setView({ screen: "home", player: view.player })}
      onLeaveQueue={() => setView({ screen: "ai-ready", player: view.player })}
      onActivity={() => setView({ screen: "activity", player: view.player })}
      onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })}
      onTerms={() => setView({ screen: "info", page: "terms", player: view.player })}
      onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })}
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
    return <Activity
      player={view.player}
      onBack={() => setView({ screen: "home", player: view.player })}
      onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })}
      onTerms={() => setView({ screen: "info", page: "terms", player: view.player })}
      onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })}
    />;
  }

  if (view.screen === "moderation") {
    return <ModerationConsole player={view.player} onBack={() => setView({ screen: "home", player: view.player })} />;
  }

  if (view.screen === "info") return <InformationPage
    player={view.player}
    page={view.page}
    onBack={() => setView({ screen: "home", player: view.player })}
    onActivity={() => setView({ screen: "activity", player: view.player })}
    onConduct={() => setView({ screen: "info", page: "conduct", player: view.player })}
    onTerms={() => setView({ screen: "info", page: "terms", player: view.player })}
    onPrivacy={() => setView({ screen: "info", page: "privacy", player: view.player })}
  />;

  if (view.screen === "finding-question") {
    return <LoadingCard message="Finding a question that needs a human answer…" />;
  }

  return <LoadingCard message="Loading Are u Human?…" />;
}

function Home({ player, locked, pendingQuestion, deliveredAnswers, connectionNotice, onSubmit, onAnswer, onActivity, onModerate, onConduct, onTerms, onPrivacy, onHelp }: { player: Player; locked: boolean; pendingQuestion: WaitingQuestion | null; deliveredAnswers: PendingDelivery[]; connectionNotice: string | null; onSubmit: (text: string, kind: QuestionKind) => Promise<void>; onAnswer: () => void; onActivity: () => void; onModerate: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void; onHelp: () => void }) {
  const [isModerator, setIsModerator] = useState(false);
  const [question, setQuestion] = useState("");
  const [questionKind, setQuestionKind] = useState<QuestionKind>("text");
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
      await onSubmit(text, questionKind);
    } catch (error: unknown) {
      setQuestionError(messageFor(error));
      setIsSubmitting(false);
    }
  }
  return (
    <main className="app-page" inert={locked} aria-hidden={locked || undefined}>
      <nav className="site-nav" aria-label="Site links">
        <span className="nav-brand">Are u Human?</span>
        <button type="button" onClick={onConduct}>conduct</button>
        <button type="button" onClick={onActivity}>activity</button>
        <button type="button" onClick={onTerms}>terms</button>
        <button type="button" onClick={onPrivacy}>privacy</button>
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
          <div className="chat-heading"><div className="mini-scribble" aria-hidden="true" /><h2>Are u Human?</h2><button className="help-button" type="button" onClick={onHelp} aria-label="How Are u Human? works">?</button></div>
          <div className="chat-feed" aria-live="polite">
            {deliveredAnswers.map((delivery) => <Fragment key={delivery.answerId}>
              <article className="user-message"><small>{delivery.questionKind === "drawing" ? "you asked for a drawing" : "you asked"}</small><p>{delivery.questionText}</p></article>
              <DeliveredChat delivery={delivery} />
            </Fragment>)}
            {pendingQuestion && <><article className="user-message"><small>{pendingQuestion.kind === "drawing" ? "you asked for a drawing" : "you asked"}</small><p>{pendingQuestion.text}</p></article>
              <div className="waiting-message" role="status"><Lottie className="chat-loading-orb" animationData={aiOrbLoader} loop aria-hidden="true" /><span>an AI is thinking…</span></div></>}
            {connectionNotice && <p className="form-error connection-message">{connectionNotice}</p>}
          </div>
        </div> : <div className="game-stage">
          <div className="scribble-mark" aria-hidden="true"><i /><i /><i /><i /></div>
          <h2>Are u Human?</h2>
          <button className="help-button" type="button" onClick={onHelp} aria-label="How Are u Human? works">?</button>
          <p className="stage-copy">The strongest LLM model, powered by humans.</p>
        </div>}
        <div className="composer-panel">
          <div className="composer-tabs" role="group" aria-label="Choose response type"><button className={questionKind === "text" ? "selected" : ""} type="button" onClick={() => { setQuestionKind("text"); focusQuestion(); }}>write something</button><button className={questionKind === "drawing" ? "selected" : ""} type="button" onClick={() => { setQuestionKind("drawing"); focusQuestion(); }}>draw something</button></div>
          <span className="credit-chip" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}><span aria-hidden="true">◉ {player.creditBalance}c</span><span className="sr-only">{pluralisedCredits(player.creditBalance)}</span></span>
          <form className="prompt-bar" onSubmit={submit}>
            <label className="sr-only" htmlFor="home-question">Your question</label>
            <input id="home-question" value={question} maxLength={500} placeholder={pendingQuestion ? "answer someone to earn another credit…" : questionKind === "drawing" ? "describe what you want someone to draw…" : "ask anything a human can answer…"} onChange={(event) => setQuestion(event.target.value)} />
            <button className="send-glyph" type="submit" aria-label="Send question" disabled={isSubmitting || !question.trim() || Boolean(pendingQuestion)}>{isSubmitting ? "…" : "↗"}</button>
          </form>
          <div className="composer-meta"><span>{question.length}/500</span><span>{pendingQuestion ? "one question is already pending" : "sending uses one credit"}</span></div>
          {questionError && <p className="form-error composer-error" role="alert">{questionError}</p>}
        </div>
      </section>
      <OnlinePresence mode="human" />
    </main>
  );
}

function ConsentGate({ error, onAccept, onConduct, onTerms, onPrivacy }: { error: string | null; onAccept: (captchaToken?: string) => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const requiresCaptcha = Boolean(turnstileSiteKey && turnstileSiteKey !== "your-turnstile-site-key");
  const markCaptchaUnavailable = useCallback(() => setCaptchaUnavailable(true), []);
  return <div className="modal-backdrop"><section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
    <div className="modal-icon" aria-hidden="true">✦</div><h2 id="entry-title">before you enter</h2><p>everyone is welcome to use Are u Human?</p>
    <label className="consent-row"><input type="checkbox" checked={ageAccepted} onChange={(event) => setAgeAccepted(event.target.checked)} /><span>i agree to follow the <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onConduct(); }}>code of conduct</button></span></label>
    <label className="consent-row"><input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span>i agree to the <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTerms(); }}>terms</button> and <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onPrivacy(); }}>privacy policy</button></span></label>
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
    <p className="eyebrow">how it works</p><h2 id="instruction-title">your ai slop bores me</h2>
    <p>In a world looming with the threat of AI stealing your job, save humanity by stealing AI's job.</p>
    <ul><li>each text or drawing prompt costs 1 credit.</li><li>to earn credits, switch to the AI tab and answer someone else's prompt with text or a drawing.</li><li>skip prompts you can't answer.</li><li>you can have one question waiting at a time.</li><li>be nice. No hate speech, personal information, links, or meetups.</li><li>report harmful questions or answers.</li></ul>
    <button className="modal-primary" type="button" onClick={onDone}>got it</button><small>you can reread the rules from the top navigation.</small>
  </section></div>;
}

function SiteNavigation({ onConduct, onActivity, onTerms, onPrivacy }: { onConduct: () => void; onActivity: () => void; onTerms: () => void; onPrivacy: () => void }) {
  return <nav className="site-nav" aria-label="Site links">
    <span className="nav-brand">Are u Human?</span>
    <button type="button" onClick={onConduct}>conduct</button>
    <button type="button" onClick={onActivity}>activity</button>
    <button type="button" onClick={onTerms}>terms</button>
    <button type="button" onClick={onPrivacy}>privacy</button>
  </nav>;
}

function InformationPage({ player, page, onBack, onActivity, onConduct, onTerms, onPrivacy }: { player: Player; page: InfoPage; onBack: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const content = page === "conduct"
    ? <><p className="eyebrow">Code of conduct</p><h1 id="info-title">Keep the humans safe.</h1><p className="lede">Ask for help, stories, opinions, or drawings — never personal data or real-world contact.</p><h2>Do not post</h2><p>Personal or contact details, links, meetups, harassment, threats, doxxing, self-harm encouragement, hate speech, sexual content involving minors, or illegal content.</p><h2>Use reports</h2><p>Report an assigned question or saved answer that breaks these rules. Repeated misuse may restrict access.</p></>
    : page === "terms"
      ? <><p className="eyebrow">Terms of use</p><h1 id="info-title">Entertainment, not expert advice.</h1><p className="lede">Every answer is written by a real person, not AI. Do not rely on Are u Human? for medical, legal, financial, safety, or other important decisions.</p><h2>Who can use it</h2><p>Are u Human? is open to everyone, anywhere. By using it, you agree to follow the code of conduct.</p><h2>Credits and availability</h2><p>Each question costs one credit and an accepted answer earns one credit. Matching is not guaranteed, and the service may change or be unavailable while in public beta.</p></>
      : <><p className="eyebrow">Privacy</p><h1 id="info-title">Anonymous by design.</h1><p className="lede">No email, username, password, or public profile is required to use Are u Human?</p><h2>What is retained</h2><p>Activity stays only in this browser until you delete it. Questions are readable on the server for up to one hour; undelivered answers up to seven days. Delivered content is removed after your browser saves it. Report evidence is retained for 30 days, then purged. Operational metadata and provider backups may remain longer.</p><h2>Your choices</h2><p>You can delete local activity at any time. Do not enter personal information in a question, answer, or drawing.</p></>;
  return <main className="home-shell"><SiteNavigation onConduct={onConduct} onActivity={onActivity} onTerms={onTerms} onPrivacy={onPrivacy} /><section className="home-card" aria-labelledby="info-title">{content}<button className="secondary-action" type="button" onClick={onBack}>Back home</button><span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span></section></main>;
}

function Activity({ player, onBack, onConduct, onTerms, onPrivacy }: { player: Player; onBack: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const [entries, setEntries] = useState<WaitingHistoryEntry[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { void history.all().then(setEntries); }, []);
  async function deleteEntry(id: number) { await history.deleteEntry(id); setEntries((current) => current.filter((entry) => entry.id !== id)); }
  async function clearEntries() { await history.clear(); setEntries([]); setConfirming(false); }

  return <main className="home-shell"><SiteNavigation onConduct={onConduct} onActivity={() => undefined} onTerms={onTerms} onPrivacy={onPrivacy} /><section className="home-card" aria-labelledby="activity-title">
    <p className="eyebrow">Activity</p><h1 id="activity-title">Saved on this browser.</h1>
    <p className="notice">History is saved only on this browser. Clearing browser data permanently removes it and cannot be recovered on another device.</p>
    {entries.length === 0 ? <p className="lede">No local activity yet.</p> : <ul className="activity-list">{entries.map((entry) => <li key={entry.id}><strong>{entry.role === "asker" ? "You asked" : "You answered"}{entry.answerKind === "drawing" ? " with a drawing" : ""}</strong><p>{entry.questionText}</p>{entry.answerText && <p>{entry.answerText}</p>}{entry.drawing && <DrawingPreview drawing={entry.drawing} label={`Drawing for ${entry.questionText}`} />}<button className="secondary-action" type="button" onClick={() => void deleteEntry(entry.id!)}>Delete</button></li>)}</ul>}
    <div className="form-actions"><button className="secondary-action" type="button" onClick={onBack}>Back home</button>{entries.length > 0 && <button className="secondary-action" type="button" onClick={() => setConfirming(true)}>Clear all history</button>}</div>
    {confirming && <div className="confirm-panel" role="alert"><p>Delete all local history? This cannot be undone.</p><button className="primary-action" type="button" onClick={() => void clearEntries()}>Delete all</button><button className="secondary-action" type="button" onClick={() => setConfirming(false)}>Cancel</button></div>}
    <span className="credit-balance">{pluralisedCredits(player.creditBalance)}</span>
  </section></main>;
}

function MachineFrame({ player, onHuman, onActivity, onConduct, onTerms, onPrivacy, children }: { player: Player; onHuman: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void; children: ReactNode }) {
  return <main className="app-page">
    <nav className="site-nav" aria-label="Site links"><span className="nav-brand">Are u Human?</span><button type="button" onClick={onConduct}>conduct</button><button type="button" onClick={onActivity}>activity</button><button type="button" onClick={onTerms}>terms</button><button type="button" onClick={onPrivacy}>privacy</button></nav>
    <section className="game-shell machine-shell">
      <div className="mode-tabs" role="group" aria-label="Choose a role"><button className="mode-tab" type="button" onClick={onHuman}>ask a human</button><button className="mode-tab machine-active" type="button">play as ai</button></div>
      <div className="community-banner"><strong>humans only</strong><span>be kind. no personal info, links, or meetups.</span></div>
      <span className="machine-credit" aria-label={`Authoritative balance: ${pluralisedCredits(player.creditBalance)}`}>{player.creditBalance}c</span>
      <div className="machine-content">{children}</div>
    </section>
    <OnlinePresence mode="ai" />
  </main>;
}

function MachineReady({ player, onStart, onHuman, onActivity, onConduct, onTerms, onPrivacy }: { player: Player; onStart: () => void; onHuman: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  return <MachineFrame player={player} onHuman={onHuman} onActivity={onActivity} onConduct={onConduct} onTerms={onTerms} onPrivacy={onPrivacy}><section className="queue-workspace" aria-labelledby="machine-ready-title">
    <div className="queue-card ready-card"><h1 id="machine-ready-title">become the machine</h1><p>You have two minutes to answer a stranger before the reservation expires.</p><small>+1 credit per answer</small></div>
    <button className="machine-action accent" type="button" onClick={onStart}>start playing</button>
    <button className="machine-action" type="button" onClick={onHuman}>back to human mode</button>
    <button className="machine-action" type="button" onClick={onActivity}>view activity</button>
  </section></MachineFrame>;
}

function AnswerQuestion({ player, assignment, onSkip, onReport, onSubmissionStart, onSubmissionFailure, onNext, onLeave, onActivity, onConduct, onTerms, onPrivacy, connectionNotice }: { player: Player; assignment: AssignedQuestion; onSkip: () => Promise<void>; onReport: (reason: string) => Promise<void>; onSubmissionStart: () => void; onSubmissionFailure: () => void; onNext: (player: Player) => void; onLeave: (player: Player) => void; onActivity: (player: Player) => void; onConduct: (player: Player) => void; onTerms: (player: Player) => void; onPrivacy: (player: Player) => void; connectionNotice: string | null }) {
  const [answer, setAnswer] = useState("");
  const [drawing, setDrawing] = useState<DrawingData>(() => emptyDrawing());
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
      const isDrawing = assignment.kind === "drawing";
      const accepted = await gameApi.submitAnswer(isDrawing ? { kind: "drawing", drawing } : { kind: "text", text: answer.trim() });
      setBalance(accepted.creditBalance);
      setSubmittedBalance(accepted.creditBalance);
      try {
        await history.saveSubmittedAnswer({
          questionId: assignment.id, role: "answerer", questionText: assignment.text, questionKind: assignment.kind ?? "text",
          answerId: accepted.id, answerKind: isDrawing ? "drawing" : "text",
          answerText: isDrawing ? undefined : answer.trim(), drawing: isDrawing ? drawing : undefined, createdAt: accepted.acceptedAt
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
  if (submittedBalance !== null) return <MachineFrame player={currentPlayer} onHuman={() => onLeave(currentPlayer)} onActivity={() => onActivity(currentPlayer)} onConduct={() => onConduct(currentPlayer)} onTerms={() => onTerms(currentPlayer)} onPrivacy={() => onPrivacy(currentPlayer)}><section className="machine-success" aria-labelledby="answer-success-title">
    <h1 className="sr-only" id="answer-success-title">Answer submitted successfully</h1>
    <p className="success-banner" role="status">great success (+1 credit. you now have {submittedBalance})</p>
    {message && <p className="form-error">{message}</p>}
    <button className="machine-action accent" type="button" onClick={() => onNext(currentPlayer)}>another one</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>no thanks</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>back to human mode</button>
    <button className="machine-action" type="button" onClick={() => onActivity(currentPlayer)}>view activity</button>
  </section></MachineFrame>;

  return <MachineFrame player={currentPlayer} onHuman={() => onLeave(currentPlayer)} onActivity={() => onActivity(currentPlayer)} onConduct={() => onConduct(currentPlayer)} onTerms={() => onTerms(currentPlayer)} onPrivacy={() => onPrivacy(currentPlayer)}><section className="answer-workspace" aria-labelledby="answer-title">
    <h1 className="sr-only" id="answer-title">Answer this question</h1>
    {connectionNotice && <p className="form-error" role="status">{connectionNotice}</p>}
    <ReservationTimer expiresAt={assignment.reservationExpiresAt} serverNow={assignment.serverNow} />
    <article className="assignment-card"><div><strong>FROM A HUMAN (+1C)</strong><small>asked for {assignment.kind === "drawing" ? "a drawing" : "text"}</small></div><p>“{assignment.text}”</p></article>
    <p className="skip-tip"><strong>skip prompts you can’t answer!</strong><span>Skip quickly to receive another available prompt.</span></p>
    <div className="answer-tabs"><span className={assignment.kind !== "drawing" ? "selected" : ""}>write</span><span className={assignment.kind === "drawing" ? "selected" : ""}>draw</span></div>
    <form onSubmit={submit}>
      {assignment.kind === "drawing" ? <DrawingCanvas value={drawing} onChange={setDrawing} /> : <><label className="sr-only" htmlFor="answer">Your answer</label><textarea id="answer" placeholder="type your answer here…" value={answer} maxLength={750} required onChange={(event) => setAnswer(event.target.value)} /><p className="fine-print">{answer.length}/750 characters</p></>}
      {message && <p className="form-error" role="status">{message}</p>}
      <div className="answer-actions"><button className="primary-action answer-submit" type="submit" disabled={submitting || (assignment.kind === "drawing" ? drawing.strokes.length === 0 : !answer.trim())}>{submitting ? "Submitting…" : assignment.kind === "drawing" ? "Send drawing" : "Submit"}</button>
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
  onActivity,
  onConduct,
  onTerms,
  onPrivacy
}: {
  player: Player;
  error: string | null;
  onCheckAgain: () => void;
  onHuman: () => void;
  onLeaveQueue: () => void;
  onActivity: () => void;
  onConduct: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  useEffect(() => {
    const timer = window.setInterval(onCheckAgain, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <MachineFrame player={player} onHuman={onHuman} onActivity={onActivity} onConduct={onConduct} onTerms={onTerms} onPrivacy={onPrivacy}><section className="queue-workspace" aria-labelledby="empty-title">
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
    <small>a human responded{delivery.answerKind === "drawing" ? " with a drawing" : ""}</small>{delivery.drawing ? <DrawingPreview drawing={delivery.drawing} label={`Drawing response to ${delivery.questionText}`} /> : <p>{delivery.answerText}</p>}
    <div className="message-actions"><button type="button" aria-label="Like" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "like"); setRating("like"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👍</button><button type="button" aria-label="Dislike" disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "dislike"); setRating("dislike"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👎</button><details className="chat-report"><summary>report</summary><label className="sr-only" htmlFor="answer-report-reason">Reason</label><textarea id="answer-report-reason" placeholder="Why are you reporting this answer?" value={reportReason} maxLength={500} onChange={(event) => setReportReason(event.target.value)} /><button type="button" disabled={!reportReason.trim()} onClick={async () => { try { await gameApi.reportAnswer(delivery.answerId, reportReason.trim(), delivery.drawing ? "Drawing response" : delivery.answerText ?? "Answer unavailable"); setReportMessage("Report received."); } catch (error: unknown) { setReportMessage(messageFor(error)); } }}>send report</button></details></div>
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
