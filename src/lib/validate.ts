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
  }
  return null;
}
