"use client";

import { useState } from "react";
import ProModal from "./ProModal";

interface ProBadgeProps {
  label: string;
  style?: React.CSSProperties;
}

export default function ProBadge({ label, style }: ProBadgeProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 99,
          border: "1px solid rgba(0,255,136,0.2)",
          background: "rgba(0,255,136,0.08)",
          color: "#00ff88",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "Segoe UI, Arial, sans-serif",
          transition: "all 0.15s",
          whiteSpace: "nowrap",
          ...style,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,255,136,0.15)";
          e.currentTarget.style.borderColor = "rgba(0,255,136,0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0,255,136,0.08)";
          e.currentTarget.style.borderColor = "rgba(0,255,136,0.2)";
        }}
      >
        ★ {label}
        <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 700 }}>Pro</span>
      </button>
      <ProModal open={showModal} onClose={() => setShowModal(false)} feature={label} />
    </>
  );
}
