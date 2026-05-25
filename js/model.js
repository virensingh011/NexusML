const FEATURES = [
  { id: 'pop', label: 'Population Density', unit: '/km\u00B2', min: 10, max: 50000, def: 5000 },
  { id: 'infra', label: 'Infrastructure Quality', unit: '', min: 0, max: 100, def: 60 },
  { id: 'response', label: 'Emergency Response', unit: 'min', min: 1, max: 60, def: 15 },
  { id: 'freq', label: 'Disaster Frequency', unit: '/yr', min: 0, max: 50, def: 8 },
  { id: 'climate', label: 'Climate Vulnerability', unit: '', min: 0, max: 100, def: 40 },
  { id: 'economy', label: 'Economic Resilience', unit: '', min: 0, max: 100, def: 50 },
];

const WEIGHTS = {
  pop: 0.20, infra: -0.25, response: 0.18,
  freq: 0.22, climate: 0.15, economy: -0.18,
};

const BASELINE_RISK = 35;

const NORMAL_CENTROIDS = {
  pop: 3500, infra: 65, response: 12,
  freq: 6, climate: 35, economy: 55,
};

const MC_SAMPLES = 200;
const NOISE_SCALE = 0.12;

function sigmoid(x) {
  return 100 / (1 + Math.exp(-0.06 * (x - 50)));
}

function normalize(value, min, max) {
  return (value - min) / (max - min);
}

function predictRaw(inputs, weightOverrides) {
  let raw = BASELINE_RISK;
  const w = weightOverrides || WEIGHTS;
  for (const f of FEATURES) {
    raw += w[f.id] * normalize(inputs[f.id], f.min, f.max) * 100;
  }
  return Math.min(100, Math.max(0, sigmoid(raw)));
}

function computeUncertainty(inputs) {
  const samples = [];
  for (let i = 0; i < MC_SAMPLES; i++) {
    const perturbed = {};
    for (const f of FEATURES) {
      perturbed[f.id] = WEIGHTS[f.id] * (1 + (Math.random() - 0.5) * 2 * NOISE_SCALE);
    }
    samples.push(predictRaw(inputs, perturbed));
  }
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(samples.length * 0.05)];
  const hi = samples[Math.floor(samples.length * 0.95)];
  const margin = Math.max(2, Math.round((hi - lo) / 2));
  return {
    lo: Math.round(lo),
    hi: Math.round(hi),
    margin: margin,
    confidence: margin <= 5 ? 'High' : margin <= 10 ? 'Medium' : 'Low',
  };
}

function detectAnomaly(inputs) {
  let dist = 0;
  for (const f of FEATURES) {
    const nd = (inputs[f.id] - NORMAL_CENTROIDS[f.id]) / ((f.max - f.min) / 4);
    dist += nd * nd;
  }
  const score = Math.min(100, Math.round(Math.sqrt(dist) * 12));
  return {
    score: score,
    label: score > 60 ? 'Unusual' : score > 35 ? 'Atypical' : 'Typical',
  };
}

