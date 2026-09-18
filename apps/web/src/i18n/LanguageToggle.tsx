import { useLanguage } from "./language-context.js";

export function LanguageToggle() {
  const { lang, setLang, t } = useLanguage();

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => setLang(lang === "zh-TW" ? "en" : "zh-TW")}
      aria-label={t.languageToggleAriaLabel}
    >
      {t.languageToggleLabel}
    </button>
  );
}
