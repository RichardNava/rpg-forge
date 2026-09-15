import type { ReactNode } from "react";

export interface CreationChoice {
  id: string;
  title: string;
  description: string;
  cta: string;
  badge?: string;
  disabled?: boolean;
}

interface CreationModeSelectorProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  choices: CreationChoice[];
  busy: boolean;
  error: string | null;
  onChoose(id: string): void;
  children?: ReactNode;
}

export function CreationModeSelector({
  eyebrow,
  title,
  subtitle,
  choices,
  busy,
  error,
  onChoose,
  children,
}: CreationModeSelectorProps) {
  return (
    <div className="character-workshop__landing">
      <div className="character-workshop__landing-heading">
        {eyebrow !== undefined && (
          <p className="character-workshop__landing-eyebrow">{eyebrow}</p>
        )}
        <h1 className="character-workshop__landing-title">{title}</h1>
        <p className="character-workshop__landing-subtitle">{subtitle}</p>
      </div>
      <div className="character-workshop__landing-choices">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={
              choice.disabled === true
                ? "character-workshop__landing-choice character-workshop__landing-choice--disabled"
                : "character-workshop__landing-choice"
            }
            onClick={() => onChoose(choice.id)}
            disabled={busy || choice.disabled === true}
          >
            <span className="character-workshop__landing-choice-title">
              {choice.title}
              {choice.badge !== undefined && (
                <span className="character-workshop__badge">
                  {choice.badge}
                </span>
              )}
            </span>
            <span className="character-workshop__landing-choice-description">
              {choice.description}
            </span>
            <span className="character-workshop__landing-choice-cta">
              {choice.cta}
            </span>
          </button>
        ))}
      </div>
      {error !== null && (
        <p className="character-workshop__dialog-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}