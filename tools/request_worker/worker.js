/* HOPS request worker — a Cloudflare Worker (free tier) that turns a run request from the atlas into a GitHub issue,
   so visitors need no GitHub account and the page never sees a token. The issue then drives .github/workflows/solve.yml
   exactly as a hand-made one would.
   Secrets / variables (Worker → Settings → Variables):
     GITHUB_TOKEN   fine-grained token, repository HOPS-Tool-LiveV1 only, permission Issues: Read and write   (secret)
     REPO           yasch00/HOPS-Tool-LiveV1                                                                  (variable)
     ALLOW_ORIGIN   https://yasch00.github.io                                                                 (variable)
   Abuse: add a Cloudflare rate-limiting rule on the worker's route (e.g. 5 requests / 10 min per IP). */
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST a run-request spec' }, 405);
    let spec;
    try { const t = await req.text(); if (t.length > 20000) throw new Error('too large'); spec = JSON.parse(t); } catch (e) { return json({ error: 'bad JSON' }, 400); }
    const site = spec.site || {}, plant = spec.plant || {}, lat = +site.lat, lon = +site.lon, tpd = +plant.tNH3_day;
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return json({ error: 'bad coordinates' }, 400);
    if (!(tpd >= 50 && tpd <= 5000)) return json({ error: 'capacity must be 50–5000 t/d' }, 400);
    if (!Array.isArray(plant.pathways) || !plant.pathways.length) return json({ error: 'no pathways' }, 400);
    const name = String(site.name || '').slice(0, 80).replace(/[<>`]/g, ''), T = spec.technical_changed || {};
    const changed = Object.keys(T).length ? Object.entries(T).map(([k, v]) => `${k}=${v}`).join(', ') : 'none (model defaults)';
    const title = `Run request: ${name || (lat + ', ' + lon)} · ${Math.round(tpd).toLocaleString('en-US')} t/d`;
    const body = `## HOPS run request\n\n| | |\n|---|---|\n| Site | ${name || '—'} (${lat}, ${lon}) |\n| Capacity | ${Math.round(tpd).toLocaleString('en-US')} t NH₃/day |\n| Pathways | ${plant.pathways.join(' and ')}, full CI sweep |\n| Nearest modelled | ${spec.proxy ? spec.proxy.name + ' · ' + spec.proxy.km + ' km' : '—'} |\n| Changed assumptions | ${changed} |\n\n<details><summary>Spec (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(spec, null, 1)}\n\`\`\`\n</details>\n\n_Submitted from the atlas via the request worker · data ${spec.data_version || '?'}_`;
    const r = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, { method: 'POST', headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hops-request-worker', 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, labels: ['run-request'] }) });
    if (!r.ok) return json({ error: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` }, 502);
    const issue = await r.json();
    return json({ issue: issue.number, url: issue.html_url });
  }
};
