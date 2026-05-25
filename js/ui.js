function getLevelColor(level) {
  switch (level) {
    case 'Low': return '#30d158';
    case 'Medium': return '#ffd60a';
    case 'High': return '#ff9f0a';
    case 'Critical': return '#ff453a';
    default: return '#86868b';
  }
}

function getConfidencePercent(confidence) {
  return confidence === 'High' ? 90 : confidence === 'Medium' ? 70 : 50;
}

function getAnomalyColor(label) {
  return label === 'Typical' ? 'var(--green)' : label === 'Atypical' ? 'var(--yellow)' : 'var(--red)';
}

function renderApp(state, result, resultB) {
  const r = result;
  const color = getLevelColor(r.level);
  const dashOffset = 314 - (r.score / 100) * 314;
  const maxImp = r.sorted[0].importance || 1;
  const aColor = getAnomalyColor(r.anomaly.label);

  document.getElementById('app').innerHTML = `
    ${renderHeader()}
    <div class="grid">
      ${renderInputPanel(state)}
      ${renderOutputPanel(r, color, dashOffset, aColor)}
    </div>
    <div class="grid">
      ${renderExplainability(r, maxImp)}
      ${renderDiagnostics(r, aColor)}
    </div>
    ${renderDivider()}
    ${renderCompareToggle(state)}
    ${state.compare ? renderCompareGrid(state, result, resultB) : ''}
    ${renderFooter()}
  `;
}

function renderHeader() {
  return `
    <div class="header">
      <h1>Disaster Risk Intelligence</h1>
      <p>Predict disaster risk from environmental and socioeconomic conditions. Adjust inputs to see how resilience measures change outcomes.</p>
    </div>
  `;
}

function renderInputPanel(state) {
  return `
    <div class="card">
      <div class="card-title">Scenario Parameters</div>
      ${FEATURES.map(f => `
        <div class="input-group">
          <div class="input-header">
            <span class="input-label">${f.label}</span>
            <span class="input-value">${state.inputs[f.id]}${f.unit}</span>
          </div>
          <input type="range" min="${f.min}" max="${f.max}" value="${state.inputs[f.id]}" oninput="onInputChange('${f.id}', +this.value)">
        </div>
      `).join('')}
    </div>
  `;
}

function renderOutputPanel(r, color, dashOffset, aColor) {
  return `
    <div class="card fade">
      <div class="card-title">Risk Assessment</div>
      <div class="score-wrap">
        <div class="score-ring" style="border: 3px solid ${color}20">
          <svg width="140" height="140">
            <circle cx="70" cy="70" r="50" fill="none" stroke="var(--border)" stroke-width="6"/>
            <circle cx="70" cy="70" r="50" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="314" stroke-dashoffset="${dashOffset}" style="transition: stroke-dashoffset .5s"/>
          </svg>
          <span class="score-num" style="color: ${color}">${r.score}</span>
        </div>
        <div class="score-conf">
          \u00B1${r.uncertainty.margin} \u00B7
          <span class="conf-badge ${r.uncertainty.confidence.toLowerCase()}">${r.uncertainty.confidence} confidence</span>
        </div>
        <div class="level-badge ${r.level.toLowerCase()}">${r.level} Risk</div>
        <div class="anomaly-badge ${r.anomaly.label.toLowerCase()}" style="color: ${aColor}">${r.anomaly.label} scenario</div>
        <div class="risk-action">${r.action}</div>
      </div>
    </div>
  `;
}

function renderExplainability(r, maxImp) {
  const expanded = window.__state && window.__state.explanationExpanded;
  return `
    <div class="card fade">
      <div class="card-title">Feature Influence</div>
      <div class="imp-list">
        ${r.sorted.map(f => `
          <div class="imp-bar">
            <span class="imp-label">${f.label}</span>
            <div class="imp-track">
              <div class="imp-fill ${f.contribution > 0 ? 'pos' : 'neg'}" style="width: ${(f.importance / maxImp) * 100}%"></div>
            </div>
            <span class="imp-val">${f.contribution > 0 ? '+' : ''}${f.contribution.toFixed(1)}</span>
          </div>
        `).join('')}
      </div>
      <button class="expand-btn" onclick="toggleExplanation()">${expanded ? '\u25BE' : '\u25B8'} Why this result?</button>
      ${expanded ? renderExplanationContent(r) : ''}
    </div>
  `;
}

