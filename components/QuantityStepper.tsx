"use client";

interface QuantityStepperProps {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
}

/**
 * Pill shaped quantity control matching the Stitch cart design.
 * Never allows a value below `min` (1) or above `max` (available stock).
 */
export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  disabled = false,
  size = "md",
  label = "Quantity",
}: QuantityStepperProps) {
  const upperBound = Math.max(min, max);
  const atMin = value <= min;
  const atMax = value >= upperBound;
  const blocked = disabled || upperBound <= min;

  const buttonSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const valueWidth = size === "sm" ? "w-7" : "w-9";
  const iconSize = size === "sm" ? "text-[15px]" : "text-[17px]";

  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center rounded-full bg-surface-container-highest p-1 shadow-inner"
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={blocked || atMin}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={`${buttonSize} flex items-center justify-center rounded-full bg-surface-container-low text-on-surface transition-colors hover:bg-surface-bright active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className={`material-symbols-outlined ${iconSize}`}>remove</span>
      </button>
      <span
        aria-live="polite"
        className={`${valueWidth} text-center font-title-md text-title-md font-bold text-on-surface`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={blocked || atMax}
        onClick={() => onChange(Math.min(upperBound, value + 1))}
        className={`${buttonSize} flex items-center justify-center rounded-full bg-surface-container-low text-on-surface transition-colors hover:bg-surface-bright active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className={`material-symbols-outlined ${iconSize}`}>add</span>
      </button>
    </div>
  );
}
