export default {
  async scheduled(event, env, ctx) {
    const url = `${env.APP_URL}/api/jobs/process`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WORKER_SECRET}` },
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(`Job processor returned ${res.status}: ${body}`);
        return;
      }
      console.log(`Job processor ok: ${body}`);
    } catch (err) {
      console.error(`Failed to call job processor: ${err}`);
    }
  },
};
