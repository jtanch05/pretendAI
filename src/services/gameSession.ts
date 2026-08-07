import { getSupabaseClient } from "./supabase";
import type { WaitingQuestion } from "./gameApi";

export type Player = {
  creditBalance: number;
  activeQuestion: WaitingQuestion | null;
};

type PlayerRow = {
  credit_balance: number;
};

type PlayerStateRow = PlayerRow & {
  active_question_id: string | null;
  active_question_status: "pending" | "reserved" | null;
  active_question_text: string | null;
  active_question_created_at: string | null;
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

  const { data: state, error: stateError } = await supabase.rpc("get_current_player_state");

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
  async enter(): Promise<Player> {
    const { supabase, hasSession } = await readSession();

    if (!hasSession) {
      const { error: signInError } = await supabase.auth.signInAnonymously();

      if (signInError) {
        throw new Error(signInError.message);
      }
    }

    return initialisePlayer();
  },

  async restore(): Promise<Player | null> {
    const { hasSession } = await readSession();

    return hasSession ? initialisePlayer() : null;
  }
};
