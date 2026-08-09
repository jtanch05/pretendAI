import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Lottie from "lottie-react";
import { gameSession, type Player } from "./services/gameSession";
import { gameApi, type AssignedQuestion, type ModerationReport, type PendingDelivery, type QuestionKind, type WaitingQuestion } from "./services/gameApi";
import { history, type WaitingHistoryEntry } from "./services/history";
import { getSupabaseClient } from "./services/supabase";
import { DrawingCanvas, DrawingPreview } from "./components/DrawingCanvas";
import { emptyDrawing, type DrawingData } from "./types/drawing";
import aiOrbLoader from "./assets/ai-orb-loader.json";
import { useLanguage } from "./language";

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

// Realtime delivers normal waiting-question updates. These requests only make
// the UI recover if the WebSocket event was missed or the connection is down.
const ACTIVE_STATE_POLL_INTERVAL_MS = 60_000;
const IDLE_CREDIT_CHECK_RETRY_MS = 60_000;

type PresenceMode = "human" | "ai";

function OnlinePresence({ mode }: { mode: PresenceMode }) {
  const { t } = useLanguage();
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
  return <p className="online-note" aria-live="polite"><span>{t("online", { online, human: counts.human, ai: counts.ai })}</span><br /><span>{t("humanTagline")}</span></p>;
}

function DesktopIcons() {
  const { language } = useLanguage();
  const labels = language === "zh"
    ? ["向真人提问", "扮演 AI", "活动记录", "回收站"]
    : ["Ask a Human", "Pretend AI", "My Activity", "Recycle Bin"];
  return <aside className="desktop-icons" aria-hidden="true">
    <span><i className="desktop-icon computer" />{labels[0]}</span>
    <span><i className="desktop-icon robot" />{labels[1]}</span>
    <span><i className="desktop-icon document" />{labels[2]}</span>
    <span><i className="desktop-icon bin" />{labels[3]}</span>
  </aside>;
}

function WindowChrome() {
  const { language } = useLanguage();
  return <>
    <div className="window-titlebar" aria-hidden="true">
      <span className="window-app-icon">H</span>
      <strong>Are u Human?.exe</strong>
      <span className="window-controls"><i>_</i><i>□</i><i>×</i></span>
    </div>
    <div className="window-menubar" aria-hidden="true">
      {(language === "zh" ? ["文件", "编辑", "查看", "帮助"] : ["File", "Edit", "View", "Help"]).map((label) => <span key={label}>{label}</span>)}
    </div>
  </>;
}

