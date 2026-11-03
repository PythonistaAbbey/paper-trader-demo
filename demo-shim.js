// Read-only demo: answers the dashboard's /api/ requests from a recorded snapshot of a demo customer.
// Nothing is sent anywhere; changes are refused. Simulated prices and paper trading only.
(function () {
  const realNow = Date.now.bind(Date);
  let snap = null;
  const ready = fetch("snapshot.json").then((r) => r.json()).then((s) => {
    snap = s;
    const off = realNow() - s.taken_ms;            // the page's clock reads the time the snapshot was taken
    Date.now = () => realNow() - off;
  });
  const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, opts);
    await ready;
    if ((opts.method || "GET").toUpperCase() !== "GET")
      return json(403, {detail: "This is a read-only demo, so changes are turned off."});
    const r = snap.responses;
    const hit = r[url.pathname + url.search] || r[url.pathname] ||
      Object.entries(r).find(([k]) => k.split("?")[0] === url.pathname)?.[1];
    return hit ? json(hit[0], hit[1]) : json(404, {detail: "Not available in the demo."});
  };
})();
