import { NextResponse } from "next/server";
import { processDueJobs } from "@/lib/scheduler";

export async function POST(request: Request) {
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerSecret) {
    console.error("WORKER_SECRET is not set; refusing to process jobs.");
    return NextResponse.json(
      { error: "Server misconfigured: WORKER_SECRET is required" },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${workerSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueJobs();
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("Error processing jobs:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