export default function App() {
  const { t } = useLanguage();
  const [hasConsent, setHasConsent] = useState(() => localStorage.getItem("pretend-ai.consent-v1") === "true");
  const [hasReadInstructions, setHasReadInstructions] = useState(() => localStorage.getItem("pretend-ai.instructions-v2") === "true");
  const [showInstructions, setShowInstructions] = useState(false);
  const [view, setView] = useState<View>(() => hasConsent
    ? { screen: "restoring" }
    : { screen: "home", player: { creditBalance: 1, activeQuestion: null } });
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [lastDelivery, setLastDelivery] = useState<PendingDelivery | null>(null);
  const [deliveredHistory, setDeliveredHistory] = useState<PendingDelivery[]>([]);
  const [realtimeRefresh, setRealtimeRefresh] = useState(0);
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [idleCreditAvailableAt, setIdleCreditAvailableAt] = useState<string | null>(null);
  const [idleCreditServerNow, setIdleCreditServerNow] = useState<string | null>(null);
  const answerPollingBlocked = useRef(false);

  const updatePlayerBalance = useCallback((creditBalance: number) => {
    setView((current) => current.screen === "restoring"
      ? current
      : { ...current, player: { ...current.player, creditBalance } });
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (view.screen === "restoring" || view.player.creditBalance !== 0 || !isPageVisible) {
      setIdleCreditAvailableAt(null);
      setIdleCreditServerNow(null);
      return;
    }

    let current = true;
    let timer: number | null = null;
    const check = async () => {
      try {
        const status = await gameSession.claimIdleCredit();
        if (!current) return;
        setIdleCreditAvailableAt(status.availableAt);
        setIdleCreditServerNow(status.serverNow);
        if (status.creditBalance !== view.player.creditBalance) updatePlayerBalance(status.creditBalance);
        if (status.creditBalance === 0 && status.availableAt) {
          const delay = Math.max(0, Date.parse(status.availableAt) - Date.parse(status.serverNow));
          timer = window.setTimeout(() => void check(), delay + 25);
        }
      } catch {
        if (current) timer = window.setTimeout(() => void check(), IDLE_CREDIT_CHECK_RETRY_MS);
      }
    };

    void check();
    return () => {
      current = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isPageVisible, updatePlayerBalance, view]);

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
      .catch(() => {
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
    // Do not keep querying while this tab is in the background. Returning to
    // the tab immediately runs one recovery check through this effect.
    if (!isPageVisible) return;
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
      } catch { if (current) setConnectionNotice(t("connectionLost")); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), ACTIVE_STATE_POLL_INTERVAL_MS);
    return () => { current = false; window.clearInterval(timer); };
  }, [view, realtimeRefresh, isPageVisible]);

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
      void client.auth.getSession().then(({ data, error }) => {
        if (!current || error || !data.session) return;
        void client.realtime.setAuth(data.session.access_token).then(() => {
          if (!current) return;
          channel = client
          .channel(`question-state:${activeQuestion.id}`, { config: { private: true } })
          .on("broadcast", { event: "question-lifecycle" }, () => {
            if (current) {
              setRealtimeRefresh((value) => value + 1);
            }
          })
          .subscribe((status) => {
            if (!current) return;
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setConnectionNotice(t("liveDisconnected"));
            }
          });
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
        idleCreditAvailableAt={idleCreditAvailableAt}
        idleCreditServerNow={idleCreditServerNow}
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
        localStorage.setItem("pretend-ai.instructions-v2", "true"); setHasReadInstructions(true); setShowInstructions(false);
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
    return <LoadingCard message={t("findingQuestion")} />;
  }

  return <LoadingCard message={t("loading")} />;
}

function Home({ player, locked, pendingQuestion, deliveredAnswers, idleCreditAvailableAt, idleCreditServerNow, connectionNotice, onSubmit, onAnswer, onActivity, onModerate, onConduct, onTerms, onPrivacy, onHelp }: { player: Player; locked: boolean; pendingQuestion: WaitingQuestion | null; deliveredAnswers: PendingDelivery[]; idleCreditAvailableAt: string | null; idleCreditServerNow: string | null; connectionNotice: string | null; onSubmit: (text: string, kind: QuestionKind) => Promise<void>; onAnswer: () => void; onActivity: () => void; onModerate: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void; onHelp: () => void }) {
  const { t } = useLanguage();
  const [isModerator, setIsModerator] = useState(false);
  const [question, setQuestion] = useState("");
  const [questionKind, setQuestionKind] = useState<QuestionKind>("text");
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const chatFeed = useRef<HTMLDivElement>(null);
  useEffect(() => { void gameSession.isModerator().then(setIsModerator).catch(() => setIsModerator(false)); }, []);
  useEffect(() => {
    if (pendingQuestion || deliveredAnswers.length > 0) {
      setQuestion("");
      setQuestionError(null);
      setIsSubmitting(false);
    }
  }, [pendingQuestion, deliveredAnswers.length]);
  useLayoutEffect(() => {
    if (!chatFeed.current) return;
    chatFeed.current.scrollTop = chatFeed.current.scrollHeight;
  }, [connectionNotice, deliveredAnswers.length, pendingQuestion?.id]);
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
      <DesktopIcons />
      <SiteNavigation onConduct={onConduct} onActivity={onActivity} onTerms={onTerms} onPrivacy={onPrivacy} onModerate={isModerator ? onModerate : undefined} />
      <section className="game-shell" aria-labelledby="home-title">
        <h1 className="sr-only" id="home-title">{t("chooseAction")}</h1>
        <WindowChrome />
        <div className="mode-tabs" role="group" aria-label={t("chooseRole")}>
          <button className="mode-tab active" aria-label={t("askQuestion")} type="button" onClick={focusQuestion}>{t("askHuman")}</button>
          <button className="mode-tab" aria-label={t("pretendAi")} type="button" onClick={onAnswer}>{t("playAi")}</button>
        </div>
        <div className="community-banner"><strong>{t("humansOnly")}</strong><span>{t("communityRule")}</span></div>
        {deliveredAnswers.length > 0 || pendingQuestion ? <div className="game-stage chat-stage">
          <div className="chat-heading"><div className="mini-scribble" aria-hidden="true" /><h2>Are u Human?</h2><button className="help-button" type="button" onClick={onHelp} aria-label={t("helpLabel")}>?</button></div>
          <div className="chat-feed" ref={chatFeed} aria-live="polite">
            {deliveredAnswers.map((delivery) => <Fragment key={delivery.answerId}>
              <article className="user-message"><small>{t(delivery.questionKind === "drawing" ? "youAskedDrawing" : "youAsked")}</small><p>{delivery.questionText}</p></article>
              <DeliveredChat delivery={delivery} />
            </Fragment>)}
            {pendingQuestion && <><article className="user-message"><small>{t(pendingQuestion.kind === "drawing" ? "youAskedDrawing" : "youAsked")}</small><p>{pendingQuestion.text}</p></article>
              <div className="waiting-message" role="status"><Lottie className="chat-loading-orb" animationData={aiOrbLoader} loop aria-hidden="true" /><span>{t("aiThinking")}</span></div></>}
            {connectionNotice && <p className="form-error connection-message">{connectionNotice}</p>}
          </div>
        </div> : <div className="game-stage">
          <div className="scribble-mark" aria-hidden="true"><i /><i /><i /><i /></div>
          <h2>Are u Human?</h2>
          <button className="help-button" type="button" onClick={onHelp} aria-label={t("helpLabel")}>?</button>
          <p className="stage-copy">{t("strongestModel")}</p>
        </div>}
        <div className="composer-panel">
          <div className="composer-tabs" role="group" aria-label={t("chooseResponse")}><button className={questionKind === "text" ? "selected" : ""} type="button" onClick={() => { setQuestionKind("text"); focusQuestion(); }}>{t("writeSomething")}</button><button className={questionKind === "drawing" ? "selected" : ""} type="button" onClick={() => { setQuestionKind("drawing"); focusQuestion(); }}>{t("drawSomething")}</button></div>
          <span className="credit-chip" aria-label={t("balance", { credits: t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance }) })}><span aria-hidden="true">◉ {player.creditBalance}c</span><span className="sr-only">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span></span>
          {player.creditBalance === 0 && <IdleCreditCountdown availableAt={idleCreditAvailableAt} serverNow={idleCreditServerNow} />}
          <form className="prompt-bar" onSubmit={submit}>
            <label className="sr-only" htmlFor="home-question">{t("yourQuestion")}</label>
            <input id="home-question" value={question} maxLength={500} placeholder={t(pendingQuestion ? "earnPlaceholder" : questionKind === "drawing" ? "drawPlaceholder" : "askPlaceholder")} onChange={(event) => setQuestion(event.target.value)} />
            <button className="send-glyph" type="submit" aria-label={t("sendQuestion")} disabled={isSubmitting || !question.trim() || Boolean(pendingQuestion)}>{isSubmitting ? "…" : "↗"}</button>
          </form>
          <div className="composer-meta"><span>{question.length}/500</span><span>{t(pendingQuestion ? "pendingQuestion" : "sendingCredit")}</span></div>
          {questionError && <p className="form-error composer-error" role="alert">{questionError}</p>}
        </div>
        <OnlinePresence mode="human" />
      </section>
    </main>
  );
}

