import { getSupabaseClient } from "./supabase";

export type WaitingQuestion = {
  id: string;
  text: string;
  status: "pending" | "reserved";
  createdAt: string;
};

export type CreatedQuestion = WaitingQuestion & { creditBalance: number };

type CreatedQuestionRow = {
  question_id: string;
  credit_balance: number;
  question_status: "pending";
  created_at: string;
};

export const gameApi = {
  async createQuestion(text: string): Promise<CreatedQuestion> {
    const { data, error } = await getSupabaseClient().rpc("create_question", { question_text: text });
    const question = (data as CreatedQuestionRow[] | null)?.[0];

    if (error) throw new Error(error.message);
    if (!question) throw new Error("The server did not return the new question.");

    return {
      id: question.question_id,
      text,
      status: question.question_status,
      createdAt: question.created_at,
      creditBalance: question.credit_balance
    };
  }
};
