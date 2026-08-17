import { DiceRoller } from "@/features/dice/components/dice-roller";

export const metadata = {
  title: "Dice Roller",
  description: "Roll tabletop dice without an account.",
};

export default function DicePage() {
  return <DiceRoller />;
}
