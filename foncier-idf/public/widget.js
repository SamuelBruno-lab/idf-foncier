/* eslint-disable */
/**
 * DATAMERRY — Widget embed JS
 *
 * Intégration côté cabinet immobilier (1 ligne dans une page HTML) :
 *
 *   <script src="https://datamerry.com/widget.js" async></script>
 *
 *   <div data-datamerry-report
 *        data-key="wdmk_live_abc123..."
 *        data-address="10 rue de Paris 75001"
 *        data-surface="62"
 *        data-pieces="3"
 *        data-color="#1f3a8a"></div>
 *
 * Le script :
 *   1. Cherche toutes les <div data-datamerry-report> au load
 *   2. Pour chacune, fetch /api/widget/render avec les paramètres data-*
 *   3. Injecte le HTML retourné dans la div
 *   4. Injecte une seule fois la feuille de style globale
 *
 * Le script ne nécessite aucune dépendance. Compatible IE11+ (on évite les
 * features ES2017+ pour maximiser la portabilité sur les sites cabinets
 * souvent vieux Wordpress).
 */
(function () {
  "use strict";

  // Origin = domaine du script lui-même (datamerry.com en prod, localhost en dev)
  // On préfère récupérer dynamiquement plutôt que de hardcoder.
  function getApiBase() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("/widget.js") !== -1) {
        try {
          var u = new URL(src);
          return u.origin;
        } catch (e) {
          // ignore
        }
      }
    }
    return "https://datamerry.com";
  }

  var API_BASE = getApiBase();
  var STYLE_ID = "dm-widget-styles";

  // ────────────────────────────────────────────────────────────────────
  // Feuille de style (injectée une seule fois)
  // ────────────────────────────────────────────────────────────────────
  var CSS = [
    ".dm-widget{",
    "  --dm-primary:#1f3a8a;",
    "  --dm-bg:#ffffff;",
    "  --dm-text:#0f172a;",
    "  --dm-muted:#64748b;",
    "  --dm-border:#e2e8f0;",
    "  font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;",
    "  color:var(--dm-text);background:var(--dm-bg);",
    "  border:1px solid var(--dm-border);border-radius:16px;",
    "  padding:24px;max-width:720px;line-height:1.4;",
    "  box-shadow:0 4px 24px rgba(0,0,0,.04);",
    "}",
    ".dm-widget *{box-sizing:border-box;margin:0;padding:0;}",
    ".dm-widget__hdr{display:flex;justify-content:space-between;align-items:baseline;",
    "  padding-bottom:12px;border-bottom:1px solid var(--dm-border);margin-bottom:16px;}",
    ".dm-widget__cabinet{font-weight:700;font-size:18px;color:var(--dm-primary);}",
    ".dm-widget__by{font-size:11px;color:var(--dm-muted);text-transform:uppercase;letter-spacing:.05em;}",
    ".dm-widget__address h2{font-size:22px;font-weight:600;margin-bottom:4px;}",
    ".dm-widget__address .dm-meta{color:var(--dm-muted);font-size:14px;margin-bottom:16px;}",
    ".dm-widget__sv{width:100%;height:auto;max-height:240px;object-fit:cover;",
    "  border-radius:12px;margin-bottom:20px;}",
    ".dm-widget__main{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;}",
    ".dm-widget__card{background:#f8fafc;border-radius:12px;padding:16px;}",
    ".dm-widget__card h3{font-size:12px;font-weight:600;text-transform:uppercase;",
    "  letter-spacing:.05em;color:var(--dm-muted);margin-bottom:8px;}",
    ".dm-bignum{font-size:24px;font-weight:700;color:var(--dm-primary);line-height:1.1;}",
    ".dm-sub{font-size:13px;color:var(--dm-text);margin-top:4px;}",
    ".dm-mini{font-size:11px;color:var(--dm-muted);margin-top:6px;}",
    ".dm-widget__neighborhood{padding-top:16px;border-top:1px solid var(--dm-border);}",
    ".dm-widget__neighborhood h3{font-size:12px;font-weight:600;text-transform:uppercase;",
    "  letter-spacing:.05em;color:var(--dm-muted);margin-bottom:12px;}",
    ".dm-widget__scores{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}",
    ".dm-score{text-align:center;}",
    ".dm-score__val{display:block;font-size:22px;font-weight:700;color:var(--dm-primary);}",
    ".dm-score__max{font-size:13px;color:var(--dm-muted);font-weight:400;}",
    ".dm-score__lbl{display:block;font-size:11px;color:var(--dm-muted);margin-top:4px;}",
    ".dm-widget__ftr{margin-top:16px;padding-top:12px;border-top:1px solid var(--dm-border);",
    "  font-size:10px;color:var(--dm-muted);text-align:center;}",
    ".dm-error{padding:16px;color:#b91c1c;background:#fef2f2;border-color:#fecaca;}",
    ".dm-widget__loading{padding:32px;text-align:center;color:var(--dm-muted);font-size:14px;}",
  ].join("");

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(CSS));
    document.head.appendChild(style);
  }

  // ────────────────────────────────────────────────────────────────────
  // Render d'une div
  // ────────────────────────────────────────────────────────────────────
  function renderOne(div) {
    if (div.getAttribute("data-dm-rendered") === "1") return;
    div.setAttribute("data-dm-rendered", "1");

    var key = div.getAttribute("data-key") || "";
    var address = div.getAttribute("data-address") || "";
    var surface = div.getAttribute("data-surface") || "";
    var pieces = div.getAttribute("data-pieces") || "";
    var prixAchat = div.getAttribute("data-prix-achat") || "";
    var color = div.getAttribute("data-color") || "";

    if (!key) {
      div.innerHTML =
        '<div class="dm-widget dm-error">⚠️ Attribut <code>data-key</code> manquant. ' +
        'Récupère ta clé widget (wdmk_live_…) sur datamerry.com/dashboard.</div>';
      return;
    }
    if (!address) {
      div.innerHTML =
        '<div class="dm-widget dm-error">⚠️ Attribut <code>data-address</code> manquant.</div>';
      return;
    }

    // Placeholder loading
    div.innerHTML = '<div class="dm-widget"><div class="dm-widget__loading">Chargement DATAMERRY…</div></div>';

    var params = new URLSearchParams();
    params.set("address", address);
    if (surface) params.set("surface", surface);
    if (pieces) params.set("pieces", pieces);
    if (prixAchat) params.set("prix_achat", prixAchat);
    if (color) params.set("color", color);

    var url = API_BASE + "/api/widget/render?" + params.toString();

    fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "text/html" },
      credentials: "omit",
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            throw new Error("HTTP " + res.status + " " + text);
          });
        }
        return res.text();
      })
      .then(function (html) {
        div.innerHTML = html;
      })
      .catch(function (err) {
        console.error("[DATAMERRY widget]", err);
        div.innerHTML =
          '<div class="dm-widget dm-error">⚠️ Erreur de chargement DATAMERRY. ' +
          'Vérifiez la clé widget et l\'autorisation de domaine. ' +
          '<br><small>' + (err.message || "") + '</small></div>';
      });
  }

  // ────────────────────────────────────────────────────────────────────
  // Bootstrap : scan toutes les divs au DOMContentLoaded
  // ────────────────────────────────────────────────────────────────────
  function scanAndRender() {
    injectStylesOnce();
    var divs = document.querySelectorAll("[data-datamerry-report]");
    for (var i = 0; i < divs.length; i++) {
      renderOne(divs[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAndRender);
  } else {
    scanAndRender();
  }

  // API publique : window.DATAMERRY.rerender() pour SPA qui change le DOM
  window.DATAMERRY = window.DATAMERRY || {};
  window.DATAMERRY.rerender = scanAndRender;
})();
