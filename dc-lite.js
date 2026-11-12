/* Small page runtime: fills {{ }} bindings, sc-for and sc-if blocks, and event handlers. */
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) {
      const n = typeof p === 'function' ? p(this.state, this.props) : p;
      this.state = Object.assign({}, this.state, n);
      if (this.__render) this.__render();
    }
  }
  window.DCLogic = DCLogic;

  const EXPR = /\{\{([^}]*)\}\}/g;
  const hasExpr = (s) => s.indexOf('{{') !== -1;
  const inner = (s) => s.replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '').trim();
  const isWhole = (s) => /^\s*\{\{[^}]*\}\}\s*$/.test(s);

  function get(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null' || path === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const k of path.split('.')) {
      if (v == null) return undefined;
      v = v[k];
    }
    return v;
  }

  function interpolate(tpl, scope) {
    return tpl.replace(EXPR, (m, e) => {
      const v = get(e, scope);
      return v == null || v === false ? '' : String(v);
    });
  }

  function walkChildren(parent, binds) {
    Array.from(parent.childNodes).forEach((n) => walk(n, binds));
  }

  function makeRange(node) {
    const start = document.createComment('s');
    const end = document.createComment('e');
    node.parentNode.insertBefore(start, node);
    node.parentNode.insertBefore(end, node);
    return { start, end };
  }

  function clearRange(r) {
    while (r.start.nextSibling && r.start.nextSibling !== r.end) r.start.nextSibling.remove();
  }

  function walk(node, binds) {
    if (node.nodeType === 3) {
      if (hasExpr(node.nodeValue)) {
        const tpl = node.nodeValue;
        let last;
        binds.push({ run: (scope) => { const v = interpolate(tpl, scope); if (v !== last) { node.nodeValue = v; last = v; } } });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'sc-if' || tag === 'sc-for') {
      const attrs = {};
      Array.from(node.attributes).forEach((a) => { attrs[a.name] = a.value; });
      const tpl = document.createDocumentFragment();
      while (node.firstChild) tpl.appendChild(node.firstChild);
      const range = makeRange(node);
      node.remove();
      if (tag === 'sc-if') {
        const expr = inner(attrs.value || '');
        const b = { mounted: false, binds: [], run(scope) {
          const on = !!get(expr, scope);
          if (on && !b.mounted) {
            const frag = tpl.cloneNode(true);
            b.binds = [];
            walkChildren(frag, b.binds);
            range.end.parentNode.insertBefore(frag, range.end);
            b.mounted = true;
          } else if (!on && b.mounted) {
            clearRange(range);
            b.mounted = false;
            b.binds = [];
          }
          if (b.mounted) b.binds.forEach((x) => x.run(scope));
        } };
        binds.push(b);
      } else {
        const expr = inner(attrs.list || '');
        const as = attrs.as || 'item';
        const idx = attrs.index || null;
        const insts = [];
        binds.push({ run(scope) {
          const list = get(expr, scope) || [];
          while (insts.length > list.length) { const i = insts.pop(); clearRange(i.range); i.range.start.remove(); i.range.end.remove(); }
          while (insts.length < list.length) {
            const anchor = document.createComment('x');
            range.end.parentNode.insertBefore(anchor, range.end);
            const r = makeRange(anchor);
            anchor.remove();
            const frag = tpl.cloneNode(true);
            const ib = [];
            walkChildren(frag, ib);
            r.end.parentNode.insertBefore(frag, r.end);
            insts.push({ range: r, binds: ib });
          }
          list.forEach((item, i) => {
            const sub = Object.create(scope);
            sub[as] = item;
            if (idx) sub[idx] = i;
            insts[i].binds.forEach((x) => x.run(sub));
          });
        } });
      }
      return;
    }

    Array.from(node.attributes).forEach((a) => {
      const name = a.name;
      if (name.indexOf('hint-') === 0) { node.removeAttribute(name); return; }
      if (!hasExpr(a.value)) return;
      if (/^on[a-z]+$/i.test(name) && isWhole(a.value)) {
        const expr = inner(a.value);
        let cur = null;
        node.addEventListener(name.slice(2).toLowerCase(), (e) => { if (typeof cur === 'function') cur(e); });
        node.removeAttribute(name);
        binds.push({ run: (scope) => { cur = get(expr, scope); } });
        return;
      }
      const tpl = a.value;
      let last;
      binds.push({ run: (scope) => {
        let v;
        if (isWhole(tpl)) {
          v = get(inner(tpl), scope);
          if (v === true) v = '';
          else if (v === false || v == null) v = null;
          else v = String(v);
        } else v = interpolate(tpl, scope);
        if (v === last) return;
        last = v;
        if (v === null) node.removeAttribute(name); else node.setAttribute(name, v);
      } });
    });
    walkChildren(node, binds);
  }

  function start() {
    const root = document.querySelector('x-dc');
    if (!root) return;
    const helmet = root.querySelector('helmet');
    if (helmet) { while (helmet.firstChild) document.head.appendChild(helmet.firstChild); helmet.remove(); }
    const sc = document.querySelector('script[data-dc-script]');
    let Comp = DCLogic;
    let props = {};
    if (sc) {
      try { props = (JSON.parse(sc.getAttribute('data-props') || '{}').$preview) || {}; } catch (e) { props = {}; }
      Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    }
    root.style.display = 'block';
    const inst = new Comp(props);
    const binds = [];
    walkChildren(root, binds);
    inst.__render = () => { const vals = inst.renderVals ? inst.renderVals() : {}; binds.forEach((b) => b.run(vals)); };
    inst.__render();
    if (inst.componentDidMount) inst.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
