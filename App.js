// Root decommission banner only.
// Active customer UI lives in ./aria-frontend/src/App.js.

import React from "react";

const shell = {
  minHeight: "100vh",
  margin: 0,
  background:
    "radial-gradient(circle at top, rgba(14,116,144,0.22), transparent 40%), linear-gradient(180deg, #07111a 0%, #04070d 100%)",
  color: "#e5eef7",
  fontFamily: "'Segoe UI', sans-serif",
  padding: "48px 24px",
};

const card = {
  maxWidth: 880,
  margin: "0 auto",
  background: "rgba(6, 14, 24, 0.88)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 24,
  padding: 32,
  boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
};

const pill = {
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: 999,
  background: "rgba(239, 68, 68, 0.14)",
  border: "1px solid rgba(239, 68, 68, 0.35)",
  color: "#fecaca",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  marginTop: 24,
};

const panel = {
  padding: 20,
  borderRadius: 18,
  background: "rgba(15, 23, 42, 0.72)",
  border: "1px solid rgba(148, 163, 184, 0.12)",
};

const code = {
  display: "block",
  marginTop: 8,
  color: "#7dd3fc",
  fontFamily: "'Consolas', monospace",
  fontSize: 13,
};

export default function App() {
  return (
    <main style={shell}>
      <section style={card}>
        <span style={pill}>Legacy Shell Decommissioned</span>
        <h1 style={{ fontSize: 40, lineHeight: 1.05, margin: "18px 0 12px" }}>HELIX XI has one active product architecture now.</h1>
        <p style={{ margin: 0, color: "#bfd0e3", fontSize: 16, lineHeight: 1.7 }}>
          This root app is no longer a compatibility console. The active customer product lives in <strong>`aria-frontend/`</strong>, the
          admin control plane lives in <strong>`aria-admin/`</strong>, and the secured backend lives in <strong>`server.js`</strong>.
        </p>

        <div style={grid}>
          <div style={panel}>
            <div style={{ fontSize: 13, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Customer UI</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>ARIA Frontend</div>
            <span style={code}>aria-frontend/</span>
            <span style={code}>http://localhost:3000</span>
          </div>

          <div style={panel}>
            <div style={{ fontSize: 13, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Admin UI</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>Mission Control</div>
            <span style={code}>aria-admin/</span>
            <span style={code}>http://localhost:3002</span>
          </div>

          <div style={panel}>
            <div style={{ fontSize: 13, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Backend</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>Secured API</div>
            <span style={code}>server.js</span>
            <span style={code}>http://localhost:3001</span>
          </div>
        </div>

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(148, 163, 184, 0.12)", color: "#9fb3c8", lineHeight: 1.7 }}>
          Local workflow:
          <span style={code}>npm run dev</span>
          This page exists only to prevent architectural drift and make the source of truth obvious.
        </div>
      </section>
    </main>
  );
}