function renderExplanationContent(r) {
  return `
    <div class="expand-content fade">
      <p>${r.explanation}</p>
      <div style="margin-top: 16px; font-weight: 500; color: var(--text)">Counterfactual scenarios</div>
      <div class="cf-list">
        ${r.counterfactuals.map(c => `
          <div class="cf-item">
            <div class="cf-info">
              <div class="cf-feature">${c.feature}</div>
              <div class="cf-change">${c.current}${c.unit} \u2192 ${c.newValue}${c.unit}</div>
            </div>
            <div class="cf-delta ${c.delta <= 0 ? 'down' : 'up'}">${c.delta > 0 ? '+' + c.delta : c.delta} risk</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top: 12px; font-size: .78rem; color: var(--text3)">
        Baseline risk: 35. Monte Carlo CI (95%). Anomaly via Mahalanobis distance.
      </div>
    </div>
  `;
}

function renderDiagnostics(r, aColor) {
  return `
    <div class="card fade">
      <div class="card-title">Model Diagnostics</div>
      <div class="diag-section">
        <div class="diag-header">
          <span class="diag-label">Prediction Confidence</span>
          <span class="diag-value">${r.uncertainty.confidence}</span>
        </div>
        <div class="diag-track">
          <div class="diag-fill" style="width: ${getConfidencePercent(r.uncertainty.confidence)}%; background: var(--accent)"></div>
        </div>
        <div class="diag-sub">Score range: ${r.uncertainty.lo} \u2013 ${r.uncertainty.hi}<span class="diag-hint"> (95% CI via Monte Carlo)</span></div>
      </div>
      <div class="diag-section">
        <div class="diag-header">
          <span class="diag-label">Scenario Anomaly Score</span>
          <span class="diag-value" style="color: ${aColor}">${r.anomaly.score}</span>
        </div>
        <div class="diag-track">
          <div class="diag-fill" style="width: ${r.anomaly.score}%; background: ${aColor}"></div>
        </div>
        <div class="diag-sub">${r.anomaly.label} \u2014 ${r.anomaly.score > 60 ? 'Input combination deviates from typical profiles.' : 'Inputs are within expected ranges.'}<span class="diag-hint"> (Mahalanobis distance)</span></div>
      </div>
      <div class="diag-section">
        <div class="diag-header">
          <span class="diag-label">Ensemble Size</span>
          <span class="diag-value">200</span>
        </div>
        <div class="diag-sub">Monte Carlo simulations with \u00B112% weight perturbation.<span class="diag-hint"> (Stochastic ensemble)</span></div>
      </div>
    </div>
  `;
}

function renderDivider() {
  return `<div class="divider"></div>`;
}

function renderCompareToggle(state) {
  return `
    <div class="toggle-bar">
      <span style="font-size: .82rem; color: var(--text2); font-weight: 500">Compare Scenarios</span>
      <button class="toggle ${state.compareEnabled ? 'on' : ''}" onclick="toggleCompare()"></button>
    </div>
  `;
}

function renderCompareGrid(state, result, resultB) {
  return `
    <div class="comp-grid fade">
      ${renderScenario('Scenario A', state.inputs, result)}
      ${renderScenario('Scenario B', state.inputsB, resultB)}
    </div>
  `;
}

function renderScenario(title, inputs, result) {
  return `
    <div class="comp-card">
      <div class="comp-title">${title}</div>
      ${FEATURES.map(f => `
        <div class="comp-input">
          <label>${f.label}</label>
          <input type="range" min="${f.min}" max="${f.max}" value="${inputs[f.id]}" oninput="onCompareChange('${title === 'Scenario B' ? 'B' : ''}', '${f.id}', +this.value)">
        </div>
      `).join('')}
      <div class="comp-result">
        <span class="comp-result-num" style="color: ${getLevelColor(result.level)}">${result.score}</span>
        <span class="comp-result-lbl" style="color: ${getLevelColor(result.level)}">${result.level}</span>
      </div>
    </div>
  `;
}

function renderFooter() {
  return `
    <div class="footer">
      <span class="footer-credit">Created by <strong>Viren Singh</strong></span>
      <span class="footer-ver">Disaster Risk Intelligence v1.0</span>
    </div>
  `;
}
