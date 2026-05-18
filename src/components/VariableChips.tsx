"use client";

import type { CustomVariable } from "@/lib/variables";
import { RESERVED_VARIABLE_NAMES } from "@/lib/variables";

interface VariableChipsProps {
  variables: CustomVariable[];
  onInsert: (token: string) => void;
  /** Whether to render the built-in tokens too. Defaults to true. */
  includeBuiltins?: boolean;
  className?: string;
}

export function VariableChips({
  variables,
  onInsert,
  includeBuiltins = true,
  className,
}: VariableChipsProps) {
  const enabledCustom = variables
    .filter((v) => v.enabled)
    .sort((a, b) => a.position - b.position);

  const builtins = includeBuiltins ? RESERVED_VARIABLE_NAMES : [];
  if (builtins.length === 0 && enabledCustom.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      <span className="text-[10px] uppercase tracking-wide text-neutral-400">Insert</span>
      {builtins.map((name) => (
        <button
          key={`builtin-${name}`}
          type="button"
          onMouseDown={(e) => {
            // Prevent focus loss so the insertion target keeps its selection.
            e.preventDefault();
            onInsert(`{{${name}}}`);
          }}
          className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-600 transition-colors"
        >
          {`{{${name}}}`}
        </button>
      ))}
      {enabledCustom.map((v) => (
        <button
          key={v.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onInsert(`{{${v.name}}}`);
          }}
          className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
    </div>
  );
}
