"use client";
import { useState } from "react";

export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function getUrl() {
    return typeof window !== "undefined" ? window.location.href : "https://datamerry.com";
  }

  function copyLink() {
    navigator.clipboard.writeText(getUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareWhatsapp() {
    const url = encodeURIComponent(getUrl());
    const txt = encodeURIComponent("Carte immobilière IA — datamerry.com ");
    window.open("https://wa.me/?text=" + txt + url, "_blank");
  }

  function shareInstagram() {
    navigator.clipboard.writeText(getUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  return (
    <div style={{ position: "fixed", bottom: "48px", right: "16px", zIndex: 9998 }}>
      {open && (
        <div style={{
          marginBottom: "8px",
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "12px",
          padding: "14px",
          width: "220px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "rgba(255,255,255,.4)", marginBottom: "4px" }}>
            Partager
          </div>
          <button onClick={copyLink} style={btnStyle}>
            <span style={iconStyle}>🔗</span>
            {copied ? "Lien copié !" : "Copier le lien"}
          </button>
          <button onClick={shareWhatsapp} style={btnStyle}>
            <span style={iconStyle}>💬</span> WhatsApp
          </button>
          <button onClick={shareInstagram} style={btnStyle}>
            <span style={iconStyle}>📸</span>
            {copied ? "Lien copié — collez dans Instagram" : "Instagram"}
          </button>
          <div style={{ fontSize: "9px", color: "rgba(255,255,255,.2)", lineHeight: 1.4 }}>
            Instagram : collez le lien dans votre story ou DM.
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "8px 14px", borderRadius: "20px",
          background: open ? "rgba(0,212,255,0.15)" : "rgba(10,10,30,0.85)",
          border: "1px solid " + (open ? "rgba(0,212,255,0.4)" : "rgba(255,255,255,0.15)"),
          color: open ? "#00d4ff" : "rgba(255,255,255,0.7)",
          fontSize: "12px", fontWeight: 700, cursor: "pointer",
          backdropFilter: "blur(8px)",
          fontFamily: "'Segoe UI', Arial, sans-serif",
          transition: "all .15s",
        }}
      >
        <span style={{ fontSize: "14px" }}>↗</span> Partager
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "8px",
  width: "100%", padding: "9px 12px", borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.05)",
  color: "#e8e8f0", fontSize: "12px", fontWeight: 600,
  cursor: "pointer", textAlign: "left",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  transition: "background .15s",
};

const iconStyle: React.CSSProperties = {
  fontSize: "15px", width: "20px", textAlign: "center", flexShrink: 0,
};
