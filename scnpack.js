/* scnpack.js — reads data/scenarios.pack.json, the lossless compact form of data/scenarios.json
   (tools/pack_scenarios.py), and hands back the identical scenario list. Used by the atlas and the storage page.

   HOPS_SCN.load(dataBase, manifest)  -> Promise<scenarios[]>
       the pack when it is there and matches the manifest (scenario count, version); otherwise scenarios.json.
   HOPS_SCN.unpack(pack)              -> scenarios[]   (same order, same keys in the same order, same values) */
(function (g) {
  function unpack(p) {
    const orders = p.orders, out = new Array(p.scn.length);
    for (let stage = 0; stage < 2; stage++) {              // base cases first, then the cases stored as differences
      p.scn.forEach((e, i) => {
        if (('b' in e) !== !!stage) return;
        const s = {};
        for (const k in e) if (k !== 'b' && k !== 'rows') s[k] = e[k];
        s.rows = e.rows.map(r => {
          const keys = orders[r.o], row = {};
          if (!('k' in r)) { keys.forEach((k, n) => { row[k] = r.v[n]; }); return row; }
          const dk = orders[r.k], d = {}, br = out[e.b].rows[r.r];
          dk.forEach((k, n) => { d[k] = r.v[n]; });
          keys.forEach(k => { row[k] = (k in d) ? d[k] : br[k]; });
          return row;
        });
        out[i] = s;
      });
    }
    return out;
  }
  async function load(base, manifest) {
    try {
      const r = await fetch(base + 'scenarios.pack.json', { cache: 'no-cache' });
      if (r.ok) {
        const p = await r.json(), m = manifest || {};
        const fresh = p && p.v === 1 && (m.n_scenarios == null || p.n === m.n_scenarios) && (!m.version || !p.version || p.version === m.version);
        if (fresh) return unpack(p);
        console.warn('scenarios.pack.json does not match manifest.json — using scenarios.json');
      }
    } catch (e) { console.warn('scenarios.pack.json unavailable — using scenarios.json', e); }
    const r = await fetch(base + 'scenarios.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(base + 'scenarios.json → HTTP ' + r.status);
    return r.json();
  }
  g.HOPS_SCN = { unpack, load };
})(window);
