/* ====================================================================
   game-doudizhu.js (从 main.js 拆分, 原型扩展 GameEngineController)
   拆分目标: 主页代码与各游戏对局代码解耦, 减少修改造成的链式影响
   注意: 本文件必须在 main.js (GameEngineController 类定义) 之后加载
   ==================================================================== */
Object.assign(GameEngineController.prototype, {

    /**
     * 补齐机器人并开始
     */
    fillAiAndStart() {
        for (let i = 1; i <= 2; i++) {
            if (!this.gameState.players[i].name || this.gameState.players[i].name.includes('等待')) {
                this.gameState.players[i].name = `AI-${i}`;
                this.gameState.players[i].isAi = true;
            }
        }
        this.startNewRound();
    },
    /**
     * 启动单机练习模式 (对战 2 个 AI 机器人)
     */
    startAiGame(nickname) {
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        // 进入斗地主前同样清理麻将后台定时器，防止麻将音效残留
        this.stopMahjongGame();

        this.gameState.players[0] = { id: 0, name: nickname, hand: [], isAi: false, isHost: true, role: 'FARMER', passedBid: false };
        this.gameState.players[1] = { id: 1, name: 'AI-1', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };
        this.gameState.players[2] = { id: 2, name: 'AI-2', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };

        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.startNewRound();
    },
    /**
     * 开始新一局 (洗牌、发牌、全员就位加载完毕后展开 3秒倒计时 + 动态进度条)
     */
    startNewRound() {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
            AuthEngine.checkAndDeductEntryFee('DOUDIZHU', isPve);
        }

        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameOverModal').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.updateHeaderVisibility();
        const _btnLeave = document.getElementById('btnLeaveRoom');
        if (_btnLeave) _btnLeave.style.display = 'inline-flex';
        const menuLeaveBtn4 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn4) menuLeaveBtn4.style.display = 'flex';

        // Bug 修复：清除上一局残留的回合倒计时 interval，防止上局 timer 继续触发 handleTurnTimeout
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }

        // Bug 修复：清除 AI 调度守卫 key，防止新局 AI 无法调度
        this._aiScheduleKey = null;

        // 彻底重置界面 DOM & 选牌状态 & 气泡 & 残余展示牌
        UIRenderer.resetGameTableUI();

        // 1. 生成局次唯一卡牌洗牌
        this.roundCounter = (this.roundCounter || 0) + 1;
        const deck = DouDizhuRules.shuffle(DouDizhuRules.createDeck(this.roundCounter));

        // 2. 发牌: 3人各 17 张原始混乱手牌，留 3 张底牌 (开局手牌保持乱序，点击理牌后进行排序)
        const p0Hand = deck.slice(0, 17);
        const p1Hand = deck.slice(17, 34);
        const p2Hand = deck.slice(34, 51);
        const bottom = deck.slice(51, 54);

        // 3. 构造重置 GameState (保持玩家 ID/昵称/isAi/isHost)
        this.gameState.phase = 'BIDDING';
        this.gameState.players[0].hand = p0Hand;
        this.gameState.players[1].hand = p1Hand;
        this.gameState.players[2].hand = p2Hand;

        this.gameState.players.forEach(p => {
            p.role = 'FARMER';
            p.passedBid = false;
        });

        this.gameState.bottomCards = bottom;
        this.gameState.currentTurn = 0;
        this.gameState.landlordIndex = -1;
        this.gameState.highestBid = 0;
        this.gameState.highestBidder = -1;
        this.gameState.bidsCount = 0;
        this.gameState.lastPlay = null;
        this.gameState.recentPlays = {
            0: { cards: [], isLatest: false },
            1: { cards: [], isLatest: false },
            2: { cards: [], isLatest: false }
        };
        this.gameState.multiplier = 1;
        this.gameState.winnerIndex = -1;
        this.gameState.readyPlayers = [false, false, false];

        this._hasPlayedSortSoundThisRound = false;

        // 先标记开局倒计时状态与统一绝对起始时间，再广播，确保 3 人联机倒计时 100% 同步
        this.gameState.openingStartTime = Date.now();
        this.gameState.isOpeningCountdown = true;

        // 房主初始化完毕，立即同步全量状态给其他客户端，让大家切入打牌界面
        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(this.gameState);
        }

        // 触发本地 3 秒全员就位加载倒计时与动态进度条
        this.startOpeningCountdown();
    },
    /**
     * 确认人齐加载完毕后的 3 秒开局倒计时与动态进度条
     */
    startOpeningCountdown() {
        const overlay = document.getElementById('startCountdownOverlay');
        const numEl = document.getElementById('startCountdownNum');
        const lightRed = document.getElementById('trafficLightRed');
        const lightYellow = document.getElementById('trafficLightYellow');
        const lightGreen = document.getElementById('trafficLightGreen');

        if (overlay) overlay.style.display = 'flex';

        this._isCountingDownLocally = true;
        this.updateControlButtons(NetworkManager.myPlayerIndex);

        const totalDuration = 3000; // 3.0 秒
        // 关键修复：全员统一以云端绝对时间戳为基准计算，消灭网络延迟造成的倒计时不同步
        const startTime = (this.gameState && this.gameState.openingStartTime) ? this.gameState.openingStartTime : Date.now();
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

        const initialElapsed = Date.now() - startTime;
        const initialSecs = Math.max(0, Math.ceil((totalDuration - initialElapsed) / 1000));
        updateLights(initialSecs);

        clearInterval(this._startCountdownTimer);
        this._startCountdownTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;

            const remainingSecs = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
            updateLights(remainingSecs);

            if (elapsed >= totalDuration) {
                clearInterval(this._startCountdownTimer);
                this._isCountingDownLocally = false;
                this.gameState.isOpeningCountdown = false;
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    if (NetworkManager.isHost) {
                        NetworkManager.broadcastState(this.gameState);
                        UIRenderer.showToast('🔥 3秒到！叫地主开始！');
                        SoundEngine.playBid();

                        // Bug 修复：无论轮到玩家还是 AI，都必须启动回合倒计时。
                        // 否则轮到玩家（currentTurn=0）时 triggerAiBidIfNeeded 会因 isAi=false
                        // 直接 return，导致回合倒计时从未启动，玩家不操作则游戏永久卡死。
                        this.startTurnTimer();

                        this.triggerAiBidIfNeeded();
                    }
                    this.updateControlButtons(NetworkManager.myPlayerIndex);
                }, 200);
            }
        }, step);
    },
    /**
     * AI 单机/补齐模式下的顺时针轮流叫牌智能决策
     */
    triggerAiBidIfNeeded() {
        if (!NetworkManager.isHost || this.gameState.phase !== 'BIDDING') return;

        const turn = this.gameState.currentTurn;
        const player = this.gameState.players[turn];
        if (!player || !player.isAi || player.passedBid) return;

        if (this._aiBidTimer) clearTimeout(this._aiBidTimer);

        const delay = 800 + Math.random() * 800; // 0.8s ~ 1.6s 优雅思考延时
        this._aiBidTimer = setTimeout(() => {
            if (this.gameState.phase !== 'BIDDING' || this.gameState.currentTurn !== turn) return;

            const highestBid = this.gameState.highestBid || 0;
            let choice = 0; // 0 = PASS
            const rand = Math.random();

            if (highestBid === 0) {
                // 还没人叫分时：AI 适当竞叫
                if (rand < 0.12) choice = 3;
                else if (rand < 0.30) choice = 2;
                else if (rand < 0.52) choice = 1;
                else choice = 0; // 48% PASS
            } else if (highestBid === 1) {
                // 已有人叫 1 分：AI 大概率不抢，给玩家机会
                if (rand < 0.12) choice = 3;
                else if (rand < 0.25) choice = 2;
                else choice = 0; // 75% PASS
            } else if (highestBid === 2) {
                // 已有人叫 2 分：AI 只有小概率叫 3 分
                if (rand < 0.15) choice = 3;
                else choice = 0; // 85% PASS
            }

            if (choice > highestBid) {
                this.processBid(turn, choice);
            } else {
                this.processBid(turn, 'PASS');
            }
        }, delay);
    },
    /**
     * 收到服务端/全网同步状态时的 UI 刷新入口
     */
    onReceiveStateUpdate(state) {
        if (!state) return;
        this.gameState = state;

        try {
            const myIndex = (NetworkManager.myPlayerIndex !== null && NetworkManager.myPlayerIndex !== undefined) ? NetworkManager.myPlayerIndex : 0;
            const rel = UIRenderer.getRelativePlayerIndices(myIndex);

            const pSelf = (this.gameState.players && this.gameState.players[rel.self]) ? this.gameState.players[rel.self] : { name: '玩家 1', hand: [], isAi: false };
            const pLeft = (this.gameState.players && this.gameState.players[rel.left]) ? this.gameState.players[rel.left] : { name: '玩家 2', hand: [], isAi: false };
            const pRight = (this.gameState.players && this.gameState.players[rel.right]) ? this.gameState.players[rel.right] : { name: '玩家 3', hand: [], isAi: false };

            // 如果游戏已经开始（叫牌/打牌阶段），确保手机客户端也自动切入牌桌界面！
            if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
                const lobbyScr = document.getElementById('lobbyScreen');
                if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
                const waitScr = document.getElementById('waitingScreen');
                if (waitScr) waitScr.style.display = 'none';
                const gameOverM = document.getElementById('gameOverModal');
                if (gameOverM) gameOverM.style.display = 'none';
                const gameTab = document.getElementById('gameTable');
                if (gameTab) gameTab.style.display = 'grid';

                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox && this.gameState.phase !== 'GAMEOVER') {
                    victoryBox.style.display = 'none';
                    delete victoryBox.dataset.minimized;
                }

                // 重新开局切入 BIDDING 阶段时，客户端强制重置上局残牌与选中状态
                if (this.gameState.phase === 'BIDDING' && this._lastPhase !== 'BIDDING') {
                    UIRenderer.resetGameTableUI();
                }

                const btnLeave = document.getElementById('btnLeaveRoom');
                if (btnLeave) btnLeave.style.display = 'inline-flex';
                const btnGoHomeTop = document.getElementById('btnGoHomeTop');
                if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';
                const menuLeave = document.getElementById('menuBtnLeaveRoom');
                if (menuLeave) menuLeave.style.display = 'flex';
            }
            this._lastPhase = this.gameState.phase;

            // 客户端如果收到开局倒计时状态且本地未在倒数，则触发本地视觉倒计时
            if (this.gameState.isOpeningCountdown && !this._isCountingDownLocally) {
                this.startOpeningCountdown();
            }

            // 1. 顶部底牌与倍数
            const isBottomRevealed = this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER';
            UIRenderer.renderBottomCards(this.gameState.bottomCards || [], isBottomRevealed);
            const multEl = document.getElementById('gameMultiplier');
            if (multEl) multEl.textContent = `x${this.gameState.multiplier || 1}`;

            // 2. 玩家面板信息 (头像/名字/剩余手牌)
            const nameSelfEl = document.getElementById('nameSelf');
            if (nameSelfEl) nameSelfEl.textContent = pSelf.name || '你';
            const nameLeftEl = document.getElementById('nameLeft');
            if (nameLeftEl) nameLeftEl.textContent = pLeft.name || '左家';
            const nameRightEl = document.getElementById('nameRight');
            if (nameRightEl) nameRightEl.textContent = pRight.name || '右家';

            const renderSeatAvatar = (avatarBoxId, avatarEmoji, isAi) => {
                const box = document.getElementById(avatarBoxId);
                if (!box) return;
                if (isAi) {
                    box.innerHTML = '<i class="fa-solid fa-robot" style="color:#60a5fa;"></i>';
                } else {
                    const emoji = avatarEmoji || '🤠';
                    box.innerHTML = `<span style="font-size:1.35rem;line-height:1;">${emoji}</span>`;
                }
            };

            renderSeatAvatar('avatarSelf', pSelf.avatar || (AuthEngine.userData ? AuthEngine.userData.avatar : '🤠'), pSelf.isAi);
            renderSeatAvatar('avatarLeft', pLeft.avatar, pLeft.isAi);
            renderSeatAvatar('avatarRight', pRight.avatar, pRight.isAi);

            const cardLeftBox = document.getElementById('cardCountLeft');
            if (cardLeftBox) {
                const cnt = cardLeftBox.querySelector('.count');
                if (cnt) cnt.textContent = pLeft.hand ? pLeft.hand.length : 0;
            }
            const cardRightBox = document.getElementById('cardCountRight');
            if (cardRightBox) {
                const cnt = cardRightBox.querySelector('.count');
                if (cnt) cnt.textContent = pRight.hand ? pRight.hand.length : 0;
            }

            // 3. 身份徽章标识 (抢地主结束后，在每个人ID左侧高亮放置【👑 地主】或【🌾 农民】徽章)
            const isBiddingDone = (this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER');
            const landlordIdx = this.gameState.landlordIndex;

            const updateRoleBadge = (badgeId, playerIdx) => {
                const el = document.getElementById(badgeId);
                if (!el) return;
                if (isBiddingDone && landlordIdx !== undefined && landlordIdx !== -1) {
                    el.style.display = 'inline-flex';
                    const isLandlord = (playerIdx === landlordIdx);
                    el.className = `role-identity-badge ${isLandlord ? 'landlord' : 'farmer'}`;
                    el.textContent = isLandlord ? '资本家' : '牛马';
                } else {
                    el.style.display = 'none';
                }
            };

            updateRoleBadge('roleBadgeSelf', rel.self);
            updateRoleBadge('roleBadgeLeft', rel.left);
            updateRoleBadge('roleBadgeRight', rel.right);

            // 玩家编号：严格按出牌顺序 1(资本家)、2(资本家下家)、3(资本家上家) 标注
            const updatePlayerNums = () => {
                const badges = {
                    self:  document.getElementById('numBadgeSelf'),
                    left:  document.getElementById('numBadgeLeft'),
                    right: document.getElementById('numBadgeRight'),
                };
                if (!isBiddingDone || landlordIdx === undefined || landlordIdx === -1) {
                    Object.values(badges).forEach(b => { if (b) b.style.display = 'none'; });
                    return;
                }

                const setNum = (badgeId, absIdx) => {
                    const el = document.getElementById(badgeId);
                    if (!el) return;
                    const turnOrder = ((absIdx - landlordIdx + 3) % 3) + 1;
                    el.textContent = turnOrder;
                    el.style.display = 'inline-flex';
                };

                setNum('numBadgeSelf',  rel.self);
                setNum('numBadgeLeft',  rel.left);
                setNum('numBadgeRight', rel.right);
            };
            updatePlayerNums();

            // 4. 叫完资本家进入打牌阶段时，自动触发全员理牌与理牌音效
            if (this.gameState.phase === 'PLAYING' && !this._hasPlayedSortSoundThisRound) {
                this._hasPlayedSortSoundThisRound = true;
                SoundEngine.playCardSort();
            }

            const myHand = pSelf.hand || [];
            UIRenderer.renderSelfHand(myHand);

            const btnSort = document.getElementById('btnSortCards');
            if (btnSort) {
                const isHandSorted = myHand.length > 0 && myHand.every((c, i) => i === 0 || c.rank <= myHand[i - 1].rank);
                if (isHandSorted || this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER') {
                    btnSort.style.display = 'none';
                } else {
                    btnSort.style.display = 'inline-flex';
                }
            }

            // 5. 渲染桌面打出的牌 / 结算明牌展示
            if (this.gameState.phase === 'GAMEOVER') {
                const bWrap = document.getElementById('bottomCardsWrapper');
                if (bWrap) bWrap.style.display = 'none';

                // 全员 (不论房主还是客户端) 自动触发战绩结算 (每个账号每盘仅结算1次)
                if (!this._hasSettledThisRound) {
                    this._hasSettledThisRound = true;
                    if (typeof AuthEngine !== 'undefined' && AuthEngine.userData) {
                        const winnerIdx = this.gameState.winnerIndex;
                        const winnerRole = (this.gameState.players && this.gameState.players[winnerIdx]) ? this.gameState.players[winnerIdx].role : 'FARMER';
                        const myRole = (this.gameState.players && this.gameState.players[myIndex]) ? this.gameState.players[myIndex].role : 'FARMER';
                        const isWin = (winnerIdx === myIndex) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                        AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);
                    }
                }

                if (this.turnTimerInterval) {
                    clearInterval(this.turnTimerInterval);
                    this.turnTimerInterval = null;
                }

                // 房主主导：确保 AI 机器人自动标记就绪 (仅对真正的 AI 生效)
                if (NetworkManager.isHost && this.gameState.players) {
                    if (!this.gameState.readyPlayers) this.gameState.readyPlayers = [false, false, false];
                    this.gameState.players.forEach((p, idx) => {
                        if (p && p.isAi) this.gameState.readyPlayers[idx] = true;
                    });
                }

                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.style.display = 'flex';
                    const winnerIdx = this.gameState.winnerIndex;
                    const winner = (this.gameState.players && winnerIdx !== undefined && winnerIdx >= 0) ? this.gameState.players[winnerIdx] : null;
                    const isLandlordWin = (winner && winner.role === 'LANDLORD');

                    let titleText = isLandlordWin ? '资本家胜利！' : '牛马胜利！';
                    let winnerDesc = '';
                    if (isLandlordWin) {
                        winnerDesc = `资本家【${winner ? winner.name : '地主'}】独占鳌头`;
                    } else {
                        const farmers = (this.gameState.players || [])
                            .filter(p => p && p.role === 'FARMER')
                            .map(p => p.name || '农民')
                            .join(' & ');
                        winnerDesc = `牛马【${farmers || '农民们'}】联手翻盘`;
                    }

                    const readyPlayers = this.gameState.readyPlayers || [false, false, false];
                    const readyCount = readyPlayers.filter(Boolean).length;
                    const hasSelfVoted = !!readyPlayers[myIndex];
                    const isMinimized = victoryBox.dataset.minimized === 'true';

                    if (isMinimized) {
                        victoryBox.innerHTML = `
                            <div class="victory-mini-badge" id="btnExpandVictory">
                                <span>🏆 胜负 (已就绪 ${readyCount}/3)</span>
                                <i class="fa-solid fa-expand"></i>
                            </div>
                        `;
                    } else {
                        victoryBox.innerHTML = `
                            <div class="victory-content-wrap">
                                <button class="victory-close-btn" id="btnCloseVictoryBanner" title="收起胜负榜 (方便看牌)">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                                <div class="victory-main-title">${titleText}</div>
                                <div class="victory-sub-desc">${winnerDesc}</div>
                                
                                <div class="restart-vote-box">
                                    <div class="restart-vote-count">准备开局 <span class="vote-num ${readyCount > 0 ? 'active' : ''}">${readyCount}/3</span></div>
                                    <button class="btn-action primary btn-restart-round ${hasSelfVoted ? 'voted' : ''}" id="btnRestartGame" ${hasSelfVoted ? 'disabled' : ''}>
                                        <i class="fa-solid ${hasSelfVoted ? 'fa-check' : 'fa-rotate-right'}"></i> ${hasSelfVoted ? '已就绪' : '再来一局'}
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                }

                // 结算时明牌公开展示全场剩余手牌 (自动折到第二排、第三排)
                UIRenderer.renderOpenHand('playedSelf', pSelf.hand || []);
                UIRenderer.renderOpenHand('playedLeft', pLeft.hand || []);
                UIRenderer.renderOpenHand('playedRight', pRight.hand || []);
            } else {
                const bWrap = document.getElementById('bottomCardsWrapper');
                if (bWrap) bWrap.style.display = 'flex';
                const vBox = document.getElementById('victoryBannerBox');
                if (vBox) {
                    vBox.style.display = 'none';
                    delete vBox.dataset.minimized;
                }

                const recent = this.gameState.recentPlays || {};
                const getPlayData = (slotIdx) => {
                    if (!recent) return null;
                    const p = recent[slotIdx] || recent[String(slotIdx)];
                    if (!p || !p.cards || p.cards.length === 0) return null;
                    return p;
                };

                const selfPlay = getPlayData(rel.self);
                const leftPlay = getPlayData(rel.left);
                const rightPlay = getPlayData(rel.right);

                UIRenderer.renderPlayedCards('playedSelf', selfPlay ? selfPlay.cards : [], selfPlay ? selfPlay.isLatest : false);
                UIRenderer.renderPlayedCards('playedLeft', leftPlay ? leftPlay.cards : [], leftPlay ? leftPlay.isLatest : false);
                UIRenderer.renderPlayedCards('playedRight', rightPlay ? rightPlay.cards : [], rightPlay ? rightPlay.isLatest : false);

                this._hasSettledThisRound = false;
            }

            // 6. 思考出牌/叫地主文本提示与头像高亮
            const currentTurnIdx = this.gameState.currentTurn;
            const currentTurnPlayer = (this.gameState.players && currentTurnIdx !== undefined) ? this.gameState.players[currentTurnIdx] : null;
            const promptContainer = document.getElementById('thinkingStatusPrompt');
            const promptTextEl = document.getElementById('thinkingStatusText');

            if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
                if (promptContainer && promptTextEl && currentTurnPlayer) {
                    promptContainer.style.display = 'inline-flex';
                    const pName = (currentTurnIdx === myIndex) ? '你' : currentTurnPlayer.name;
                    const actionDesc = (this.gameState.phase === 'BIDDING') ? '叫地主中...' : '思考出牌中...';
                    promptTextEl.textContent = `轮到 【${pName}】 ${actionDesc}`;
                }
            } else {
                if (promptContainer) promptContainer.style.display = 'none';
            }

            // 7. 交互控制按钮面板
            this.updateControlButtons(myIndex);

            // 7. 倒计时指示 (对局结束时隐藏倒计时)
            if (this.gameState.phase === 'GAMEOVER') {
                UIRenderer.updateTurnIndicator(-1, myIndex);
            } else {
                UIRenderer.updateTurnIndicator(
                    this.gameState.currentTurn,
                    myIndex,
                    this.gameState.timerSeconds !== undefined ? this.gameState.timerSeconds : 25,
                    this.gameState.turnStartTime
                );
            }

            // 8. 处理 AI 或当前回合的自动触发 (如果是房主)
            if (NetworkManager.isHost && this.gameState.phase !== 'GAMEOVER') {
                this.checkAiTurn();
            }

            // 9. 结算处理
            if (this.gameState.phase === 'GAMEOVER') {
                this.showGameOverModal();
            }
        } catch (err) {
            console.error('[GameEngine] onReceiveStateUpdate 状态刷新异常 (已容错防护):', err);
        }
    },
    /**
     * 更新操作按钮显示 (抢手速叫地主/不叫/出牌)
     */
    updateControlButtons(myIndex) {
        const controlsBar = document.getElementById('controlsBar');
        const biddingControls = document.getElementById('biddingControls');
        const reBidControls = document.getElementById('reBidControls');
        const playControls = document.getElementById('playControls');

        if (this.gameState.phase === 'GAMEOVER' || this.gameState.phase === 'WAITING') {
            controlsBar.style.display = 'none';
            return;
        }

        controlsBar.style.display = 'block';

        if (this.gameState.phase === 'BIDDING') {
            biddingControls.style.display = 'flex';
            reBidControls.style.display = 'none';
            playControls.style.display = 'none';

            const myPlayer = this.gameState.players[myIndex];
            const isOpeningCountdown = !!this.gameState.isOpeningCountdown || !!this._isCountingDownLocally;
            // 抢地主模式：只要自己还没退出且不在开局倒计时，就可以抢（任何时候都能点）
            const hasPassed = myPlayer && myPlayer.passedBid;

            const passBtn = document.getElementById('btnBidPass');
            const b1Btn = document.getElementById('btnBid1');
            const b2Btn = document.getElementById('btnBid2');
            const b3Btn = document.getElementById('btnBid3');
            const landlordBtn = document.getElementById('btnBidLandlord');

            const isDisabled = isOpeningCountdown || hasPassed;

            [passBtn, b1Btn, b2Btn, b3Btn, landlordBtn].forEach(b => {
                if (b) {
                    b.disabled = isDisabled;
                    if (isDisabled) b.classList.add('disabled');
                    else b.classList.remove('disabled');
                }
            });
        } else if (this.gameState.phase === 'PLAYING') {
            biddingControls.style.display = 'none';
            reBidControls.style.display = 'none';
            playControls.style.display = 'flex';

            const isAiMode = NetworkManager.isAiMode;
            const hintBtn = document.getElementById('btnHint');
            if (hintBtn) hintBtn.style.display = isAiMode ? 'inline-flex' : 'none';

            const isFreePlay = !this.gameState.lastPlay || this.gameState.lastPlay.playerIndex === myIndex;
            const passBtn = document.getElementById('btnPass');
            passBtn.style.display = isFreePlay ? 'none' : 'inline-block';

            const playBtn = document.getElementById('btnPlayCard');
            const isMyTurn = (this.gameState.currentTurn === myIndex);

            if (!isMyTurn) {
                // 不在自己回合，出牌阶段按钮全盘置灰
                passBtn.disabled = true;
                passBtn.classList.add('disabled');
                playBtn.disabled = true;
                playBtn.classList.add('disabled');
                if (hintBtn) {
                    hintBtn.disabled = true;
                    hintBtn.classList.add('disabled');
                }
            } else {
                // 轮到自己回合
                passBtn.disabled = false;
                passBtn.classList.remove('disabled');
                if (hintBtn) {
                    hintBtn.disabled = false;
                    hintBtn.classList.remove('disabled');
                }
                UIRenderer.updatePlayButtonState();
            }
        }
    },
    /**
     * 响应玩家（自己或远程客户端）的点击动作
     */
    handleSelfAction(actionType, payload) {
        NetworkManager.sendActionToHost(actionType, payload);
    },
    /**
     * 房主引擎处理动作分发
     */
    handlePlayerAction(playerIndex, actionType, payload) {
        if (!NetworkManager.isHost) return;

        if (actionType === 'BID') {
            this.processBid(playerIndex, payload);
        } else if (actionType === 'PLAY') {
            this.processPlay(playerIndex, payload);
        } else if (actionType === 'CHAT_PHRASE') {
            this.processChatPhrase(playerIndex, payload.text);
            NetworkManager.broadcastChatPhrase(playerIndex, payload.text);
        } else if (actionType === 'RESTART_VOTE') {
            this.processRestartVote(playerIndex);
        }
    },
    /**
     * 处理【再来一局】准备就绪投票
     */
    processRestartVote(playerIndex) {
        if (this.activeGameType === 'MAHJONG' || (window.mahjongEngine && window.mahjongEngine.isGameOver)) {
            if (!this.mahjongReadyPlayers) this.mahjongReadyPlayers = [false, false, false, false];
            this.mahjongReadyPlayers[playerIndex] = true;

            const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
            for (let i = 0; i < 4; i++) {
                if (!seatPlayers[i] || seatPlayers[i].isAi) {
                    this.mahjongReadyPlayers[i] = true;
                }
            }

            const readyCount = this.mahjongReadyPlayers.filter(Boolean).length;
            const statusPayload = {
                readyPlayers: this.mahjongReadyPlayers,
                readyCount: readyCount,
                total: 4
            };

            NetworkManager.sendMahjongRematchStatus(statusPayload);

            const btnSettle = document.getElementById('btnMahjongSettleRematch');
            if (btnSettle) {
                btnSettle.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (${readyCount}/4 就绪)`;
            }
            UIRenderer.showToast(`⌛ 麻将重开准备中：${readyCount}/4 席位就绪`);

            if (readyCount >= 4) {
                setTimeout(() => {
                    this.mahjongReadyPlayers = [false, false, false, false];
                    this.startMahjongOnlineGame(NetworkManager.roomId, true);
                }, 400);
            }
            return;
        }

        if (this.gameState.phase !== 'GAMEOVER') return;
        if (!this.gameState.readyPlayers) {
            this.gameState.readyPlayers = [false, false, false];
        }

        this.gameState.readyPlayers[playerIndex] = true;

        // 房主处理时，确保 AI 机器人自动设为准备就绪
        this.gameState.players.forEach((p, idx) => {
            if (p.isAi) this.gameState.readyPlayers[idx] = true;
        });

        const readyCount = this.gameState.readyPlayers.filter(Boolean).length;
        NetworkManager.broadcastState(this.gameState);

        // 当 3 位玩家（包含 AI）全员就位 (3/3)，自动重新发牌开局！
        if (readyCount >= 3) {
            setTimeout(() => {
                this.startNewRound();
            }, 300);
        }
    },
    /**
     * 处理抢地主逻辑（纯抢地主模式：谁先叫分谁就立即成为地主，不分顺序，叫了不能被抢）
     */
    processBid(playerIndex, action) {
        if (this.gameState.phase !== 'BIDDING') return;

        // 开局 3 秒倒计时锁判定
        if (this.gameState.isOpeningCountdown) {
            this.gameState.isOpeningCountdown = false;
        }

        const player = this.gameState.players[playerIndex];
        if (!player) return;

        const isClaimAction = (action === 'CLAIM' || action === 1 || action === 2 || action === 3);
        // 纯抢地主模式修复：超时自动“不叫”仅是托管，不应剥夺玩家主动叫地主权利。
        // 若玩家因超时被标记 passedBid，此时点击叫地主应优先生效（点击优先于超时托管）。
        if (isClaimAction && player.passedBid) {
            player.passedBid = false;
        } else if (player.passedBid) {
            return; // 已退出的玩家不能再操作
        }

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        if (action === 'CLAIM' || action === 1 || action === 2 || action === 3) {
            // ✅ 抢地主：任何人叫任意分数（1/2/3），立即锁定为地主，其他人不再有机会抢
            const bidVal = (typeof action === 'number') ? action : 3;
            SoundEngine.playBid();
            this.gameState.highestBid = bidVal;
            this.gameState.highestBidder = playerIndex;
            this.gameState.multiplier = bidVal;
            UIRenderer.showBubble(bubbleTarget, bidVal === 3 ? '👑 3分(地主)' : `👑 ${bidVal}分`);
            UIRenderer.showToast(`👑 ${player.name} 抢到地主！(${bidVal} 分)`);
            // 立即确定地主，结束叫地主阶段
            this.finalizeLandlord(playerIndex);
            return;

        } else if (action === 'PASS' || action === 0) {
            // 玩家点击【不叫/不抢】，退出本局叫地主
            player.passedBid = true;
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '不抢');
            UIRenderer.showToast(`${player.name} 放弃抢地主`);

            // 统计剩下还没退出的玩家
            const activeBidders = this.gameState.players.filter(p => !p.passedBid);

            if (activeBidders.length === 0) {
                // 全员都放弃了 → 重新发牌
                UIRenderer.showToast('全员放弃，重新发牌！');
                setTimeout(() => this.startNewRound(), 1500);
            } else if (activeBidders.length === 1) {
                // 只剩一人 → 自动成为地主（1分）
                const lastPlayerIdx = this.gameState.players.findIndex(p => !p.passedBid);
                SoundEngine.playBid();
                UIRenderer.showToast(`🌾 ${this.gameState.players[lastPlayerIdx].name} 无人竞争，自动成为地主！`);
                if (!this.gameState.highestBid || this.gameState.highestBid < 1) {
                    this.gameState.highestBid = 1;
                    this.gameState.multiplier = 1;
                }
                setTimeout(() => this.finalizeLandlord(lastPlayerIdx), 800);
            } else {
                // 仍有多人未放弃：更新 currentTurn 并继续等待（AI 会自动触发）
                const nextTurn = this._nextActiveBidder(playerIndex);
                this.gameState.currentTurn = nextTurn !== -1 ? nextTurn : playerIndex;
                this.startTurnTimer();
            }

            // 广播最新状态
            if (NetworkManager.isHost) {
                NetworkManager.broadcastState(this.gameState);
                this.triggerAiBidIfNeeded();
            }
        }
    },
    /**
     * 从 fromPlayerIndex 开始（不包含自身），找下一个还没退出叫地主的玩家索引
     * 如果所有人都退出了返回 -1
     */
    _nextActiveBidder(fromPlayerIndex) {
        for (let i = 1; i <= 3; i++) {
            const idx = (fromPlayerIndex + i) % 3;
            if (this.gameState.players[idx] && !this.gameState.players[idx].passedBid) return idx;
        }
        return -1;
    },
    /**
     * 确定地主身份并把底牌分发给地主
     */
    finalizeLandlord(landlordIdx) {
        // 防重机制：防止网络延迟或定时器导致重复触发领底牌产生 5张Q/重复卡牌 bug！
        if (this.gameState.phase === 'PLAYING' || landlordIdx === undefined || landlordIdx < 0 || landlordIdx > 2) return;

        this.gameState.landlordIndex = landlordIdx;
        this.gameState.phase = 'PLAYING';
        this.gameState.currentTurn = landlordIdx;
        this.gameState.multiplier = Math.max(1, this.gameState.highestBid || 1);
        this.gameState.lastPlay = null;
        this.gameState.recentPlays = {
            0: { cards: [], isLatest: false },
            1: { cards: [], isLatest: false },
            2: { cards: [], isLatest: false }
        };

        // 清理叫地主阶段或上一局残留界面，确保地主首出时 100% 渲染显现
        UIRenderer.resetGameTableUI();

        // 赋予角色并自动为全场玩家整理手牌
        this.gameState.players.forEach((p, idx) => {
            p.role = idx === landlordIdx ? 'LANDLORD' : 'FARMER';
            p.hand = DouDizhuRules.sortCards(p.hand);
        });

        // 3 张底牌给地主 (严格过滤已有 card.id 保证防重)
        const currentHandIds = new Set(this.gameState.players[landlordIdx].hand.map(c => c.id));
        const newBottomCards = (this.gameState.bottomCards || []).filter(c => !currentHandIds.has(c.id));
        const landlordHand = [...this.gameState.players[landlordIdx].hand, ...newBottomCards];
        this.gameState.players[landlordIdx].hand = DouDizhuRules.sortCards(landlordHand);

        UIRenderer.showToast(`${this.gameState.players[landlordIdx].name} 成为地主！得 3 张底牌`);
        SoundEngine.playCardSort();
        this.startTurnTimer();

        // 全量同步最新地主身份、20张地主手牌与 PLAYING 阶段状态至云端/所有客户端
        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(this.gameState);
        }
    },
    /**
     * 处理出牌逻辑
     */
    processPlay(playerIndex, cards) {
        if (this.gameState.phase !== 'PLAYING') return;

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === playerIndex;

        if (!cards || cards.length === 0) {
            // 选择过 / 不出
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '要不起');
        } else {
            // 校验是否符合斗地主出牌规则 (传入 playerIndex 确保赢牌后属于自由首出)
            const canPlay = DouDizhuRules.canBeat(cards, this.gameState.lastPlay, playerIndex);
            if (!canPlay) {
                if (playerIndex === NetworkManager.myPlayerIndex) {
                    UIRenderer.showToast('不符合出牌规则或压不住桌上的牌！');
                }
                return;
            }

            // 如果是自由首出（开启新一轮叫/打牌），清空上一轮大家打出的残牌！
            if (isFreePlay || !this.gameState.recentPlays) {
                this.gameState.recentPlays = {
                    0: { cards: [], isLatest: false },
                    1: { cards: [], isLatest: false },
                    2: { cards: [], isLatest: false }
                };
            }

            // 规则合规！从玩家手牌中扣除
            const playedIds = new Set(cards.map(c => c.id));
            this.gameState.players[playerIndex].hand = this.gameState.players[playerIndex].hand.filter(c => !playedIds.has(c.id));

            this.gameState.lastPlay = { playerIndex, cards };

            // 取消之前玩家出牌的 isLatest 金光高亮标记
            for (let i = 0; i < 3; i++) {
                if (this.gameState.recentPlays[i]) {
                    this.gameState.recentPlays[i].isLatest = false;
                } else {
                    this.gameState.recentPlays[i] = { cards: [], isLatest: false };
                }
            }

            // 记录当前玩家打出的牌
            this.gameState.recentPlays[playerIndex] = {
                cards: cards,
                isLatest: true
            };

            // 检查炸弹 / 火箭翻倍
            const analysis = DouDizhuRules.analyzeCards(cards);
            if (analysis.type === CardType.BOMB || analysis.type === CardType.ROCKET) {
                this.gameState.multiplier *= 2;
                SoundEngine.playBomb();
                UIRenderer.showToast(analysis.type === CardType.ROCKET ? '🚀 王炸！倍数 x2' : '💣 炸弹！倍数 x2');
            } else {
                SoundEngine.playCardPlay();
            }

            // 检查胜利条件！
            if (this.gameState.players[playerIndex].hand.length === 0) {
                this.gameState.phase = 'GAMEOVER';
                this.gameState.winnerIndex = playerIndex;
                this.gameState.readyPlayers = [false, false, false];
                NetworkManager.broadcastState(this.gameState);

                // 战绩结算与天梯积分更新
                if (typeof AuthEngine !== 'undefined') {
                    const myIdx = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
                    const winnerRole = this.gameState.players[playerIndex].role;
                    const myRole = (this.gameState.players[myIdx]) ? this.gameState.players[myIdx].role : 'FARMER';
                    const isWin = (playerIndex === myIdx) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                    AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);

                    // 💰 结算斗地主【知因币】 (带 PVE 25% 比例和零分保底)
                    if (AuthEngine.updateCoins) {
                        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
                        const ratio = isPve ? 0.25 : 1.0;
                        const baseScore = 50 * (this.gameState.multiplier || 1);
                        if (isWin) {
                            const winAmount = Math.ceil((myRole === 'LANDLORD' ? baseScore * 2 : baseScore) * ratio);
                            AuthEngine.updateCoins(winAmount, isPve ? '斗地主切磋胜 (PVE)' : '斗地主胜 (PVP)');
                        } else {
                            const loseAmount = -Math.ceil((myRole === 'LANDLORD' ? baseScore * 2 : baseScore) * ratio);
                            AuthEngine.updateCoins(loseAmount, isPve ? '斗地主切磋负 (PVE)' : '斗地主负 (PVP)');
                        }

                        // ⭐ 结算斗地主【经验值】
                        if (AuthEngine.addExp) {
                            const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                            AuthEngine.addExp(expVal, isPve ? '斗地主切磋 (PVE)' : '斗地主对局 (PVP)');
                        }
                    }
                }
                return;
            }
        }

        // 轮到下一位
        this.gameState.currentTurn = (playerIndex + 1) % 3;
        this.startTurnTimer();
    },
    /**
     * 启动/刷新真实 1 秒级实时倒计时 (Host节点主导)
     */
    startTurnTimer() {
        if (!NetworkManager.isHost) return;

        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }

        this.gameState.timerSeconds = 25;
        this.gameState.turnStartTime = Date.now();
        NetworkManager.broadcastState(this.gameState);

        this.turnTimerInterval = setInterval(() => {
            if (this.gameState.phase !== 'BIDDING' && this.gameState.phase !== 'PLAYING') {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                return;
            }

            const elapsedSecs = Math.floor((Date.now() - (this.gameState.turnStartTime || Date.now())) / 1000);
            this.gameState.timerSeconds = Math.max(0, 25 - elapsedSecs);

            if (this.gameState.timerSeconds <= 0) {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                this.handleTurnTimeout();
            }
        }, 1000);
    },
    /**
     * 倒计时超时自动处理逻辑 (根据斗地主标准规则)
     */
    handleTurnTimeout() {
        if (!NetworkManager.isHost) return;
        const turn = this.gameState.currentTurn;

        if (this.gameState.phase === 'BIDDING') {
            // 叫地主阶段超时：默认【不叫 / 不抢】
            UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认不叫`);
            this.processBid(turn, 0);
        } else if (this.gameState.phase === 'PLAYING') {
            const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === turn;

            if (isFreePlay) {
                // 出牌阶段 - 自由首出超时：默认打出手牌中点数最小的单张
                // Bug修复：不能直接取 hand[hand.length-1]（依赖排序假设），改用遍历找最小 rank
                const hand = this.gameState.players[turn].hand;
                if (hand && hand.length > 0) {
                    const smallestCard = hand.reduce((min, c) => c.rank < min.rank ? c : min, hand[0]);
                    UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，自动出最小单牌`);
                    this.processPlay(turn, [smallestCard]);
                } else {
                    this.processPlay(turn, []);
                }
            } else {
                // 出牌阶段 - 跟牌压牌超时：默认【要不起 / 过 (PASS)】
                UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认选择过`);
                this.processPlay(turn, []);
            }
        }
    },
    /**
     * 手牌整理排序并播放理牌音效
     */
    sortSelfHand() {
        const myIndex = NetworkManager.myPlayerIndex;
        if (this.gameState.players[myIndex]) {
            this.gameState.players[myIndex].hand = DouDizhuRules.sortCards(this.gameState.players[myIndex].hand);
            UIRenderer.renderSelfHand(this.gameState.players[myIndex].hand);
            SoundEngine.playCardSort();
            const btnSort = document.getElementById('btnSortCards');
            if (btnSort) btnSort.style.display = 'none';
        }
    },
    /**
     * 主动发送经典快捷短语 (全网 P2P 气泡同步)
     */
    sendChatPhrase(text) {
        const myIndex = NetworkManager.myPlayerIndex;
        // 本地立即展示气泡
        this.processChatPhrase(myIndex, text);

        // 网络同步给其他所有联机玩家
        if (NetworkManager.isHost) {
            NetworkManager.broadcastChatPhrase(myIndex, text);
        } else {
            NetworkManager.sendActionToHost('CHAT_PHRASE', { text: text });
        }
    },
    /**
     * 在指定玩家头像上方展示对话气泡
     */
    processChatPhrase(senderIndex, text) {
        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (senderIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (senderIndex === rel.right) bubbleTarget = 'bubbleRight';

        UIRenderer.showBubble(bubbleTarget, text, 3800);
        SoundEngine.playCardSelect();
    },
    /**
     * 智能提示按钮点击
     */
    triggerSmartHint() {
        const myIndex = NetworkManager.myPlayerIndex;
        const myHand = this.gameState.players[myIndex].hand;
        const lastPlay = (this.gameState.lastPlay && this.gameState.lastPlay.playerIndex !== myIndex) ? this.gameState.lastPlay : null;

        const hintCards = DouDizhuRules.findSmartHint(myHand, lastPlay);
        if (hintCards.length > 0) {
            UIRenderer.setSelectedCards(hintCards);
        } else {
            UIRenderer.showToast('没有能压过上家的牌');
        }
    },
    /**
     * 主动点击出牌按钮
     */
    triggerPlayCard() {
        const myIndex = NetworkManager.myPlayerIndex;
        const selected = UIRenderer.getSelectedCards(this.gameState.players[myIndex].hand);
        if (selected.length === 0) {
            UIRenderer.showToast('请先选择要出的牌');
            return;
        }

        this.handleSelfAction('PLAY', selected);
    },
    /**
     * 检查当前回合是否为机器人，是则自动出牌（完整策略 AI）
     */
    checkAiTurn() {
        const turnIdx = this.gameState.currentTurn;
        const currentPlayer = this.gameState.players[turnIdx];
        if (!currentPlayer || !currentPlayer.isAi) return;

        // ====== 防重复调度守卫 ======
        // onReceiveStateUpdate 每次收到广播都会调用 checkAiTurn，但同一个回合
        // 只能调度一次 AI 定时器，否则 AI 会出两次牌。
        // 用 "turn索引_阶段" 作为 key，同一 key 已挂起时直接返回。
        const scheduleKey = `${turnIdx}_${this.gameState.phase}`;
        if (this._aiScheduleKey === scheduleKey) return;
        this._aiScheduleKey = scheduleKey;

        // 模拟真实思考延迟：1.0~2.4秒
        const thinkMs = 1000 + Math.random() * 1400;
        setTimeout(() => {
            // 清除守卫，允许下一个回合正常调度
            this._aiScheduleKey = null;

            // 验证：如果回合或阶段已经变更（例如其他玩家已出牌），直接丢弃
            if (this.gameState.currentTurn !== turnIdx) return;
            if (this.gameState.phase === 'GAMEOVER' || this.gameState.phase === 'WAITING') return;

            // Bug 修复：BIDDING 阶段由 scheduleAiBids() 专属处理（速度叫牌），
            // checkAiTurn 不应重复处理，否则 AI 会在叫牌阶段出两次
            if (this.gameState.phase === 'BIDDING') return;

            if (this.gameState.phase === 'PLAYING') {
                const aiCards = this._getAiPlayDecision(turnIdx);
                this.processPlay(turnIdx, aiCards);
                // processPlay → startTurnTimer → broadcastState，已自动广播，不再重复广播
            }
        }, thinkMs);
    },
    /**
     * 评估手牌强度 (0~100分)：用于 AI 决策是否抢地主
     */
    _evaluateHandStrength(hand) {
        if (!hand || hand.length === 0) return 0;
        let score = 0;

        // 大王/小王
        hand.forEach(c => {
            if (c.rank === 17) score += 18;      // 大王
            else if (c.rank === 16) score += 14; // 小王
            else if (c.rank === 15) score += 8;  // 2
            else if (c.rank === 14) score += 5;  // A
            else if (c.rank === 13) score += 3;  // K
        });

        // 炸弹
        const groups = DouDizhuRules.groupCardsByRank(hand);
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 4) score += 22;     // 炸弹大加分
            else if (cards.length === 3) score += 5; // 三条
            else if (cards.length === 2) score += 2; // 对子
        }

        // 双王炸
        const jokers = hand.filter(c => c.rank >= 16);
        if (jokers.length === 2) score += 10; // 已经在单王算了，补偿连王额外加成

        return Math.min(100, score);
    },
    /**
     * AI 出牌决策核心（带角色策略 + 回合顺序感知）
     * @returns {Array} 要出的牌，空数组=过/要不起
     */
    _getAiPlayDecision(aiIdx) {
        const player = this.gameState.players[aiIdx];
        const hand = player.hand;
        const role = player.role; // 'LANDLORD' or 'FARMER'
        const lastPlay = this.gameState.lastPlay;

        // 判断是否是自由出牌（无上家牌 / 上家就是自己）
        const isFreePlay = !lastPlay || !lastPlay.cards || lastPlay.cards.length === 0
            || lastPlay.playerIndex === aiIdx;

        if (isFreePlay) {
            return this._aiFreePlaStrategy(aiIdx, hand, role);
        }

        // 判断上家是否是队友农民
        const lastPlayer = this.gameState.players[lastPlay.playerIndex];
        const lastIsTeammate = (role === 'FARMER' && lastPlayer && lastPlayer.role === 'FARMER');

        if (lastIsTeammate) {
            // 关键：利用回合顺序判断地主是否已出过牌（已过了）
            // lastPlay.playerIndex 出牌后：posFirst = 第一个接手的人，posSecond = 第二个
            // 若 AI 是 posFirst (+1)：地主(+2)还没出，可能压队友 → 需考虑护牌
            // 若 AI 是 posSecond (+2)：地主(+1)已出过且过了 → 队友本轮稳赢，直接过
            const posFirst = (lastPlay.playerIndex + 1) % 3;
            const landlordComesAfterAI = (aiIdx === posFirst);
            return this._aiFarmerCoverDecision(aiIdx, hand, lastPlay, landlordComesAfterAI);
        }

        // 上家是地主：跟牌/压牌策略
        return this._aiFollowStrategy(aiIdx, hand, role, lastPlay);
    },
    /**
     * 农民 AI 看队友出牌后的接牌决策
     * landlordComesAfterAI = true 表示地主还没出牌（可能压队友），需要决定是否帮队友护牌
     * landlordComesAfterAI = false 表示地主已经过了，队友本轮稳赢，直接过
     */
    _aiFarmerCoverDecision(aiIdx, hand, lastPlay, landlordComesAfterAI) {
        const landlordIdx = this.gameState.landlordIndex;
        const landlordCardCount = (this.gameState.players[landlordIdx] && this.gameState.players[landlordIdx].hand)
            ? this.gameState.players[landlordIdx].hand.length : 20;
        const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
        const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

        // 地主已经过了，队友本轮稳赢，直接过
        if (!landlordComesAfterAI) return [];

        // 地主还没出牌，分析队友出的牌强弱
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const teammateTopRank = lastPlay.cards.reduce((max, c) => Math.max(max, c.rank), 0);

        // 队友出的牌已经是强牌（2/王/炸弹/火箭），地主大概率压不住，直接过
        const isAlreadyStrong = (
            (prev.type === 1 && teammateTopRank >= 15) || // 单2或王
            (prev.type === 2 && teammateTopRank >= 15) || // 对2
            prev.type === 13 || // 炸弹
            prev.type === 14    // 火箭
        );
        if (isAlreadyStrong) return [];

        // 队友出的是弱牌，地主可能压 → 尝试用便宜牌盖住，让地主无牌可压
        const safeBeat = this._findSafeBeat(hand, lastPlay, prev);

        // 队友只剩1~2张，更积极地接牌护住队友
        if (teammateCards <= 2 && safeBeat.length > 0) return safeBeat;

        // 正常情况：只用廉价牌接（不用2/王/炸弹），不值得接就过
        if (safeBeat.length > 0) {
            const isExpensive = safeBeat.some(c => c.rank >= 15); // 用到了2或王才算贵
            if (!isExpensive) return safeBeat;
        }

        // 没有便宜接法，让队友的牌先顶着，过
        return [];
    },
    /**
     * 寻找"便宜"压过上家的牌（不用炸弹、优先不用2/王）
     */
    _findSafeBeat(hand, lastPlay, prev) {
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大
        const groups = DouDizhuRules.groupCardsByRank(hand);

        if (prev.type === 1) { // 单张：找最小能压的非大牌
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 15) return [c]; // 优先不用2/王
            }
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 16) return [c]; // 退而求次用A/K
            }
        } else if (prev.type === 2) { // 对子
            const sorted = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 15) return cards.slice(0, 2);
            }
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 16) return cards.slice(0, 2);
            }
        } else if (prev.type === 3) { // 三张
            const sorted = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 3 && rank < 15) return cards.slice(0, 3);
            }
        } else {
            // 顺子/连对/飞机等，用 findSmartHint 找最小压法，排除炸弹
            const hint = DouDizhuRules.findSmartHint(hand, lastPlay);
            if (hint.length > 0) {
                const analysis = DouDizhuRules.analyzeCards(hint);
                if (analysis.type !== 13 && analysis.type !== 14) return hint;
            }
        }
        return [];
    },
    /**
     * AI 自由出牌策略
     */
    _aiFreePlaStrategy(aiIdx, hand, role) {
        const groups = DouDizhuRules.groupCardsByRank(hand);
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大

        // 统计牌型分布
        const singles = [];
        const pairs = [];
        const triples = [];
        const bombs = [];
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 1) singles.push({ rank, cards });
            else if (cards.length === 2) pairs.push({ rank, cards });
            else if (cards.length === 3) triples.push({ rank, cards });
            else if (cards.length === 4) bombs.push({ rank, cards });
        }
        singles.sort((a, b) => a.rank - b.rank);
        pairs.sort((a, b) => a.rank - b.rank);
        triples.sort((a, b) => a.rank - b.rank);
        bombs.sort((a, b) => a.rank - b.rank);

        const landlordIdx = this.gameState.landlordIndex;
        const landlord = this.gameState.players[landlordIdx];
        const landlordCardCount = landlord ? landlord.hand.length : 20;

        // 判断是否需要紧急追牌（对方剩余牌很少）
        const isEmergency = landlordCardCount <= 3;

        // 1. 地主策略：优先出顺子/组合拆散，快速清牌
        if (role === 'LANDLORD') {
            // 优先出三带类
            if (triples.length > 0) {
                const t = triples[0];
                // 三带一
                if (singles.length > 0) {
                    const kicker = singles[0].cards[0];
                    if (kicker.rank !== t.rank) return [...t.cards, kicker];
                }
                // 三带二
                if (pairs.length > 0) {
                    const kicker = pairs[0];
                    if (kicker.rank !== t.rank) return [...t.cards, ...kicker.cards];
                }
                return t.cards;
            }

            // 优先出顺子
            const straight = this._findBestStraight(sortedHand, null, false);
            if (straight.length > 0) return straight;

            // 出对子（最小对子）
            if (pairs.length > 0) return pairs[0].cards;

            // 出单张（最小单张）
            if (singles.length > 0) return [singles[0].cards[0]];

            // 如果只剩炸弹，出炸弹
            if (bombs.length > 0) return bombs[0].cards;

            // 出手牌最小的一张
            return sortedHand.length > 0 ? [sortedHand[0]] : [];
        }

        // 2. 农民策略：帮助队友，阻止地主
        // 找队友（另一位农民）
        const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
        const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

        // 如果队友快要出完了，尽量出大牌、顺子，为队友铺路
        if (teammateCards <= 3 || isEmergency) {
            // 出炸弹拦截地主
            if (bombs.length > 0 && landlordCardCount <= 5) {
                return bombs[0].cards;
            }
            // 出大对子/单张
            const bigSingle = [...singles].reverse().find(s => s.rank >= 14);
            if (bigSingle) return [bigSingle.cards[0]];
        }

        // 农民正常策略：先出最小的单张/对子消耗手牌，留大牌压地主
        // 优先出对子（最小）
        if (pairs.length > 0) return pairs[0].cards;

        // 出单张
        if (singles.length > 0) return [singles[0].cards[0]];

        // 出三条
        if (triples.length > 0) return triples[0].cards;

        // 只剩炸弹，出最小炸弹
        if (bombs.length > 0) return bombs[0].cards;

        return sortedHand.length > 0 ? [sortedHand[0]] : [];
    },
    /**
     * AI 跟牌/压牌策略
     */
    _aiFollowStrategy(aiIdx, hand, role, lastPlay) {
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大
        const groups = DouDizhuRules.groupCardsByRank(hand);

        const landlordIdx = this.gameState.landlordIndex;
        const landlordCardCount = this.gameState.players[landlordIdx] ? this.gameState.players[landlordIdx].hand.length : 20;

        // 此函数只在上家是地主时被调用（农民队友出牌情况已由 _aiFarmerCoverDecision 处理）
        const lastIsLandlord = this.gameState.players[lastPlay.playerIndex].role === 'LANDLORD';

        // 地主快出完时，农民必须全力压
        const mustBeat = lastIsLandlord && landlordCardCount <= 3;

        const bombs = [];
        const jokers = sortedHand.filter(c => c.rank >= 16);
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 4) bombs.push({ rank, cards });
        }
        bombs.sort((a, b) => a.rank - b.rank);

        // 找最小能压过的牌
        const hintCards = DouDizhuRules.findSmartHint(hand, lastPlay);

        // 如果能找到对应牌型
        if (hintCards.length > 0 && DouDizhuRules.analyzeCards(hintCards).type !== 0) {
            const hint = DouDizhuRules.analyzeCards(hintCards);

            // 如果提示的是炸弹/火箭
            if (hint.type === 14 || hint.type === 13) {
                // 只在紧急时用炸弹/火箭（地主剩1~4张，或农民队友快出完）
                const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
                const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

                if (mustBeat || landlordCardCount <= 4 || teammateCards <= 2) {
                    return hintCards; // 关键时刻出炸弹
                }
                // 其他情况憋住炸弹，看能否用普通牌压
                // 重新找普通牌能压的
                const nonBombHint = this._findNonBombBeat(hand, lastPlay);
                if (nonBombHint.length > 0) return nonBombHint;
                // 实在没有，选择过
                if (!mustBeat) return [];
                return hintCards; // 必须压，只能出炸弹
            }

            // 有普通能压的牌，直接压（此处上家必为地主）
            return hintCards;
        }

        // 找不到匹配牌型，尝试炸弹
        if (bombs.length > 0 && (mustBeat || landlordCardCount <= 3)) {
            return bombs[0].cards;
        }
        if (jokers.length === 2 && (mustBeat || landlordCardCount <= 2)) {
            return jokers;
        }

        // 过/要不起
        return [];
    },
    /**
     * 找能压过上家的非炸弹牌
     */
    _findNonBombBeat(hand, lastPlay) {
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const sortedHand = DouDizhuRules.sortCards(hand, true);
        const groups = DouDizhuRules.groupCardsByRank(hand);

        if (prev.type === 1) { // 单张
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 16) return [c];
            }
        } else if (prev.type === 2) { // 对子
            for (const [rank, cards] of groups.entries()) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 16) {
                    return cards.slice(0, 2);
                }
            }
        } else if (prev.type === 3) { // 三张
            for (const [rank, cards] of groups.entries()) {
                if (rank > prev.mainRank && cards.length >= 3) {
                    return cards.slice(0, 3);
                }
            }
        }
        return [];
    },
    /**
     * 寻找最优顺子（自由出牌时）
     */
    _findBestStraight(sortedHand, minRank, mustBeat) {
        const groups = DouDizhuRules.groupCardsByRank(sortedHand);
        // 尝试找5张以上顺子
        for (let len = 8; len >= 5; len--) {
            for (let startRank = 3; startRank <= 10; startRank++) {
                const straight = [];
                for (let r = startRank; r < startRank + len; r++) {
                    const g = groups.get(r);
                    if (g && g.length >= 1) straight.push(g[0]);
                    else break;
                }
                if (straight.length === len) return straight;
            }
        }
        return [];
    },
    /**
     * 展示结算弹窗
     */
    showGameOverModal() {
        // 去除重型弹窗遮罩，直接在主桌面上进行优雅总结
        const modal = document.getElementById('gameOverModal');
        if (modal) modal.style.display = 'none';

        const winner = this.gameState.players[this.gameState.winnerIndex];
        const isLandlordWin = (winner && winner.role === 'LANDLORD');

        const myIndex = NetworkManager.myPlayerIndex;
        const myRole = this.gameState.players[myIndex].role;
        const iWon = (isLandlordWin && myRole === 'LANDLORD') || (!isLandlordWin && myRole === 'FARMER');

        if (iWon) SoundEngine.playWin();
    }

});
