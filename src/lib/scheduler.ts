import fs from "fs";
import path from "path";
import { OAuth2Client } from "google-auth-library";
import { sendMessage } from "./gmail";
import type { Contact } from "./gmail";

export interface ScheduledJob {
  id: string;
  scheduledAt: string; // ISO 8601
  subject: string;
  body: string;
  signature: string;
  contacts: Contact[];
  refreshToken: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_FILE = path.join(DATA_DIR, "scheduled-jobs.json");

function readJobs(): ScheduledJob[] {
  try {
    if (!fs.existsSync(JOBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")) as ScheduledJob[];
  } catch {
    return [];
  }
}

function writeJobs(jobs: ScheduledJob[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain access token from refresh token");
  return token;
}

async function processJobs(): Promise<void> {
  const jobs = readJobs();
  if (jobs.length === 0) return;

  const now = new Date();
  const due = jobs.filter((j) => new Date(j.scheduledAt) <= now);
  if (due.length === 0) return;

  const remaining = jobs.filter((j) => new Date(j.scheduledAt) > now);

  for (const job of due) {
    try {
      const accessToken = await getAccessToken(job.refreshToken);
      for (const contact of job.contacts) {
        try {
          await sendMessage(accessToken, contact, job.subject, job.body, job.signature || undefined);
        } catch (err) {
          console.error(`[scheduler] Failed to send to ${contact.email} (job ${job.id}):`, err);
        }
      }
      console.log(`[scheduler] Processed job ${job.id} (${job.contacts.length} recipients)`);
    } catch (err) {
      console.error(`[scheduler] Failed to process job ${job.id}:`, err);
      // Keep failed jobs in the remaining list to avoid data loss
      remaining.push(job);
    }
  }

  writeJobs(remaining);
}

let intervalStarted = false;

function ensureInterval(): void {
  if (intervalStarted) return;
  intervalStarted = true;
  // Run immediately on start, then every 60s
  processJobs().catch(console.error);
  setInterval(() => processJobs().catch(console.error), 60_000);
}

export function addJob(job: ScheduledJob): void {
  const jobs = readJobs();
  jobs.push(job);
  writeJobs(jobs);
  ensureInterval();
}

export function listJobs(): Omit<ScheduledJob, "refreshToken">[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return readJobs().map(({ refreshToken: _rt, ...rest }) => rest);
}

export function removeJob(id: string): boolean {
  const jobs = readJobs();
  const next = jobs.filter((j) => j.id !== id);
  if (next.length === jobs.length) return false;
  writeJobs(next);
  return true;
}

export function removeAllJobs(): number {
  const jobs = readJobs();
  writeJobs([]);
  return jobs.length;
}

// Auto-start on import so existing jobs are picked up after a server restart
ensureInterval();
