"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import ProModal from "./ProModal";
import { useAuth } from "./AuthProvider";

export default function Header() {
  const [showProModal, setShowProModal] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoggedIn = !loading && !!user;

  // Surfaces white-label (Eurealimmo / cabinets / widgets embed) ont leur
  // propre branding — pas de header datamerry par-dessus.
  if (
    pathname?.startsWith("/mandataire/") ||
    pathname?.startsWith("/cabinets/") ||
    pathname?.startsWith("/chatbot/embed") ||
    pathname?.startsWith("/widget/")
  ) {
    return null;
  }

  return (
    <>
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1100,
          background: "rgba(10,10,30,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          fontFamily: "Segoe UI, Arial, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 20px",
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Logo */}
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ color: "#0a0a1e", fontWeight: 900, fontSize: 14 }}>D</span>
            </div>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>
              datamerry
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              fontSize: 13,
            }}
            className="hidden-mobile"
          >
            <Link href="/pricing" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
            >
              Pricing
            </Link>
            <Link href="/actualites" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
            >
              Nouveautés
            </Link>
            <span style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)" }} />

            {isLoggedIn ? (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                  {user?.user_metadata?.prenom ?? user?.email?.split("@")[0] ?? ""}
                </span>
                <button
                  onClick={async () => { await signOut(); router.push("/"); }}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: "rgba(255,255,255,0.35)", cursor: "pointer",
                    fontSize: 12, fontFamily: "inherit", transition: "color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6b6b")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                >
                  Déconnexion
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  style={{ color: "rgba(255,255,255,0.4)", textDecoration: "none", fontSize: 12, transition: "color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                >
                  Connexion
                </Link>
                <Link
                  href="/signup"
                  style={{ color: "rgba(255,255,255,0.4)", textDecoration: "none", fontSize: 12, transition: "color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                >
                  Créer un compte
                </Link>
              </>
            )}

            <button
              onClick={() => setShowProModal(true)}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                color: "#0a0a1e",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "Segoe UI, Arial, sans-serif",
                transition: "transform 0.15s, box-shadow 0.15s",
                boxShadow: "0 2px 12px rgba(0,212,255,0.2)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.04)";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,212,255,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,212,255,0.2)";
              }}
            >
              Essai Pro 14 jours
            </button>
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              padding: 8,
              display: "none",
            }}
            className="show-mobile"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div
            style={{
              background: "rgba(10,10,30,0.97)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Link href="/pricing" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: 14 }}>Pricing</Link>
            <Link href="/actualites" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: 14 }}>Nouveautés</Link>
            {isLoggedIn ? (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>{user?.user_metadata?.prenom ?? user?.email?.split("@")[0] ?? ""}</span>
                <button onClick={async () => { await signOut(); setMobileOpen(false); router.push("/"); }} style={{ background: "none", border: "none", color: "#ff6b6b", cursor: "pointer", fontSize: 13, fontFamily: "inherit", textAlign: "left", padding: 0 }}>Déconnexion</button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setMobileOpen(false)} style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 14 }}>Connexion</Link>
                <Link href="/signup" onClick={() => setMobileOpen(false)} style={{ color: "rgba(255,255,255,0.4)", textDecoration: "none", fontSize: 13 }}>Créer un compte</Link>
              </>
            )}
            <button
              onClick={() => { setShowProModal(true); setMobileOpen(false); }}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                color: "#0a0a1e",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                marginTop: 4,
              }}
            >
              Essai Pro 14 jours
            </button>
          </div>
        )}
      </header>

      <ProModal open={showProModal} onClose={() => setShowProModal(false)} />

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .hidden-mobile { display: none !important; }
          .show-mobile { display: block !important; }
        }
        @media (min-width: 769px) {
          .show-mobile { display: none !important; }
        }
      `}</style>
    </>
  );
}
