import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider, LanguageSwitch, useLanguage } from "./language";

function TranslationProbe() {
  const { t } = useLanguage();
  return <h1>{t("chooseAction")}</h1>;
}

describe("language switch", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("switches the interface to Chinese and persists the choice", async () => {
    render(
      <LanguageProvider>
        <LanguageSwitch />
        <TranslationProbe />
      </LanguageProvider>,
    );

    expect(screen.getByRole("heading", { name: "What would you like to do?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));

    expect(screen.getByRole("heading", { name: "你想做什么？" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("are-u-human.language")).toBe("zh"));
    expect(document.documentElement.lang).toBe("zh-CN");

    cleanup();
    render(
      <LanguageProvider>
        <LanguageSwitch />
        <TranslationProbe />
      </LanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "你想做什么？" })).toBeInTheDocument();
  });
});
