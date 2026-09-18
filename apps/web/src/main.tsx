import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { AuthGate } from "./AuthGate.js";
import { LanguageProvider } from "./i18n/language-context.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </LanguageProvider>
  </StrictMode>
);
