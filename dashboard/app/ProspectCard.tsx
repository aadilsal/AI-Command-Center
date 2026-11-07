"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Loader2, Play, Send } from "lucide-react";

export default function ProspectCard() {
  const stats = useQuery(api.views.prospectStats);
  const runNow = useMutation(api.prospectAgent.runNow);
  const [busy, setBusy] = useState(false);
  const c = stats?.counts ?? {};

  return (
    <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/prospects" className="flex items-center gap-2 text-zinc-300 hover:text-zinc-100">
          <Send className="h-4 w-4" /> Prospect Engine — agencies to contact <span className="text-xs text-zinc-500">Open →</span>
        </Link>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await runNow();
            } finally {
              setTimeout(() => setBusy(false), 3000);
            }
          }}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {busy ? "Running" : "Run now"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Ready to send", c.Ready ?? 0, "text-green-400"],
          ["Follow-ups due", stats?.followUpsDue ?? 0, "text-orange-400"],
          ["Contacted", c.Contacted ?? 0, "text-zinc-100"],
          ["Replied", (c.Replied ?? 0) + (c.Meeting ?? 0), "text-purple-400"],
          ["Won", c.Won ?? 0, "text-green-400"],
        ].map(([label, value, cls]) => (
          <Link key={label as string} href="/prospects" className="rounded-lg bg-zinc-950 p-3 hover:bg-zinc-800/60">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className={`mt-1 text-xl font-semibold ${cls}`}>{value}</p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        {stats?.total ?? 0} agencies found · {c.New ?? 0} waiting for research · {stats?.sentTotal ?? 0} emails sent
      </p>
    </section>
  );
}
