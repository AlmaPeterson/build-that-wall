// On-device translation (Chrome's built-in translator) when the browser has it

interface Detector { detect(text: string): Promise<{ detectedLanguage: string }[]> }
interface TranslatorApi {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(text: string): Promise<string> }>;
}
interface TranslateGlobals {
  Translator?: TranslatorApi;
  LanguageDetector?: { create(): Promise<Detector> };
}

export interface Translation {
  text: string;
  /** The language it was written in, e.g. "es" */
  lang: string;
}

/** English text, or null if it's already English, the browser can't translate, or it took over 10 seconds. */
export async function translateOnDevice(text: string, api: TranslateGlobals = globalThis as TranslateGlobals): Promise<Translation | null> {
  try {
    const { Translator, LanguageDetector } = api;
    if (!Translator || !LanguageDetector) return null;
    const work = (async () => {
      const det = await LanguageDetector.create();
      const top = (await det.detect(text))[0];
      if (!top || top.detectedLanguage === 'en' || top.detectedLanguage === 'und') return null;
      const opts = { sourceLanguage: top.detectedLanguage, targetLanguage: 'en' };
      if ((await Translator.availability(opts)) === 'unavailable') return null;
      const tr = await Translator.create(opts);
      return { text: await tr.translate(text), lang: top.detectedLanguage };
    })();
    return await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 10000))]);
  } catch {
    return null;
  }
}
