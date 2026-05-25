// ---------- State ----------
function buildDefaultInputs(overrides) {
  const d = {};
  for (const f of FEATURES) d[f.id] = f.def;
  if (overrides) for (const k in overrides) d[k] = overrides[k];
  return d;
}

const state = {
  inputs: buildDefaultInputs(),
  inputsB: buildDefaultInputs({ infra: 80, response: 8, economy: 75 }),
  compare: false,
  expanded: false,
};

let result, resultB;
function recalc() {
  result = predict(state.inputs);
  resultB = predict(state.inputsB);
}
recalc();

// ---------- Helpers ----------
const LEVEL_COLORS = { Low: '#30d158', Medium: '#ffd60a', High: '#ff9f0a', Critical: '#ff453a' };
const CONF_PCT = { High: 90, Medium: 70, Low: 50 };
const ANOM_COL = { Typical: 'var(--green)', Atypical: 'var(--yellow)', Unusual: 'var(--red)' };
const REALISM_COL = { Realistic: 'var(--green)', Questionable: 'var(--yellow)', Implausible: 'var(--red)' };

// ---------- Build static UI once ----------
function buildInputs() {
  const panel = document.getElementById('input-panel');
  for (const f of FEATURES) {
    const g = document.createElement('div');
    g.className = 'input-group';
    g.innerHTML = `
      <div class="input-header">
        <span class="input-label">${f.label}</span>
        <span class="input-value" id="iv-${f.id}">${state.inputs[f.id]}${f.unit}</span>
      </div>
      <input type="range" id="ir-${f.id}" min="${f.min}" max="${f.max}" value="${state.inputs[f.id]}">
    `;
    panel.appendChild(g);
    document.getElementById(`ir-${f.id}`).addEventListener('input', () => onInput(f.id));
  }
}

function buildCompareScenarios() {
  const grid = document.getElementById('compare-grid');
  grid.innerHTML = '';
  for (const [tag, key] of [['A', 'inputs'], ['B', 'inputsB']]) {
    const card = document.createElement('div');
    card.className = 'comp-card';
    card.id = `comp-${tag}`;
    let html = `<div class="comp-title">Scenario ${tag}</div>`;
    for (const f of FEATURES) {
      html += `
        <div class="comp-input">
          <label>${f.label}</label>
          <input type="range" id="cr-${tag}-${f.id}" min="${f.min}" max="${f.max}" value="${state[key][f.id]}">
        </div>
      `;
    }
    html += `<div class="comp-result" id="comp-result-${tag}"></div>`;
    card.innerHTML = html;
    grid.appendChild(card);
    for (const f of FEATURES) {
      document.getElementById(`cr-${tag}-${f.id}`).addEventListener('input', () => onCompare(key, f.id));
    }
  }
}

