/**
 * Echo Studio - Audio Processing Engine
 * Ported from MATLAB EchoGeneratorApp
 */

class EchoStudio {
        constructor() {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                this.inputBuffer = null;
                this.outputBuffer = null;
                this.sourceNode = null;
                this.sampleRate = 44100;

                // UI elements
                this.initUI();
                this.bindEvents();
        }

        initUI() {
                this.upload = document.getElementById('audio-upload');
                this.genBtn = document.getElementById('generate-test');
                this.processBtn = document.getElementById('process-btn');
                this.playInput = document.getElementById('play-input');
                this.playOutput = document.getElementById('play-output');
                this.stopBtn = document.getElementById('stop-btn');
                this.saveBtn = document.getElementById('save-btn');

                this.alphaSlider = document.getElementById('alpha-slider');
                this.delaySlider = document.getElementById('delay-slider');
                this.tailSlider = document.getElementById('tail-slider');

                this.alphaVal = document.getElementById('alpha-value');
                this.delayVal = document.getElementById('delay-value');
                this.tailVal = document.getElementById('tail-value');

                this.status = document.getElementById('status-label');
                this.info = document.getElementById('info-content');
                this.fileInfo = document.getElementById('file-info');

                this.inputCanvas = document.getElementById('input-canvas');
                this.outputCanvas = document.getElementById('output-canvas');
        }

        bindEvents() {
                this.upload.addEventListener('change', (e) => this.handleUpload(e));
                this.genBtn.addEventListener('click', () => this.generateTestSignal());
                this.processBtn.addEventListener('click', () => this.processAudio());

                this.playInput.addEventListener('click', () => this.playBuffer(this.inputBuffer));
                this.playOutput.addEventListener('click', () => this.playBuffer(this.outputBuffer));
                this.stopBtn.addEventListener('click', () => this.stopPlayback());
                this.saveBtn.addEventListener('click', () => this.downloadOutput());

                this.alphaSlider.addEventListener('input', () => {
                        this.alphaVal.textContent = parseFloat(this.alphaSlider.value).toFixed(2);
                });
                this.delaySlider.addEventListener('input', () => {
                        this.delayVal.textContent = `${this.delaySlider.value} ms`;
                });
                this.tailSlider.addEventListener('input', () => {
                        this.tailVal.textContent = `${parseFloat(this.tailSlider.value).toFixed(1)} s`;
                });

                // Resize observer for canvases
                const resizeObserver = new ResizeObserver(() => {
                        this.drawWaveform(this.inputCanvas, this.inputBuffer ? this.inputBuffer.getChannelData(0) : null, '#60a5fa');
                        this.drawWaveform(this.outputCanvas, this.outputBuffer ? this.outputBuffer.getChannelData(0) : null, '#a78bfa');
                });
                resizeObserver.observe(this.inputCanvas);
                resizeObserver.observe(this.outputCanvas);
        }

        async handleUpload(e) {
                const file = e.target.files[0];
                if (!file) return;

                this.updateStatus('Loading audio...', 'warning');
                try {
                        const arrayBuffer = await file.arrayBuffer();
                        this.inputBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                        this.sampleRate = this.inputBuffer.sampleRate;

                        // Mix to mono if needed
                        if (this.inputBuffer.numberOfChannels > 1) {
                                this.info.textContent += `Notice: Stereo downmixed to Mono\n`;
                        }

                        this.fileInfo.textContent = `${file.name} (${(this.inputBuffer.duration).toFixed(1)}s)`;
                        this.drawWaveform(this.inputCanvas, this.inputBuffer.getChannelData(0), '#60a5fa');

                        this.processBtn.disabled = false;
                        this.playInput.disabled = false;
                        this.updateStatus('Audio loaded', 'success');
                } catch (err) {
                        console.error(err);
                        this.updateStatus('Error loading audio', 'error');
                }
        }

