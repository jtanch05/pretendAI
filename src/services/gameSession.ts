import { getSupabaseClient } from "./supabase";
import type { WaitingQuestion } from "./gameApi";

export type Player = {
  creditBalance: number;
  activeQuestion: WaitingQuestion | null;
};

export type IdleCreditStatus = {
  creditBalance: number;
  availableAt: string | null;
  serverNow: string;
  awarded: boolean;
};

type PlayerRow = {
  credit_balance: number;
};

type PlayerStateRow = PlayerRow & {
  active_question_id: string | null;
  active_question_status: "pending" | "reserved" | null;
  active_question_text: string | null;
  active_question_kind: "text" | "drawing" | null;
  active_question_created_at: string | null;
};

type IdleCreditStatusRow = {
  credit_balance: number;
  idle_credit_available_at: string | null;
  server_now: string;
  credit_awarded: boolean;
};

function playerFrom(data: PlayerStateRow[] | null): Player {
  const player = data?.[0];

  if (!player || typeof player.credit_balance !== "number") {
    throw new Error("The server did not return a player balance.");
  }

  const hasActiveQuestion = Boolean(
    player.active_question_id &&
      player.active_question_status &&
      player.active_question_text &&
      player.active_question_created_at
  );

  return {
    creditBalance: player.credit_balance,
    activeQuestion: hasActiveQuestion
      ? {
          id: player.active_question_id!,
          status: player.active_question_status!,
          text: player.active_question_text!,
          kind: player.active_question_kind ?? "text",
          createdAt: player.active_question_created_at!
        }
      : null
  };
}

async function initialisePlayer(): Promise<Player> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("create_profile_with_starter_credit");

  if (error) {
    throw new Error(error.message);
  }

  const { data: state, error: stateError } = await supabase.rpc("get_current_player_state_v2");

  if (stateError) {
    throw new Error(stateError.message);
  }

  return playerFrom(state as PlayerStateRow[] | null);
}

async function readSession() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  return { supabase, hasSession: Boolean(data.session) };
}

export const gameSession = {
  async enter(captchaToken?: string): Promise<Player> {
    const { supabase, hasSession } = await readSession();

    if (!hasSession) {
      const { error: signInError } = await supabase.auth.signInAnonymously({ options: captchaToken ? { captchaToken } : undefined });

      if (signInError) {
        throw new Error(signInError.message);
      }
    }

    return initialisePlayer();
  },

  async restore(): Promise<Player | null> {
    const { hasSession } = await readSession();

    return hasSession ? initialisePlayer() : null;
  },

  async claimIdleCredit(): Promise<IdleCreditStatus> {
    const { data, error } = await getSupabaseClient().rpc("claim_idle_credit");
    const status = (data as IdleCreditStatusRow[] | null)?.[0];

    if (error) throw new Error(error.message);
    if (!status) throw new Error("The server did not return the idle-credit status.");

    return {
      creditBalance: status.credit_balance,
      availableAt: status.idle_credit_available_at,
      serverNow: status.server_now,
      awarded: status.credit_awarded
    };
  },

  async isModerator(): Promise<boolean> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session?.user.app_metadata.role === "moderator";
  }
};
