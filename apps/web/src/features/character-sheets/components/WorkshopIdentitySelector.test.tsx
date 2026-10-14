// @vitest-environment jsdom

import {
  fireEvent,
  render,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";

describe("WorkshopIdentitySelector", () => {
  it("renders mode display with correct labels", () => {
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

    // PC mode displays "Player Character"
    const pcDisplay = container.querySelector(".character-workshop__identity-value");
    expect(pcDisplay?.textContent?.trim()).toBe("Player Character");

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

    const npcDisplay = container.querySelector(".character-workshop__identity-value");
    expect(npcDisplay?.textContent?.trim()).toBe("Non-Player Character");

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeTruthy();

    // Threat buttons exist (5 levels: very-low, low, medium, elite, legendary)
    expect(threatGroup?.querySelectorAll("button").length).toBe(5);

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

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeNull();

    container.remove();
  });
});