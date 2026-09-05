import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Exit Keepa | Automated DeFi exits";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ background: "#0b1713", color: "#f3f7f5", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", width: "100%", height: "100%" }}>
        <div style={{ color: "#8ef0c5", fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>EXIT KEEPA</div>
        <div style={{ marginTop: 24, fontSize: 72, fontWeight: 800, lineHeight: 1.05 }}>Set your exit.<br />Walk away.</div>
        <div style={{ marginTop: 28, color: "#b9c9c2", fontSize: 30 }}>Automated DeFi exits through your Safe on Base.</div>
      </div>
    ),
    size,
  );
}