function IdleCreditCountdown({ availableAt, serverNow }: { availableAt: string | null; serverNow: string | null }) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!availableAt || !serverNow) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [availableAt, serverNow]);

  if (!availableAt || !serverNow) return null;
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(availableAt) - Date.parse(serverNow) - elapsed) / 1000));
  const time = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  return <span className="idle-credit-countdown">{t("idleCreditCountdown", { time })}</span>;
}

function ConsentGate({ error, onAccept, onConduct, onTerms, onPrivacy }: { error: string | null; onAccept: (captchaToken?: string) => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const { t } = useLanguage();
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const requiresCaptcha = Boolean(turnstileSiteKey && turnstileSiteKey !== "your-turnstile-site-key");
  const markCaptchaUnavailable = useCallback(() => setCaptchaUnavailable(true), []);
  return <div className="modal-backdrop"><section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
    <div className="modal-icon" aria-hidden="true">✦</div><h2 id="entry-title">{t("beforeEnter")}</h2><p>{t("everyoneWelcome")}</p>
    <label className="consent-row"><input type="checkbox" checked={ageAccepted} onChange={(event) => setAgeAccepted(event.target.checked)} /><span>{t("agreeConductPrefix")} <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onConduct(); }}>{t("codeOfConduct")}</button></span></label>
    <label className="consent-row"><input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span>{t("agreePolicyPrefix")} <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTerms(); }}>{t("terms")}</button> {t("and")} <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onPrivacy(); }}>{t("privacyPolicy")}</button></span></label>
    {requiresCaptcha && <TurnstileChallenge siteKey={turnstileSiteKey!} onToken={setCaptchaToken} onUnavailable={markCaptchaUnavailable} />}
    {captchaUnavailable && <p className="form-error" role="alert">{t("captchaError")}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="modal-primary" type="button" disabled={!ageAccepted || !policyAccepted || (requiresCaptcha && !captchaToken)} onClick={() => onAccept(captchaToken ?? undefined)}>{t("enterAnonymous")}</button>
    <small>{t("noAccount")}</small>
  </section></div>;
}

