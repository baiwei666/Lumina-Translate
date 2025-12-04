import { GoogleGenAI, Type } from "@google/genai";
import { AppModel, CustomLLMConfig, LLMProvider } from "../types";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Interface for translation requests to decouple provider logic
 */
interface TranslationRequest {
  texts: string[];
  targetLanguage: string;
  tone: string;
  modelName: string;
  context?: string;
  provider: LLMProvider;
  customConfig?: CustomLLMConfig;
}

/**
 * Translates a batch of text segments using the selected provider.
 */
export const translateBatch = async (req: TranslationRequest): Promise<string[]> => {
  const { texts, targetLanguage, tone, modelName, context, provider, customConfig } = req;

  // Construct the prompt
  const systemPrompt = `
    You are a professional translator known for high-quality, culturally adaptive translations.
    Role: Translator.
    Target Language: ${targetLanguage}.
    Tone: ${tone}.
    Global Context: ${context || "General content"}.
    
    STRICT INSTRUCTIONS:
    1. Output ONLY a JSON object with a single key "translations" containing an array of strings.
    2. The array MUST contain exactly ${texts.length} items.
    3. Maintain 1-to-1 mapping with input. Do not split or merge lines.
    4. Do not include markdown formatting like \`\`\`json. Just the raw JSON.
    5. Prioritize "faithfulness, expressiveness, and elegance" (信达雅).
  `;

  const userPrompt = `Input segments to translate:\n${JSON.stringify(texts)}`;

  let attempt = 0;
  const maxRetries = 3;

  while (attempt < maxRetries) {
    try {
      let jsonText = "";

      if (provider === LLMProvider.GEMINI) {
        // --- GOOGLE GEMINI STRATEGY ---
        // The API key must be provided in the environment variable for Gemini default.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translations: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              }
            },
            // Only apply thinking budget if using the Gemini Pro model
            thinkingConfig: modelName === AppModel.PRO ? { thinkingBudget: 1024 } : undefined
          }
        });
        jsonText = response.text || "";

      } else if (provider === LLMProvider.CUSTOM) {
        // --- CUSTOM OPENAI COMPATIBLE STRATEGY ---
        if (!customConfig?.baseUrl || !customConfig?.apiKey) {
          throw new Error("Missing Custom Provider Configuration");
        }

        const endpoint = `${customConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${customConfig.apiKey}`
          },
          body: JSON.stringify({
            model: customConfig.modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" }, // Attempt to force JSON if supported
            temperature: 0.3
          })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Custom API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("Empty response from Custom API");
        jsonText = content;
      }

      // --- PARSING & VALIDATION ---
      // Clean up markdown code blocks if present (common issue with some models)
      const cleanJson = jsonText.replace(/```json\n?|\n?```/g, "").trim();
      
      let parsed;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (e) {
        throw new Error("Failed to parse JSON response: " + cleanJson.substring(0, 50) + "...");
      }

      if (!parsed.translations || !Array.isArray(parsed.translations)) {
         throw new Error("Invalid JSON structure: missing 'translations' array");
      }

      // Heuristic fix: If we sent 1 item but got multiple, merge them.
      if (texts.length === 1 && parsed.translations.length > 1) {
        console.warn(`Model split single input into ${parsed.translations.length} outputs. Merging...`);
        return [parsed.translations.join('\n')];
      }

      if (parsed.translations.length !== texts.length) {
        throw new Error(`Length mismatch: Expected ${texts.length}, got ${parsed.translations.length}`);
      }

      return parsed.translations;

    } catch (error: any) {
      console.warn(`Translation attempt ${attempt + 1} failed:`, error);
      attempt++;
      
      if (attempt === maxRetries) {
        throw error;
      }
      // Exponential backoff
      await wait(1000 * Math.pow(2, attempt - 1));
    }
  }

  throw new Error("Unexpected error in translation loop");
};
