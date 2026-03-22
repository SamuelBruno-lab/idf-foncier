import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const DEPT_REPOS: Record<string, string> = {
  "60": "oise-foncier",
  "75": "paris-foncier",
  "77": "seine-et-marne-foncier",
  "78": "yvelines-foncier",
  "91": "essonne-foncier",
  "92": "hauts-de-seine-foncier",
  "93": "seine-saint-denis-foncier",
  "94": "val-de-marne-foncier",
  "95": "val-d-oise-foncier",
};

/* Mobile-friendly CSS/JS: collapse the stats panel on small screens */
const MOBILE_FIX = `
<style>
@media (max-width: 640px) {
  [id^="dash"] {
    width: calc(100vw - 16px) !important;
    max-width: 360px !important;
    top: auto !important;
    bottom: 8px !important;
    left: 8px !important;
    max-height: 55vh !important;
    overflow: hidden !important;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    border-radius: 14px !important;
  }
  /* When collapsed: only the handle bar (48px) is visible */
  [id^="dash"].dm-collapsed {
    max-height: 48px !important;
    overflow: hidden !important;
  }
  [id^="dash"].dm-hidden {
    max-height: 0 !important;
    opacity: 0 !important;
    pointer-events: none !important;
    bottom: -10px !important;
  }
  /* Full-width handle bar at the top - always visible, easy to tap */
  .dm-handle-bar {
    display: flex !important;
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    height: 48px;
    min-height: 48px;
    background: linear-gradient(135deg, rgba(0,212,255,0.12), rgba(0,180,220,0.08));
    border-bottom: 1px solid rgba(0,212,255,0.25);
    align-items: center;
    justify-content: center;
    cursor: pointer;
    -webkit-tap-highlight-color: rgba(0,212,255,0.2);
    gap: 8px;
    padding: 0 16px;
    box-sizing: border-box;
  }
  .dm-handle-bar:active {
    background: rgba(0,212,255,0.22);
  }
  /* Drag-style indicator pill */
  .dm-handle-pill {
    width: 36px;
    height: 4px;
    border-radius: 3px;
    background: rgba(0,212,255,0.5);
    flex-shrink: 0;
  }
  .dm-handle-label {
    color: #00d4ff;
    font-size: 13px;
    font-weight: 700;
    font-family: 'Segoe UI', system-ui, sans-serif;
    flex-shrink: 0;
  }
  .dm-handle-arrow {
    color: #00d4ff;
    font-size: 16px;
    flex-shrink: 0;
    transition: transform 0.3s ease;
  }
  [id^="dash"].dm-collapsed .dm-handle-arrow {
    transform: rotate(180deg);
  }
  /* Scrollable content area below the handle */
  .dm-content-wrap {
    overflow-y: auto !important;
    max-height: calc(55vh - 48px) !important;
    -webkit-overflow-scrolling: touch;
  }
  .dm-mobile-show-btn {
    display: flex !important;
  }
  /* Leaflet popups: make close button bigger on mobile */
  .leaflet-popup-close-button {
    width: 28px !important;
    height: 28px !important;
    font-size: 22px !important;
    padding: 4px !important;
    right: 4px !important;
    top: 4px !important;
  }
  .leaflet-popup-content-wrapper {
    max-width: calc(100vw - 60px) !important;
  }
}
/* Hidden by default on desktop */
.dm-handle-bar { display: none; }
.dm-mobile-show-btn {
  display: none;
  position: fixed;
  bottom: 14px;
  left: 10px;
  z-index: 9998;
  background: linear-gradient(135deg, rgba(10,10,30,0.97), rgba(20,20,50,0.97));
  border: 1px solid rgba(0,212,255,0.4);
  border-radius: 99px;
  padding: 10px 20px;
  color: #00d4ff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 4px 24px rgba(0,0,0,0.7);
  align-items: center;
  gap: 6px;
  -webkit-tap-highlight-color: rgba(0,212,255,0.2);
}
</style>
<script>
(function(){
  if(window.innerWidth>640)return;
  function init(){
    var dash=document.querySelector('[id^="dash"]');
    if(!dash)return;
    dash.style.position='fixed';
    dash.style.zIndex='9999';
    /* Wrap existing content in a scrollable div */
    var wrap=document.createElement('div');
    wrap.className='dm-content-wrap';
    while(dash.firstChild)wrap.appendChild(dash.firstChild);
    /* Create handle bar */
    var bar=document.createElement('div');
    bar.className='dm-handle-bar';
    bar.innerHTML='<span class="dm-handle-pill"></span><span class="dm-handle-label">Stats</span><span class="dm-handle-arrow">▼</span>';
    dash.appendChild(bar);
    dash.appendChild(wrap);
    /* Create "show" floating button (when fully hidden) */
    var showBtn=document.createElement('button');
    showBtn.className='dm-mobile-show-btn';
    showBtn.innerHTML='📊 Stats';
    document.body.appendChild(showBtn);
    var state=1; /* 0=open, 1=collapsed, 2=hidden */
    dash.classList.add('dm-collapsed');
    function toggle(e){
      if(e)e.stopPropagation();
      if(state===0){
        dash.classList.add('dm-collapsed');
        dash.classList.remove('dm-hidden');
        state=1;
      } else if(state===1){
        dash.classList.remove('dm-collapsed');
        dash.classList.remove('dm-hidden');
        showBtn.style.display='none';
        state=0;
      }
    }
    bar.addEventListener('click',toggle);
    /* Long press on handle bar hides panel completely */
    var longTimer=null;
    bar.addEventListener('touchstart',function(){longTimer=setTimeout(function(){
      dash.classList.add('dm-hidden');dash.classList.remove('dm-collapsed');
      showBtn.style.display='flex';state=2;
    },600);},{passive:true});
    bar.addEventListener('touchend',function(){clearTimeout(longTimer);},{passive:true});
    bar.addEventListener('touchmove',function(){clearTimeout(longTimer);},{passive:true});
    showBtn.addEventListener('click',function(){
      dash.classList.remove('dm-hidden');dash.classList.add('dm-collapsed');
      showBtn.style.display='none';state=1;
    });
    /* Hide existing desktop toggle to avoid conflict */
    var oldToggle=dash.querySelector('[id$="-toggle"]');
    if(oldToggle)oldToggle.style.display='none';
  }
  if(document.readyState==='complete')setTimeout(init,300);
  else window.addEventListener('load',function(){setTimeout(init,300);});
})();
</script>`;