function TurnstileChallenge({ siteKey, onToken, onUnavailable }: { siteKey: string; onToken: (token: string | null) => void; onUnavailable: () => void }) {
  const { t } = useLanguage();
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

  return <div className="turnstile-challenge" ref={container} aria-label={t("antiAbuse")} />;
}

function InstructionsModal({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  return <div className="modal-backdrop"><section className="instruction-modal" role="dialog" aria-modal="true" aria-labelledby="instruction-title">
    <p className="eyebrow">{t("howItWorks")}</p><h2 id="instruction-title">{t("instructionTitle")}</h2>
    <p>{t("instructionIntro")}</p>
    <ul><li>{t("ruleCost")}</li><li>{t("ruleEarn")}</li><li>{t("ruleIdleCredit")}</li><li>{t("ruleSkip")}</li><li>{t("ruleOne")}</li><li>{t("ruleNice")}</li><li>{t("ruleReport")}</li></ul>
    <button className="modal-primary" type="button" onClick={onDone}>{t("gotIt")}</button><small>{t("rereadRules")}</small>
  </section></div>;
}

function SiteNavigation({ onConduct, onActivity, onTerms, onPrivacy, onModerate }: { onConduct: () => void; onActivity: () => void; onTerms: () => void; onPrivacy: () => void; onModerate?: () => void }) {
  const { language, t } = useLanguage();
  const time = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  return <nav className="site-nav" aria-label={t("siteLinks")}>
    <span className="start-button"><i aria-hidden="true">▦</i>{language === "zh" ? "开始" : "Start"}</span>
    <span className="nav-brand"><i aria-hidden="true">H</i>Are u Human?</span>
    <span className="task-shortcuts">
      <button type="button" onClick={onConduct}>{t("conduct")}</button>
      <button type="button" onClick={onActivity}>{t("activity")}</button>
      <button type="button" onClick={onTerms}>{t("terms")}</button>
      <button type="button" onClick={onPrivacy}>{t("privacy")}</button>
      {onModerate && <button type="button" onClick={onModerate}>{t("moderate")}</button>}
    </span>
    <span className="task-tray"><i aria-hidden="true">▥</i><span>{language === "zh" ? "中" : "EN"}</span><time>{time}</time></span>
  </nav>;
}

function InformationPage({ player, page, onBack, onActivity, onConduct, onTerms, onPrivacy }: { player: Player; page: InfoPage; onBack: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const { t } = useLanguage();
  const content = page === "conduct"
    ? <><p className="eyebrow">{t("conductEyebrow")}</p><h1 id="info-title">{t("conductTitle")}</h1><p className="lede">{t("conductLead")}</p><h2>{t("doNotPost")}</h2><p>{t("doNotPostBody")}</p><h2>{t("useReports")}</h2><p>{t("useReportsBody")}</p></>
    : page === "terms"
      ? <><p className="eyebrow">{t("termsEyebrow")}</p><h1 id="info-title">{t("termsTitle")}</h1><p className="lede">{t("termsLead")}</p><h2>{t("whoCanUse")}</h2><p>{t("whoCanUseBody")}</p><h2>{t("creditsAvailability")}</h2><p>{t("creditsAvailabilityBody")}</p></>
      : <><p className="eyebrow">{t("privacyEyebrow")}</p><h1 id="info-title">{t("privacyTitle")}</h1><p className="lede">{t("privacyLead")}</p><h2>{t("retained")}</h2><p>{t("retainedBody")}</p><h2>{t("choices")}</h2><p>{t("choicesBody")}</p></>;
  return <main className="home-shell"><SiteNavigation onConduct={onConduct} onActivity={onActivity} onTerms={onTerms} onPrivacy={onPrivacy} /><section className="home-card" aria-labelledby="info-title">{content}<button className="secondary-action" type="button" onClick={onBack}>{t("backHome")}</button><span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span></section></main>;
}

function Activity({ player, onBack, onConduct, onTerms, onPrivacy }: { player: Player; onBack: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<WaitingHistoryEntry[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { void history.all().then(setEntries); }, []);
  async function deleteEntry(id: number) { await history.deleteEntry(id); setEntries((current) => current.filter((entry) => entry.id !== id)); }
  async function clearEntries() { await history.clear(); setEntries([]); setConfirming(false); }

  return <main className="home-shell"><SiteNavigation onConduct={onConduct} onActivity={() => undefined} onTerms={onTerms} onPrivacy={onPrivacy} /><section className="home-card" aria-labelledby="activity-title">
    <p className="eyebrow">{t("activity")}</p><h1 id="activity-title">{t("activityTitle")}</h1>
    <p className="notice">{t("activityNotice")}</p>
    {entries.length === 0 ? <p className="lede">{t("noActivity")}</p> : <ul className="activity-list">{entries.map((entry) => <li key={entry.id}><strong>{t(entry.role === "asker" ? "youAsked" : "youAnswered")}{entry.answerKind === "drawing" ? t("withDrawing") : ""}</strong><p>{entry.questionText}</p>{entry.answerText && <p>{entry.answerText}</p>}{entry.drawing && <DrawingPreview drawing={entry.drawing} label={t("drawingFor", { question: entry.questionText })} />}<button className="secondary-action" type="button" onClick={() => void deleteEntry(entry.id!)}>{t("delete")}</button></li>)}</ul>}
    <div className="form-actions"><button className="secondary-action" type="button" onClick={onBack}>{t("backHome")}</button>{entries.length > 0 && <button className="secondary-action" type="button" onClick={() => setConfirming(true)}>{t("clearHistory")}</button>}</div>
    {confirming && <div className="confirm-panel" role="alert"><p>{t("deleteHistoryConfirm")}</p><button className="primary-action" type="button" onClick={() => void clearEntries()}>{t("deleteAll")}</button><button className="secondary-action" type="button" onClick={() => setConfirming(false)}>{t("cancel")}</button></div>}
    <span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span>
  </section></main>;
}

function MachineFrame({ player, onHuman, onActivity, onConduct, onTerms, onPrivacy, children }: { player: Player; onHuman: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  return <main className="app-page">
    <DesktopIcons />
    <SiteNavigation onConduct={onConduct} onActivity={onActivity} onTerms={onTerms} onPrivacy={onPrivacy} />
    <section className="game-shell machine-shell">
      <WindowChrome />
      <div className="mode-tabs" role="group" aria-label={t("chooseRole")}><button className="mode-tab" type="button" onClick={onHuman}>{t("askHuman")}</button><button className="mode-tab machine-active" type="button">{t("playAi")}</button></div>
      <div className="community-banner"><strong>{t("humansOnly")}</strong><span>{t("communityRule")}</span></div>
      <span className="machine-credit" aria-label={t("balance", { credits: t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance }) })}>{player.creditBalance}c</span>
      <div className="machine-content">{children}</div>
      <OnlinePresence mode="ai" />
    </section>
  </main>;
}

function MachineReady({ player, onStart, onHuman, onActivity, onConduct, onTerms, onPrivacy }: { player: Player; onStart: () => void; onHuman: () => void; onActivity: () => void; onConduct: () => void; onTerms: () => void; onPrivacy: () => void }) {
  const { t } = useLanguage();
  return <MachineFrame player={player} onHuman={onHuman} onActivity={onActivity} onConduct={onConduct} onTerms={onTerms} onPrivacy={onPrivacy}><section className="queue-workspace" aria-labelledby="machine-ready-title">
    <div className="queue-card ready-card"><h1 id="machine-ready-title">{t("becomeMachine")}</h1><p>{t("machineReady")}</p><small>{t("earnCredit")}</small></div>
    <button className="machine-action accent" type="button" onClick={onStart}>{t("startPlaying")}</button>
    <button className="machine-action" type="button" onClick={onActivity}>{t("viewActivity")}</button>
  </section></MachineFrame>;
}

function AnswerQuestion({ player, assignment, onSkip, onReport, onSubmissionStart, onSubmissionFailure, onNext, onLeave, onActivity, onConduct, onTerms, onPrivacy, connectionNotice }: { player: Player; assignment: AssignedQuestion; onSkip: () => Promise<void>; onReport: (reason: string) => Promise<void>; onSubmissionStart: () => void; onSubmissionFailure: () => void; onNext: (player: Player) => void; onLeave: (player: Player) => void; onActivity: (player: Player) => void; onConduct: (player: Player) => void; onTerms: (player: Player) => void; onPrivacy: (player: Player) => void; connectionNotice: string | null }) {
  const { t } = useLanguage();
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
        setMessage(t("answerSavedWarning"));
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
    <h1 className="sr-only" id="answer-success-title">{t("submittedTitle")}</h1>
    <p className="success-banner" role="status">{t("success", { count: submittedBalance })}</p>
    {message && <p className="form-error">{message}</p>}
    <button className="machine-action accent" type="button" onClick={() => onNext(currentPlayer)}>{t("anotherOne")}</button>
    <button className="machine-action" type="button" onClick={() => onLeave(currentPlayer)}>{t("noThanks")}</button>
    <button className="machine-action" type="button" onClick={() => onActivity(currentPlayer)}>{t("viewActivity")}</button>
  </section></MachineFrame>;

  return <MachineFrame player={currentPlayer} onHuman={() => onLeave(currentPlayer)} onActivity={() => onActivity(currentPlayer)} onConduct={() => onConduct(currentPlayer)} onTerms={() => onTerms(currentPlayer)} onPrivacy={() => onPrivacy(currentPlayer)}><section className="answer-workspace" aria-labelledby="answer-title">
    <h1 className="sr-only" id="answer-title">{t("answerQuestion")}</h1>
    {connectionNotice && <p className="form-error" role="status">{connectionNotice}</p>}
    <ReservationTimer expiresAt={assignment.reservationExpiresAt} serverNow={assignment.serverNow} />
    <article className="assignment-card"><div><strong>{t("fromHuman")}</strong><small>{t("askedFor", { kind: t(assignment.kind === "drawing" ? "drawing" : "text") })}</small></div><p>“{assignment.text}”</p></article>
    <p className="skip-tip"><strong>{t("skipTitle")}</strong><span>{t("skipBody")}</span></p>
    <div className="answer-tabs"><span className={assignment.kind !== "drawing" ? "selected" : ""}>{t("write")}</span><span className={assignment.kind === "drawing" ? "selected" : ""}>{t("draw")}</span></div>
    <form onSubmit={submit}>
      {assignment.kind === "drawing" ? <DrawingCanvas value={drawing} onChange={setDrawing} /> : <><label className="sr-only" htmlFor="answer">{t("yourAnswer")}</label><textarea id="answer" placeholder={t("answerPlaceholder")} value={answer} maxLength={750} required onChange={(event) => setAnswer(event.target.value)} /><p className="fine-print">{t("characters", { count: answer.length })}</p></>}
      {message && <p className="form-error" role="status">{message}</p>}
      <div className="answer-actions"><button className="primary-action answer-submit" type="submit" disabled={submitting || (assignment.kind === "drawing" ? drawing.strokes.length === 0 : !answer.trim())}>{submitting ? t("submitting") : assignment.kind === "drawing" ? t("sendDrawing") : t("submit")}</button>
      <button className="secondary-action" type="button" disabled={skipping || submitting} onClick={async () => { setSkipping(true); try { await onSkip(); } catch (error: unknown) { setMessage(messageFor(error)); setSkipping(false); } }}>{t("skip")}</button>
      <details className="report-menu"><summary>{t("report")}</summary><label className="question-label" htmlFor="question-report-reason">{t("reason")}</label><textarea id="question-report-reason" value={reportReason} maxLength={500} onChange={(event) => setReportReason(event.target.value)} /><button className="secondary-action" type="button" disabled={reporting || !reportReason.trim()} onClick={async () => { setReporting(true); try { await onReport(reportReason.trim()); } catch (error: unknown) { setMessage(messageFor(error)); setReporting(false); } }}> {t(reporting ? "reporting" : "reportRelease")}</button></details></div>
    </form>
  </section></MachineFrame>;
}

function ReservationTimer({ expiresAt, serverNow }: { expiresAt: string; serverNow: string }) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState(0);
  const remaining = Math.max(0, Date.parse(expiresAt) - Date.parse(serverNow) - elapsed);
  const seconds = Math.ceil(remaining / 1000);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const percent = Math.min(100, (remaining / 120000) * 100);
  return <div className="reservation-timer" role="timer" aria-live="off"><div><span>{t("timeLeft")}</span><strong>{seconds}s</strong></div><div className="timer-track"><i style={{ width: `${percent}%` }} /></div><span className="sr-only">{t("timeRemaining", { time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` })}</span></div>;
}

export function EmptyQueue({
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
  const { t } = useLanguage();
  return <MachineFrame player={player} onHuman={onHuman} onActivity={onActivity} onConduct={onConduct} onTerms={onTerms} onPrivacy={onPrivacy}><section className="queue-workspace" aria-labelledby="empty-title">
    <div className="queue-card"><h1 id="empty-title">{t("becomeMachine")}</h1><p>{t("machineReadyShort")}</p><small>{t("earnCredit")}</small><strong><span aria-hidden="true">◔</span> {t("waitingPrompt")}</strong></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="machine-action" type="button" onClick={onCheckAgain}>{t("checkNow")}</button><button className="machine-action" type="button" onClick={onLeaveQueue}>{t("leaveQueue")}</button><button className="machine-action" type="button" onClick={onActivity}>{t("viewActivity")}</button>
  </section></MachineFrame>;
}

function DeliveredChat({ delivery }: { delivery: PendingDelivery }) {
  const { t } = useLanguage();
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  return <article className="assistant-message" aria-labelledby="delivery-title">
    <h2 className="sr-only" id="delivery-title">{t("humanAnswered")}</h2>
    <small>{t(delivery.answerKind === "drawing" ? "humanRespondedDrawing" : "humanResponded")}</small>{delivery.drawing ? <DrawingPreview drawing={delivery.drawing} label={t("drawingResponse", { question: delivery.questionText })} /> : <p>{delivery.answerText}</p>}
    <div className="message-actions"><button type="button" aria-label={t("like")} disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "like"); setRating("like"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👍</button><button type="button" aria-label={t("dislike")} disabled={rating !== null} onClick={async () => { try { await gameApi.rateAnswer(delivery.answerId, "dislike"); setRating("dislike"); } catch (error: unknown) { setRatingError(messageFor(error)); } }}>👎</button><details className="chat-report"><summary>{t("report")}</summary><label className="sr-only" htmlFor="answer-report-reason">{t("reason")}</label><textarea id="answer-report-reason" placeholder={t("reportPlaceholder")} value={reportReason} maxLength={500} onChange={(event) => setReportReason(event.target.value)} /><button type="button" disabled={!reportReason.trim()} onClick={async () => { try { await gameApi.reportAnswer(delivery.answerId, reportReason.trim()); setReportMessage(t("reportReceived")); } catch (error: unknown) { setReportMessage(messageFor(error)); } }}>{t("sendReport")}</button></details></div>
    {rating && <p className="chat-feedback" role="status">{t("thanksFeedback")}</p>}{ratingError && <p className="form-error" role="alert">{ratingError}</p>}{reportMessage && <p className="chat-feedback" role="status">{reportMessage}</p>}
  </article>;
}

function ModerationConsole({ player, onBack }: { player: Player; onBack: () => void }) {
  const { t } = useLanguage();
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
  return <main className="home-shell"><section className="home-card" aria-labelledby="moderation-title"><p className="eyebrow">{t("moderationEyebrow")}</p><h1 id="moderation-title">{t("openReports")}</h1><p className="notice">{t("moderationNotice")}</p>{error && <p className="form-error" role="alert">{error}</p>}{reports.length === 0 ? <p className="lede">{t("noReports")}</p> : <ul className="activity-list">{reports.map((report) => <li key={report.id}><strong>{t("reportType", { type: report.contentType })}</strong><p>{t("reasonValue", { value: report.reason })}</p><p>{t("evidence", { value: report.evidenceSnapshot })}</p><div className="form-actions"><button className="secondary-action" disabled={working === report.id} onClick={() => void resolve(report, "dismiss")}>{t("dismiss")}</button><button className="secondary-action" disabled={working === report.id} onClick={() => void resolve(report, "remove_content", true)}>{t("removeRefund")}</button><button className="primary-action" disabled={working === report.id} onClick={() => void resolve(report, "remove_and_restrict", true)}>{t("removeRestrict")}</button></div></li>)}</ul>}<button className="secondary-action" type="button" onClick={onBack}>{t("backHome")}</button><span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span></section></main>;
}

function DeliveryRetry({ player, error, onRetry }: { player: Player; error: string; onRetry: () => void }) {
  const { t } = useLanguage();
  return <main className="home-shell"><section className="home-card" aria-labelledby="delivery-retry-title">
    <p className="eyebrow">{t("answerReady")}</p><h1 id="delivery-retry-title">{t("saveAnswer")}</h1>
    <p className="form-error" role="alert">{error}</p>
    <button className="primary-action" type="button" onClick={onRetry}>{t("retrySave")}</button>
    <span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span>
  </section></main>;
}

function ExpiredQuestion({ player, onContinue }: { player: Player; onContinue: () => void }) {
  const { t } = useLanguage();
  return <main className="home-shell"><section className="home-card" aria-labelledby="expired-title">
    <p className="eyebrow">{t("questionExpired")}</p>
    <h1 id="expired-title">{t("questionExpiredTitle")}</h1>
    <p className="lede">{t("questionExpiredBody")}</p>
    <button className="primary-action" type="button" onClick={onContinue}>{t("continue")}</button>
    <span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span>
  </section></main>;
}

function UnavailableDelivery({ player, onContinue }: { player: Player; onContinue: () => void }) {
  const { t } = useLanguage();
  return <main className="home-shell"><section className="home-card" aria-labelledby="unavailable-title">
    <p className="eyebrow">{t("answerUnavailable")}</p><h1 id="unavailable-title">{t("answerUnavailableTitle")}</h1>
    <p className="lede">{t("answerUnavailableBody")}</p>
    <button className="primary-action" type="button" onClick={onContinue}>{t("continue")}</button>
    <span className="credit-balance">{t(player.creditBalance === 1 ? "credit" : "credits", { count: player.creditBalance })}</span>
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
