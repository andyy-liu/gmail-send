import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createDraft, Contact } from "@/lib/gmail";
import { validateContacts, hasCRLF } from "@/lib/validate";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized or missing access token" }, { status: 401 });
    }

    const body = await request.json();
    const { subject, body: emailBody, signature, contacts } = body;

    if (!subject || !emailBody || !contacts || !Array.isArray(contacts)) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
    if (hasCRLF(subject)) {
      return NextResponse.json({ error: "Invalid characters in subject" }, { status: 400 });
    }
    const contactError = validateContacts(contacts);
    if (contactError) {
      return NextResponse.json({ error: contactError }, { status: 400 });
    }

    const results = [];
    const errors = [];

    // Process each contact
    for (const contact of contacts as Contact[]) {
      try {
        const draft = await createDraft(session.accessToken, contact, subject, emailBody, signature || undefined);
        results.push({ email: contact.email, draftId: draft.id });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error creating draft for ${contact.email}:`, err);
        errors.push({ email: contact.email, error: errorMessage });
      }
    }

    return NextResponse.json({ results, errors });
  } catch (err: unknown) {
    console.error("Critical error in draft creation route:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
