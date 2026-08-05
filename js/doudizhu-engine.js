/**
 * 游鲸棋牌 - 斗地主核心游戏引擎 (DouDizhuEngine)
 * 负责斗地主洗牌/发牌/叫地主流转/打牌扣牌/出牌校验/AI机器人决策与结算
 */
const DouDizhuEngine = {
    /**
     * 开始新一局 (洗牌、发牌、全员就位加载完毕后展开 3秒倒计时 + 动态进度条)
     */
    startNewRound(gameEngine) {
        const engine = gameEngine || window.GameEngine;
        if (!engine) return;

        const waitScr = document.getElementById('waitingScreen');
        const gameM = document.getElementById('gameOverModal');
        const gameT = document.getElementById('gameTable');

        if (waitScr) waitScr.style.display = 'none';
        if (gameM) gameM.style.display = 'none';
        if (gameT) gameT.style.display = 'grid';

        if (typeof engine.updateHeaderVisibility === 'function') {
            engine.updateHeaderVisibility();
        }

        const _btnLeave = document.getElementById('btnLeaveRoom');
        if (_btnLeave) _btnLeave.style.display = 'inline-flex';
        const menuLeaveBtn4 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn4) menuLeaveBtn4.style.display = 'flex';

        // 清除上一局残留的回合倒计时 interval
        if (engine.turnTimerInterval) {
            clearInterval(engine.turnTimerInterval);
            engine.turnTimerInterval = null;
        }

        // 清除 AI 调度守卫 key
        engine._aiScheduleKey = null;

        // 彻底重置界面 DOM & 选牌状态 & 气泡 & 残余展示牌
        if (typeof UIRenderer !== 'undefined') {
            UIRenderer.resetGameTableUI();
        }

        // 1. 生成局次唯一卡牌洗牌
        engine.roundCounter = (engine.roundCounter || 0) + 1;
        const deck = DouDizhuRules.shuffle(DouDizhuRules.createDeck(engine.roundCounter));

        // 2. 发牌: 3人各 17 张原始手牌，留 3 张底牌
        const p0Hand = deck.slice(0, 17);
        const p1Hand = deck.slice(17, 34);
        const p2Hand = deck.slice(34, 51);
        const bottom = deck.slice(51, 54);

        // 3. 构造重置 GameState
        engine.gameState.phase = 'BIDDING';
        engine.gameState.players[0].hand = p0Hand;
        engine.gameState.players[1].hand = p1Hand;
        engine.gameState.players[2].hand = p2Hand;

        engine.gameState.players.forEach(p => {
            p.role = 'FARMER';
            p.passedBid = false;
        });

        engine.gameState.bottomCards = bottom;
        engine.gameState.currentTurn = 0;
        engine.gameState.landlordIndex = -1;
        engine.gameState.highestBid = 0;
        engine.gameState.highestBidder = -1;
        engine.gameState.bidsCount = 0;
        engine.gameState.lastPlay = null;
        engine.gameState.recentPlays = {
            0: { cards: [], isLatest: false },
            1: { cards: [], isLatest: false },
            2: { cards: [], isLatest: false }
        };
        engine.gameState.multiplier = 1;
        engine.gameState.winnerIndex = -1;
        engine.gameState.readyPlayers = [false, false, false];

        engine._hasPlayedSortSoundThisRound = false;

        // 先标记开局倒计时状态与统一绝对起始时间，再广播
        engine.gameState.openingStartTime = Date.now();
        engine.gameState.isOpeningCountdown = true;

        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(engine.gameState);
        }

        // 触发本地 3 秒全员就位加载倒计时与动态进度条
        this.startOpeningCountdown(engine);
    },

    /**
     * 确认人齐加载完毕后的 3 秒开局倒计时与动态进度条
     */
    startOpeningCountdown(gameEngine) {
        const engine = gameEngine || window.GameEngine;
        if (!engine) return;

        const overlay = document.getElementById('startCountdownOverlay');
        const numEl = document.getElementById('startCountdownNum');
        const lightRed = document.getElementById('trafficLightRed');
        const lightYellow = document.getElementById('trafficLightYellow');
        const lightGreen = document.getElementById('trafficLightGreen');

        if (overlay) overlay.style.display = 'flex';

        engine._isCountingDownLocally = true;
        if (typeof engine.updateControlButtons === 'function') {
            engine.updateControlButtons(NetworkManager.myPlayerIndex);
        }

        const totalDuration = 3000;
        const startTime = Date.now();
        const step = 50;

        let lastPlayedSec = -1;
        const updateLights = (sec) => {
            if (lightRed) lightRed.classList.toggle('active', sec === 3 || sec === 0);
            if (lightYellow) lightYellow.classList.toggle('active', sec === 2 || sec === 0);
            if (lightGreen) lightGreen.classList.toggle('active', sec === 1 || sec === 0);

            if (sec !== lastPlayedSec) {
                lastPlayedSec = sec;
                if (typeof SoundEngine !== 'undefined') {
                    if (sec === 3 || sec === 2 || sec === 1) {
                        SoundEngine.playCountdownBeep(sec);
                    } else if (sec === 0) {
                        SoundEngine.playCountdownGo();
                    }
                }
            }

            if (numEl) {
                if (sec === 3) {
                    numEl.textContent = '3';
                    numEl.className = 'start-number num-red';
                } else if (sec === 2) {
                    numEl.textContent = '2';
                    numEl.className = 'start-number num-yellow';
                } else if (sec === 1) {
                    numEl.textContent = '1';
                    numEl.className = 'start-number num-green';
                } else {
                    numEl.textContent = '抢！';
                    numEl.className = 'start-number num-go';
                }
            }
        };

        updateLights(3);

        clearInterval(engine._startCountdownTimer);
        engine._startCountdownTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remainingSecs = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
            updateLights(remainingSecs);

            if (elapsed >= totalDuration) {
                clearInterval(engine._startCountdownTimer);
                engine._isCountingDownLocally = false;
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    if (NetworkManager.isHost) {
                        engine.gameState.isOpeningCountdown = false;
                        NetworkManager.broadcastState(engine.gameState);
                        if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('🔥 3秒到！手速抢地主开始！');
                        if (typeof SoundEngine !== 'undefined') SoundEngine.playBid();

                        if (NetworkManager.isAiMode) {
                            this.scheduleAiBids(engine);
                        }
                    }
                    if (typeof engine.updateControlButtons === 'function') {
                        engine.updateControlButtons(NetworkManager.myPlayerIndex);
                    }
                }, 200);
            }
        }, step);
    },

    /**
     * AI 机器人叫地主模拟调度
     */
    scheduleAiBids(gameEngine) {
        const engine = gameEngine || window.GameEngine;
        if (!engine || engine.gameState.phase !== 'BIDDING') return;

        const currentTurn = engine.gameState.currentTurn;
        const p = engine.gameState.players[currentTurn];

        if (p && p.isAi) {
            setTimeout(() => {
                if (engine.gameState.phase === 'BIDDING' && engine.gameState.currentTurn === currentTurn) {
                    const bidChoice = Math.random() > 0.4 ? 3 : 0;
                    engine.handlePlayerAction(currentTurn, 'BID', bidChoice);
                }
            }, 1000 + Math.random() * 1200);
        }
    },

    /**
     * AI 出牌决策智商算法
     */
    getAiPlayDecision(handCards, lastPlay, playerIndex) {
        if (!handCards || handCards.length === 0) return [];

        const sortedHand = DouDizhuRules.sortCards(handCards, true);
        const isFreePlay = !lastPlay || !lastPlay.cards || lastPlay.cards.length === 0 || lastPlay.playerIndex === playerIndex;

        if (isFreePlay) {
            // 首出：找能带牌的三张或最小单牌/对子
            const smartHint = DouDizhuRules.findSmartHint(handCards, null);
            return smartHint && smartHint.length > 0 ? smartHint : [sortedHand[0]];
        }

        // 压牌提示
        const hintCards = DouDizhuRules.findSmartHint(handCards, lastPlay);
        if (hintCards && hintCards.length > 0) {
            return hintCards;
        }

        // 默认放弃过牌
        return [];
    }
};

window.DouDizhuEngine = DouDizhuEngine;
