import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { LanguageProvider, LanguageSwitch } from "./language";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <LanguageSwitch />
      <App />
    </LanguageProvider>
  </StrictMode>
);
