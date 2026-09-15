// @vitest-environment jsdom

import {
  fireEvent,
  render,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";

describe("WorkshopIdentitySelector", () => {
  it("renders PC/NPC segmented control with correct labels and pressed states", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        characterType="pc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector('button[aria-label="Player character"]');
    const npcButton = container.querySelector('button[aria-label="Non-player character"]');

    expect(pcButton).toBeTruthy();
    expect(npcButton).toBeTruthy();
    expect(pcButton?.getAttribute("aria-pressed")).toBe("true");
    expect(npcButton?.getAttribute("aria-pressed")).toBe("false");

    // Threat options not shown when PC selected
    expect(container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]')).toBeNull();

    container.remove();
  });

  it("shows threat options when NPC is selected", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Render with NPC from the start to test threat options
    render(
      <WorkshopIdentitySelector
        characterType="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeTruthy();

    // Threat buttons exist
    expect(threatGroup?.querySelectorAll("button").length).toBe(4);

    container.remove();
  });

  it("calls onChange with characterType when clicking NPC, then re-render shows threat", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Start with PC
    render(
      <WorkshopIdentitySelector
        characterType="pc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const npcButton = container.querySelector('button[aria-label="Non-player character"]');
    fireEvent.click(npcButton!);
    expect(onChange).toHaveBeenCalledWith({ characterType: "npc" });

    // Re-render with NPC to verify threat options appear
    const { unmount } = render(
      <WorkshopIdentitySelector
        characterType="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const threatGroup = container.querySelector('[role="group"][aria-labelledby="workshop-identity-threat-label"]');
    expect(threatGroup).toBeTruthy();
    expect(threatGroup?.querySelectorAll("button").length).toBe(4);

    unmount();
    container.remove();
  });

  it("calls onChange with threatLevel when selecting a threat level", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        characterType="npc"
        threatLevel={null}
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const commonButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Common",
    );
    fireEvent.click(commonButton!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: "common" });

    const veteranButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Veteran",
    );
    fireEvent.click(veteranButton!);
    expect(onChange).toHaveBeenCalledWith({ threatLevel: "veteran" });

    container.remove();
  });

  it("toggles threat level off when clicking the selected option", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Start with no threat selected
    render(
      <WorkshopIdentitySelector
        characterType="npc"
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
        characterType="npc"
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

  it("resets threat to null when switching to PC", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        characterType="npc"
        threatLevel="elite"
        disabled={false}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector('button[aria-label="Player character"]');
    fireEvent.click(pcButton!);
    expect(onChange).toHaveBeenCalledWith({ characterType: "pc", threatLevel: null });

    container.remove();
  });

  it("disables all controls when disabled prop is true", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        characterType="pc"
        threatLevel={null}
        disabled={true}
        onChange={onChange}
      />,
      { container },
    );

    const pcButton = container.querySelector<HTMLButtonElement>('button[aria-label="Player character"]');
    const npcButton = container.querySelector<HTMLButtonElement>('button[aria-label="Non-player character"]');

    expect(pcButton?.disabled).toBe(true);
    expect(npcButton?.disabled).toBe(true);

    container.remove();
  });

  it("displays selected threat option with pressed styling", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <WorkshopIdentitySelector
        characterType="npc"
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
});