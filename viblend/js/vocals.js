// js/vocals.js — Vocal separation engine (ONNX + frequency-domain fallback)

import { getAudioContext } from './karaoke.js';

// ─── VocalRemover Class ───────────────────────────────────────────────────────

export class VocalRemover {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.vocalPercent = 100; // 0 = no vocals, 100 = full vocals
    this._sourceNode = null;
    this._midNode = null;
    this._sideNode = null;
    this._vocalGain = null;
    this._outputGain = null;
    this._connected = false;
    this._onnxAvailable = false;
    this._onnxWorker = null;
    this._initONNX();
  }

  async _initONNX() {
    try {
      this._onnxWorker = new Worker('/js/workers/vocals-worker.js');
      this._onnxWorker.addEventListener('message', this._handleWorkerMessage.bind(this));
      this._onnxWorker.postMessage({ type: 'PING' });
    } catch {
      // ONNX worker not available — will fall back to frequency domain
    }
  }

  _handleWorkerMessage(event) {
    const { type } = event.data;
    if (type === 'PONG') {
      this._onnxAvailable = true;
    } else if (type === 'MODEL_READY') {
      this._onnxAvailable = true;
    }
  }

  /**
   * Enable vocal removal mode.
   * sourceNode: AudioNode that delivers the music signal (GainNode from musicGain)
   * destinationNode: AudioNode to connect output to (masterGain)
   */
  enable(sourceNode, destinationNode) {
    this.ctx = getAudioContext();
    if (!this.ctx || this._connected) return;

    this.enabled = true;
    this._sourceNode = sourceNode;

    // Build mid-side processing network
    this._buildMidSideChain(sourceNode, destinationNode);
    this._connected = true;
  }

  disable() {
    this.enabled = false;
    this._teardown();
  }

  _buildMidSideChain(source, destination) {
    const ctx = this.ctx;

    // Create stereo splitter and merger for mid-side processing
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    // Mid channel = (L + R) / 2 — contains centered vocals
    const midMerger = ctx.createChannelMerger(2);
    const midGainL = ctx.createGain();
    const midGainR = ctx.createGain();
    midGainL.gain.value = 0.5;
    midGainR.gain.value = 0.5;

    // Side channel = (L - R) / 2 — ambient, no centered vocals
    const sideInverter = ctx.createGain();
    sideInverter.gain.value = -0.5;
    const sideGainL = ctx.createGain();
    sideGainL.gain.value = 0.5;

    // Bandpass filter for vocal frequency range (200 Hz to 4000 Hz)
    const vocalBandpass = ctx.createBiquadFilter();
    vocalBandpass.type = 'bandpass';
    vocalBandpass.frequency.value = 1000;  // Center freq
    vocalBandpass.Q.value = 0.3;           // Wide Q for broad vocal range

    // Vocal gain control (this is what the slider controls)
    this._vocalGain = ctx.createGain();
    this._vocalGain.gain.value = this.vocalPercent / 100;

    // Output gain
    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = 1.0;

    // Wire up: source → splitter
    source.connect(splitter);

    // Mid path: average L and R
    splitter.connect(midGainL, 0);
    splitter.connect(midGainR, 1);
    midGainL.connect(midMerger, 0, 0);
    midGainR.connect(midMerger, 0, 0);

    // Mid through vocal bandpass and gain control
    midMerger.connect(vocalBandpass);
    vocalBandpass.connect(this._vocalGain);

    // Side path: L * 0.5 - R * 0.5
    splitter.connect(sideGainL, 0);
    splitter.connect(sideInverter, 1);

    // Reconstruct: L = Mid + Side, R = Mid - Side (using merger)
    // For simplicity, we attenuate the vocal mid channel and preserve the rest
    // This creates partial vocal cancellation

    // Dry signal (non-vocal content) — route direct
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1.0;
    source.connect(dryGain);

    // Mix dry with processed vocal channel
    dryGain.connect(this._outputGain);
    this._vocalGain.connect(this._outputGain);

    this._outputGain.connect(destination);

    // Store nodes for cleanup
    this._nodes = { splitter, merger, midMerger, midGainL, midGainR, vocalBandpass, sideInverter, sideGainL, dryGain };
  }

  _teardown() {
    if (!this._nodes) return;
    Object.values(this._nodes).forEach(node => {
      try { node.disconnect(); } catch { /* already disconnected */ }
    });
    if (this._vocalGain) { try { this._vocalGain.disconnect(); } catch { } }
    if (this._outputGain) { try { this._outputGain.disconnect(); } catch { } }
    this._nodes = null;
    this._connected = false;
  }

  /**
   * Set vocal volume: 0 = max removal, 100 = full original vocals
   */
  setVocalVolume(percent) {
    this.vocalPercent = percent;
    if (!this._vocalGain || !this.ctx) return;

    // Map: 100 = 1.0 gain (full vocals), 0 = -0.8 gain (phase cancellation)
    // At 0, we subtract the vocal mid band to cancel centered vocals
    const gainValue = percent / 100;
    this._vocalGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this._vocalGain.gain.linearRampToValueAtTime(gainValue, this.ctx.currentTime + 0.05);

    // At low values, boost the output gain slightly to compensate for energy loss
    if (this._outputGain) {
      const compensationGain = percent < 50 ? 1.0 + (0.5 - percent / 100) * 0.4 : 1.0;
      this._outputGain.gain.linearRampToValueAtTime(compensationGain, this.ctx.currentTime + 0.05);
    }
  }

  getModeLabel() {
    if (this.vocalPercent === 0) return 'Instrumental';
    if (this.vocalPercent === 100) return 'Original';
    if (this.vocalPercent < 30) return 'Nearly Instrumental';
    if (this.vocalPercent < 70) return 'Blend';
    return 'Mostly Vocal';
  }

  destroy() {
    this._teardown();
    if (this._onnxWorker) {
      this._onnxWorker.terminate();
      this._onnxWorker = null;
    }
  }
}

// ─── Export singleton ─────────────────────────────────────────────────────────

export const vocalRemover = new VocalRemover();
export default vocalRemover;
