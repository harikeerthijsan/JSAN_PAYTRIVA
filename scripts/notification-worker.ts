import "dotenv/config";
import { runNotificationJobs } from "../src/lib/notification-worker";

const pollIntervalMs = 30_000;
let stopping = false;

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

async function main() {
  console.info("PAYTRIVA notification worker started.");
  while (!stopping) {
    try {
      const result = await runNotificationJobs();
      if (result.reminders || result.paymentEvents || result.email.sent || result.email.failed) {
        console.info("PAYTRIVA notification worker completed a polling cycle.", result);
      }
    } catch (error) {
      console.error("PAYTRIVA notification worker cycle failed.", error);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  console.info("PAYTRIVA notification worker stopped.");
}

void main().catch((error: unknown) => {
  console.error("PAYTRIVA notification worker stopped unexpectedly.", error);
  process.exitCode = 1;
});
