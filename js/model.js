const FEATURES = [
  { id: 'pop', label: 'Population Density', unit: '/km\u00B2', min: 10, max: 50000, def: 5000 },
  { id: 'infra', label: 'Infrastructure Quality', unit: '', min: 0, max: 100, def: 60 },
  { id: 'response', label: 'Emergency Response', unit: 'min', min: 1, max: 60, def: 15 },
  { id: 'freq', label: 'Disaster Frequency', unit: '/yr', min: 0, max: 50, def: 8 },
  { id: 'climate', label: 'Climate Vulnerability', unit: '', min: 0, max: 100, def: 40 },
  { id: 'economy', label: 'Economic Resilience', unit: '', min: 0, max: 100, def: 50 },
];

const MODELS = [
  {
    id: 'weighted',
    label: 'Weighted Score',
    desc: 'Domain-weighted linear model',
    weights: { pop: 0.20, infra: -0.25, response: 0.18, freq: 0.22, climate: 0.15, economy: -0.18 },
    baseline: 35,
  },
  {
    id: 'logistic',
    label: 'Logistic Baseline',
    desc: 'Simpler logistic regression proxy',
    weights: { pop: 0.12, infra: -0.18, response: 0.22, freq: 0.18, climate: 0.20, economy: -0.12 },
    baseline: 40,
  },
  {
    id: 'ensemble',
    label: 'Ensemble (RF Sim.)',
    desc: 'Simulated random forest (non-linear)',
    weights: { pop: 0.25, infra: -0.30, response: 0.12, freq: 0.28, climate: 0.18, economy: -0.22 },
    baseline: 30,
  },
];

const BASELINE_RISK = 35;
const NORMAL_CENTROIDS = { pop: 3500, infra: 65, response: 12, freq: 6, climate: 35, economy: 55 };
const DRIFT_CENTROIDS = { pop: 12000, infra: 45, response: 20, freq: 14, climate: 55, economy: 40 };
const MC_SAMPLES = 200;
const NOISE_SCALE = 0.12;

function sigmoid(x) { return 100 / (1 + Math.exp(-0.06 * (x - 50))); }
function normalize(v, mn, mx) { return (v - mn) / (mx - mn); }

function predictRaw(inputs, weights, baseline) {
  let raw = baseline || BASELINE_RISK;
  const w = weights || MODELS[0].weights;
  for (const f of FEATURES) raw += w[f.id] * normalize(inputs[f.id], f.min, f.max) * 100;
  return Math.min(100, Math.max(0, sigmoid(raw)));
}

function computeUncertainty(inputs, weights) {
  const w = weights || MODELS[0].weights;
  const samples = [];
  for (let i = 0; i < MC_SAMPLES; i++) {
    const p = {};
    for (const f of FEATURES) p[f.id] = w[f.id] * (1 + (Math.random() - 0.5) * 2 * NOISE_SCALE);
    samples.push(predictRaw(inputs, p));
  }
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(samples.length * 0.05)];
  const hi = samples[Math.floor(samples.length * 0.95)];
  const margin = Math.max(2, Math.round((hi - lo) / 2));
  return { lo: Math.round(lo), hi: Math.round(hi), margin, confidence: margin <= 5 ? 'High' : margin <= 10 ? 'Medium' : 'Low' };
}

function detectAnomaly(inputs, drifted) {
  const cents = drifted ? DRIFT_CENTROIDS : NORMAL_CENTROIDS;
  let dist = 0;
  for (const f of FEATURES) {
    const nd = (inputs[f.id] - cents[f.id]) / ((f.max - f.min) / 4);
    dist += nd * nd;
  }
  const score = Math.min(100, Math.round(Math.sqrt(dist) * 12));
  return { score, label: score > 60 ? 'Unusual' : score > 35 ? 'Atypical' : 'Typical' };
}

