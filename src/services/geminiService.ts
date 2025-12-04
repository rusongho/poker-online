import { Card } from "../types";

export const getHandAnalysis = async (
  communityCards: Card[],
  winnerName: string,
  winningHand: string,
  potSize: number
): Promise<string> => {
  // AI functionality disabled to ensure stable deployment
  return `Game over! ${winnerName} won with ${winningHand}. (AI commentary unavailable)`;
};

export const getStrategicAdvice = async (
  hand: Card[],
  communityCards: Card[],
  phase: string,
  pot: number,
  toCall: number
): Promise<string> => {
    // AI functionality disabled to ensure stable deployment
    return "Trust your instincts! (AI advice unavailable)";
}