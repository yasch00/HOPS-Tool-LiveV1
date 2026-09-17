/* HOPS request worker — a Cloudflare Worker (free tier) between the atlas and GitHub, so visitors need no GitHub account and
   the page never sees a token. Everything downstream is unchanged: the issue drives .github/workflows/solve.yml.

   POST JSON, one of:
     { action: "request", spec }            → opens the "Run request" issue. Returns { issue, url, token }. The token is a secret
                                              only this visitor's browser holds; its SHA-256 is stored in the issue body, so the
                                              same browser (and nobody else) can later cancel or remove what it requested.
     { action: "cancel",  issue, token }    → closes the request issue as "not planned"; cancel.yml then stops its solve.
     { action: "remove",  site,  token }    → opens a "Remove request: site N" issue (N = 1000 + request issue) that remove.yml
                                              executes (its author is the token's owner); an unfinished solve is cancelled too.
   The repository owner can always do the same by hand on GitHub (close the issue as not planned / open a Remove request).

   Secrets / variables (Worker → Settings → Variables and Secrets):
     GITHUB_TOKEN   fine-grained token, repository HOPS-Tool-LiveV1 only, permission Issues: Read and write   (secret)
     REPO           yasch00/HOPS-Tool-LiveV1                                                                  (variable)
     ALLOW_ORIGIN   https://yasch00.github.io                                                                 (variable)
   Abuse: add a Cloudflare rate-limiting rule on the worker's route (e.g. 5 requests / 10 min per IP). */

const GH = 'https://api.github.com';
async function sha256(s){ const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function randomToken(){ const a = new Uint8Array(24); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); }
function fmtInt(n){ return Math.round(n).toLocaleString('en-US'); }

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
    const gh = (path, init = {}) => fetch(GH + path, { ...init, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hops-request-worker', 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST a run-request spec' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 20000) throw new Error('too large'); body = JSON.parse(t); } catch (e) { return json({ error: 'bad JSON' }, 400); }
    const action = body.action || (body.site && body.plant ? 'request' : null);

    /* ---- request: spec → issue ------------------------------------------------------------------------------------ */
    if (action === 'request') {
      const spec = body.spec || body, site = spec.site || {}, plant = spec.plant || {}, lat = +site.lat, lon = +site.lon, tpd = +plant.tNH3_day;
      if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return json({ error: 'bad coordinates' }, 400);
      if (!(tpd >= 50 && tpd <= 5000)) return json({ error: 'capacity must be 50–5000 t/d' }, 400);
      if (!Array.isArray(plant.pathways) || !plant.pathways.length) return json({ error: 'no pathways' }, 400);
      const name = String(site.name || '').slice(0, 80).replace(/[<>`]/g, ''), T = spec.technical_changed || {};
      const changed = Object.keys(T).length ? Object.entries(T).map(([k, v]) => `${k}=${v}`).join(', ') : 'none (model defaults)';
      const token = randomToken(), rt = await sha256(token);
      const title = `Run request: ${name || (lat + ', ' + lon)} · ${fmtInt(tpd)} t/d`;
      const text = `## HOPS run request\n\n| | |\n|---|---|\n| Site | ${name || '—'} (${lat}, ${lon}) |\n| Capacity | ${fmtInt(tpd)} t NH₃/day |\n| Pathways | ${plant.pathways.join(' and ')}, full CI sweep |\n| Nearest modelled | ${spec.proxy ? spec.proxy.name + ' · ' + spec.proxy.km + ' km' : '—'} |\n| Changed assumptions | ${changed} |\n\n<details><summary>Spec (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(spec, null, 1)}\n\`\`\`\n</details>\n\n_Submitted from the atlas via the request worker · data ${spec.data_version || '?'}_\n<!-- rt:${rt} -->`;
      const r = await gh(`/repos/${env.REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body: text, labels: ['run-request'] }) });
      if (!r.ok) return json({ error: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` }, 502);
      const issue = await r.json();
      return json({ issue: issue.number, url: issue.html_url, token });
    }

    /* ---- cancel / remove: only with the token handed out at submission ---------------------------------------------- */
    if (action === 'cancel' || action === 'remove') {
      const n = action === 'cancel' ? Number(body.issue) : Number(body.site) - 1000, token = String(body.token || '');
      if (!(n >= 1) || !/^[0-9a-f]{48}$/.test(token)) return json({ error: 'issue/site and token required' }, 400);
      const r = await gh(`/repos/${env.REPO}/issues/${n}`); if (!r.ok) return json({ error: 'no such request' }, 404);
      const issue = await r.json();
      if (!/^Run request/.test(issue.title || '') || !(issue.body || '').includes(`<!-- rt:${await sha256(token)} -->`)) return json({ error: 'this browser did not submit that request' }, 403);
      if (issue.state === 'open') {                                                                   // unfinished solve: stop it (cancel.yml reacts to "not planned")
        const c = await gh(`/repos/${env.REPO}/issues/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
        if (!c.ok) return json({ error: `GitHub ${c.status}` }, 502);
        await gh(`/repos/${env.REPO}/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body: `<!-- hops-worker --> ${action === 'cancel' ? 'Cancelled' : 'Removed'} by the requester from the atlas.` }) });
      }
      if (action === 'cancel') return json({ ok: true, issue: n });
      const site = 1000 + n;
      const rr = await gh(`/repos/${env.REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: `Remove request: site ${site}`, body: `Remove requested site **${site}** (request #${n}) from the atlas — data, runs and siting layers.\n\n_Requested by the original requester from the atlas via the request worker; executed by .github/workflows/remove.yml._` }) });
      if (!rr.ok) return json({ error: `GitHub ${rr.status}: ${(await rr.text()).slice(0, 200)}` }, 502);
      const ri = await rr.json();
      return json({ ok: true, site, issue: ri.number, url: ri.html_url });
    }
    return json({ error: 'unknown action' }, 400);
  }
};
