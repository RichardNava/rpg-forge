import type { Metadata } from "next";
import { CharacterWorkshop } from "@/features/character-sheets/components/CharacterWorkshop";

export const metadata: Metadata = {
  title: "Character Sheet Workshop",
  description: "Draft, edit and confirm a character sheet without an account.",
};

export default function CharacterSheetsPage() {
  return (
    <main className="character-workshop">
      <CharacterWorkshop />
    </main>
  );
}
