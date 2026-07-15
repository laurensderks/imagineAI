/**
 * admin.js
 *
 * The analytics dashboard, visible only to admins. The button is hidden for
 * everyone else, but that's cosmetic — /api/analytics re-checks the caller's
 * verified session, so hiding the button is not what protects the data.
 *
 * Charting notes: every chart here is a single series measuring magnitude, so
 * they all use one hue (the accent) rather than a colour per category — colour
 * would imply an identity that isn't there. Single series also means no legend;
 * values ride the tip of each mark instead.
 */
(function () {
  const overlay = document.getElementById('adminOverlay');
  const content = document.getElementById('adminContent');
  const msg = document.getElementById('adminMsg');
  const adminBtn = document.getElementById('adminBtn');

  // The database stores style/engine ids; show the names people actually see in
  // the app, so the dashboard matches the product ("Pixel", not "minecraft").
  const STYLE_NAMES = {
    photorealistic: 'Photorealistic',
    cartoon: 'Cartoon',
    watercolour: 'Watercolour',
    pencil: 'Pencil',
    oil_masters: 'Oil Painting',
    minecraft: 'Pixel',
    fantasy: 'Fantasy',
  };
  const ENGINE_NAMES = { fast: 'Fast', quality: 'High-Res' };

  function prettify(rows, map) {
    return rows.map((r) => ({ ...r, label: map[r.label] || r.label }));
  }

  function showMsg(text) {
    msg.textContent = text;
    msg.hidden = !text;
    content.hidden = !!text;
  }

  // 1284 -> "1,284"; 12903 -> "12.9K". Keeps big tiles from wrapping.
  function compact(n) {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number') return String(n);
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  // Percentage change, last 14 days vs the 14 before.
  //
  // `upIsGood` decides the colour, not the direction: revenue climbing is good,
  // costs climbing is not, and the same arrow must not read the same way for
  // both. Pass null where "better" is genuinely ambiguous (more people hitting
  // the paywall could mean healthy demand or bad pricing) — those stay neutral
  // rather than pretending to a judgement.
  function delta(d, upIsGood) {
    if (!d) return null;
    const cur = Number(d.cur) || 0;
    const prev = Number(d.prev) || 0;
    if (cur === 0 && prev === 0) return null; // nothing happened either period
    if (prev === 0) return { text: 'new', tone: 'neutral' };

    const pct = ((cur - prev) / prev) * 100;
    if (Math.round(pct) === 0) return { text: 'no change', tone: 'neutral' };

    const arrow = pct > 0 ? '▲' : '▼';
    const shown = Math.abs(pct) >= 999 ? '999+' : Math.abs(Math.round(pct));
    let tone = 'neutral';
    if (upIsGood !== null) tone = (pct > 0) === upIsGood ? 'good' : 'bad';
    return { text: `${arrow} ${shown}%`, tone };
  }

  function tile(label, value, sub, d) {
    const el = document.createElement('div');
    el.className = 'kpi';
    const l = document.createElement('span');
    l.className = 'kpi-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'kpi-value';
    v.textContent = value;
    el.append(l, v);

    if (d) {
      const dl = document.createElement('span');
      dl.className = 'kpi-delta ' + d.tone;
      // Arrow + text, never colour alone — the meaning survives colourblindness
      // and greyscale.
      dl.textContent = d.text;
      const vs = document.createElement('span');
      vs.className = 'kpi-delta-vs';
      vs.textContent = ' vs prev 14d';
      dl.appendChild(vs);
      el.appendChild(dl);
    }
    if (sub) {
      const s = document.createElement('span');
      s.className = 'kpi-sub';
      s.textContent = sub;
      el.appendChild(s);
    }
    return el;
  }

  // Horizontal bars: label, bar, value at the tip. One hue, no legend.
  function renderBars(container, rows) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="chart-empty">No data yet.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.title = `${r.label}: ${r.value.toLocaleString()}`;

      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = r.label;

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      // Zero stays visibly zero rather than a misleading sliver.
      fill.style.width = r.value === 0 ? '0' : Math.max(2, (r.value / max) * 100) + '%';
      track.appendChild(fill);

      const val = document.createElement('span');
      val.className = 'bar-value';
      val.textContent = r.value.toLocaleString();

      row.append(label, track, val);
      container.appendChild(row);
    });
  }

  // Columns for the 14-day series.
  function renderCols(container, axis, rows) {
    container.innerHTML = '';
    axis.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="chart-empty">No data yet.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    rows.forEach((r, i) => {
      const col = document.createElement('div');
      col.className = 'col';
      col.title = `${r.label}: ${r.value} render${r.value === 1 ? '' : 's'}`;
      const fill = document.createElement('div');
      fill.className = 'col-fill';
      fill.style.height = r.value === 0 ? '2px' : (r.value / max) * 100 + '%';
      if (r.value === 0) fill.classList.add('empty');
      col.appendChild(fill);
      container.appendChild(col);

      // Label only the ends — a label per column would be unreadable at 14.
      const tick = document.createElement('span');
      tick.className = 'col-tick';
      tick.textContent = i === 0 || i === rows.length - 1 ? r.label : '';
      axis.appendChild(tick);
    });
  }

  function render(d) {
    const k = d.kpis;
    const dd = d.deltas || {};
    const kpiRow = document.getElementById('kpiRow');
    kpiRow.innerHTML = '';
    kpiRow.append(
      tile('Visits', compact(k.visits), `${compact(k.bots)} bots filtered`,
        delta(dd.visits, true)),
      tile('Signups', compact(k.signups), null,
        delta(dd.signups, true)),
      tile('Renders', compact(k.renders),
        k.failed_renders ? `${k.failed_renders} failed` : null,
        delta(dd.renders, true)),
      tile('Revenue', '$' + k.revenue.toFixed(2), null,
        delta(dd.revenue, true)),
      // Costs going up is the one place where a rising arrow is bad news.
      tile('Est. cost', 'A$' + Number(k.est_cost_aud).toFixed(2), 'OpenAI, measured',
        delta(dd.est_cost_aud, false)),
      // A balance, not a flow — a 14-day "change" would be meaningless here.
      tile('Unspent tokens', compact(k.tokens_unspent), `${compact(k.tokens_sold)} sold`),
      // Ambiguous by nature: could be healthy demand, could be bad pricing.
      tile('Hit paywall', compact(k.paywall_hits), 'wanted to render',
        delta(dd.paywall_hits, null))
    );

    renderBars(document.getElementById('funnelBars'), d.funnel);
    renderCols(document.getElementById('dailyCols'), document.getElementById('dailyAxis'), d.daily);
    renderBars(document.getElementById('styleBars'), prettify(d.styles, STYLE_NAMES));
    renderBars(document.getElementById('engineBars'), prettify(d.engines, ENGINE_NAMES));

    document.getElementById('adminFoot').textContent =
      'Updated ' + new Date(d.generated_at).toLocaleString();
  }

  async function open() {
    overlay.classList.add('open');
    showMsg('Loading…');
    try {
      const token = await window.Auth.getToken();
      const res = await fetch('/api/analytics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || 'Could not load analytics.');
        return;
      }
      showMsg('');
      render(data);
    } catch (err) {
      showMsg('Could not load analytics.');
      console.error('[admin]', err);
    }
  }

  adminBtn.addEventListener('click', open);
  document.getElementById('closeAdmin').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  // Ask the server whether this session is an admin; show the button if so.
  if (window.Auth) {
    window.Auth.onChange(async (user) => {
      if (!user) {
        adminBtn.hidden = true;
        return;
      }
      try {
        const token = await window.Auth.getToken();
        const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        const me = await res.json();
        adminBtn.hidden = !me.admin;
      } catch (_) {
        adminBtn.hidden = true;
      }
    });
  }
})();
