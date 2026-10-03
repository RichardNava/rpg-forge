import type { Metadata } from "next";
import { CharacterWorkshopV2Host } from "@/features/character-sheets/components/CharacterWorkshopV2Host";

export const metadata: Metadata = {
  title: "Character Sheet Workshop",
  description: "Draft, edit and confirm a character sheet without an account.",
};

export default function CharacterSheetsPage() {
  return (
    <main className="character-workshop">
      <CharacterWorkshopV2Host />
    </main>
  );
}
