// Markouts then the shadow report. Run by hand or by .github/workflows/bot-report.yml:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx bot/analysis/run.ts
// The repo is public and so are Actions logs: counts only; the report itself goes to the bot_reports table.

import { runMarkouts } from "./markouts";
import { runReport } from "./report";

export async function runAnalysis(): Promise<{ markouts: number; reportChars: number }> {
  let markouts = 0;
  for (let i = 0; i < 20; i++) {
    const r = await runMarkouts(120e3);
    markouts += r.done;
    if (!r.remaining) break;
  }
  const { body } = await runReport();
  return { markouts, reportChars: body.length };
}

if (process.argv[1]?.endsWith("analysis/run.ts")) runAnalysis().then((r) => console.log(`analysis: markouts ${r.markouts}, report ${r.reportChars} chars`)).catch((e) => {
  console.error(e instanceof Error ? e.message.split(":")[0] : "analysis failed");
  process.exit(1);
});