const STREET_VIEW_SCRIPT = `
<script>
/* Inject Street View + Google Maps links into DVF popups */
(function(){
  function addLinks(){
    var maps=[];
    for(var k in window){try{if(k.indexOf("map_")===0&&window[k]&&typeof window[k].on==="function"&&window[k]._container)maps.push(window[k]);}catch(e){}}
    maps.forEach(function(map){
      map.on("popupopen",function(e){
        var popup=e.popup;
        var ll=popup.getLatLng();
        if(!ll)return;
        var el=popup.getElement();
        if(!el)return;
        var c=el.querySelector(".leaflet-popup-content");
        if(!c||c.querySelector(".sv-links"))return;
        var d=document.createElement("div");
        d.className="sv-links";
        d.style.cssText="margin-top:8px;padding:0 14px 10px;display:flex;gap:6px;flex-wrap:wrap;";
        d.innerHTML='<a href="https://www.google.com/maps?q=&layer=c&cbll='+ll.lat+','+ll.lng+'" target="_blank" rel="noopener" style="display:inline-block;padding:5px 10px;border-radius:6px;background:#1a1a2e;color:#00d4ff;font-size:11px;font-weight:600;text-decoration:none;border:1px solid rgba(0,212,255,0.4);">Street View</a>'
          +'<a href="https://www.google.com/maps/search/?api=1&query='+ll.lat+','+ll.lng+'" target="_blank" rel="noopener" style="display:inline-block;padding:5px 10px;border-radius:6px;background:#f5f5f5;color:#555;font-size:11px;font-weight:600;text-decoration:none;border:1px solid #ddd;">Google Maps</a>';
        c.appendChild(d);
      });
    });
  }
  if(document.readyState==="complete")setTimeout(addLinks,500);
  else window.addEventListener("load",function(){setTimeout(addLinks,500);});
})();
</script>`;

export async function GET(req: NextRequest) {
  const dept = req.nextUrl.searchParams.get("dept");
  const file = req.nextUrl.searchParams.get("file");

  if (!dept || !file || !DEPT_REPOS[dept]) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  // Sanitize file parameter
  if (!/^(carte_\w+|index)\.html$/.test(file)) {
    return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  }

  const repo = DEPT_REPOS[dept];
  const url = `https://samuelbruno-lab.github.io/${repo}/${file}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    let html = await res.text();

    // Rewrite relative .html links to go through the proxy
    html = html.replace(/href="((?:carte_\w+|index)\.html)"/g, `href="/api/map-proxy?dept=${dept}&file=$1"`);

    // Inject mobile fix + Street View script if not already present
    if (!html.includes("sv-links")) {
      html = html.replace("</body>", `${MOBILE_FIX}\n${STREET_VIEW_SCRIPT}\n</body>`);
    } else if (!html.includes("dm-mobile-toggle")) {
      html = html.replace("</body>", `${MOBILE_FIX}\n</body>`);
    }

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch map" }, { status: 502 });
  }
}