function predictModel(inputs, modelId) {
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];
  const w = model.weights;
  const contributions = {};
  let raw = model.baseline;
  for (const f of FEATURES) {
    const n = normalize(inputs[f.id], f.min, f.max);
    const c = w[f.id] * n * 100;
    contributions[f.id] = c;
    raw += c;
  }
  const score = Math.round(Math.min(100, Math.max(0, sigmoid(raw))));
  let level, action;
  if (score < 25) { level = 'Low'; action = 'Routine monitoring \u2014 standard preparedness is sufficient.'; }
  else if (score < 50) { level = 'Medium'; action = 'Strengthen local response capacity and review contingency plans.'; }
  else if (score < 75) { level = 'High'; action = 'Deploy pre-positioned resources and activate early warning systems.'; }
  else { level = 'Critical'; action = 'Initiate evacuation protocols, mobilize national response teams immediately.'; }

  const sorted = FEATURES.map(f => ({ ...f, importance: Math.abs(contributions[f.id]), contribution: contributions[f.id] }))
    .sort((a, b) => b.importance - a.importance);

  const top = sorted[0];
  const explanation = top.contribution > 0
    ? `${top.label} is the primary risk driver (${top.importance.toFixed(1)}% influence). Reducing exposure would most effectively lower risk.`
    : `${top.label} is the strongest protective factor (${top.importance.toFixed(1)}% influence). Strengthening it further improves resilience.`;

  const counterfactuals = sorted.slice(0, 3).map(f => {
    const current = inputs[f.id];
    const delta = (f.contribution > 0 ? -1 : 1) * ((f.max - f.min) * 0.2);
    const newVal = Math.min(f.max, Math.max(f.min, current + delta));
    const ni = { ...inputs, [f.id]: newVal };
    return { feature: f.label, change: (delta > 0 ? '+' : '') + delta.toFixed(0), unit: f.unit, current, newValue: Math.round(newVal), delta: Math.round(predictRaw(ni, w, model.baseline) - score) };
  });

  const uncertainty = computeUncertainty(inputs, w);
  return { score, level, action, contributions, sorted, explanation, counterfactuals, uncertainty, modelId: model.id };
}

function predictAll(inputs) {
  return MODELS.map(m => predictModel(inputs, m.id));
}

function computeDrift(inputs) {
  let driftScore = 0;
  const reasons = [];
  for (const f of FEATURES) {
    const shift = Math.abs(NORMAL_CENTROIDS[f.id] - DRIFT_CENTROIDS[f.id]);
    const maxShift = f.max - f.min;
    const pct = shift / maxShift;
    driftScore += pct * 100;
  }
  driftScore = Math.round(driftScore / FEATURES.length);

  for (const f of FEATURES) {
    const diff = inputs[f.id] - NORMAL_CENTROIDS[f.id];
    const expectedShift = inputs[f.id] - DRIFT_CENTROIDS[f.id];
    if (Math.abs(diff) > (f.max - f.min) * 0.3) {
      reasons.push(`${f.label} has shifted ${diff > 0 ? '+':''}${Math.round(diff)} from baseline`);
    }
  }

  const severity = driftScore < 25 ? 'Low' : driftScore < 50 ? 'Moderate' : 'Severe';
  return { score: driftScore, severity, reasons: reasons.slice(0, 3) };
}

function predict(inputs, opts) {
  const modelId = (opts && opts.modelId) || 'weighted';
  const drifted = opts && opts.drifted;
  const primary = predictModel(inputs, modelId);
  const all = predictAll(inputs);
  const anomaly = detectAnomaly(inputs, drifted);
  const drift = drifted ? computeDrift(inputs) : null;

  // Realism check
  const rw = [];
  let rs = 0;
  if (inputs.response < 3 && inputs.climate > 80) { rw.push('Emergency Response <3min is unrealistic alongside max Climate Vulnerability.'); rs += 40; }
  else if (inputs.response < 3) { rw.push('Emergency Response below 3min is faster than any known real-world system.'); rs += 25; }
  if (inputs.infra > 85 && inputs.climate > 80) { rw.push('Infrastructure >85 and Climate Vulnerability >80 is contradictory.'); rs += 35; }
  if (inputs.freq > 30 && inputs.response > 30) { rw.push('Disaster Frequency >30/yr with Response >30min is implausible.'); rs += 30; }
  if (inputs.pop > 30000 && inputs.infra < 20) { rw.push('Population Density >30k with Infrastructure <20 is unrealistic.'); rs += 30; }
  if (inputs.economy > 85 && inputs.infra < 20) { rw.push('Economic Resilience >85 with Infrastructure <20 is contradictory.'); rs += 25; }
  const rlvl = rs >= 30 ? 'Implausible' : rs >= 10 ? 'Questionable' : 'Realistic';
  const rcls = rlvl === 'Implausible' ? 'implausible' : rlvl === 'Questionable' ? 'questionable' : 'realistic';

  return {
    ...primary,
    allModels: all,
    anomaly,
    realism: { level: rlvl, badgeClass: rcls, warnings: rw, score: rs },
    drift,
  };
}
