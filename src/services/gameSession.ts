import { getSupabaseClient } from "./supabase";

export type Player = {
  creditBalance: number;
};

type PlayerRow = {
  credit_balance: number;
};

function playerFrom(data: PlayerRow[] | null): Player {
  const player = data?.[0];

  if (!player || typeof player.credit_balance !== "number") {
    throw new Error("The server did not return a player balance.");
  }

  return { creditBalance: player.credit_balance };
}

async function initialisePlayer(): Promise<Player> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_profile_with_starter_credit");

  if (error) {
    throw new Error(error.message);
  }

  return playerFrom(data as PlayerRow[] | null);
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
