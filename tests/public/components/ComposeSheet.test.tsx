// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { ComposeSheet } from "../../../src/public/components/compose/ComposeSheet";
import { openCompose, closeCompose } from "../../../src/public/stores/ui";
import { api } from "../../../src/public/lib/api";

beforeEach(() => {
  closeCompose();
  vi.spyOn(api, "listVoices").mockResolvedValue([{ _id: "alloy", title: "Alloy" }]);
  vi.spyOn(api, "listModels").mockResolvedValue(["tts-1"]);
});

describe("ComposeSheet", () => {
  it("does not render when closed", () => {
    const { container } = render(() => <ComposeSheet />);
    expect(container.querySelector(".sheet")).toBeNull();
  });

  it("renders form fields when opened", async () => {
    openCompose();
    const { findByPlaceholderText } = render(() => <ComposeSheet />);
    const textarea = await findByPlaceholderText("Text eingeben oder einfügen…");
    expect(textarea).toBeTruthy();
  });

  it("shows error when submitting empty text", async () => {
    openCompose();
    const { findByText, getByText } = render(() => <ComposeSheet />);
    const generate = await findByText("Generieren");
    fireEvent.click(generate);
    expect(getByText("Text darf nicht leer sein")).toBeTruthy();
  });
});
