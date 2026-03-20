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

    // Inject Street View script if not already present
    if (!html.includes("sv-links")) {
      html = html.replace("</body>", `${STREET_VIEW_SCRIPT}\n</body>`);
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