        generateTestSignal() {
                this.updateStatus('Generating test signal...', 'warning');
                const duration = 5;
                const fs = 44100;
                const length = duration * fs;
                const sig = new Float32Array(length);

                // Chirp (200Hz to 2000Hz)
                const f0 = 200;
                const f1 = 2000;
                const beta = (f1 - f0) / duration;
                for (let i = 0; i < length; i++) {
                        const t = i / fs;
                        // Phase for linear chirp: 2*pi * (f0*t + 0.5*beta*t^2)
                        const phase = 2 * Math.PI * (f0 * t + 0.5 * beta * t * t);
                        sig[i] = 0.3 * Math.sin(phase);
                }

                // Burst logic
                for (let bt = 0.5; bt < 4.5; bt += 1.5) {
                        const bs = Math.floor(bt * fs);
                        const be = Math.min(bs + Math.floor(0.3 * fs), length);
                        const bf = 400 + 200 * (bt / 5);

                        for (let i = bs; i < be; i++) {
                                const bt_vec = (i - bs) / fs;
                                const env = Math.sin(Math.PI * bt_vec / (0.3));
                                sig[i] += 0.4 * env * Math.sin(2 * Math.PI * bf * bt_vec);
                        }
                }

                // Normalize
                let maxVal = 0;
                for (let i = 0; i < length; i++) if (Math.abs(sig[i]) > maxVal) maxVal = Math.abs(sig[i]);
                if (maxVal > 0) {
                        for (let i = 0; i < length; i++) sig[i] = (sig[i] / maxVal) * 0.8;
                }

                this.inputBuffer = this.audioCtx.createBuffer(1, length, fs);
                this.inputBuffer.copyToChannel(sig, 0);
                this.sampleRate = fs;

                this.fileInfo.textContent = `Generated Test Signal (5.0s)`;
                this.drawWaveform(this.inputCanvas, sig, '#60a5fa');

                this.processBtn.disabled = false;
                this.playInput.disabled = false;
                this.updateStatus('Test signal generated', 'success');
        }

        processAudio() {
                if (!this.inputBuffer) return;

                this.updateStatus('Processing...', 'warning');

                // Ensure UI stays responsive
                setTimeout(() => {
                        const alpha = parseFloat(this.alphaSlider.value);
                        const delayMs = parseFloat(this.delaySlider.value);
                        const tailDur = parseFloat(this.tailSlider.value);

                        const nd = Math.round((delayMs / 1000) * this.sampleRate);
                        const N = this.inputBuffer.length;
                        const tailSamples = Math.round(tailDur * this.sampleRate);
                        const totalSamples = N + tailSamples;

                        const x = this.inputBuffer.getChannelData(0);
                        const y = new Float32Array(totalSamples);

                        /**
                         * Echo algorithm: Y[n] = x[n] + alpha * Y[n - nd]
                         * This matches the MATLAB implementation exactly.
                         */
                        for (let n = 0; n < totalSamples; n++) {
                                const x_val = n < N ? x[n] : 0;
                                if (n < nd) {
                                        y[n] = x_val;
                                } else {
                                        y[n] = x_val + alpha * y[n - nd];
                                }
                        }

                        // Normalize safely
                        let maxVal = 0;
                        for (let i = 0; i < totalSamples; i++) if (Math.abs(y[i]) > maxVal) maxVal = Math.abs(y[i]);
                        if (maxVal > 1.0) {
                                for (let i = 0; i < totalSamples; i++) y[i] = (y[i] / maxVal) * 0.95;
                        }

                        this.outputBuffer = this.audioCtx.createBuffer(1, totalSamples, this.sampleRate);
                        this.outputBuffer.copyToChannel(y, 0);

                        this.drawWaveform(this.outputCanvas, y, '#a78bfa');

                        this.info.textContent = `✓ Processed successfully\n` +
                                `α = ${alpha.toFixed(2)}, Delay = ${delayMs}ms\n` +
                                `Input: ${(N / this.sampleRate).toFixed(2)}s\n` +
                                `Output: ${(totalSamples / this.sampleRate).toFixed(2)}s`;

                        this.playOutput.disabled = false;
                        this.saveBtn.disabled = false;
                        this.updateStatus('Processing complete!', 'success');
                }, 50);
        }

