const LEVEL_COLORS = { Low: '#30d158', Medium: '#ffd60a', High: '#ff9f0a', Critical: '#ff453a' };
const CONF_PCT = { High: 90, Medium: 70, Low: 50 };
const ANOM_COL = { Typical: 'var(--green)', Atypical: 'var(--yellow)', Unusual: 'var(--red)' };
const REALISM_COL = { Realistic: 'var(--green)', Questionable: 'var(--yellow)', Implausible: 'var(--red)' };
const DRIFT_COL = { Low: 'var(--green)', Moderate: 'var(--yellow)', Severe: 'var(--red)' };

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
  model: 'weighted',
  drift: false,
};

let result, resultB;
function recalc() {
  result = predict(state.inputs, { modelId: state.model, drifted: state.drift });
  resultB = predict(state.inputsB, { modelId: state.model, drifted: state.drift });
}
recalc();

// ---------- Build static UI ----------
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

function buildModelSelector() {
  const sel = document.getElementById('model-select');
  for (const m of MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = state.model;
  sel.addEventListener('change', () => {
    state.model = sel.value;
    recalc();
    updateResult(result);
    updateCompare();
  });
}

function buildCompareScenarios() {
  const grid = document.getElementById('compare-grid');
  for (const [tag, key] of [['A', 'inputs'], ['B', 'inputsB']]) {
    const card = document.createElement('div');
    card.className = 'comp-card';
    card.id = `comp-${tag}`;
    let html = `<div class="comp-title">Scenario ${tag}</div>`;
    for (const f of FEATURES) {
      html += `<div class="comp-input"><label>${f.label}</label><input type="range" id="cr-${tag}-${f.id}" min="${f.min}" max="${f.max}" value="${state[key][f.id]}"></div>`;
    }
    html += `<div class="comp-result" id="comp-result-${tag}"></div>`;
    card.innerHTML = html;
    grid.appendChild(card);
    for (const f of FEATURES) {
      document.getElementById(`cr-${tag}-${f.id}`).addEventListener('input', () => onCompare(key, f.id));
    }
  }
}

// ---------- Update ----------
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

  const maxImp = r.sorted[0].importance || 1;
  document.getElementById('imp-list').innerHTML = r.sorted.map(f => `
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

  // Model comparison table
  document.getElementById('diag-models').innerHTML = `
    <div class="diag-header"><span class="diag-label">Model Comparison</span></div>
    <div class="model-table">
      ${r.allModels.map(m => {
        const c = LEVEL_COLORS[m.level];
        const isBest = Math.abs(m.score - 50) === Math.min(...r.allModels.map(x => Math.abs(x.score - 50)));
        const isActive = m.modelId === state.model;
        return `
          <div class="model-row ${isActive ? 'model-active' : ''}" onclick="switchModel('${m.modelId}')">
            <div class="model-info">
              <span class="model-name">${m.label}</span>
              <span class="model-desc">${m.desc}</span>
            </div>
            <div class="model-score" style="color:${c}">${m.score}</div>
            <div class="model-level" style="color:${c}">${m.level}</div>
            ${isActive ? '<span class="model-badge">active</span>' : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div class="diag-sub" style="margin-top:6px">
      <span class="model-auto">Best: ${r.allModels.reduce((best, m) => Math.abs(m.score - 50) < Math.abs(best.score - 50) ? m : best).label}</span>
      <span class="diag-hint"> (closest to decision boundary)</span>
    </div>
  `;

  document.getElementById('diag-ensemble').innerHTML = `
    <div class="diag-header"><span class="diag-label">Ensemble Size</span><span class="diag-value">200</span></div>
    <div class="diag-sub">Monte Carlo simulations with \u00B112% weight perturbation.<span class="diag-hint"> (Stochastic ensemble)</span></div>
  `;

  // Realism
  const rl = r.realism;
  const realEl = document.getElementById('diag-realism');
  realEl.style.display = 'block';
  realEl.innerHTML = `
    <div class="diag-header"><span class="diag-label">Scenario Realism</span><span class="realism-badge ${rl.badgeClass}">${rl.level}</span></div>
    ${rl.warnings.length ? `<ul class="realism-warnings">${rl.warnings.map(w => `<li>${w}</li>`).join('')}</ul><div class="diag-sub" style="margin-top:6px">Model assumes independent variables.<span class="diag-hint"> Domain constraint check</span></div>`
    : `<div class="diag-sub">All parameters are within realistic ranges.<span class="diag-hint"> Domain constraint check</span></div>`}
  `;

  // Drift
  const driftEl = document.getElementById('diag-drift');
  if (state.drift && r.drift) {
    driftEl.style.display = 'block';
    const dCol = DRIFT_COL[r.drift.severity];
    driftEl.innerHTML = `
      <div class="diag-header"><span class="diag-label">Data Drift Severity</span><span class="diag-value" style="color:${dCol}">${r.drift.severity}</span></div>
      <div class="diag-track"><div class="diag-fill" style="width:${r.drift.score}%;background:${dCol}"></div></div>
      <div class="diag-sub">Distribution shift score: ${r.drift.score}/100. Population and climate centroids have shifted since training.<span class="diag-hint"> (PSI proxy)</span></div>
      ${r.drift.reasons.length ? `<ul class="realism-warnings">${r.drift.reasons.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
      <div class="diag-sub" style="margin-top:4px"><span style="color:var(--yellow)">\u26A0</span> Model performance may degrade. Retraining recommended if drift persists.<span class="diag-hint"> (Drift simulation active)</span></div>
    `;
  } else {
    driftEl.style.display = 'none';
  }

  // Explanation expand
  if (state.expanded) {
    const ec = document.getElementById('expand-content');
    ec.style.display = 'block';
    ec.innerHTML = `
      <p>${r.explanation}</p>
      <div style="margin-top:16px;font-weight:500;color:var(--text)">Counterfactual scenarios</div>
      <div class="cf-list">${r.counterfactuals.map(c => `
        <div class="cf-item">
          <div class="cf-info"><div class="cf-feature">${c.feature}</div><div class="cf-change">${c.current}${c.unit} \u2192 ${c.newValue}${c.unit}</div></div>
          <div class="cf-delta ${c.delta <= 0 ? 'down' : 'up'}">${c.delta > 0 ? '+' + c.delta : c.delta} risk</div>
        </div>
      `).join('')}</div>
      <div style="margin-top:12px;font-size:.78rem;color:var(--text3)">Baseline risk: varies by model. Monte Carlo CI (95%).</div>
    `;
  }
}

function updateCompare() {
  const grid = document.getElementById('compare-grid');
  if (!state.compare) { grid.style.display = 'none'; const el = document.getElementById('compare-insight'); if (el) el.style.display = 'none'; return; }
  grid.style.display = 'grid';

  const diff = resultB.score - result.score;
  let insight = '';
  if (Math.abs(diff) <= 2) insight = 'Scenarios are nearly identical in risk.';
  else if (diff > 0) insight = `Scenario A (${result.score}) outperforms B (${resultB.score}) — mainly due to better risk management.`;
  else insight = `Scenario B (${resultB.score}) outperforms A (${result.score}) — mainly due to better risk management.`;

  let insightEl = document.getElementById('compare-insight');
  if (!insightEl) {
    insightEl = document.createElement('div');
    insightEl.id = 'compare-insight';
    insightEl.className = 'compare-insight';
    grid.parentNode.insertBefore(insightEl, grid.nextSibling);
  }
  insightEl.style.display = 'block';
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
  if (key === 'inputs') {
    for (const f of FEATURES) {
      document.getElementById(`ir-${f.id}`).value = state.inputs[f.id];
      document.getElementById(`iv-${f.id}`).textContent = state.inputs[f.id] + (f.unit || '');
    }
    updateResult(result);
  }
}

function switchModel(id) {
  state.model = id;
  document.getElementById('model-select').value = id;
  recalc();
  updateResult(result);
  updateCompare();
}

function toggleCompare() {
  state.compare = !state.compare;
  document.getElementById('compare-toggle').classList.toggle('on');
  updateCompare();
}

function toggleExpand() {
  state.expanded = !state.expanded;
  const btn = document.getElementById('expand-btn');
  const ec = document.getElementById('expand-content');
  if (state.expanded) { btn.textContent = '\u25BE Why this result?'; updateResult(result); }
  else { btn.textContent = '\u25B8 Why this result?'; ec.style.display = 'none'; }
}

function toggleDrift() {
  state.drift = !state.drift;
  document.getElementById('drift-toggle').classList.toggle('on');
  recalc();
  updateResult(result);
  updateCompare();
}

// ---------- Init ----------
buildInputs();
buildModelSelector();
buildCompareScenarios();
document.getElementById('compare-toggle').addEventListener('click', toggleCompare);
document.getElementById('expand-btn').addEventListener('click', toggleExpand);
document.getElementById('drift-toggle').addEventListener('click', toggleDrift);
updateResult(result);
