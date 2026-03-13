Product Requirements Document: Gmail Send MVP

1. Product Overview
   Gmail Send is a lightweight, single-page internal web application designed to automate the creation of customized email drafts in Gmail. The tool eliminates manual copy-pasting for high-volume startup outreach by merging a central template with a list of contact variables.

2. Tech Stack Recommendation
   Framework: Next.js (React) with App Router. This allows for both the frontend UI and the backend API routes (needed for Gmail API communication) to exist in one repository.

Styling: Tailwind CSS for rapid, simple, and readable UI construction.

Authentication & API: next-auth (for Google OAuth) and googleapis (official Node.js client for interacting with the Gmail API).

3. Core User Flow
   Authentication: The user logs into the application using their Google account to grant Gmail API permissions (https://www.googleapis.com/auth/gmail.compose).

Template Input: The user pastes a master email template into a text area. The template uses specific syntax for variables (e.g., {{FirstName}}, {{Company}}).

Data Entry: The user clicks an "Add Contact" button to create new rows in the UI. Each row contains input fields for Email, First Name, and Company.

Draft Generation: The user clicks a "Create Drafts" button. The application iterates through the rows, replaces the template variables with the row data, and pushes the drafts to the user's Gmail account.

Completion: The UI displays a success message. The user navigates to their native Gmail client to review, schedule, and send the drafts.

4. Functional Requirements
   4.1. Authentication Interface
   A simple login screen requiring Google OAuth.

The application must request scopes specifically for creating drafts, restricting access from reading or deleting existing emails if possible.

4.2. Frontend UI (Data & Template Entry)
Template Text Area: A large text area for the email body.

Subject Line Input: A standard text input for the email subject (which can also support variables).

Contact Table/List: A dynamic list of input rows.

Each row must have fields for Target Email, First Name, and Company.

Each row must have a "Delete" button to remove it.

A master "Add Row" button appends a new empty row to the list.

4.3. Logic & Variable Parsing
The application must scan the Subject Line and Template Text Area for exact string matches of {{FirstName}} and {{Company}}.

Before API execution, the application must validate that no fields in the active rows are left blank.

4.4. Gmail API Integration
The backend API route must construct a valid MIME (Multipurpose Internet Mail Extensions) email message for each row.

The API must call the gmail.users.drafts.create endpoint to generate the draft in the authenticated user's account.

The application must handle rate limiting or basic API errors and return a success/failure status to the frontend.

5. Out of Scope (MVP)
   Direct email dispatch.

In-app scheduling or delayed sending.

CSV upload functionality.

Rich text formatting (HTML) in the template editor; the MVP will use plain text formatting.

Database storage for past templates or contacts.
