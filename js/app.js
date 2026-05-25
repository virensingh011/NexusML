function buildDefaultInputs(overrides) {
  const defaults = {};
  for (const f of FEATURES) {
    defaults[f.id] = f.def;
  }
  if (overrides) {
    for (const key in overrides) {
      defaults[key] = overrides[key];
    }
  }
  return defaults;
}

let state = {
  inputs: buildDefaultInputs(),
  inputsB: buildDefaultInputs({ infra: 80, response: 8, economy: 75 }),
  compareEnabled: false,
  explanationExpanded: false,
};

let result = predict(state.inputs);
let resultB = predict(state.inputsB);

window.__state = state;

function onInputChange(id, value) {
  state.inputs[id] = value;
  result = predict(state.inputs);
  renderApp(state, result, resultB);
}

function onCompareChange(suffix, id, value) {
  if (suffix === 'B') {
    state.inputsB[id] = value;
    resultB = predict(state.inputsB);
  } else {
    state.inputs[id] = value;
    result = predict(state.inputs);
  }
  renderApp(state, result, resultB);
}

function toggleCompare() {
  state.compareEnabled = !state.compareEnabled;
  renderApp(state, result, resultB);
}

function toggleExplanation() {
  state.explanationExpanded = !state.explanationExpanded;
  renderApp(state, result, resultB);
}

renderApp(state, result, resultB);
