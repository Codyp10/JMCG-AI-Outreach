import { GoogleGenerativeAI } from "@google/generative-ai";

/** Default model for copy-generate, reply classification, and QA (override with GEMINI_MODEL). */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export async function generateGeminiText(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userMessage: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const genAI = new GoogleGenerativeAI(params.apiKey);
  const model = genAI.getGenerativeModel({
    model: params.model,
    systemInstruction: params.systemInstruction,
  });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: params.userMessage }] }],
    generationConfig: {
      maxOutputTokens: params.maxOutputTokens ?? 2048,
      temperature: 0.7,
    },
  });
  const text = result.response.text();
  return text.trim();
}
