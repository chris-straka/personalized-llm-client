import type { Part } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import { state, THINKING_LEVELS } from './state';

export function getAI(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

export async function countFileTokens(ai: GoogleGenAI, model: string, part: Part) {
  return await ai.models.countTokens({ model, contents: [{ role: 'user', parts: [part] }] });
}

export async function generateResponse(ai: GoogleGenAI, model: string) {
  return await ai.models.generateContent({
    model,
    contents: state.chatHistory,
    config: {
      systemInstruction: `Be brief, no summaries.`,
      thinkingConfig: { thinkingLevel: THINKING_LEVELS[state.thinkingIndex] },
      tools: []
    }
  });
}
