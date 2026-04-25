# Project Goal

Complete UI/UX redesign for "Gmail Send" – transitioning from a standard tab/form-based interface to a **flow-based automation canvas** (similar to Zapier/Customer.io).

The app adopts a strict "Notion-like" minimalist, monochromatic aesthetic.

---

# Design System & UI Specs

## Color Palette

Strictly Black, White, and Grays (`neutral` scale in Tailwind). **Light mode only.** Dark mode CSS vars should be stubbed but not implemented.

- Buttons: black with white text, or white with black borders. No blue/primary colors.
- **Semantic exceptions only:** Green = Success/Sent, Red = Error/Failed, Amber = Scheduled/Warning.

## Border Radius

Global `--radius` in `globals.css`: `0.25rem` (4px). "Almost sharp" rounded rectangles.

## Typography

Geist/Inter. `font-medium` or `font-semibold` for headers. `text-sm` for standard UI elements.

## Depth & Shadows

No soft drop shadows. Use crisp `1px` solid borders (`border-neutral-200`). Hover states use subtle background shifts (`hover:bg-neutral-100`) or crisp solid offset shadows (`shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`).

---

# Component Architecture: Shadcn First

- Never build UI components from scratch.
- All interface elements use **Shadcn UI** as the base.
- Install via CLI, then open the generated `components/ui` file and replace default Shadcn aesthetics (soft shadows, primary brand colors) with our sharp borders, monochromatic scheme, and minimal border radius.

---

# Layout

## Sidebar

- Collapsible (toggle button to collapse to icon rail).
- Fluid/responsive width — scales with screen size, never clips content.
- Lists all campaigns by name.
- **"+ New campaign" button** at top: clicking prompts an inline rename input directly in the sidebar, then opens that campaign's canvas.
- Each campaign item has a `...` menu (three-dot) with two actions: **Rename** and **Delete**.

## Canvas Area

- Takes remaining width after sidebar.
- **Dot grid background** (`<Background variant="dots" />` from React Flow).
- Nodes flow **top to bottom**, connected by **straight vertical lines**.
- Zoom controls (React Flow's default `<Controls />`).

## Drawer (Sheet)

- Slides in from the **right**, covering the right half of the screen. Does not push/compress the canvas — it overlaps it.
- Triggered by clicking any node.
- Contains **two tabs:**
  1. **Email** — Subject input, rich text body editor, send timing config (see below).
  2. **Recipients** — ContactTable (CSV upload + manual row addition).
- Close button (`X`) in top-right corner.

---

# Canvas Nodes

## Sequence Start Node

- Purely decorative root node at the top of every canvas.
- Displays "Sequence start" label.
- Not clickable. No interactions.

## Email Node (Initial & Follow-up)

Fixed-size rectangle card. Anatomy top to bottom:

```
┌─────────────────────────────────────┐
│ [TIMING BAR — neutral-200 bg]       │  ← e.g. "Send immediately" or "Send in 3 days"
├─────────────────────────────────────┤
│ ✉ Subject line truncated...  👥 12  │  ← email icon, truncated subject, people icon + count
│   Body preview text truncated...    │  ← first ~60 chars of body, gray, smaller text
│                          [status]   │  ← "Draft" / "Sent" / "Scheduled" badge
└─────────────────────────────────────┘
```

- **Top bar:** `bg-neutral-200`, dark text (`text-neutral-800`), `text-xs font-medium`. Shows timing label.
- **Body area:** white/neutral-50 background.
- **Subject line:** `text-sm font-medium`, truncated with ellipsis.
- **Body preview:** `text-xs text-neutral-400`, truncated.
- **Recipient count:** people icon + number, right-aligned in body row.
- **Status badge:** small pill — green for Sent, amber for Scheduled, neutral for Draft.
- **Hover state:** body area shifts to `bg-neutral-50`.
- **Selected state (drawer open):** body area shifts to `bg-neutral-100`, border becomes `border-neutral-400`.
- **`...` menu** on hover (top-right of card): single action — **Delete**.

## Ghost / Placeholder Node

- Shown at the bottom of the flow when no follow-up node exists yet.
- Visual: dashed border rectangle, neutral gray, centered `+` icon.
- Clicking it opens the drawer with empty fields to configure a new email step.

## "+" Add Follow-up Button

- Sits **below the last real node** in the flow, connected by a line.
- Clicking it appends a new Ghost Node below and opens the drawer.

---

# Drawer: Email Tab — Send Timing

The Email tab of the drawer contains send timing config above the subject/body editor.

**For the first (root) email node:**
- Radio or segmented control: **"Send immediately"** | **"Schedule"**
- If "Schedule": date + time picker appears.

**For follow-up nodes:**
- Field: **"Send X [days/hours] after previous step"** — number input + unit select (Days / Hours).
- Subject line input is **locked/read-only** (inherits parent subject to preserve Gmail thread).

---

# State Management

- React Flow nodes map 1:1 to `Batch` objects in `batches.ts`.
- Each node stores `position: { x, y }` for React Flow layout (top-to-bottom, auto-calculated).
- A React Flow **edge** represents the `parentBatchId` relationship.
- Follow-up nodes inherit `recipients` from parent; user can delete rows in the Recipients tab to exclude contacts.

---

# Toasts

Use **Sonner** for all status feedback. Always show a toast for:
- Campaign saved as draft
- Emails sent
- Send scheduled
- Any error

---

# Animation & Motion

## Drawer (Sheet)
- Slide in from right: `cubic-bezier(0.32, 0.72, 0, 1)` (iOS drawer curve), `300ms`.
- Slide out: `200ms ease-out` (asymmetric — exit faster than enter).

## Node entrance (when first appearing on canvas)
- `opacity: 0 → 1` + `scale: 0.97 → 1`, `150ms ease-out`.
- Never animate from `scale(0)`.

## Buttons (Send, Save, Schedule)
- `:active` state: `transform: scale(0.97)`, `transition: transform 100ms ease-out`.

## No animation on:
- Keyboard-triggered actions (none planned for now).
- Canvas pan/zoom (React Flow default).

## prefers-reduced-motion
- Wrap all transform-based animations in `@media (prefers-reduced-motion: no-preference)`.
- Keep opacity transitions even under reduced motion.

---

# Out of Scope (Do Not Implement)

- Drag-and-drop variable pills in editor. Keep `{{FirstName}}` text string insertion.
- Dedicated Contacts/Audience page. Contact management stays inside drawer Recipients tab.
- Email performance stats (open rate, click rate, reply rate) on node cards.
- Dark mode UI (CSS vars stubbed only).
- Keyboard shortcuts.
