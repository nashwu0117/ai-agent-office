import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LANGUAGE_STORAGE_KEY, translations, type Lang, type Translations } from "./translations.js";

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "zh-TW" ? stored : null;
  } catch {
    // localStorage can throw (private browsing, blocked storage) — fall
    // back to the default language rather than crash the app over it.
    return null;
  }
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Default is zh-TW (the user's current language) when nothing has been
  // chosen before; a returning visitor's last choice always wins.
  const [lang, setLangState] = useState<Lang>(() => readStoredLang() ?? "zh-TW");

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({ lang, setLang, t: translations[lang] }), [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