function checkRealism(inputs) {
  const warnings = [];
  let score = 0;

  // Rule 1: Emergency response < 3min with high climate vulnerability
  if (inputs.response < 3 && inputs.climate > 80) {
    warnings.push('Emergency Response <3min is unrealistic alongside max Climate Vulnerability. No region with extreme climate risk has sub-3min response.');
    score += 40;
  } else if (inputs.response < 3) {
    warnings.push('Emergency Response below 3 minutes is faster than any known real-world system (best: ~5min, Seattle FD). Extrapolating beyond observed data.');
    score += 25;
  } else if (inputs.response < 5 && inputs.climate > 70) {
    warnings.push('Emergency Response under 5min with high Climate Vulnerability is unusual — vulnerable regions rarely achieve this response time.');
    score += 15;
  }

  // Rule 2: High infrastructure + high climate vulnerability
  if (inputs.infra > 85 && inputs.climate > 80) {
    warnings.push('Infrastructure Quality >85 and Climate Vulnerability >80 is contradictory — high vulnerability regions cannot sustain world-class infrastructure.');
    score += 35;
  } else if (inputs.infra > 90 && inputs.climate > 60) {
    warnings.push('Near-perfect Infrastructure with elevated Climate Vulnerability is unusual. Climate-vulnerable regions typically have weakened infrastructure.');
    score += 15;
  }

  // Rule 3: High disaster frequency with slow response
  if (inputs.freq > 30 && inputs.response > 30) {
    warnings.push('Disaster Frequency >30/yr with Emergency Response >30min is implausible — frequent disasters force faster response systems to develop.');
    score += 30;
  } else if (inputs.freq > 20 && inputs.response > 25) {
    warnings.push('High disaster frequency typically drives faster emergency response. Current combination is unusual.');
    score += 10;
  }

  // Rule 4: Max population density with low infrastructure
  if (inputs.pop > 30000 && inputs.infra < 20) {
    warnings.push('Population Density >30,000/km\u00B2 with Infrastructure Quality <20 is unrealistic — dense urban centers require functional infrastructure.');
    score += 30;
  } else if (inputs.pop > 20000 && inputs.infra < 15) {
    warnings.push('Extremely dense population with very low infrastructure quality is typically not sustainable.');
    score += 10;
  }

  // Rule 5: Economic resilience with infrastructure mismatch
  if (inputs.economy > 85 && inputs.infra < 20) {
    warnings.push('Economic Resilience >85 with Infrastructure Quality <20 is contradictory — resilient economies invest in infrastructure.');
    score += 25;
  } else if (inputs.economy < 10 && inputs.infra > 85) {
    warnings.push('High Infrastructure Quality with very low Economic Resilience is unusual — infrastructure requires economic backing.');
    score += 15;
  }

  let level, badgeClass;
  if (score >= 30) {
    level = 'Implausible';
    badgeClass = 'implausible';
  } else if (score >= 10) {
    level = 'Questionable';
    badgeClass = 'questionable';
  } else {
    level = 'Realistic';
    badgeClass = 'realistic';
  }

  return { level, badgeClass, warnings, score };
}

function predict(inputs) {
  const contributions = {};
  let raw = BASELINE_RISK;

  for (const f of FEATURES) {
    const n = normalize(inputs[f.id], f.min, f.max);
    const c = WEIGHTS[f.id] * n * 100;
    contributions[f.id] = c;
    raw += c;
  }

  const score = Math.round(Math.min(100, Math.max(0, sigmoid(raw))));

  let level, action;
  if (score < 25) {
    level = 'Low';
    action = 'Routine monitoring \u2014 standard preparedness is sufficient.';
  } else if (score < 50) {
    level = 'Medium';
    action = 'Strengthen local response capacity and review contingency plans.';
  } else if (score < 75) {
    level = 'High';
    action = 'Deploy pre-positioned resources and activate early warning systems.';
  } else {
    level = 'Critical';
    action = 'Initiate evacuation protocols, mobilize national response teams immediately.';
  }

  const sorted = FEATURES
    .map(f => ({ ...f, importance: Math.abs(contributions[f.id]), contribution: contributions[f.id] }))
    .sort((a, b) => b.importance - a.importance);

  const top = sorted[0];
  const explanation = top.contribution > 0
    ? `${top.label} is the primary risk driver (${top.importance.toFixed(1)}% influence). Reducing exposure would most effectively lower risk.`
    : `${top.label} is the strongest protective factor (${top.importance.toFixed(1)}% influence). Strengthening it further improves resilience.`;

  const counterfactuals = sorted.slice(0, 3).map(f => {
    const current = inputs[f.id];
    const delta = (f.contribution > 0 ? -1 : 1) * ((f.max - f.min) * 0.2);
    const newVal = Math.min(f.max, Math.max(f.min, current + delta));
    const newInputs = { ...inputs, [f.id]: newVal };
    const newScore = predictRaw(newInputs);
    return {
      feature: f.label,
      change: (delta > 0 ? '+' : '') + delta.toFixed(0),
      unit: f.unit,
      current: current,
      newValue: Math.round(newVal),
      delta: Math.round(newScore - score),
    };
  });

  const uncertainty = computeUncertainty(inputs);
  const anomaly = detectAnomaly(inputs);
  const realism = checkRealism(inputs);

  return { score, level, action, contributions, sorted, explanation, counterfactuals, uncertainty, anomaly, realism };
}