        drawWaveform(canvas, data, color) {
                if (!data) return;
                const ctx = canvas.getContext('2d');
                const width = canvas.width = canvas.parentElement.clientWidth;
                const height = canvas.height = canvas.parentElement.clientHeight;

                ctx.clearRect(0, 0, width, height);

                // Draw center line
                ctx.strokeStyle = '#334155';
                ctx.beginPath();
                ctx.moveTo(0, height / 2);
                ctx.lineTo(width, height / 2);
                ctx.stroke();

                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();

                const step = Math.ceil(data.length / width);
                const amp = height / 2;

                for (let i = 0; i < width; i++) {
                        let min = 1.0;
                        let max = -1.0;
                        for (let j = 0; j < step; j++) {
                                const datum = data[(i * step) + j];
                                if (datum < min) min = datum;
                                if (datum > max) max = datum;
                        }
                        ctx.moveTo(i, (1 + min) * amp);
                        ctx.lineTo(i, (1 + max) * amp);
                }
                ctx.stroke();
        }

        playBuffer(buffer) {
                if (!buffer) return;
                this.stopPlayback();

                this.sourceNode = this.audioCtx.createBufferSource();
                this.sourceNode.buffer = buffer;
                this.sourceNode.connect(this.audioCtx.destination);
                this.sourceNode.start();
        }

        stopPlayback() {
                if (this.sourceNode) {
                        try { this.sourceNode.stop(); } catch (e) { }
                        this.sourceNode = null;
                }
        }

        updateStatus(text, type) {
                this.status.textContent = text;
                this.status.className = 'process-status status-' + type;
                if (type === 'success') this.status.style.color = 'var(--success)';
                if (type === 'warning') this.status.style.color = 'var(--warning)';
                if (type === 'error') this.status.style.color = '#ef4444';
        }

        downloadOutput() {
                if (!this.outputBuffer) return;
                const wavBlob = this.bufferToWave(this.outputBuffer);
                const url = URL.createObjectURL(wavBlob);
                const a = document.createElement('a');
                const alpha = parseFloat(this.alphaSlider.value);
                const delay = this.delaySlider.value;
                a.href = url;
                a.download = `echo_alpha${alpha.toFixed(1)}_delay${delay}ms.wav`;
                a.click();
                URL.revokeObjectURL(url);
        }

        // WAV encoding helper
        bufferToWave(abuffer) {
                const length = abuffer.length * 1 * 2 + 44;
                const buffer = new ArrayBuffer(length);
                const view = new DataView(buffer);
                const channelData = abuffer.getChannelData(0);
                let offset = 0;

                const writeString = (s) => {
                        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
                        offset += s.length;
                };

                writeString('RIFF');
                view.setUint32(offset, length - 8, true); offset += 4;
                writeString('WAVE');
                writeString('fmt ');
                view.setUint32(offset, 16, true); offset += 4;
                view.setUint16(offset, 1, true); offset += 2;
                view.setUint16(offset, 1, true); offset += 2;
                view.setUint32(offset, abuffer.sampleRate, true); offset += 4;
                view.setUint32(offset, abuffer.sampleRate * 2, true); offset += 4;
                view.setUint16(offset, 2, true); offset += 2;
                view.setUint16(offset, 16, true); offset += 2;
                writeString('data');
                view.setUint32(offset, length - offset - 4, true); offset += 4;

                for (let i = 0; i < channelData.length; i++, offset += 2) {
                        const s = Math.max(-1, Math.min(1, channelData[i]));
                        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                }

                return new Blob([buffer], { type: 'audio/wav' });
        }
}

// Spark the engine
window.addEventListener('DOMContentLoaded', () => {
        window.studio = new EchoStudio();
});
