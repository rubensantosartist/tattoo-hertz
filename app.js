const micButton = document.querySelector("#mic-button");
const buttonLabel = document.querySelector("#button-label");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const frequencyDisplay = document.querySelector("#frequency");
const noteDisplay = document.querySelector("#note");
const noteDescription = document.querySelector("#note-description");
const noteRow = document.querySelector(".note-row");
const permissionNote = document.querySelector("#permission-note");
const canvas = document.querySelector("#visualizer");
const ctx = canvas.getContext("2d");
const settingsButton = document.querySelector("#settings-button");
const settingsPanel = document.querySelector("#settings-panel");
const sensitivityInput = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivity-value");

let audioContext;
let analyser;
let stream;
let source;
let running = false;
let animationId;
let sensitivity = Number(sensitivityInput.value);
let timeData;
let lastFrameTime = 0;
let pitchHistory = [];

const noteNames = ["Dó", "Dó♯", "Ré", "Ré♯", "Mi", "Fá", "Fá♯", "Sol", "Sol♯", "Lá", "Lá♯", "Si"];

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function drawIdle() {
  const { width, height } = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#252a23";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.strokeStyle = "#555d4e";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  for (let x = 0; x <= width; x += 4) {
    const y = height / 2 + Math.sin(x * 0.04) * 1.3 + Math.sin(x * 0.013) * 1.3;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function setFrequency(value) {
  if (!value || !Number.isFinite(value)) {
    frequencyDisplay.textContent = running ? "0" : "—";
    document.querySelector(".frequency-unit").innerHTML = "HERTZ <span>(Hz)</span>";
    noteRow.hidden = running;
    return;
  }
  noteRow.hidden = false;
  frequencyDisplay.textContent = value >= 1000 ? (value / 1000).toFixed(3) : value.toFixed(1);
  if (value >= 1000) document.querySelector(".frequency-unit").innerHTML = "KILOHERTZ <span>(kHz)</span>";
  else document.querySelector(".frequency-unit").innerHTML = "HERTZ <span>(Hz)</span>";
  const midi = Math.round(69 + 12 * Math.log2(value / 440));
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const cents = Math.round(1200 * Math.log2(value / (440 * 2 ** ((midi - 69) / 12))));
  noteDisplay.textContent = `${noteNames[noteIndex]}${octave}`;
  noteDescription.textContent = `${cents > 0 ? "+" : ""}${cents} cents da nota mais próxima`;
}

function estimatePitch(buffer, sampleRate) {
  // YIN's cumulative mean normalized difference rejects many octave errors
  // and gives a sub-sample period estimate for clear, monophonic tones.
  const downsample = 4;
  const size = Math.floor(buffer.length / downsample);
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < sensitivity) return null;

  const signal = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const offset = i * downsample;
    signal[i] = (buffer[offset] + buffer[offset + 1] + buffer[offset + 2] + buffer[offset + 3]) * 0.25;
  }
  const analysisRate = sampleRate / downsample;
  const minLag = Math.floor(analysisRate / 1800);
  const maxLag = Math.min(Math.floor(analysisRate / 30), Math.floor(size / 2));
  const sampleCount = size - maxLag;
  const difference = new Float64Array(maxLag + 1);
  const normalized = new Float64Array(maxLag + 1);

  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < sampleCount; i++) {
      const delta = signal[i] - signal[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let cumulative = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    cumulative += difference[lag];
    normalized[lag] = cumulative ? difference[lag] * lag / cumulative : 1;
  }

  const threshold = 0.2;
  let bestLag = -1;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (normalized[lag] < threshold) {
      while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0) return null;

  const left = normalized[Math.max(1, bestLag - 1)];
  const center = normalized[bestLag];
  const right = normalized[Math.min(maxLag, bestLag + 1)];
  const denominator = left - 2 * center + right;
  const adjustment = denominator ? 0.5 * (left - right) / denominator : 0;
  const period = bestLag + Math.max(-0.5, Math.min(0.5, adjustment));
  return analysisRate / period;
}

