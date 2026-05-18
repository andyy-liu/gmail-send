import { checkTemplateTokens, type CustomVariable } from "@/lib/variables";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hasCRLF(value: string): boolean {
  return /[\r\n]/.test(value);
}

export function validateContacts(contacts: unknown): string | null {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return "contacts must be a non-empty array";
  }
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i] as Record<string, unknown>;
    if (typeof c.email !== "string" || !c.email.trim()) return `Row ${i + 1}: email is required`;
    if (typeof c.firstName !== "string" || !c.firstName.trim()) return `Row ${i + 1}: firstName is required`;
    if (typeof c.company !== "string" || !c.company.trim()) return `Row ${i + 1}: company is required`;
    if (!isValidEmail(c.email)) return `Row ${i + 1}: invalid email address`;
    if (hasCRLF(c.email) || hasCRLF(c.firstName) || hasCRLF(c.company)) {
      return `Row ${i + 1}: field contains invalid characters`;
    }
    if (c.customFields !== undefined && (typeof c.customFields !== "object" || Array.isArray(c.customFields))) {
      return `Row ${i + 1}: customFields must be an object`;
    }
  }
  return null;
}

/**
 * Reject the send if subject/body reference any unknown or disabled custom
 * variable. Built-ins (FirstName/Company/Signature) are always allowed.
 */
export function validateTemplateTokens(
  subject: string,
  body: string,
  variables: CustomVariable[]
): string | null {
  const { unknown, disabled } = checkTemplateTokens(subject, body, variables);
  if (disabled.length) {
    return `Cannot send: template uses disabled variable(s) ${disabled.map((n) => `{{${n}}}`).join(", ")}. Re-enable them in the Variables panel or remove the references.`;
  }
  if (unknown.length) {
    return `Cannot send: template references unknown variable(s) ${unknown.map((n) => `{{${n}}}`).join(", ")}.`;
  }
  return null;
}
