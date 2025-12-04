 
import { Card } from "../types";

const SYSTEM_INSTRUCTION = `You are a witty, slightly sarcastic, but strategic poker commentator. 
Your goal is to analyze the poker hand provided and give a 1-2 sentence commentary.
Focus on the winner's strategy or the key moment of the hand (e.g., a lucky river, a brilliant bluff).
Keep it short, entertaining, and educational.`;

export const getHandAnalysis = async (
  communityCards: Card[],
  winnerName: string,
  winningHand: string,
  potSize: number
): Promise<string> => {
  if (!process.env.API_KEY) {
    return "Gemini API Key not found. Commentary unavailable.";
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const boardStr = communityCards.map(c => `${c.rank}${c.suit}`).join(" ");
    const prompt = `
      The hand is over.
      Board: [${boardStr}]
      Winner: ${winnerName} with ${winningHand}.
      Pot Size: ${potSize}.
      Give me a quick commentary.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 100,
      }
    });

    return response.text || "No commentary generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "The commentator is taking a coffee break (API Error).";
  }
};

export const getStrategicAdvice = async (
  hand: Card[],
  communityCards: Card[],
  phase: string,
  pot: number,
  toCall: number
): Promise<string> => {
    if (!process.env.API_KEY) return "Enable API Key for advice.";

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const handStr = hand.map(c => `${c.rank}${c.suit}`).join(" ");
        const boardStr = communityCards.map(c => `${c.rank}${c.suit}`).join(" ");
        
        const prompt = `
            I am in a Texas Hold'em game.
            My Hand: ${handStr}
            Board: ${boardStr || "None"}
            Phase: ${phase}
            Pot: ${pot}
            Cost to Call: ${toCall}
            
            What should I do? (Fold, Call, Raise). Briefly explain why in 1 sentence.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { maxOutputTokens: 60 }
        });

        return response.text || "Follow your gut.";
    } catch (e) {
        return "Advice unavailable.";
    }
}