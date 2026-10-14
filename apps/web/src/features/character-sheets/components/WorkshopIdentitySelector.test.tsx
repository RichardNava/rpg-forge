// @vitest-environment jsdom

import {
  fireEvent,
  render,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";

describe("WorkshopIdentitySelector", () => {
  it("renders PC/NPC buttons with correct labels and pressed states", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        mode="pc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector('button[aria-label="Player Character"]');
    const npcButton = container.querySelector('button[aria-label="Non-Player Character"]');

    expect(pcButton).toBeTruthy();
    expect(npcButton).toBeTruthy();
    expect(pcButton?.getAttribute("aria-pressed")).toBe("true");
    expect(npcButton?.getAttribute("aria-pressed")).toBe("false");

    // Threat options not shown when PC
    expect(container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]')).toBeNull();

    container.remove();
  });

  it("shows threat options when NPC mode", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Render with NPC mode
    render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const npcButton = container.querySelector('button[aria-label="Non-Player Character"]');
    expect(npcButton?.getAttribute("aria-pressed")).toBe("true");

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeTruthy();

    // Threat buttons exist (5 levels: very-low, low, medium, elite, legendary)
    expect(threatGroup?.querySelectorAll("button").length).toBe(5);

    container.remove();
  });

  it("calls onChange with mode when clicking NPC button", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Start with PC
    render(
      <WorkshopIdentitySelector
        mode="pc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const npcButton = container.querySelector('button[aria-label="Non-Player Character"]');
    fireEvent.click(npcButton!);
    expect(onChange).toHaveBeenCalledWith({ mode: "npc" });

    container.remove();
  });

  it("calls onChange with mode when clicking PC button", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Start with NPC
    render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector('button[aria-label="Player Character"]');
    fireEvent.click(pcButton!);
    expect(onChange).toHaveBeenCalledWith({ mode: "pc" });

    container.remove();
  });

  it("calls onChange with threatLevel when selecting a threat level", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const veryLowButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Very Low",
    );
    fireEvent.click(veryLowButton!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: "very-low" });

    const lowButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Low",
    );
    fireEvent.click(lowButton!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: "low" });

    container.remove();
  });

  it("toggles threat level off when clicking the selected option", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Start with no threat selected
    render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const eliteButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Elite",
    );
    // First click selects it
    fireEvent.click(eliteButton!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: "elite" });
    // Re-render with elite selected
    const { unmount } = render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel="elite"
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );
    // Click again to toggle off
    const eliteButton2 = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Elite",
    );
    fireEvent.click(eliteButton2!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: null });

    unmount();
    container.remove();
  });

  it("displays selected threat option with pressed styling", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        mode="npc"
        threatLevel="elite"
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const eliteButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Elite",
    );
    expect(eliteButton?.getAttribute("aria-pressed")).toBe("true");
    expect(eliteButton?.classList.contains("character-workshop__identity-option--selected")).toBe(true);

    container.remove();
  });

  it("disables all controls when disabled prop is true", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        mode="pc"
        threatLevel={null}
        disabled={true}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector<HTMLButtonElement>('button[aria-label="Player Character"]');
    const npcButton = container.querySelector<HTMLButtonElement>('button[aria-label="Non-Player Character"]');

    expect(pcButton?.disabled).toBe(true);
    expect(npcButton?.disabled).toBe(true);

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeNull();

    container.remove();
  });
});