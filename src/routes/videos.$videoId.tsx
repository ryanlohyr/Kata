import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getVideo, pollNow } from "~/server/functions";
import { compactNumber, relativeTime } from "~/lib/format";

export const Route = createFileRoute("/videos/$videoId")({
  loader: async ({ params }) => getVideo({ data: { id: params.videoId } }),
  component: VideoDetail,
});

type Bucket = "minute" | "hour" | "day";

function VideoDetail() {
  const { video, snapshots } = Route.useLoaderData();
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>("hour");
  const [busy, setBusy] = useState(false);

  const series = useMemo(() => bucketSnapshots(snapshots, bucket), [snapshots, bucket]);
  const latest = snapshots.at(-1);

  async function refresh() {
    setBusy(true);
    try {
      await pollNow({ data: { id: video.id } });
      router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link to="/" className="muted">
        ← back
      </Link>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <h1 style={{ marginBottom: 4 }}>
          <span className={`badge ${video.platform}`}>{video.platform}</span>{" "}
          {video.author_username ? `@${video.author_username}` : video.external_id}
        </h1>
        <button onClick={refresh} disabled={busy}>
          {busy ? "Polling…" : "Poll now"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        <a href={video.url} target="_blank" rel="noreferrer">
          {video.url}
        </a>
      </p>
      {video.caption && <p>{video.caption}</p>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 16 }}>
        <Stat label="Views" value={latest?.views} />
        <Stat label="Likes" value={latest?.likes} />
        <Stat label="Comments" value={latest?.comments} />
        <Stat label="Shares" value={latest?.shares} />
      </div>

      <div className="row" style={{ marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>Over time</h2>
        <div style={{ flex: 1 }} />
        {(["minute", "hour", "day"] as const).map((b) => (
          <button
            key={b}
            className={b === bucket ? "" : "secondary"}
            onClick={() => setBucket(b)}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, height: 320 }}>
        {series.length < 2 ? (
          <div className="muted" style={{ height: "100%", display: "grid", placeItems: "center" }}>
            Need at least 2 snapshots to plot. Last poll: {relativeTime(video.last_polled_at)}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid stroke="#232733" />
              <XAxis dataKey="t" tickFormatter={(t) => formatTick(t, bucket)} stroke="#8b91a1" />
              <YAxis tickFormatter={(v) => compactNumber(v)} stroke="#8b91a1" />
              <Tooltip
                contentStyle={{ background: "#14161d", border: "1px solid #232733" }}
                labelFormatter={(t) => new Date(t).toLocaleString()}
              />
              <Line type="monotone" dataKey="views" stroke="#3b82f6" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="likes" stroke="#ef4444" dot={false} strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="comments"
                stroke="#a78bfa"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        {snapshots.length} snapshots since first seen{" "}
        {relativeTime(video.first_seen_at)}.
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.04 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{compactNumber(value)}</div>
    </div>
  );
}

// Bucket snapshots by minute / hour / day. We take the last value in each bucket
// (cumulative metrics like views are monotonic, so "last" = "value at end of bucket").
function bucketSnapshots(snapshots: any[], bucket: Bucket): any[] {
  const grouped = new Map<number, any>();
  for (const s of snapshots) {
    const t = bucketTime(new Date(s.scraped_at), bucket);
    grouped.set(t, { ...s, t });
  }
  return [...grouped.values()].sort((a, b) => a.t - b.t);
}

function bucketTime(d: Date, bucket: Bucket): number {
  const x = new Date(d);
  x.setSeconds(0, 0);
  if (bucket === "minute") return x.getTime();
  x.setMinutes(0);
  if (bucket === "hour") return x.getTime();
  x.setHours(0);
  return x.getTime();
}

function formatTick(t: number, bucket: Bucket): string {
  const d = new Date(t);
  if (bucket === "day") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bucket === "hour")
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
