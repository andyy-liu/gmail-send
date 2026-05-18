export interface CustomVariable {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
}

export const VARIABLE_NAME_MAX_LEN = 60;

export const RESERVED_VARIABLE_NAMES = ["FirstName", "Company", "Signature"] as const;
export const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_PATTERN.test(name);
}

export function isReservedName(name: string): boolean {
  return (RESERVED_VARIABLE_NAMES as readonly string[]).includes(name);
}

/** Extract the unique set of {{Token}} names referenced in a template string. */
export function extractTokens(template: string): string[] {
  if (!template) return [];
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(template)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

/**
 * Returns variable names referenced in subject+body that aren't allowed:
 * either unknown (not a built-in and not in `enabledNames`) or disabled.
 */
export function findInvalidTokens(
  subject: string,
  body: string,
  enabledNames: Set<string>
): { unknown: string[]; disabled: string[] } {
  const tokens = new Set<string>([...extractTokens(subject), ...extractTokens(body)]);
  const unknown: string[] = [];
  const disabled: string[] = [];
  for (const name of tokens) {
    if (isReservedName(name)) continue;
    if (enabledNames.has(name)) continue;
    // We can't tell unknown from disabled here without a 2nd set. Caller may
    // pass a superset (allNames) separately if it wants to distinguish; the
    // server differentiates via the API. For our use this is "unknown".
    unknown.push(name);
  }
  return { unknown, disabled };
}

/**
 * Like findInvalidTokens but distinguishes disabled vars (exist but turned off)
 * from unknown vars (no such variable defined).
 */
export function checkTemplateTokens(
  subject: string,
  body: string,
  variables: CustomVariable[]
): { unknown: string[]; disabled: string[] } {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const tokens = new Set<string>([...extractTokens(subject), ...extractTokens(body)]);
  const unknown: string[] = [];
  const disabled: string[] = [];
  for (const name of tokens) {
    if (isReservedName(name)) continue;
    const v = byName.get(name);
    if (!v) {
      unknown.push(name);
    } else if (!v.enabled) {
      disabled.push(name);
    }
  }
  return { unknown, disabled };
}

/** Rewrite every {{oldName}} occurrence to {{newName}} in a template string. */
export function renameTokensInTemplate(
  template: string,
  oldName: string,
  newName: string
): string {
  if (!template) return template;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g");
  return template.replace(re, `{{${newName}}}`);
}
