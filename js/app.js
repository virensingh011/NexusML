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
  const col = LEVEL_COLORS[r.level] || '#86868b';
  document.getElementById('score-num').textContent = r.score !== undefined && r.score !== null ? r.score : 'Not Available';
  document.getElementById('score-num').style.color = col;

  const arc = document.getElementById('score-arc');
  arc.setAttribute('stroke', col);
  arc.setAttribute('stroke-dashoffset', 314 - ((r.score || 0) / 100) * 314);

  const conf = r.uncertainty || { margin: '?', confidence: 'Low', lo: '?', hi: '?' };
  document.getElementById('score-conf').innerHTML =
    `\u00B1${conf.margin} \u00B7 <span class="conf-badge ${(conf.confidence || 'low').toLowerCase()}">${conf.confidence || 'Low'} confidence</span>`;

  // --- Probability distribution + level badge ---
  const pd = r.probDist || { low: 0, medium: 0, high: 0 };
  const lb = document.getElementById('level-badge');
  lb.innerHTML = `${r.level} Risk<span class="prob-dist"> L:${pd.low}% M:${pd.medium}% H:${pd.high}%</span>`;
  lb.className = 'level-badge ' + (r.level || 'low').toLowerCase();

  const anomLabel = (r.anomaly && r.anomaly.label) || 'Typical';
  const ab = document.getElementById('anomaly-badge');
  ab.textContent = anomLabel + ' scenario';
  ab.className = 'anomaly-badge ' + anomLabel.toLowerCase();
  ab.style.color = ANOM_COL[anomLabel] || 'var(--text2)';

  document.getElementById('risk-action').textContent = r.action || 'Not Available';

  // --- Simplified feature influence (top 5) ---
  const topFeatures = (r.sorted || []).slice(0, 5);
  const maxImp = topFeatures.length ? (topFeatures[0].importance || 1) : 1;
  document.getElementById('imp-list').innerHTML = topFeatures.length
    ? topFeatures.map(f => `
      <div class="imp-bar">
        <span class="imp-label">${f.label}</span>
        <div class="imp-track"><div class="imp-fill ${(f.contribution || 0) > 0 ? 'pos' : 'neg'}" style="width:${((f.importance || 0) / maxImp) * 100}%"></div></div>
        <span class="imp-val">${(f.contribution || 0) > 0 ? '+' : ''}${(f.contribution || 0).toFixed(1)}</span>
      </div>
    `).join('')
    : '<div class="diag-sub">No feature data available</div>';

  // --- Diagnostics ---
  document.getElementById('diag-confidence').innerHTML = `
    <div class="diag-header"><span class="diag-label">Prediction Confidence</span><span class="diag-value">${conf.confidence || 'Not Available'}</span></div>
    <div class="diag-track"><div class="diag-fill" style="width:${CONF_PCT[conf.confidence] || 50}%;background:var(--accent)"></div></div>
    <div class="diag-sub">Score range: ${conf.lo} \u2013 ${conf.hi}<span class="diag-hint"> (95% CI via Monte Carlo)</span></div>
  `;

  // --- Decision Rule ---
  const fr = r.finalRisk || { score: 'Not Available', level: 'Not Available' };
  document.getElementById('diag-decision-rule').innerHTML = `
    <div class="diag-header"><span class="diag-label">Final Risk (Decision Rule)</span><span class="diag-value" style="color:${LEVEL_COLORS[fr.level] || '#86868b'}">${fr.score} \u2014 ${fr.level}</span></div>
    <div class="decision-rule">
      <span class="rule-weight">Model (50%)</span><span class="rule-bar"><span class="rule-fill" style="width:50%;background:var(--accent)"></span></span><span class="rule-pct">${r.score || '?'}</span>
      <span class="rule-weight">Features (20%)</span><span class="rule-bar"><span class="rule-fill" style="width:20%;background:var(--orange)"></span></span><span class="rule-pct">+${Math.min(100, (r.sorted || []).slice(0,3).reduce((s,f) => s + Math.abs(f.contribution||0),0)/3).toFixed(0) || '?'}</span>
      <span class="rule-weight">Anomaly (15%)</span><span class="rule-bar"><span class="rule-fill" style="width:15%;background:var(--yellow)"></span></span><span class="rule-pct">${(r.anomaly && r.anomaly.score) || '?'}</span>
      <span class="rule-weight">Drift (15%)</span><span class="rule-bar"><span class="rule-fill" style="width:15%;background:var(--red)"></span></span><span class="rule-pct">${r.drift ? Math.max(0, 100 - r.drift.score) : 75}</span>
    </div>
    <div class="diag-sub">Weighted combination of model, features, anomaly, and drift.<span class="diag-hint"> 0\u201330 Low / 30\u201370 Medium / 70\u2013100 High</span></div>
  `;

  // --- Anomaly ---
  const aCol = ANOM_COL[anomLabel] || 'var(--text2)';
  document.getElementById('diag-anomaly').innerHTML = `
    <div class="diag-header"><span class="diag-label">Scenario Anomaly Score</span><span class="diag-value" style="color:${aCol}">${(r.anomaly && r.anomaly.score) || 'Not Available'}</span></div>
    <div class="diag-track"><div class="diag-fill" style="width:${(r.anomaly && r.anomaly.score) || 0}%;background:${aCol}"></div></div>
    <div class="diag-sub">${anomLabel} \u2014 ${(r.anomaly && r.anomaly.score) > 60 ? 'Input combination deviates from typical profiles.' : 'Inputs are within expected ranges.'}<span class="diag-hint"> (Mahalanobis distance)</span></div>
  `;

  // --- Model comparison table ---
  const models = r.allModels || [];
  const bestModel = models.length > 0
    ? models.reduce((best, m) => (m.score || 0) > (best.score || 0) ? m : best)
    : null;
  document.getElementById('diag-models').innerHTML = `
    <div class="diag-header"><span class="diag-label">Model Comparison</span></div>
    ${models.length > 0 ? `
    <div class="model-table">
      ${models.map(m => {
        const name = m.label || 'Not Available';
        const desc = m.desc || '';
        const score = (m.score !== undefined && m.score !== null) ? m.score : 'Not Available';
        const level = m.level || 'Not Available';
        const c = LEVEL_COLORS[level] || '#86868b';
        const isBest = bestModel && m.modelId === bestModel.modelId;
        const isActive = m.modelId === state.model;
        return `
          <div class="model-row ${isActive ? 'model-active' : ''}" onclick="switchModel('${m.modelId || ''}')">
            <div class="model-info">
              <span class="model-name">${name}</span>
              ${desc ? `<span class="model-desc">${desc}</span>` : ''}
            </div>
            <div class="model-score" style="color:${c}">${score}</div>
            <div class="model-level" style="color:${c}">${level}</div>
            ${isActive ? '<span class="model-badge">active</span>' : ''}
            ${isBest && !isActive ? '<span class="model-badge" style="background:rgba(48,209,88,0.12);color:var(--green)">best</span>' : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div class="diag-sub" style="margin-top:6px">
      <span class="model-auto">Best: ${bestModel ? (bestModel.label || 'Not Available') + ' (' + (bestModel.score !== undefined && bestModel.score !== null ? bestModel.score : '?') + ')' : 'No model available'}</span>
      <span class="diag-hint"> (highest score)</span>
    </div>
    ` : '<div class="diag-sub" style="padding:8px 0">No model available</div>'}
  `;

  document.getElementById('diag-ensemble').innerHTML = `
    <div class="diag-header"><span class="diag-label">Ensemble Size</span><span class="diag-value">200</span></div>
    <div class="diag-sub">Monte Carlo simulations with \u00B112% weight perturbation.<span class="diag-hint"> (Stochastic ensemble)</span></div>
  `;

  // --- Realism ---
  const rl = r.realism || { level: 'Realistic', badgeClass: 'realistic', warnings: [] };
  const realEl = document.getElementById('diag-realism');
  realEl.style.display = 'block';
  realEl.innerHTML = `
    <div class="diag-header"><span class="diag-label">Scenario Realism</span><span class="realism-badge ${rl.badgeClass || 'realistic'}">${rl.level || 'Realistic'}</span></div>
    ${(rl.warnings || []).length
      ? `<ul class="realism-warnings">${rl.warnings.map(w => `<li>${w || ''}</li>`).join('')}</ul><div class="diag-sub" style="margin-top:6px">Model assumes independent variables.<span class="diag-hint"> Domain constraint check</span></div>`
      : `<div class="diag-sub">All parameters are within realistic ranges.<span class="diag-hint"> Domain constraint check</span></div>`}
  `;

  // --- Drift status ---
  const driftEl = document.getElementById('diag-drift');
  if (state.drift && r.drift) {
    driftEl.style.display = 'block';
    const statusMap = { Low: '\uD83D\uDFE2 Stable', Moderate: '\uD83D\uDFE1 Warning', Severe: '\uD83D\uDD34 Critical' };
    const status = statusMap[r.drift.severity] || r.drift.severity;
    const dCol = DRIFT_COL[r.drift.severity] || 'var(--green)';
    driftEl.innerHTML = `
      <div class="diag-header"><span class="diag-label">Data Drift Status</span><span class="diag-value" style="color:${dCol}">${status}</span></div>
      <div class="diag-track"><div class="diag-fill" style="width:${r.drift.score || 0}%;background:${dCol}"></div></div>
      <div class="diag-sub">Distribution shift: ${r.drift.score || 0}/100<span class="diag-hint"> (PSI proxy)</span></div>
      ${(r.drift.reasons || []).length ? `<ul class="realism-warnings">${r.drift.reasons.map(w => `<li>${w || ''}</li>`).join('')}</ul>` : ''}
    `;
  } else {
    driftEl.style.display = 'none';
  }

  // --- Short + structured "Why this result" ---
  if (state.expanded) {
    const ec = document.getElementById('expand-content');
    ec.style.display = 'block';
    const sorted = r.sorted || [];
    const top = sorted[0] || null;
    const second = sorted[1] || null;
    const topDriver = top
      ? (top.contribution || 0) > 0
        ? `${top.label} is the top risk driver (+${(top.importance || 0).toFixed(1)})`
        : `${top.label} is the strongest protective factor (${(top.importance || 0).toFixed(1)})`
      : 'Not Available';
    const secondDriver = second
      ? (second.contribution || 0) > 0
        ? `${second.label} is the second driver (+${(second.importance || 0).toFixed(1)})`
        : `${second.label} is the second protective factor (${(second.importance || 0).toFixed(1)})`
      : 'Not Available';
    ec.innerHTML = `
      <div class="why-item"><span class="why-bullet">Top driver:</span> ${topDriver}</div>
      <div class="why-item"><span class="why-bullet">Second driver:</span> ${secondDriver}</div>
      <div class="why-item"><span class="why-bullet">Stability:</span> \u00B1${conf.margin} (${conf.confidence} confidence)</div>
      <div style="margin-top:14px;font-weight:500;color:var(--text)">Counterfactual scenarios</div>
      <div class="cf-list">${(r.counterfactuals || []).map(c => `
        <div class="cf-item">
          <div class="cf-info">
            <div class="cf-feature">${c.feature || 'Not Available'}</div>
            <div class="cf-change">${c.current !== undefined ? c.current : '?'}${c.unit || ''} \u2192 ${c.newValue !== undefined ? c.newValue : '?'}${c.unit || ''}</div>
            <div class="cf-reason">${c.reason || ''}</div>
          </div>
          <div class="cf-delta ${(c.delta || 0) <= 0 ? 'down' : 'up'}">${(c.delta || 0) > 0 ? '+' + c.delta : (c.delta || 0)} risk</div>
        </div>
      `).join('')}</div>
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
  if (state.expanded) {
    btn.textContent = '\u25BE Why this result?';
    try { updateResult(result); } catch (e) {
      const ec = document.getElementById('expand-content');
      if (ec) { ec.style.display = 'block'; ec.textContent = 'Error: ' + e.message; }
    }
  } else {
    btn.textContent = '\u25B8 Why this result?';
    const ec = document.getElementById('expand-content');
    if (ec) ec.style.display = 'none';
  }
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
