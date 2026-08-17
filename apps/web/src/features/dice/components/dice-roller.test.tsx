// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearDice: vi.fn(),
  diceBoxRoll: vi.fn(),
  initialize: vi.fn(),
  loadTheme: vi.fn(),
  loadSounds: vi.fn(),
  parseDiceNotation: vi.fn(),
  rollDice: vi.fn(),
  rollNotation: vi.fn(),
  setDimensions: vi.fn(),
  soundStates: [] as boolean[],
  themeCaches: [] as Record<string, unknown>[],
}));

vi.mock("@repo/dice-engine", () => ({
  DiceValidationError: class DiceValidationError extends Error {},
  MAX_DICE_PER_ROLL: 20,
  MAX_MODIFIER: 10000,
  MIN_MODIFIER: -10000,
  parseDiceNotation: mocks.parseDiceNotation,
  rollDice: mocks.rollDice,
  rollNotation: mocks.rollNotation,
}));

vi.mock("@3d-dice/dice-box-threejs", () => ({
  default: class DiceBox {
    DiceColors = { colorsets: { white: "cached" } };
    private soundEnabled = true;
    clearDice = mocks.clearDice;
    initialize = mocks.initialize;
    loadTheme = mocks.loadTheme;
    loadSounds = mocks.loadSounds;
    setDimensions = mocks.setDimensions;
    roll = async (notation: string) => mocks.diceBoxRoll(notation);

    constructor() {
      mocks.themeCaches.push(this.DiceColors.colorsets);
    }

    get sounds() {
      return this.soundEnabled;
    }

    set sounds(value: boolean) {
      this.soundEnabled = value;
      mocks.soundStates.push(value);
    }
  },
}));

import { DiceRoller } from "./dice-roller";
import {
  DiceTable3d,
  DICE_BOX_INITIALIZATION_TIMEOUT_MS,
  DICE_BOX_ROLL_TIMEOUT_MS,
  type DiceTableRoll,
} from "./dice-table-3d";
import { DEFAULT_DICE_THEME } from "../lib/dice-theme-options";

function result(dice: number[], modifier = 0, kept = dice) {
  const discarded = dice.filter((value, index) => {
    const keptCount = kept.filter((keptValue) => keptValue === value).length;
    return (
      dice.slice(0, index + 1).filter((die) => die === value).length > keptCount
    );
  });
  const subtotal = kept.reduce((total, value) => total + value, 0);
  return {
    dice,
    kept,
    discarded,
    modifier,
    subtotal,
    total: subtotal + modifier,
  };
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function facesFromNotation(notation: string) {
  const [, notationValues = ""] = notation.split("@");
  return notationValues.split(",").map((value) => ({ value: Number(value) }));
}

function diceBoxResponse(values: number[]) {
  return { sets: [{ rolls: values.map((value) => ({ value })) }] };
}

function tableRoll(
  id: number,
  notation: string,
  expectedValues: number[],
): DiceTableRoll {
  return {
    id,
    plan: { notation, expectedValues, visualDice: expectedValues.length },
    usesSupported3dDie: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = (value) => resolvePromise(value);
    reject = (reason) => rejectPromise(reason);
  });
  return { promise, reject, resolve };
}

function displayedTotal() {
  return screen.getByText("Total").parentElement?.querySelector("strong")
    ?.textContent;
}

function displayedSuccesses() {
  return screen.getByText("Successes").parentElement?.querySelector("strong")
    ?.textContent;
}

async function waitForResultActions() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Reroll" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

