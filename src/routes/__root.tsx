import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Viral Analytics" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{globalCss}</style>
      </head>
      <body>
        <div className="app">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

const globalCss = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0b0c10; color: #e7e9ee; }
  a { color: inherit; }
  .app { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
  h1 { font-size: 24px; margin: 0 0 16px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 24px 0 12px; }
  .muted { color: #8b91a1; }
  .card { background: #14161d; border: 1px solid #232733; border-radius: 12px; padding: 16px; }
  .row { display: flex; gap: 12px; align-items: center; }
  .grid { display: grid; gap: 12px; }
  input[type=text], input[type=url] { background: #0f1117; border: 1px solid #232733; color: #e7e9ee; padding: 10px 12px; border-radius: 8px; font-size: 14px; flex: 1; }
  button { background: #3b82f6; color: white; border: 0; padding: 10px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }
  button.secondary { background: #232733; color: #e7e9ee; }
  button.danger { background: #2a1a1a; color: #ff8b8b; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #232733; font-size: 14px; }
  th { color: #8b91a1; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #232733; color: #c9cfdc; }
  .badge.tiktok { background: #1f1015; color: #ff5577; }
  .badge.instagram { background: #1a1320; color: #c084fc; }
`;
