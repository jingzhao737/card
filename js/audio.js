/* ==========================================================================
   高保真自然柔和物理音效合成器 (Organic Acoustic Card Sound Engine)
   ========================================================================== */

class AudioSynth {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.cardFlipBuffer = null;
        this.isBufferLoading = false;
        this.stoneDropBuffer = null;
        this.isStoneBufferLoading = false;
        this.mahjongTileBuffer = null;
        this.isMahjongBufferLoading = false;
        this.mahjongShuffleBuffer = null;
        this.isMahjongShuffleBufferLoading = false;
        this.mobileAudioUnlocked = false;
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        if (this.ctx) {
            if (!this.cardFlipBuffer && !this.isBufferLoading) {
                this.loadCardFlipBuffer();
            }
            if (!this.stoneDropBuffer && !this.isStoneBufferLoading) {
                this.loadStoneDropBuffer();
            }
            if (!this.mahjongTileBuffer && !this.isMahjongBufferLoading) {
                this.loadMahjongTileBuffer();
            }
            if (!this.mahjongShuffleBuffer && !this.isMahjongShuffleBufferLoading) {
                this.loadMahjongShuffleBuffer();
            }
        }
    }

    /**
     * 移动端 (iOS Safari / Android Chrome / 微信) 首次触摸极速解封音频引擎
     */
    unlockMobileAudio() {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        // 解封 HTML5 Audio 标签 (iOS Safari 关键静音触发解封)
        ['audioCardFlip', 'audioStoneDrop', 'audioMahjongTile', 'audioMahjongShuffle'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !this.mobileAudioUnlocked) {
                try {
                    el.volume = 0.001;
                    const p = el.play();
                    if (p !== undefined) {
                        p.then(() => {
                            el.pause();
                            el.currentTime = 0;
                            el.volume = 0.85;
                        }).catch(() => {});
                    }
                } catch (e) {}
            }
        });
        this.mobileAudioUnlocked = true;
    }

    async loadCardFlipBuffer() {
        if (this.cardFlipBuffer || this.isBufferLoading) return;
        this.isBufferLoading = true;
        try {
            const response = await fetch('sound/card-flip.wav');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.cardFlipBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isBufferLoading = 'failed';
            }
        } catch (e) {
            this.isBufferLoading = 'failed';
        }
    }

    async loadStoneDropBuffer() {
        if (this.stoneDropBuffer || this.isStoneBufferLoading) return;
        this.isStoneBufferLoading = true;
        try {
            const response = await fetch('sound/placing-a-piece.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.stoneDropBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isStoneBufferLoading = 'failed';
            }
        } catch (e) {
            this.isStoneBufferLoading = 'failed';
        }
    }

    async loadMahjongTileBuffer() {
        if (this.mahjongTileBuffer || this.isMahjongBufferLoading) return;
        this.isMahjongBufferLoading = true;
        try {
            const response = await fetch('sound/mahjangclack-1.wav');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongTileBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongBufferLoading = 'failed';
        }
    }

    async loadMahjongShuffleBuffer() {
        if (this.mahjongShuffleBuffer || this.isMahjongShuffleBufferLoading) return;
        this.isMahjongShuffleBufferLoading = true;
        try {
            const response = await fetch('sound/mahjong-shuffle.wav');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongShuffleBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongShuffleBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongShuffleBufferLoading = 'failed';
        }
    }

    toggleSound() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * 五子棋落子音效：放大大音量，并为每次落子加入极度丰富的声音与速度动态变化
     * @param {boolean} isWhite - 是否为白棋
     */
    playStoneDrop(isWhite = false) {
        if (!this.enabled) return;
        this.init();

        // 1. 优先使用 Web Audio API 解码的真实音频 Buffer 播放
        if (this.ctx && this.stoneDropBuffer) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            try {
                const source = this.ctx.createBufferSource();
                const gain = this.ctx.createGain();
                source.buffer = this.stoneDropBuffer;

                // 速度与音高丰富随机抖动 (速度范围 0.88x - 1.22x, 每颗子绝不重样)
                const speedVar = 0.88 + Math.random() * 0.34; // 速度 0.88 ~ 1.22 随机变化
                const colorTone = isWhite ? 1.06 : 0.95;       // 白棋清脆、黑棋沉稳
                source.playbackRate.value = colorTone * speedVar;

                // 音量加大 (提升至 1.75 强劲音量，带 ±0.25 动态力度震荡)
                const dynamicVolume = 1.75 + (Math.random() * 0.5 - 0.25);
                gain.gain.value = dynamicVolume;

                source.connect(gain);
                gain.connect(this.ctx.destination);
                source.start(0);
                return;
            } catch (e) {
                // 回退下述方案
            }
        }

        // 2. 次选：HTML5 Audio 标签 DOM 播放 (最大音量 1.0)
        const htmlAudio = document.getElementById('audioStoneDrop');
        if (htmlAudio) {
            try {
                htmlAudio.currentTime = 0;
                htmlAudio.volume = 1.0;
                htmlAudio.playbackRate = 0.9 + Math.random() * 0.25;
                htmlAudio.play().catch(() => {});
                return;
            } catch (e) {}
        }

        // 3. 兜底：合成器物理清脆碰撞声 (同步增大音量与速度变化)
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const speedVar = 0.88 + Math.random() * 0.34;
        const pitchMod = (isWhite ? 1.1 : 0.9) * speedVar;
        const startFreq = 850 * pitchMod;
        const endFreq = 180 * pitchMod;
        const duration = (0.045 + Math.random() * 0.02) / speedVar;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = isWhite ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.65, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.01);
    }

    /**
     * 选牌音效：柔和自然弹纸声 (Soft Organic Card Pop)
     */
    playCardSelect() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 主音调：柔和正弦波渐变 (520Hz -> 720Hz)，带有 3ms 柔和 Attack 避免生硬
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(720, now + 0.035);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.14, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        // 辅音：低通滤波纸张碰撞微响 (Lowpass Friction)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.02);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(1600, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.08, now + 0.003);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        noise.connect(lowpass);
        lowpass.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        osc.start(now);
        noise.start(now);
        osc.stop(now + 0.035);
    }

    /**
     * 取消选牌音效：温和落手声 (Soft Organic Deselect Tok)
     */
    playCardDeselect() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 主音调：平滑降音 (580Hz -> 360Hz)，带 3ms 柔和缓冲
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(360, now + 0.035);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.035);
    }

    /**
     * 理牌音效：快速滑牌/洗牌纸擦刷音 (Fast Card Riffle / Sort Sound)
     */
    playCardSort() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const pitches = [480, 600, 720, 850];

        pitches.forEach((freq, i) => {
            const startTime = now + i * 0.025; // 每 25ms 弹响一次

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            osc.frequency.exponentialRampToValueAtTime(freq + 120, startTime + 0.02);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.12, startTime + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.02);

            const bufferSize = Math.floor(this.ctx.sampleRate * 0.015);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let k = 0; k < bufferSize; k++) {
                data[k] = (Math.random() * 2 - 1) * Math.exp(-k / (bufferSize * 0.3));
            }

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(2200 + i * 300, startTime);
            filter.Q.setValueAtTime(2, startTime);

            const noiseGain = this.ctx.createGain();
            noiseGain.gain.setValueAtTime(0.001, startTime);
            noiseGain.gain.linearRampToValueAtTime(0.1, startTime + 0.002);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.015);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(this.ctx.destination);

            noise.start(startTime);
        });
    }

    /**
     * 出牌音效：沉稳绒布桌面触牌声 (Warm Felt Table Slap)
     */
    playCardPlay() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 沉稳牌桌触击低音 (Table Thud)
        const thudOsc = this.ctx.createOscillator();
        const thudGain = this.ctx.createGain();
        thudOsc.type = 'sine';
        thudOsc.frequency.setValueAtTime(140, now);
        thudOsc.frequency.exponentialRampToValueAtTime(45, now + 0.07);

        thudGain.gain.setValueAtTime(0.001, now);
        thudGain.gain.linearRampToValueAtTime(0.28, now + 0.005);
        thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        thudOsc.connect(thudGain);
        thudGain.connect(this.ctx.destination);

        // 2. 柔和牌面擦落声 (Soft Friction)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.04);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(300, now + 0.04);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.004);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        thudOsc.start(now);
        noise.start(now);
        thudOsc.stop(now + 0.07);
    }

    /**
     * 不出/过 音效：轻柔木块扣击 (Gentle Muted Tap)
     */
    playPass() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.11, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
    }

    /**
     * 抢地主/叫分音效：暖色三和弦风铃 (Warm Chime)
     */
    playBid() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99];

        freqs.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.06);

            const startTime = now + i * 0.06;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.12, startTime + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.25);
        });
    }

    /**
     * 炸弹音效：沉稳低音轰鸣 (Deep Warm Bomb)
     */
    playBomb() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 低音震感 drop
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(100, now);
        sub.frequency.exponentialRampToValueAtTime(30, now + 0.4);

        subGain.gain.setValueAtTime(0.001, now);
        subGain.gain.linearRampToValueAtTime(0.45, now + 0.01);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        sub.connect(subGain);
        subGain.connect(this.ctx.destination);

        // 2. 温暖炸弹轰鸣 (Warm Lowpass Noise)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.4);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(35, now + 0.4);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.35, now + 0.01);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        sub.start(now);
        noise.start(now);
        sub.stop(now + 0.4);
    }

    /**
     * 胜利音效：圆润舒缓五音和弦 (Smooth Victory Fanfare)
     */
    playWin() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];

        notes.forEach((freq, index) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + index * 0.08);

            const startTime = now + index * 0.08;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.15, startTime + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.35);
        });
    }

    /**
     * 倒计时嘀声
     */
    playCountdownTick() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(784, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
    }

    /**
     * 3秒开局倒计时嘀声 (Beep for 3, 2, 1)
     */
    playCountdownBeep(sec) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const freq = sec === 3 ? 440 : sec === 2 ? 554 : 659;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.12);
    }

    /**
     * 开局倒计时冲刺/抢！提示音 (High pitch chord flourish for GO!)
     */
    playCountdownGo() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        [880, 1108, 1320].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.035);

            gain.gain.setValueAtTime(0.001, now + idx * 0.035);
            gain.gain.linearRampToValueAtTime(0.22, now + idx * 0.035 + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.035 + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.035);
            osc.stop(now + idx * 0.035 + 0.25);
        });
    }

    /**
     * 解闷气球按压挤压音效 (使用单例 SoundEngine.ctx，永不上限卡死)
     */
    playToySqueeze(stage) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        const startFreq = 240 + stage * 40;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(startFreq + 80, now + 0.07);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
    }

    /**
     * 解闷气球啪！爆炸音效 (使用单例 SoundEngine.ctx，永不上限卡死)
     */
    playToyPop() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 爆裂噪点
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.09);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.12));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + 0.09);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start(now);

        // 2. 低音冲击
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.07);

        oscGain.gain.setValueAtTime(0.7, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
    }

    /**
     * 播放真实卡牌翻转音效 (sound/card-flip.wav) - 1.4倍速
     * 支持 Web Audio API 解码 Buffer + HTML5 Audio 预加载节点 (100% 兼容 GitHub Pages & 移动端)
     */
    playCardFlipSound() {
        if (!this.enabled) return;
        this.init();

        // 优先使用 Web Audio API 解码 Buffer (0延迟、100%免疫跨域/阻断，支持 1.4x 变速)
        if (this.ctx && this.cardFlipBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.cardFlipBuffer;
                source.playbackRate.value = 1.4;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 0.85;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {
                // 回退
            }
        }

        // 备用方案 1: 使用 index.html 预加载的 HTML5 Audio DOM 节点
        const el = document.getElementById('audioCardFlip');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.85;
                clone.playbackRate = 1.4;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {
                        if (typeof this.playCardPlace === 'function') this.playCardPlace();
                    });
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/card-flip.wav');
            audio.volume = 0.85;
            audio.playbackRate = 1.4;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    if (typeof this.playCardPlace === 'function') {
                        this.playCardPlace();
                    }
                });
            }
        } catch (e) {
            if (typeof this.playCardPlace === 'function') {
                this.playCardPlace();
            }
        }
    }

    /**
     * 播放真实国粹麻将牌落牌碰撞音效 (sound/mahjangclack-1.wav)
     * 优先使用 Web Audio API 解码 Buffer (0延迟、100%免疫阻断)，备用使用 HTML5 Audio 节点与合成器
     */
    playMahjongTile() {
        if (!this.enabled) return;
        try {
            this.init();
        } catch (e) {
            // 音频初始化失败(如浏览器策略限制)绝不影响游戏流程
        }

        // 优先使用 Web Audio API 解码 Buffer (0 延迟、100% 免疫阻断)
        if (this.ctx && this.mahjongTileBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongTileBuffer;
                // 自然微随机变调 0.98~1.04 (模仿真实物理麻将碰撞声差异)
                source.playbackRate.value = 0.98 + Math.random() * 0.06;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 1.0;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {
                // 回退
            }
        }

        // 备用方案 1: HTML5 Audio DOM 节点
        const el = document.getElementById('audioMahjongTile');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.95;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {});
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/mahjangclack-1.wav');
            audio.volume = 0.95;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        } catch (e) {}
    }

    /**
     * 播放开局麻将洗牌/搓牌音效 (sound/mahjong-shuffle.wav)
     */
    playMahjongShuffle() {
        if (!this.enabled) return;
        try {
            this.init();
        } catch (e) {}

        // 优先使用 Web Audio API 解码 Buffer
        if (this.ctx && this.mahjongShuffleBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongShuffleBuffer;
                source.playbackRate.value = 1.0;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 0.95;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {}
        }

        // 备用方案 1: HTML5 Audio DOM 节点
        const el = document.getElementById('audioMahjongShuffle');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.95;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {});
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/mahjong-shuffle.wav');
            audio.volume = 0.95;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        } catch (e) {}
    }
}

const SoundEngine = new AudioSynth();
window.SoundEngine = SoundEngine;
window.audioSynth  = SoundEngine;

// 全局绑定移动端 (iOS Safari / Android / 微信) 触摸极速解封音频引擎
const _unlockAudioOnTouch = () => {
    if (window.SoundEngine) {
        window.SoundEngine.unlockMobileAudio();
    }
};
window.addEventListener('touchstart', _unlockAudioOnTouch, { passive: true, capture: true });
window.addEventListener('touchend', _unlockAudioOnTouch, { passive: true, capture: true });
window.addEventListener('click', _unlockAudioOnTouch, { capture: true });
