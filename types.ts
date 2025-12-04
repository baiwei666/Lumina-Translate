export enum ContentType {
  PLAIN_TEXT = 'PLAIN_TEXT',
  SUBTITLE_SRT = 'SUBTITLE_SRT',
  LYRICS_LRC = 'LYRICS_LRC',
  MARKDOWN = 'MARKDOWN'
}

export interface SubtitleBlock {
  id: number;
  startTime: string;
  endTime: string;
  originalText: string;
  translatedText: string;
  isTranslating: boolean;
}

export interface TranslationConfig {
  targetLanguage: string;
  tone: string; // e.g., "Formal", "Casual", "Literary (信达雅)"
  model: string;
}

export enum AppModel {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-3-pro-preview'
}

export enum OutputFormat {
  ONLY_TRANSLATION = 'ONLY_TRANSLATION',
  DUAL_TRANS_SRC = 'DUAL_TRANS_SRC', // Translated top, Original bottom
  DUAL_SRC_TRANS = 'DUAL_SRC_TRANS'  // Original top, Translated bottom
}

export enum LLMProvider {
  GEMINI = 'gemini',
  CUSTOM = 'custom' // OpenAI Compatible
}

export interface CustomLLMConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export type Theme = 'light' | 'dark';
