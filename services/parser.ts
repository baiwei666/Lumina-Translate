import { SubtitleBlock, OutputFormat } from '../types';

/**
 * Check if content looks like SRT
 */
export const isSRTContent = (text: string): boolean => {
  return /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(text);
};

/**
 * Check if content looks like LRC (Lyrics)
 * Matches: [00:12.195] or [00:12]
 */
export const isLRCContent = (text: string): boolean => {
  return /^\[\d{2}:\d{2}(\.\d{2,3})?\]/m.test(text);
};

/**
 * Basic SRT Parser
 */
export const parseSRT = (content: string): SubtitleBlock[] => {
  const normalized = content.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  
  const subtitles: SubtitleBlock[] = [];
  let idCounter = 1;

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split('\n');
    if (lines.length < 2) continue;

    let timeLineIndex = 0;
    const arrowIndex = lines.findIndex(line => line.includes('-->'));
    
    if (arrowIndex !== -1) {
        timeLineIndex = arrowIndex;
        const timeLine = lines[timeLineIndex];
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

        if (timeMatch) {
          const textLines = lines.slice(timeLineIndex + 1);
          const originalText = textLines.join('\n').trim();

          if (originalText) {
             subtitles.push({
                id: idCounter++,
                startTime: timeMatch[1],
                endTime: timeMatch[2],
                originalText: originalText,
                translatedText: '',
                isTranslating: false
              });
          }
        }
    }
  }
  return subtitles;
};

/**
 * LRC Parser
 * Extracts timestamp and text. Note: LRC usually doesn't have explicit end times per line.
 */
export const parseLRC = (content: string): SubtitleBlock[] => {
  const lines = content.split(/\r?\n/);
  const blocks: SubtitleBlock[] = [];
  let id = 1;

  // Regex for standard LRC: [mm:ss.xx]Text
  // Also supports ID tags which we might just want to preserve or ignore. 
  // For translation app, we focus on lines with time.
  const timeRegex = /^\[(\d{2}:\d{2}(?:\.\d{2,3})?)\](.*)/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const startTime = match[1];
      const text = match[2].trim();
      
      // Even if text is empty, sometimes LRC uses it for timing spacers, but usually we translate text.
      if (text) {
        blocks.push({
          id: id++,
          startTime: startTime,
          endTime: '', // Not used for LRC
          originalText: text,
          translatedText: '',
          isTranslating: false
        });
      }
    }
  }
  return blocks;
};

/**
 * Stringify SRT
 */
export const stringifySRT = (blocks: SubtitleBlock[], format: OutputFormat): string => {
  return blocks.map((block, index) => {
    let text = "";
    const original = block.originalText;
    const translated = block.translatedText || original;

    switch (format) {
      case OutputFormat.ONLY_TRANSLATION:
        text = translated;
        break;
      case OutputFormat.DUAL_TRANS_SRC:
        text = `${translated}\n${original}`;
        break;
      case OutputFormat.DUAL_SRC_TRANS:
        text = `${original}\n${translated}`;
        break;
      default:
        text = translated;
    }

    return `${index + 1}\n${block.startTime} --> ${block.endTime}\n${text}\n`;
  }).join('\n');
};

/**
 * Stringify LRC
 * Repeats timestamp for dual language lines to ensure players render both.
 */
export const stringifyLRC = (blocks: SubtitleBlock[], format: OutputFormat): string => {
  return blocks.map(block => {
    const timeTag = `[${block.startTime}]`;
    const original = block.originalText;
    const translated = block.translatedText || original;

    switch (format) {
      case OutputFormat.ONLY_TRANSLATION:
        return `${timeTag}${translated}`;
      case OutputFormat.DUAL_TRANS_SRC:
        // Standard LRC dual: repeat time tag on next line
        return `${timeTag}${translated}\n${timeTag}${original}`;
      case OutputFormat.DUAL_SRC_TRANS:
        return `${timeTag}${original}\n${timeTag}${translated}`;
      default:
        return `${timeTag}${translated}`;
    }
  }).join('\n');
};

/**
 * Simple text splitter
 */
export const parsePlainText = (content: string): SubtitleBlock[] => {
    const paragraphs = content.split(/\n\s*\n/);
    return paragraphs.map((p, i) => ({
        id: i + 1,
        startTime: '00:00:00,000',
        endTime: '00:00:00,000',
        originalText: p.trim(),
        translatedText: '',
        isTranslating: false
    })).filter(b => b.originalText.length > 0);
};