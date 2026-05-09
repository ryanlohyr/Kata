import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { addVideo, deleteVideo, listVideos } from "~/server/functions";
import { compactNumber, relativeTime } from "~/lib/format";

export const Route = createFileRoute("/")({
  loader: async () => listVideos(),
  component: Dashboard,
});

function Dashboard() {
  const videos = Route.useLoaderData();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addVideo({ data: { url } });
      setUrl("");
      router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Stop tracking this video and delete its history?")) return;
    await deleteVideo({ data: { id } });
    router.invalidate();
  }

  return (
    <>
      <h1>Viral Analytics</h1>
      <p className="muted">Paste a TikTok or Instagram Reel link to start tracking.</p>

      <form onSubmit={onSubmit} className="row" style={{ marginTop: 16 }}>
        <input
          type="url"
          placeholder="https://www.tiktok.com/@... or https://www.instagram.com/reel/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Track"}
        </button>
      </form>
      {error && <p style={{ color: "#ff8b8b", marginTop: 8 }}>{error}</p>}

      <h2>Tracked videos ({videos.length})</h2>
      {videos.length === 0 ? (
        <div className="card muted">No videos yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Video</th>
                <th>Views</th>
                <th>Likes</th>
                <th>Comments</th>
                <th>Last poll</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v: any) => (
                <tr key={v.id}>
                  <td>
                    <span className={`badge ${v.platform}`}>{v.platform}</span>
                  </td>
                  <td>
                    <Link to="/videos/$videoId" params={{ videoId: v.id }}>
                      {v.author_username ? `@${v.author_username}` : v.external_id}
                    </Link>
                    <div className="muted" style={{ fontSize: 12, maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {v.caption ?? v.url}
                    </div>
                  </td>
                  <td>{compactNumber(v.latest?.views)}</td>
                  <td>{compactNumber(v.latest?.likes)}</td>
                  <td>{compactNumber(v.latest?.comments)}</td>
                  <td className="muted">{relativeTime(v.last_polled_at)}</td>
                  <td>
                    <button className="danger" onClick={() => onDelete(v.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
