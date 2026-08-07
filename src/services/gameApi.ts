import { getSupabaseClient } from "./supabase";

export type WaitingQuestion = {
  id: string;
  text: string;
  status: "pending" | "reserved";
  createdAt: string;
};

export type CreatedQuestion = WaitingQuestion & { creditBalance: number };

export type AssignedQuestion = {
  id: string;
  text: string;
  reservationExpiresAt: string;
  serverNow: string;
};
export type SubmittedAnswer = { id: string; creditBalance: number; acceptedAt: string };
export type PendingDelivery = { answerId: string; questionId: string; questionText: string; answerText: string; answeredAt: string };

type CreatedQuestionRow = {
  question_id: string;
  credit_balance: number;
  question_status: "pending";
  created_at: string;
};

type AssignedQuestionRow = {
  question_id: string;
  question_text: string;
  reservation_expires_at: string;
  server_now: string;
};
type SubmittedAnswerRow = { answer_id: string; credit_balance: number; accepted_at: string };
type PendingDeliveryRow = { answer_id: string; question_id: string; question_text: string; answer_text: string; answered_at: string };

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
  },

  async getAndReserveQuestion(): Promise<AssignedQuestion | null> {
    const { data, error } = await getSupabaseClient().rpc("get_and_reserve_question");
    const question = (data as AssignedQuestionRow[] | null)?.[0];

    if (error) throw new Error(error.message);
    if (!question) return null;

    return {
      id: question.question_id,
      text: question.question_text,
      reservationExpiresAt: question.reservation_expires_at,
      serverNow: question.server_now
    };
  },

  async submitAnswer(text: string): Promise<SubmittedAnswer> {
    const { data, error } = await getSupabaseClient().rpc("submit_answer", { answer_text: text });
    const answer = (data as SubmittedAnswerRow[] | null)?.[0];
    if (error) throw new Error(error.message);
    if (!answer) throw new Error("The server did not return the accepted answer.");
    return { id: answer.answer_id, creditBalance: answer.credit_balance, acceptedAt: answer.accepted_at };
  },

  async retrievePendingDelivery(): Promise<PendingDelivery | null> {
    const { data, error } = await getSupabaseClient().rpc("retrieve_pending_delivery");
    const delivery = (data as PendingDeliveryRow[] | null)?.[0];
    if (error) throw new Error(error.message);
    return delivery ? {
      answerId: delivery.answer_id, questionId: delivery.question_id, questionText: delivery.question_text,
      answerText: delivery.answer_text, answeredAt: delivery.answered_at
    } : null;
  },

  async acknowledgeDelivery(answerId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc("acknowledge_delivery", { delivered_answer_id: answerId });
    if (error) throw new Error(error.message);
  },

  async skipQuestion(): Promise<void> {
    const { error } = await getSupabaseClient().rpc("skip_question");
    if (error) throw new Error(error.message);
  },

  async rateAnswer(answerId: string, rating: "like" | "dislike"): Promise<void> {
    const { error } = await getSupabaseClient().rpc("rate_answer", { rated_answer_id: answerId, rating_value: rating });
    if (error) throw new Error(error.message);
  }
};