function drawWaveform(buffer) {
  const { width, height } = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.strokeStyle = "#2d332a";
  ctx.lineWidth = 1;
  ctx.stroke();
  const step = Math.max(1, Math.floor(buffer.length / width));
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const sample = buffer[x * step] || 0;
    const y = height / 2 + sample * height * 0.43;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#c6f36d";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "#c6f36655";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function update(timestamp) {
  if (!running) return;
  if (timestamp - lastFrameTime >= 40) {
    lastFrameTime = timestamp;
    analyser.getFloatTimeDomainData(timeData);
    drawWaveform(timeData);
    const pitch = estimatePitch(timeData, audioContext.sampleRate);
    if (pitch && pitch >= 20 && pitch <= 1800) {
      pitchHistory.push(pitch);
      if (pitchHistory.length > 3) pitchHistory.shift();
      const sorted = [...pitchHistory].sort((a, b) => a - b);
      setFrequency(sorted[Math.floor(sorted.length / 2)]);
    } else {
      pitchHistory = [];
      setFrequency(0);
    }
  }
  animationId = requestAnimationFrame(update);
}

function setMicButtonText(label) {
  buttonLabel.textContent = label;
  micButton.setAttribute("aria-label", label);
  micButton.title = label;
}

async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) {
    permissionNote.textContent = "Este navegador não suporta captura de áudio. Abre a app em HTTPS ou localhost.";
    return;
  }
  micButton.disabled = true;
  setMicButtonText("A pedir acesso ao microfone…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.15;
    timeData = new Float32Array(analyser.fftSize);
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    running = true;
    pitchHistory = [];
    lastFrameTime = 0;
    statusText.textContent = "A OUVIR AGORA";
    statusDot.classList.add("active");
    setMicButtonText("Parar de ouvir");
    permissionNote.textContent = "A frequência é uma estimativa do som mais tonal captado.";
    micButton.classList.add("listening");
    update();
  } catch (error) {
    const messages = {
      NotAllowedError: "Acesso ao microfone recusado. Permite-o nas definições do navegador.",
      NotFoundError: "Não foi encontrado nenhum microfone ligado ao dispositivo.",
      NotReadableError: "O microfone está a ser usado por outra aplicação.",
    };
    permissionNote.textContent = messages[error.name] || "Não foi possível aceder ao microfone. Verifica as permissões do navegador.";
    setMicButtonText("Tentar novamente");
  } finally {
    micButton.disabled = false;
  }
}

async function stopListening() {
  running = false;
  cancelAnimationFrame(animationId);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  stream = null;
  audioContext = null;
  source = null;
  analyser = null;
  timeData = null;
  statusText.textContent = "PRONTO A OUVIR";
  statusDot.classList.remove("active");
  setMicButtonText("Começar a ouvir");
  permissionNote.textContent = "O microfone só é ativado quando carregas no botão.";
  frequencyDisplay.textContent = "—";
  document.querySelector(".frequency-unit").innerHTML = "HERTZ <span>(Hz)</span>";
  noteDisplay.textContent = "—";
  noteDescription.textContent = "A frequência aparecerá aqui";
  noteRow.hidden = false;
  micButton.classList.remove("listening");
  drawIdle();
}

micButton.addEventListener("click", () => running ? stopListening() : startListening());
settingsButton.addEventListener("click", () => { settingsPanel.hidden = !settingsPanel.hidden; });
sensitivityInput.addEventListener("input", () => {
  sensitivity = Number(sensitivityInput.value);
  const labels = [[0.005, "Alta"], [0.02, "Média"], [0.05, "Baixa"]];
  sensitivityValue.textContent = labels.find(([limit]) => sensitivity <= limit)?.[1] || "Muito baixa";
});
drawIdle();
