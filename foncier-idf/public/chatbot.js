/* eslint-disable */
/**
 * DATAMERRY Chatbot — Widget embed JS (iframe).
 *
 * Intégration côté cabinet immobilier — 4 lignes HTML :
 *
 *   <script src="https://datamerry.com/chatbot.js" async></script>
 *
 *   <div data-datamerry-chatbot
 *        data-key="wdmk_live_abcdef..."
 *        data-cabinet="Collabimmo"
 *        data-color="#c2410c"
 *        data-greeting="Bonjour, je suis l'assistant Collabimmo..."
 *        data-height="640"></div>
 *
 * Le script :
 *   1. Scan toutes les <div data-datamerry-chatbot> au load + DOMContentLoaded.
 *   2. Pour chacune, crée une <iframe> pointant vers /chatbot/embed avec les
 *      paramètres encodés en query string.
 *   3. Écoute postMessage('datamerry-chatbot-height', N) en provenance de
 *      l'iframe pour redimensionner automatiquement la hauteur.
 *
 * Avantages iframe vs injection directe :
 *   - Isolation CSS totale (pas de conflit avec le site cabinet).
 *   - Pas de pollution JS / globals.
 *   - La clé widget reste dans le contexte iframe DATAMERRY (pas de re-exposure
 *     au DOM du cabinet).
 *
 * Compatible IE11+. Aucune dépendance externe.
 */
(function () {
  "use strict";

  var STYLE_ID = "dm-chatbot-styles";
  var BOOTSTRAP_FLAG = "data-dm-chatbot-rendered";

  // Origin du script (datamerry.com en prod, localhost en dev)
  function getApiBase() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("/chatbot.js") !== -1) {
        try {
          return new URL(src).origin;
        } catch (e) {
          // ignore
        }
      }
    }
    return "https://datamerry.com";
  }
  var API_BASE = getApiBase();

  // CSS minimal injecté côté cabinet (juste le wrapper iframe)
  var CSS = [
    ".dm-chatbot-frame-wrap{",
    "  position:relative;",
    "  width:100%;",
    "  max-width:760px;",
    "  margin:0 auto;",
    "  border-radius:16px;",
    "  overflow:hidden;",
    "  box-shadow:0 4px 24px rgba(0,0,0,.06);",
    "  background:#ffffff;",
    "  border:1px solid #e2e8f0;",
    "}",
    ".dm-chatbot-frame{",
    "  width:100%;",
    "  border:none;",
    "  display:block;",
    "  min-height:520px;",
    "  background:transparent;",
    "  transition:height .25s ease;",
    "}",
    ".dm-chatbot-loading{",
    "  padding:40px 24px;",
    "  text-align:center;",
    "  color:#94a3b8;",
    "  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "  font-size:13px;",
    "}",
  ].join("");

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(CSS));
    document.head.appendChild(style);
  }

  // Construit l'URL /chatbot/embed avec params
  function buildEmbedUrl(div) {
    var key = div.getAttribute("data-key") || "";
    var cabinet = div.getAttribute("data-cabinet") || "";
    var color = div.getAttribute("data-color") || "";
    var greeting = div.getAttribute("data-greeting") || "";

    var params = [];
    if (key) params.push("key=" + encodeURIComponent(key));
    if (cabinet) params.push("cabinet=" + encodeURIComponent(cabinet));
    if (color) params.push("color=" + encodeURIComponent(color));
    if (greeting) params.push("greeting=" + encodeURIComponent(greeting));

    return API_BASE + "/chatbot/embed?" + params.join("&");
  }

  // Render une div en iframe
  function renderOne(div) {
    if (div.getAttribute(BOOTSTRAP_FLAG) === "1") return;
    div.setAttribute(BOOTSTRAP_FLAG, "1");

    var key = div.getAttribute("data-key");
    if (!key || (key.indexOf("dmk_") !== 0 && key.indexOf("wdmk_") !== 0)) {
      div.innerHTML =
        '<div class="dm-chatbot-loading" style="color:#991b1b;background:#fef2f2;border:1px dashed #fecaca;border-radius:8px;">' +
        "&#9888;&#65039; Attribut <code>data-key</code> manquant ou invalide. " +
        "Récupérez votre clé widget (wdmk_live_…) auprès de DATAMERRY." +
        "</div>";
      return;
    }

    // Wrapper + placeholder
    var wrap = document.createElement("div");
    wrap.className = "dm-chatbot-frame-wrap";

    var loading = document.createElement("div");
    loading.className = "dm-chatbot-loading";
    loading.textContent = "Chargement de l'assistant DATAMERRY…";
    wrap.appendChild(loading);

    // Iframe
    var iframe = document.createElement("iframe");
    iframe.className = "dm-chatbot-frame";
    iframe.title = "Assistant IA DATAMERRY";
    iframe.setAttribute("allowtransparency", "true");
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups",
    );
    iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
    iframe.style.opacity = "0";

    var initialHeight = parseInt(div.getAttribute("data-height") || "640", 10);
    iframe.style.height = (initialHeight > 0 ? initialHeight : 640) + "px";

    iframe.onload = function () {
      // Cache le placeholder + fade-in iframe
      try {
        wrap.removeChild(loading);
      } catch (e) {}
      iframe.style.opacity = "1";
    };
    iframe.src = buildEmbedUrl(div);
    wrap.appendChild(iframe);

    // Remplace le contenu de la div hôte par le wrapper
    div.innerHTML = "";
    div.appendChild(wrap);

    // Sauvegarde la référence pour le resize handler
    div._dmIframe = iframe;
  }

  // Listener postMessage pour auto-resize
  function setupResizeListener() {
    if (window._dmChatbotResizeAttached) return;
    window._dmChatbotResizeAttached = true;

    window.addEventListener("message", function (event) {
      // Vérifie que le message vient bien de DATAMERRY
      if (!event.origin || event.origin.indexOf(API_BASE) !== 0) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "datamerry-chatbot-height") return;
      if (typeof data.height !== "number" || data.height < 100) return;

      // Cherche l'iframe émettrice et ajuste sa hauteur
      var iframes = document.getElementsByClassName("dm-chatbot-frame");
      for (var i = 0; i < iframes.length; i++) {
        var f = iframes[i];
        if (f.contentWindow === event.source) {
          var newH = Math.min(data.height + 8, 1200); // cap à 1200px
          f.style.height = newH + "px";
          break;
        }
      }
    });
  }

  // Bootstrap : scan + render
  function scanAndRender() {
    injectStylesOnce();
    setupResizeListener();
    var divs = document.querySelectorAll("[data-datamerry-chatbot]");
    for (var i = 0; i < divs.length; i++) {
      renderOne(divs[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAndRender);
  } else {
    scanAndRender();
  }

  // API publique : window.DATAMERRY_CHATBOT.rerender() pour SPA
  window.DATAMERRY_CHATBOT = window.DATAMERRY_CHATBOT || {};
  window.DATAMERRY_CHATBOT.rerender = scanAndRender;
})();
