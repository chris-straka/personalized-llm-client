import { ThinkingLevel, type Content, type Part } from '@google/genai';

export const THINKING_LEVELS = [
  ThinkingLevel.LOW,
  ThinkingLevel.MEDIUM,
  ThinkingLevel.HIGH
] as const;

export const state = {
  chatHistory: [] as Content[],
  pendingFiles: [] as Part[],
  totalTokens: 0,
  thinkingIndex: 0 // Default to ThinkingLevel.LOW
};