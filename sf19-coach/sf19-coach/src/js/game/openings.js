// ECO opening names (lichess chess-openings, CC0), loaded lazily.
class Openings {
  constructor() {
    this.names = null;
    this.pos = null;
    this.loading = null;
  }

  get ready() { return !!this.pos; }

  load(url = 'data/openings.json') {
    if (!this.loading) {
      this.loading = fetch(url)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(d => { this.names = d.names; this.pos = d.pos; return this; })
        .catch(e => { console.warn('openings not available', e); this.loading = null; throw e; });
    }
    return this.loading;
  }

  /** Test helper / offline use. */
  loadData(d) { this.names = d.names; this.pos = d.pos; this.loading = Promise.resolve(this); }

  lookup(epd) {
    if (!this.pos) return null;
    const i = this.pos[epd];
    if (i === undefined || i < 0) return null;
    const [eco, name] = this.names[i];
    return { eco, name };
  }

  isBook(epd) { return !!this.pos && this.pos[epd] !== undefined; }

  /** Name of the opening for a tree node: the deepest named position on its path (within 40 plies). */
  forNode(node) {
    if (!this.pos) return null;
    let n = node;
    for (let i = 0; n && i < 60; i++, n = n.parent) {
      const o = this.lookup(n.epd);
      if (o) return o;
    }
    return null;
  }
}

export const openings = new Openings();
