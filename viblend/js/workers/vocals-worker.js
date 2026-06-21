// js/workers/vocals-worker.js — ONNX Runtime Web worker for stem separation

// Attempt to load ONNX Runtime Web
let ort = null;
let session = null;
let modelLoading = false;
let modelLoaded = false;

try {
  importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
  ort = self.ort;
} catch (e) {
  // ONNX not available — worker will inform main thread
  ort = null;
}

self.addEventListener('message', async (event) => {
  const { type, ...data } = event.data;

  switch (type) {
    case 'PING':
      self.postMessage({ type: ort ? 'PONG' : 'UNAVAILABLE' });
      break;

    case 'LOAD_MODEL':
      await loadModel();
      break;

    case 'PROCESS_CHUNK':
      await processChunk(data);
      break;

    case 'TERMINATE':
      session = null;
      self.close();
      break;
  }
});

async function loadModel() {
  if (!ort) {
    self.postMessage({ type: 'MODEL_ERROR', error: 'ONNX Runtime not available' });
    return;
  }
  if (modelLoaded) {
    self.postMessage({ type: 'MODEL_READY' });
    return;
  }
  if (modelLoading) return;

  modelLoading = true;
  try {
    session = await ort.InferenceSession.create('/models/demucs_small.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    modelLoaded = true;
    modelLoading = false;
    self.postMessage({ type: 'MODEL_READY' });
  } catch (e) {
    modelLoading = false;
    self.postMessage({ type: 'MODEL_ERROR', error: e.message });
    // Signal to main thread to use frequency-domain fallback
  }
}

async function processChunk({ audioData, sampleRate, chunkId }) {
  if (!session || !ort) {
    // Fall back — tell main thread to use frequency domain
    self.postMessage({ type: 'CHUNK_FALLBACK', chunkId });
    return;
  }

  try {
    // Convert to Float32Array if needed
    const float32 = audioData instanceof Float32Array
      ? audioData
      : new Float32Array(audioData);

    // Create input tensor — Demucs expects shape [1, 2, samples]
    // For mono, duplicate channel
    const stereoData = new Float32Array(2 * float32.length);
    for (let i = 0; i < float32.length; i++) {
      stereoData[i] = float32[i];
      stereoData[i + float32.length] = float32[i];
    }

    const inputTensor = new ort.Tensor('float32', stereoData, [1, 2, float32.length]);
    const feeds = { input: inputTensor };

    const results = await session.run(feeds);

    // Extract vocals and instrumental outputs
    // Output names depend on model export — try common names
    const outputNames = Object.keys(results);
    const instrumental = results[outputNames[0]]?.data || float32;
    const vocals = results[outputNames[1]]?.data || new Float32Array(float32.length);

    self.postMessage({
      type: 'CHUNK_RESULT',
      chunkId,
      instrumental: Array.from(instrumental),
      vocals: Array.from(vocals),
    });
  } catch (e) {
    self.postMessage({ type: 'CHUNK_FALLBACK', chunkId, error: e.message });
  }
}
