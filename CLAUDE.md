# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
```

There are no automated tests in this project.

## Environment Setup

Create `.env.local` with:
```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...   # generate with: openssl rand -base64 32
```

Google OAuth credentials need `https://www.googleapis.com/auth/gmail.compose` scope and redirect URI `http://localhost:3000/api/auth/callback/google`.

## Architecture

**Next.js App Router** app with two API routes and one main page. All UI state persists to localStorage.

### Core Flow

1. User authenticates via Google OAuth (next-auth). The access token is stored in the JWT and exposed on the session as `session.accessToken`.
2. User edits an email template (subject + HTML body) and a contacts table (email, firstName, company).
3. On submit, the frontend POSTs to `/api/drafts/create` with the template and contacts.
4. The backend substitutes `{{FirstName}}`, `{{Company}}`, `{{Signature}}` per-contact, builds a MIME message, base64url-encodes it, and calls `gmail.users.drafts.create()` for each contact.

### Key Files

- `src/app/page.tsx` — Main page: orchestrates auth state, localStorage sync, form validation, and draft creation API call.
- `src/app/api/drafts/create/route.ts` — Backend API: iterates contacts, performs template substitution, constructs MIME email, calls Gmail API.
- `src/lib/gmail.ts` — Gmail API logic: template processing, HTML escaping, MIME message construction, `cleanListHtml()` to strip `<p>` tags from list items (prevents Gmail margin issues).
- `src/lib/auth.ts` — NextAuth config: Google provider with `gmail.compose` scope, `access_type=offline`, JWT callback that stores `accessToken`.
- `src/components/RichTextEditor.tsx` — Tiptap WYSIWYG editor with custom font size extension (`src/lib/tiptap-font-size.ts`).
- `src/components/SignatureDialog.tsx` — Signature editor using hard breaks (not paragraph breaks) for tight Gmail line spacing.
- `src/hooks/useLocalStorage.ts` — Custom hook syncing React state to localStorage. Keys: `gmailsend_subject`, `gmailsend_body`, `gmailsend_signature`, `gmailsend_contacts`.

### Auth Pattern

Session is extended in `src/types/next-auth.d.ts` to include `accessToken`. The main page uses `useSession()` to gate the UI; the API route uses `getServerSession()` to retrieve the token for Gmail API calls.