describe("DiceRoller", () => {
  beforeEach(() => {
    setReducedMotion(false);
    mocks.clearDice.mockReset();
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.loadTheme.mockReset().mockResolvedValue(undefined);
    mocks.loadSounds.mockReset().mockResolvedValue(undefined);
    mocks.rollDice.mockReset().mockReturnValue(result([12]));
    mocks.rollNotation.mockReset().mockReturnValue(result([3, 5], 4));
    mocks.setDimensions.mockReset();
    mocks.parseDiceNotation.mockReset().mockReturnValue({
      count: 2,
      sides: 6,
      modifier: 4,
    });
    mocks.soundStates.length = 0;
    mocks.themeCaches.length = 0;
    mocks.diceBoxRoll
      .mockReset()
      .mockImplementation((notation: string) =>
        Promise.resolve({ sets: [{ rolls: facesFromNotation(notation) }] }),
      );
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the configuration dock and a keyboard-operable 3D table", async () => {
    render(<DiceRoller />);

    expect(screen.getByRole("heading", { name: "Dice Roller" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Choose a die" })).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Dice" })).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Modifier" })).not.toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Success threshold" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("region", { name: "3D dice table" }),
    ).not.toBeNull();
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
  });

  it("moves from configuration to a verified result only after DiceBox completes", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    expect(
      screen.getByRole("button", { name: "Dice settling…" }),
    ).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(displayedTotal()).toBe("12");
    expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@12");
    expect(mocks.loadSounds).toHaveBeenCalled();
  });

  it("uses DiceBox's direct roll response for verification", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(displayedTotal()).toBe("12");
    expect(screen.queryByText(/could not be verified/)).toBeNull();
  });

  it("rerolls with the same configuration and a new engine result", async () => {
    mocks.rollDice
      .mockReturnValueOnce(result([12]))
      .mockReturnValueOnce(result([7]));
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() => expect(displayedTotal()).toBe("12"));
    await waitForResultActions();
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));

    await waitFor(() => expect(displayedTotal()).toBe("7"));
    expect(mocks.rollDice).toHaveBeenNthCalledWith(1, {
      count: 1,
      sides: 20,
      modifier: 0,
    });
    expect(mocks.rollDice).toHaveBeenNthCalledWith(2, {
      count: 1,
      sides: 20,
      modifier: 0,
    });
    expect(mocks.diceBoxRoll).toHaveBeenNthCalledWith(1, "1d20@12");
    expect(mocks.diceBoxRoll).toHaveBeenNthCalledWith(2, "1d20@7");
    expect(mocks.loadTheme).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the result after rolls and back to configuration after modify", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    const rollButton = screen.getByRole("button", { name: "Roll dice" });
    rollButton.focus();
    fireEvent.click(rollButton);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Resolved Roll" }),
      ),
    );
    await waitForResultActions();

    const reroll = screen.getByRole("button", { name: "Reroll" });
    reroll.focus();
    fireEvent.click(reroll);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Resolved Roll" }),
      ),
    );
    await waitForResultActions();

    const modify = screen.getByRole("button", { name: "Modify roll" });
    modify.focus();
    fireEvent.click(modify);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Dice Roller" }),
      ),
    );
  });

  it("serializes two immediate reroll clicks into one physical simulation", async () => {
    const secondRoll = deferred<unknown>();
    mocks.rollDice
      .mockReturnValueOnce(result([12]))
      .mockReturnValueOnce(result([7]))
      .mockReturnValueOnce(result([5]));
    mocks.diceBoxRoll
      .mockImplementationOnce(() => Promise.resolve(diceBoxResponse([12])))
      .mockImplementationOnce(() => secondRoll.promise);
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() => expect(displayedTotal()).toBe("12"));
    await waitForResultActions();

    const reroll = screen.getByRole("button", { name: "Reroll" });
    fireEvent.click(reroll);
    fireEvent.click(reroll);

    await waitFor(() => expect(mocks.diceBoxRoll).toHaveBeenCalledTimes(2));
    expect(mocks.rollDice).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondRoll.resolve(diceBoxResponse([7]));
    });
    await waitFor(() => expect(displayedTotal()).toBe("7"));
  });

  it("returns to configuration without discarding selected values", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("spinbutton", { name: "Dice" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Modifier" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );

    await waitForResultActions();

    fireEvent.click(screen.getByRole("button", { name: "Modify roll" }));

    expect(
      (screen.getByRole("spinbutton", { name: "Dice" }) as HTMLInputElement)
        .value,
    ).toBe("4");
    expect(
      (screen.getByRole("spinbutton", { name: "Modifier" }) as HTMLInputElement)
        .value,
    ).toBe("3");
  });

  it("resets configuration settings to their defaults", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "d6" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Dice" }), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Modifier" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Advanced notation" }));
    fireEvent.click(screen.getByRole("button", { name: "Visual settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Reset settings" }));

    expect(
      screen.getByRole("button", { name: "d20" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByRole("spinbutton", { name: "Dice" }) as HTMLInputElement)
        .value,
    ).toBe("1");
    expect(
      (screen.getByRole("spinbutton", { name: "Modifier" }) as HTMLInputElement)
        .value,
    ).toBe("0");
    expect(
      screen
        .getByRole("button", { name: "Advanced notation" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Visual settings" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("limits count to 20 and sends advantage or disadvantage requests to the engine", async () => {
    mocks.rollDice.mockReturnValue(result([18, 7], 3, [18]));
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    const count = screen.getByRole("spinbutton", {
      name: "Dice",
    }) as HTMLInputElement;
    fireEvent.change(count, { target: { value: "21" } });
    expect(count.value).toBe("20");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Modifier" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Advantage" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );

    expect(mocks.rollDice).toHaveBeenCalledWith({
      count: 2,
      sides: 20,
      modifier: 3,
      keepHighest: 1,
    });
    await waitForResultActions();
    fireEvent.click(screen.getByRole("button", { name: "Modify roll" }));
    fireEvent.click(screen.getByRole("button", { name: "Disadvantage" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(mocks.rollDice).toHaveBeenLastCalledWith({
      count: 2,
      sides: 20,
      modifier: 3,
      keepLowest: 1,
    });
  });

  it("supports advanced notation and keeps its engine result accessible", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Advanced notation/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Advanced notation" }),
      {
        target: { value: "2d6+4" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(mocks.rollNotation).toHaveBeenCalledWith("2d6+4");
    expect(screen.getByText("2d6+4")).not.toBeNull();
  });

  it("associates an invalid advanced notation error with the focused input", async () => {
    mocks.parseDiceNotation.mockImplementationOnce(() => {
      throw new Error("invalid notation");
    });
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Advanced notation/ }));
    const notation = screen.getByRole("textbox", {
      name: "Advanced notation",
    });
    fireEvent.change(notation, { target: { value: "not dice" } });
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText(/The dice could not be rolled/)).not.toBeNull(),
    );
    expect(notation.getAttribute("aria-describedby")).toContain("dice-error");
    expect(document.activeElement).toBe(notation);
  });

  it("applies colorset, texture, material, and sound settings to subsequent dice", async () => {
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Visual settings/ }));
    fireEvent.change(screen.getByLabelText("Texture"), {
      target: { value: "marble" },
    });
    fireEvent.change(screen.getByLabelText("Material"), {
      target: { value: "metal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn sound off" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(mocks.loadTheme).toHaveBeenCalledWith({
      colorset: "white",
      texture: "marble",
      material: "metal",
    });
    expect(mocks.soundStates).toContain(false);
    expect(mocks.themeCaches[0]).not.toHaveProperty("white");

    await waitForResultActions();
    fireEvent.click(screen.getByRole("button", { name: "Modify roll" }));
    fireEvent.change(screen.getByLabelText("Texture"), {
      target: { value: "paper" },
    });
    fireEvent.change(screen.getByLabelText("Material"), {
      target: { value: "glass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn sound on" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(mocks.loadTheme).toHaveBeenLastCalledWith({
        colorset: "white",
        texture: "paper",
        material: "glass",
      }),
    );
    expect(mocks.soundStates).toContain(true);
    expect(mocks.themeCaches).toHaveLength(1);
  });

  it("maps a d100 to physical percentile dice and keeps successes on the table", async () => {
    mocks.rollDice.mockReturnValue(result([37]));
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "d100" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Success threshold" }),
      { target: { value: "30" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d100+1d10@30,7");
    expect(screen.getByText("Total successes")).not.toBeNull();
  });

  it("evaluates each success after applying the roll modifier", async () => {
    mocks.rollDice.mockReturnValue(result([3, 2, 1], 2));
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "d6" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Dice" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Modifier" }), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Success threshold" }),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() => expect(displayedSuccesses()).toBe("1"));
    expect(screen.getByText("Total successes")).not.toBeNull();
  });

  it("uses an accessible engine fallback when WebGL initialization fails", async () => {
    mocks.initialize.mockRejectedValueOnce(new Error("WebGL unavailable"));
    render(<DiceRoller />);

    await waitFor(() =>
      expect(
        screen.getByText("3D visualization is unavailable in this browser."),
      ).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(screen.getByText(/3D visualization was unavailable/)).not.toBeNull();
    expect(mocks.diceBoxRoll).not.toHaveBeenCalled();
  });

  it("returns the engine result when DiceBox initialization times out", async () => {
    const initialization = deferred<void>();
    mocks.initialize.mockReturnValue(initialization.promise);
    vi.useFakeTimers();
    render(<DiceRoller />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.initialize).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DICE_BOX_INITIALIZATION_TIMEOUT_MS);
    });

    expect(screen.getByText("Resolved Roll")).not.toBeNull();
    expect(screen.getByText(/3D visualization was unavailable/)).not.toBeNull();
    expect(mocks.diceBoxRoll).not.toHaveBeenCalled();
  });

  it("returns the engine result and releases reroll when DiceBox roll times out", async () => {
    const stalledRoll = deferred<unknown>();
    mocks.diceBoxRoll.mockReturnValue(stalledRoll.promise);
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@12");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DICE_BOX_ROLL_TIMEOUT_MS);
    });

    expect(screen.getByText("Resolved Roll")).not.toBeNull();
    expect(screen.getByText(/3D visualization was unavailable/)).not.toBeNull();
    expect(mocks.clearDice).toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Reroll" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps mismatched dice visible for development diagnostics", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.rollDice
      .mockReturnValueOnce(result([12]))
      .mockReturnValueOnce(result([7]));
    mocks.diceBoxRoll
      .mockResolvedValueOnce({ sets: [{ rolls: [{ value: 1 }] }] })
      .mockImplementation((notation: string) =>
        Promise.resolve({ sets: [{ rolls: facesFromNotation(notation) }] }),
      );
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(displayedTotal()).toBe("12");
    expect(
      screen.getByText(/3D visualization could not be verified/),
    ).not.toBeNull();
    expect(screen.getByText("3D VERIFICATION MISMATCH")).not.toBeNull();
    expect(screen.getByText("Expected: 12")).not.toBeNull();
    expect(screen.getByText("DiceBox returned: 1")).not.toBeNull();
    expect(screen.getByText("Roll ID: 1")).not.toBeNull();
    expect(screen.getByText(/Presentation token:/)).not.toBeNull();
    expect(
      screen.getByText(
        /Compare these values with the faces physically visible/,
      ),
    ).not.toBeNull();
    expect(mocks.clearDice).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "[dice] 3D face verification failed.",
      expect.objectContaining({
        expectedValues: [12],
        notation: "1d20@12",
        returnedValues: [1],
        rollId: 1,
        visualDice: 1,
      }),
    );

    await waitForResultActions();
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));
    await waitFor(() => expect(displayedTotal()).toBe("7"));
    expect(mocks.diceBoxRoll).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("does not expose mismatch values outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.diceBoxRoll.mockResolvedValue({
      sets: [{ rolls: [{ value: 1 }] }],
    });
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(screen.queryByText("3D VERIFICATION MISMATCH")).toBeNull();
    expect(screen.queryByText("Expected: 12")).toBeNull();
    expect(screen.queryByText("DiceBox returned: 1")).toBeNull();
  });

  it("releases the lock after a DiceBox error", async () => {
    mocks.rollDice
      .mockReturnValueOnce(result([12]))
      .mockReturnValueOnce(result([7]));
    mocks.diceBoxRoll.mockRejectedValueOnce(new Error("renderer failed"));
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));
    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Reroll" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));

    await waitFor(() => expect(displayedTotal()).toBe("7"));
    expect(mocks.diceBoxRoll).toHaveBeenCalledTimes(2);
  });

  it("does not start a stale roll after its theme load resolves", async () => {
    const firstThemeLoad = deferred<void>();
    const onComplete = vi.fn();
    const first = tableRoll(1, "1d20@12", [12]);
    const second = tableRoll(2, "1d20@7", [7]);
    mocks.loadTheme.mockImplementationOnce(() => firstThemeLoad.promise);
    const { rerender } = render(
      <DiceTable3d
        activeRoll={first}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    await waitFor(() => expect(mocks.loadTheme).toHaveBeenCalledTimes(1));

    rerender(
      <DiceTable3d
        activeRoll={second}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );

    await act(async () => {
      firstThemeLoad.resolve();
    });

    await waitFor(() =>
      expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@7"),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(2, "physical"));
    expect(mocks.diceBoxRoll).not.toHaveBeenCalledWith("1d20@12");
  });

  it("waits for a layout frame before starting DiceBox physics", async () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const onComplete = vi.fn();
    render(
      <DiceTable3d
        activeRoll={tableRoll(1, "1d20@12", [12])}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );

    await waitFor(() => expect(frame).not.toBeNull());
    expect(mocks.diceBoxRoll).not.toHaveBeenCalled();

    await act(async () => {
      frame?.(0);
    });

    await waitFor(() =>
      expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@12"),
    );
    expect(onComplete).toHaveBeenCalledWith(1, "physical");
  });

  it("defers a table resize until active physics settles", async () => {
    const completion = deferred<unknown>();
    const onComplete = vi.fn();
    let onResize: ResizeObserverCallback = () => {
      throw new Error("ResizeObserver was not initialized.");
    };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }

        disconnect() {}
        observe() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    mocks.diceBoxRoll.mockImplementationOnce(() => completion.promise);
    render(
      <DiceTable3d
        activeRoll={tableRoll(1, "1d20@12", [12])}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );
    await waitFor(() =>
      expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@12"),
    );

    const dimensionsBeforeResize = mocks.setDimensions.mock.calls.length;
    onResize([] as ResizeObserverEntry[], {} as ResizeObserver);
    expect(mocks.setDimensions).toHaveBeenCalledTimes(dimensionsBeforeResize);

    await act(async () => {
      completion.resolve(diceBoxResponse([12]));
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(1, "physical"));
    expect(mocks.setDimensions.mock.calls.length).toBeGreaterThan(
      dimensionsBeforeResize,
    );
  });

  it("ignores a stale physical completion after a newer presentation token", async () => {
    const firstCompletion = deferred<unknown>();
    const onComplete = vi.fn();
    const first = tableRoll(1, "1d20@12", [12]);
    const second = tableRoll(2, "1d20@7", [7]);
    mocks.diceBoxRoll.mockImplementationOnce(() => firstCompletion.promise);
    const { rerender } = render(
      <DiceTable3d
        activeRoll={first}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );
    await waitFor(() =>
      expect(mocks.diceBoxRoll).toHaveBeenCalledWith("1d20@12"),
    );

    rerender(
      <DiceTable3d
        activeRoll={second}
        onComplete={onComplete}
        reduceMotion={false}
        successCount={null}
        theme={DEFAULT_DICE_THEME}
      />,
    );

    expect(mocks.diceBoxRoll).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstCompletion.resolve(diceBoxResponse([12]));
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(2, "physical"));
    expect(onComplete).not.toHaveBeenCalledWith(1, "physical");
    expect(onComplete).not.toHaveBeenCalledWith(1, "unverified");
  });

  it("skips physics for reduced motion while keeping sound preference independent", async () => {
    setReducedMotion(true);
    render(<DiceRoller />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Roll dice" }));

    await waitFor(() =>
      expect(screen.getByText("Resolved Roll")).not.toBeNull(),
    );
    expect(screen.getByText(/Physics animation was skipped/)).not.toBeNull();
    expect(mocks.diceBoxRoll).not.toHaveBeenCalled();
  });
});