// ---------- Update only dynamic values ----------
function updateResult(r) {
  const col = LEVEL_COLORS[r.level];
  document.getElementById('score-num').textContent = r.score;
  document.getElementById('score-num').style.color = col;

  const arc = document.getElementById('score-arc');
  arc.setAttribute('stroke', col);
  arc.setAttribute('stroke-dashoffset', 314 - (r.score / 100) * 314);

  const conf = r.uncertainty;
  document.getElementById('score-conf').innerHTML =
    `\u00B1${conf.margin} \u00B7 <span class="conf-badge ${conf.confidence.toLowerCase()}">${conf.confidence} confidence</span>`;

  const lb = document.getElementById('level-badge');
  lb.textContent = r.level + ' Risk';
  lb.className = 'level-badge ' + r.level.toLowerCase();

  const ab = document.getElementById('anomaly-badge');
  ab.textContent = r.anomaly.label + ' scenario';
  ab.className = 'anomaly-badge ' + r.anomaly.label.toLowerCase();
  ab.style.color = ANOM_COL[r.anomaly.label];

  document.getElementById('risk-action').textContent = r.action;

  // Feature importance
  const maxImp = r.sorted[0].importance || 1;
  const list = document.getElementById('imp-list');
  list.innerHTML = r.sorted.map(f => `
    <div class="imp-bar">
      <span class="imp-label">${f.label}</span>
      <div class="imp-track"><div class="imp-fill ${f.contribution > 0 ? 'pos' : 'neg'}" style="width:${(f.importance / maxImp) * 100}%"></div></div>
      <span class="imp-val">${f.contribution > 0 ? '+' : ''}${f.contribution.toFixed(1)}</span>
    </div>
  `).join('');

  // Diagnostics
  document.getElementById('diag-confidence').innerHTML = `
    <div class="diag-header"><span class="diag-label">Prediction Confidence</span><span class="diag-value">${conf.confidence}</span></div>
    <div class="diag-track"><div class="diag-fill" style="width:${CONF_PCT[conf.confidence]}%;background:var(--accent)"></div></div>
    <div class="diag-sub">Score range: ${conf.lo} \u2013 ${conf.hi}<span class="diag-hint"> (95% CI via Monte Carlo)</span></div>
  `;
  const aCol = ANOM_COL[r.anomaly.label];
  document.getElementById('diag-anomaly').innerHTML = `
    <div class="diag-header"><span class="diag-label">Scenario Anomaly Score</span><span class="diag-value" style="color:${aCol}">${r.anomaly.score}</span></div>
    <div class="diag-track"><div class="diag-fill" style="width:${r.anomaly.score}%;background:${aCol}"></div></div>
    <div class="diag-sub">${r.anomaly.label} \u2014 ${r.anomaly.score > 60 ? 'Input combination deviates from typical profiles.' : 'Inputs are within expected ranges.'}<span class="diag-hint"> (Mahalanobis distance)</span></div>
  `;
  document.getElementById('diag-ensemble').innerHTML = `
    <div class="diag-header"><span class="diag-label">Ensemble Size</span><span class="diag-value">200</span></div>
    <div class="diag-sub">Monte Carlo simulations with \u00B112% weight perturbation.<span class="diag-hint"> (Stochastic ensemble)</span></div>
  `;

  // Realism check
  const rl = r.realism;
  const rCol = REALISM_COL[rl.level];
  const realEl = document.getElementById('diag-realism');
  realEl.style.display = 'block';
  realEl.innerHTML = `
    <div class="diag-header">
      <span class="diag-label">Scenario Realism</span>
      <span class="realism-badge ${rl.badgeClass}">${rl.level}</span>
    </div>
    ${rl.warnings.length > 0 ? `
      <ul class="realism-warnings">
        ${rl.warnings.map(w => `<li>${w}</li>`).join('')}
      </ul>
      <div class="diag-sub" style="margin-top:6px">Model assumes independent variables; in reality, climate vulnerability correlates with infrastructure quality and response capacity. <span class="diag-hint">Domain constraint check</span></div>
    ` : `
      <div class="diag-sub">All parameters are within realistic ranges for real-world scenarios.<span class="diag-hint"> Domain constraint check</span></div>
    `}
  `;

  // Explanation expand
  if (state.expanded) {
    const ec = document.getElementById('expand-content');
    ec.style.display = 'block';
    ec.innerHTML = `
      <p>${r.explanation}</p>
      <div style="margin-top:16px;font-weight:500;color:var(--text)">Counterfactual scenarios</div>
      <div class="cf-list">
        ${r.counterfactuals.map(c => `
          <div class="cf-item">
            <div class="cf-info"><div class="cf-feature">${c.feature}</div><div class="cf-change">${c.current}${c.unit} \u2192 ${c.newValue}${c.unit}</div></div>
            <div class="cf-delta ${c.delta <= 0 ? 'down' : 'up'}">${c.delta > 0 ? '+' + c.delta : c.delta} risk</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:12px;font-size:.78rem;color:var(--text3)">Baseline risk: 35. Monte Carlo CI (95%). Anomaly via Mahalanobis distance.</div>
    `;
  }
}

function updateCompare() {
  const grid = document.getElementById('compare-grid');
  if (!state.compare) { grid.style.display = 'none'; return; }
  grid.style.display = 'grid';

  // Insight text
  const diff = resultB.score - result.score;
  let insight = '';
  if (Math.abs(diff) <= 2) {
    insight = 'Scenarios are nearly identical in risk.';
  } else if (diff > 0) {
    const topA = result.sorted[0];
    const topB = resultB.sorted[0];
    insight = `Scenario A (${result.score}) outperforms B (${resultB.score}) mainly due to better ${topA.contribution < 0 ? topA.label : 'management of ' + topB.label}.`;
  } else {
    const topA = result.sorted[0];
    const topB = resultB.sorted[0];
    insight = `Scenario B (${resultB.score}) outperforms A (${result.score}) mainly due to better ${topB.contribution < 0 ? topB.label : 'management of ' + topA.label}.`;
  }

  let insightEl = document.getElementById('compare-insight');
  if (!insightEl) {
    insightEl = document.createElement('div');
    insightEl.id = 'compare-insight';
    insightEl.className = 'compare-insight';
    grid.parentNode.insertBefore(insightEl, grid.nextSibling);
  }
  insightEl.textContent = insight;

  for (const [tag, key] of [['A', 'inputs'], ['B', 'inputsB']]) {
    const r = key === 'inputs' ? result : resultB;
    const inp = state[key];
    const col = LEVEL_COLORS[r.level];
    document.getElementById(`comp-result-${tag}`).innerHTML = `
      <span class="comp-result-num" style="color:${col}">${r.score}</span>
      <span class="comp-result-lbl" style="color:${col}">${r.level}</span>
    `;
    for (const f of FEATURES) {
      document.getElementById(`cr-${tag}-${f.id}`).value = inp[f.id];
    }
  }
}

// ---------- Handlers ----------
function onInput(id) {
  state.inputs[id] = +document.getElementById(`ir-${id}`).value;
  document.getElementById(`iv-${id}`).textContent = state.inputs[id] + (FEATURES.find(f => f.id === id).unit || '');
  recalc();
  updateResult(result);
  updateCompare();
}

function onCompare(key, id) {
  state[key][id] = +document.getElementById(`cr-${key === 'inputs' ? 'A' : 'B'}-${id}`).value;
  recalc();
  updateCompare();
  // Sync main inputs when scenario A changes
  if (key === 'inputs') {
    for (const f of FEATURES) {
      document.getElementById(`ir-${f.id}`).value = state.inputs[f.id];
      document.getElementById(`iv-${f.id}`).textContent = state.inputs[f.id] + (f.unit || '');
    }
    updateResult(result);
  }
}

function toggleCompare() {
  state.compare = !state.compare;
  document.getElementById('compare-toggle').classList.toggle('on');
  const el = document.getElementById('compare-insight');
  if (el) el.style.display = state.compare ? 'block' : 'none';
  updateCompare();
}

function toggleExpand() {
  state.expanded = !state.expanded;
  const btn = document.getElementById('expand-btn');
  const ec = document.getElementById('expand-content');
  if (state.expanded) {
    btn.textContent = '\u25BE Why this result?';
    updateResult(result);
  } else {
    btn.textContent = '\u25B8 Why this result?';
    ec.style.display = 'none';
  }
}

// ---------- Init ----------
buildInputs();
buildCompareScenarios();
document.getElementById('compare-toggle').addEventListener('click', toggleCompare);
document.getElementById('expand-btn').addEventListener('click', toggleExpand);
updateResult(result);
