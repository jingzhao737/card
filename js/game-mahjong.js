/* ====================================================================
   game-mahjong.js (从 main.js 拆分, 原型扩展 GameEngineController)
   拆分目标: 主页代码与各游戏对局代码解耦, 减少修改造成的链式影响
   注意: 本文件必须在 main.js (GameEngineController 类定义) 之后加载
   ==================================================================== */
Object.assign(GameEngineController.prototype, {

    /**
     * 开启在线多人/补齐 AI 游鲸麻将模式 (真正多人云端同步局)
     */
    startMahjongOnlineGame(roomId, isHost = false) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
            AuthEngine.checkAndDeductEntryFee('MAHJONG', isPve);
        }

        // 切换游戏前清理斗地主残留定时器
        this.stopDoudizhuTimers();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (mahjongScr) { mahjongScr.style.display = 'flex'; mahjongScr.classList.add('active'); }
        this.updateHeaderVisibility();

        const settlementModal = document.getElementById('mahjongSettlementModal');
        if (settlementModal) settlementModal.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';

        this.selectedMahjongTileIndex = -1;
        // 每次开局都重置初始化标记，避免重开一局时客户端跳过新的初始牌组
        this._mahjongOnlineInitDone = false;
        this.mahjongReadyPlayers = [false, false, false, false];

        const btnSettle = document.getElementById('btnMahjongSettleRematch');
        if (btnSettle) {
            btnSettle.disabled = false;
            btnSettle.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 再来一局';
        }

        if (isHost) {
            NetworkManager.clearMahjongRematchStatus();
            // 房主初始化麻将引擎并导出全量牌组与庄家状态
            window.mahjongEngine.reset(false, 0);
            const initData = window.mahjongEngine.exportState();
            NetworkManager.sendMahjongInitState(initData);
            // 清掉上一局残留的出牌动作，防止重开时客户端误导入旧状态
            NetworkManager.clearMahjongMoves();
            NetworkManager.sendMahjongStart(roomId);
            // 房主启动 AI 回合看门狗：任何异常/竞态导致 AI 回合卡住都会自动恢复
            if (this._mahjongWatchdogId) clearInterval(this._mahjongWatchdogId);
            this._mahjongWatchdogId = setInterval(() => {
                this._checkMahjongAiWatchdog();
            }, 4000);
        } else {
            // 客户端拉取房主生成的初始牌组状态
            NetworkManager.onMahjongInitState((initData) => {
                if (initData && !this._mahjongOnlineInitDone) {
                    this._mahjongOnlineInitDone = true;
                    window.mahjongEngine.importState(initData);
                    this.renderMahjongHandTiles();
                    this.renderMahjongDiscards();
                    this.renderMahjongMelds();
                }
            });
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : (isHost ? 0 : 1);
        const players = this.latestLobbyPlayers || this.gameState.players || [];
        for (let i = 0; i < 4; i++) {
            if (!players[i]) {
                players[i] = { id: i, name: `AI-${i}`, isAi: (i !== 0), isHost: (i === 0) };
            }
        }
        // 引擎固定座位风向：0=南(我方/房主)、1=东(右家)、2=北(对家)、3=西(左家)
        const windNames = ['东', '南', '西', '北'];

        const mNameBottom = document.getElementById('mNameBottom');
        const mNameRight  = document.getElementById('mNameRight');
        const mNameTop    = document.getElementById('mNameTop');
        const mNameLeft   = document.getElementById('mNameLeft');
        const mAvatarBottom = document.getElementById('mAvatarBottom');
        const mAvatarRight  = document.getElementById('mAvatarRight');
        const mAvatarTop    = document.getElementById('mAvatarTop');
        const mAvatarLeft   = document.getElementById('mAvatarLeft');
        const mWindBottom = document.getElementById('mWindBottom');
        const mWindRight  = document.getElementById('mWindRight');
        const mWindTop    = document.getElementById('mWindTop');
        const mWindLeft   = document.getElementById('mWindLeft');

        // 座位名称渲染：纯名字（AI 前缀与风向独立展示，避免重复冗余）
        const getPlayerNameAtRelativePos = (offset) => {
            const absIdx = (mySlot + offset) % 4;
            const p = players[absIdx];
            return p ? p.name : `AI-${absIdx + 1}`;
        };
        const seatAvatar = (absIdx) => {
            const p = players[absIdx];
            if (p && !p.isAi && p.avatar) return p.avatar;
            return p && !p.isAi ? '🤠' : '🤖';
        };

        if (mNameBottom) mNameBottom.textContent = getPlayerNameAtRelativePos(0);
        if (mNameRight)  mNameRight.textContent  = getPlayerNameAtRelativePos(1);
        if (mNameTop)    mNameTop.textContent    = getPlayerNameAtRelativePos(2);
        if (mNameLeft)   mNameLeft.textContent   = getPlayerNameAtRelativePos(3);
        if (mAvatarBottom) mAvatarBottom.textContent = seatAvatar(mySlot);
        if (mAvatarRight)  mAvatarRight.textContent  = seatAvatar((mySlot + 1) % 4);
        if (mAvatarTop)    mAvatarTop.textContent    = seatAvatar((mySlot + 2) % 4);
        if (mAvatarLeft)   mAvatarLeft.textContent   = seatAvatar((mySlot + 3) % 4);

        // 风向独立徽章 (0=南/我方、1=东/右、2=北/对、3=西/左)
        if (mWindBottom) mWindBottom.textContent = windNames[mySlot];
        if (mWindRight)  mWindRight.textContent  = windNames[(mySlot + 1) % 4];
        if (mWindTop)    mWindTop.textContent    = windNames[(mySlot + 2) % 4];
        if (mWindLeft)   mWindLeft.textContent   = windNames[(mySlot + 3) % 4];

        // 设置 3D 局风罗盘风向标签 (映射到玩家视角：底部为我方风向，右/顶/左依序顺时针排列)
        const windSouth = document.getElementById('windSouth');
        const windEast  = document.getElementById('windEast');
        const windNorth = document.getElementById('windNorth');
        const windWest  = document.getElementById('windWest');

        if (windSouth) windSouth.textContent = windNames[mySlot];
        if (windEast)  windEast.textContent  = windNames[(mySlot + 1) % 4];
        if (windNorth) windNorth.textContent = windNames[(mySlot + 2) % 4];
        if (windWest)  windWest.textContent  = windNames[(mySlot + 3) % 4];

        const dealerIdx = window.mahjongEngine.dealer;
        const relativeDealerPos = (dealerIdx - mySlot + 4) % 4;
        const dealerTags = ['mDealerBottom', 'mDealerRight', 'mDealerTop', 'mDealerLeft'];
        dealerTags.forEach((tagId, idx) => {
            const el = document.getElementById(tagId);
            if (el) el.style.display = (idx === relativeDealerPos) ? 'inline-block' : 'none';
        });

        this.renderMahjongHandTiles();
        this.renderMahjongDiscards();
        this.renderMahjongMelds();
        this.renderMahjongVisualWall();

        this.triggerMahjongDealAnimation(() => {
            const isMyTurn = (window.mahjongEngine.currentTurn === mySlot);
            if (isMyTurn) {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 轮到你起手出牌`);
                UIRenderer.showToast(`🎲 你是起手庄家！优先出牌`);
                this.checkSelfActionsOnTurn();
            } else if (NetworkManager.isHost) {
                // 庄家为 AI 座位时，由房主驱动 AI 起手出牌（广播后非房主客户端同步跟上）
                this.updateMahjongStatusUI(`🀄 4人雀局 · 对方正在烧烤...`);
                UIRenderer.showToast(`🎲 庄家优先起手出牌中...`);
                const currDealer = window.mahjongEngine.currentTurn;
                const dealerPlayer = this.gameState.players[currDealer];
                if (dealerPlayer && dealerPlayer.isAi) {
                    this.triggerAiTurnLoop();
                }
            } else {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 对方正在烧烤...`);
                UIRenderer.showToast(`🎲 庄家优先起手出牌中...`);
            }
        });

        // 实时监听其他玩家在云端的打牌动作与全局牌桌同步
        NetworkManager.onMahjongMove((move) => {
            if (!move) return;
            const senderIsAi = (this.gameState.players && this.gameState.players[move.senderSlot]) ? this.gameState.players[move.senderSlot].isAi : false;
            if (NetworkManager.isHost && senderIsAi) return;
            if (move.senderSlot === mySlot) return;
            if (move.stateData) {
                window.mahjongEngine.importState(move.stateData);
                this.renderMahjongHandTiles();
                this.renderMahjongDiscards();
                this.renderMahjongMelds();

                // 远程玩家胡牌 / 流局：全员同步弹出结算面板
                if (window.mahjongEngine.isGameOver) {
                    // 远程胡牌：播放胜利音效提示
                    if (move.actionType === 'HU' && typeof SoundEngine !== 'undefined' && SoundEngine.playWin) {
                        try { SoundEngine.playWin(); } catch (e) {}
                    }
                    this.showMahjongSettlement(window.mahjongEngine.winner, null);
                    return;
                }

                const relativeSender = (move.senderSlot - mySlot + 4) % 4;
                const seatLabels = ['你', '右家', '对家', '左家'];

                // 远程玩家 吃/碰/杠：播放对应语音音效 + 国风大字报提示 (跳过摸牌音与响应检查)
                if (move.actionType === 'CHOW' || move.actionType === 'PONG' || move.actionType === 'KONG') {
                    // 其他玩家完成了吃碰杠: 清除本端挂起的响应条 (防止残留/误触发)
                    this.clearMahjongPendingResponse();
                    const actText = move.actionType === 'CHOW' ? '吃！' : (move.actionType === 'PONG' ? '碰！' : '杠！');
                    this.showMahjongActionToast(`${seatLabels[relativeSender] || '对方'}${actText}`);
                    return;
                }

                // 远程玩家选择【过】(不响应): 清除本端响应条, 若轮到 AI 由房主驱动继续
                if (move.actionType === 'PASS') {
                    this.clearMahjongPendingResponse();
                    if (NetworkManager.isHost && window.mahjongEngine && !window.mahjongEngine.isGameOver
                        && window.mahjongEngine.currentTurn !== mySlot
                        && this.gameState.players[window.mahjongEngine.currentTurn] && this.gameState.players[window.mahjongEngine.currentTurn].isAi) {
                        this.triggerAiTurnLoop();
                    }
                    return;
                }

                if (move.discardedTile) {
                    this.animateTileThrow(move.discardedTile, relativeSender);
                }
                if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playMahjongTile === 'function') {
                    SoundEngine.playMahjongTile();
                }

                const currTurn = window.mahjongEngine.currentTurn;
                const isMyTurnNow = (currTurn === mySlot);

                // 检查我方 (mySlot) 对远程打出的牌是否有 吃/碰/杠/胡 响应
                if (move.discardedTile && move.actionType !== 'CHOW' && move.actionType !== 'PONG' && move.actionType !== 'KONG' && move.actionType !== 'HU') {
                    const engine = window.mahjongEngine;
                    const isUpperHouse = (move.senderSlot + 1) % 4 === mySlot;
                    const chowOptions = isUpperHouse ? engine.getChowOptions(mySlot, move.discardedTile) : [];
                    const canChow = chowOptions.length > 0;
                    const canPong = engine.checkCanPong(mySlot, move.discardedTile);
                    const canKong = engine.checkCanKong(mySlot, move.discardedTile);

                    // 截胡判定: 多家可胡时按出牌者下家起顺时针就近优先
                    const huInfo = engine.evaluateHuPriority(move.senderSlot, move.discardedTile);
                    const canHu = huInfo.canHu && !huInfo.huBlocked; // 被截则不弹胡
                    if (huInfo.huBlocked) {
                        const seatLabels2 = ['你', '右家', '对家', '左家'];
                        const blockerSeat = huInfo.huWinner >= 0 ? (seatLabels2[(huInfo.huWinner - mySlot + 4) % 4] || '其他玩家') : '其他玩家';
                        UIRenderer.showToast(`🈲 你的胡被${blockerSeat}截胡了！`);
                    }

                    if (canChow || canPong || canKong || canHu) {
                        this.pendingDiscardRes = {
                            discarded: move.discardedTile,
                            fromPlayer: move.senderSlot,
                            canChow,
                            chowOptions,
                            canPong,
                            canKong,
                            canHu,
                            huBlocked: huInfo.huBlocked,
                            huWinner: huInfo.huWinner
                        };
                        this.showHumanResponseActionBar(this.pendingDiscardRes);
                        this.updateMahjongStatusUI(`⚠️ 玩家打出 [${move.discardedTile.name}]：请选择【吃 / 碰 / 杠 / 胡 / 过】`);
                        return;
                    }
                }

                if (isMyTurnNow) {
                    // 轮到我方: 响应判定之后才摸牌 (修正手牌数, 点炮胡/碰杠判定基于 13 张)
                    if (window.mahjongEngine.pendingDraw) {
                        const drawRes = window.mahjongEngine.drawTile(mySlot);
                        if (!drawRes) {
                            this.showMahjongSettlement(-1, null);
                            return;
                        }
                        this.animateTileDraw(mySlot, window.mahjongEngine.lastDrawnTile);
                        this.renderMahjongHandTiles(true);
                    }
                    this.updateMahjongStatusUI('🀄 4人雀局 · 轮到你出牌！');
                    UIRenderer.showToast('🎲 轮到你出牌！');
                    this.checkSelfActionsOnTurn();
                } else {
                    const relativeTurn = (currTurn - mySlot + 4) % 4;
                    const seatLabels = ['你', '右家', '对家', '左家'];
                    this.updateMahjongStatusUI(`🀄 4人雀局 · ${seatLabels[relativeTurn] || '对方'}正在烧烤...`);
                }

                // 如果下一个轮到 AI 出牌且我是房主，由房主机器驱动 AI 做出决定（跳过 AI 广播回声，避免重复驱动）
                const senderIsAi = this.gameState.players[move.senderSlot] ? this.gameState.players[move.senderSlot].isAi : false;
                if (NetworkManager.isHost && !senderIsAi && this.gameState.players[currTurn] && this.gameState.players[currTurn].isAi) {
                    this.triggerAiTurnLoop();
                }
            }
        });

        // 绑定吃/碰/杠/胡/过动作按钮
        this.bindMahjongActionButtons();
    },
    /**
     * 开启正宗 4 人围桌游鲸麻将模式 (单机 AI / 线上)
     */
    startMahjongAiMode() {
        // NEW 角标已读标记
        if (typeof AuthEngine !== 'undefined' && AuthEngine.markGameSeen) AuthEngine.markGameSeen('MAHJONG');
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee && !AuthEngine.checkAndDeductEntryFee('MAHJONG', true)) {
            return;
        }

        // 切换游戏前清理斗地主残留定时器，防止其 handleTurnTimeout 干扰麻将对局
        this.stopDoudizhuTimers();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (mahjongScr) { mahjongScr.style.display = 'flex'; mahjongScr.classList.add('active'); }
        this.updateHeaderVisibility();

        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';
        this.gameState.players = [
            { id: 0, name: nick, isAi: false, isHost: true },
            { id: 1, name: 'AI-1', isAi: true, isHost: false },
            { id: 2, name: 'AI-2', isAi: true, isHost: false },
            { id: 3, name: 'AI-3', isAi: true, isHost: false }
        ];

        // 关闭胡牌结算弹窗 & 吃牌弹窗
        const settlementModal = document.getElementById('mahjongSettlementModal');
        if (settlementModal) settlementModal.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';

        // 初始化 4 人麻将引擎 (我方 Seat 0 / 南)
        this.selectedMahjongTileIndex = -1;
        window.mahjongEngine.reset(true, 0);

        // 设置 4 个座位玩家信息
        const mNameBottom = document.getElementById('mNameBottom');
        if (mNameBottom) mNameBottom.textContent = nick;

        // 设置庄家标识与先手引导
        const dealerIdx = window.mahjongEngine.dealer;
        const dealerNames = ['你 (南风)', '右家 (东风)', '对家 (北风)', '左家 (西风)'];
        const dealerName = dealerNames[dealerIdx];

        const dealerTags = ['mDealerBottom', 'mDealerRight', 'mDealerTop', 'mDealerLeft'];
        dealerTags.forEach((tagId, idx) => {
            const el = document.getElementById(tagId);
            if (el) el.style.display = (idx === dealerIdx) ? 'inline-block' : 'none';
        });

        this.renderMahjongHandTiles();
        this.renderMahjongDiscards();
        this.renderMahjongMelds();
        this.renderMahjongVisualWall();

        this.triggerMahjongDealAnimation(() => {
            if (dealerIdx === 0) {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 随机选定 👑【${dealerName}】庄家先手出牌`);
                UIRenderer.showToast(`🎲 随机选定 👑【${dealerName}】为庄家！优先起手`);
                this.checkSelfActionsOnTurn();
            } else {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 随机选定 👑【${dealerName}】庄家起手出牌中...`);
                UIRenderer.showToast(`🎲 随机选定 👑【${dealerName}】为庄家！由其优先起手`);
                this.triggerAiTurnLoop();
            }
        });

        // 绑定底栏与菜单按键
        const btnBack = document.getElementById('btnMahjongBackLobby');
        if (btnBack) btnBack.onclick = () => this.resetToLobby();

        const btnRematch = document.getElementById('btnMahjongRematch');
        if (btnRematch) btnRematch.onclick = () => this.startMahjongAiMode();

        const btnCloseChow = document.getElementById('btnCloseChowModal');
        if (btnCloseChow) btnCloseChow.onclick = () => {
            if (chowModal) chowModal.style.display = 'none';
        };

        const btnSettleRematch = document.getElementById('btnMahjongSettleRematch');
        if (btnSettleRematch) {
            btnSettleRematch.onclick = () => {
                if (NetworkManager.roomId && !NetworkManager.isAiMode) {
                    btnSettleRematch.disabled = true;
                    btnSettleRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (等待全员...)';
                    this.handleSelfAction('RESTART_VOTE', { gameType: 'MAHJONG' });
                    if (NetworkManager.isHost) {
                        this.processRestartVote(0);
                    }
                } else {
                    this.startMahjongAiMode();
                }
            };
        }

        const btnSettleLobby = document.getElementById('btnMahjongSettleLobby');
        if (btnSettleLobby) btnSettleLobby.onclick = () => {
            const mModal = document.getElementById('mahjongSettlementModal');
            if (mModal) mModal.style.display = 'none';
            this.resetToLobby();
        };

        // 绑定吃/碰/杠/胡/过按键
        this.bindMahjongActionButtons();

        // 我方开局自摸/杠牌动作判定
        this.checkSelfActionsOnTurn();
    },
    /**
     * 绑定吃/碰/杠/胡/过动作按钮
     */
    bindMahjongActionButtons() {
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        if (btnChow) btnChow.onclick = () => this.handleMahjongChowClick();
        if (btnPong) btnPong.onclick = () => this.handleMahjongPongClick();
        if (btnKong) btnKong.onclick = () => this.handleMahjongKongClick();

        // 📱 手机端出牌按钮：固定在 ID 信息右侧，选中牌后亮起可点击
        const btnDiscard = document.getElementById('btnMahjongDiscard');
        if (btnDiscard) {
            btnDiscard.onclick = () => {
                const idx = this.selectedMahjongTileIndex;
                if (idx === undefined || idx === null || idx < 0) return;
                this.selectedMahjongTileIndex = -1;
                this.hideMahjongDiscardBar();
                this.handleMahjongTileDiscard(idx);
            };
        }
        if (btnHu) btnHu.onclick = () => this.handleMahjongHuClick();
        if (btnPass) btnPass.onclick = () => this.handleMahjongPassClick();
    },
    /**
     * 播放国风特效大字报 (吃！/碰！/杠！/胡！) 并联动触发高保真语音音效 (chi.mp3, peng.mp3, gang.mp3)
     */
    showMahjongActionToast(text) {
        const toast = document.getElementById('mahjongActionToast');
        const textEl = document.getElementById('mahjongActionToastText');
        if (!toast || !textEl) return;

        textEl.textContent = text;
        toast.style.display = 'block';

        // 联动播放真实声优语音音效
        if (typeof SoundEngine !== 'undefined') {
            if (text.includes('吃') || text.includes('CHOW')) {
                if (typeof SoundEngine.playMahjongChow === 'function') SoundEngine.playMahjongChow();
            } else if (text.includes('碰') || text.includes('PONG')) {
                if (typeof SoundEngine.playMahjongPong === 'function') SoundEngine.playMahjongPong();
            } else if (text.includes('杠') || text.includes('KONG')) {
                if (typeof SoundEngine.playMahjongKong === 'function') SoundEngine.playMahjongKong();
            }
        }

        if (this._actionToastTimer) clearTimeout(this._actionToastTimer);
        this._actionToastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 850);
    },
    /**
     * 生成正宗国粹 3D 浮雕麻将牌面图案 HTML (万、筒/饼、条/索、字/风/箭)
     */
    getMahjongTileFaceHTML(tile) {
        if (!tile) return '';
        const { type, num, name } = tile;

        // 1. 字牌 (红中、发财、白板、东南西北)
        if (type === '字') {
            if (name === '红中') return `<div class="m-face honor red-zhong">中</div>`;
            if (name === '发财') return `<div class="m-face honor green-fa">發</div>`;
            if (name === '白板') return `<div class="m-face honor baiban"><div class="baiban-inner"></div></div>`;
            return `<div class="m-face honor wind">${name.replace('风', '')}</div>`;
        }

        // 2. 万字牌 (1-9万)
        if (type === '万') {
            const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
            return `<div class="m-face wan"><span class="w-num">${cn[num] || num}</span><span class="w-char">萬</span></div>`;
        }

        // 3. 饼/筒牌 (1-9饼)
        if (type === '筒' || type === '饼') {
            if (num === 1) {
                return `<div class="m-face bing bing-1"><div class="rosette"><div class="rosette-inner"></div></div></div>`;
            }
            let dots = '';
            for (let i = 1; i <= num; i++) {
                dots += `<span class="dot d-${i}"></span>`;
            }
            return `<div class="m-face bing bing-${num}">${dots}</div>`;
        }

        // 4. 条/索牌 (1-9条：高清 100% 数学精准矢量 SVG，彻底解决尺寸不一与换行问题)
        if (type === '条' || type === '索') {
            return this.getTiaoTileSVG(num);
        }

        return `<div class="m-face fallback">${name}</div>`;
    },
    /**
     * 🀄 136张国粹 1-9 条/索全量高清 100% 数学几何精准 SVG 矢量生成函数
     * 彻底解决原本 CSS 浮动导致同一索牌在不同区域尺寸不一、中心杆变高变矮或换行的缺陷
     */
    getTiaoTileSVG(num) {
        if (num === 1) {
            return `
                <div class="m-face tiao tiao-1">
                    <img src="picture/yaoji.webp" class="yaoji-img" alt="幺鸡" />
                </div>`;
        }
        if (num === 2) {
            return `
                <div class="m-face tiao tiao-2">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="8.5" y="7.5" width="4.8" height="29" rx="2" fill="#16a34a"/>
                        <rect x="18.7" y="7.5" width="4.8" height="29" rx="2" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 3) {
            return `
                <div class="m-face tiao tiao-3">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4.8" y="8.5" width="4.5" height="27" rx="1.8" fill="#2563eb"/>
                        <rect x="13.75" y="8.5" width="4.5" height="27" rx="1.8" fill="#16a34a"/>
                        <rect x="22.7" y="8.5" width="4.5" height="27" rx="1.8" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 4) {
            return `
                <div class="m-face tiao tiao-4">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6.5" y="4.5" width="4.6" height="16.5" rx="1.6" fill="#16a34a"/>
                        <rect x="20.9" y="4.5" width="4.6" height="16.5" rx="1.6" fill="#dc2626"/>
                        <rect x="6.5" y="23" width="4.6" height="16.5" rx="1.6" fill="#dc2626"/>
                        <rect x="20.9" y="23" width="4.6" height="16.5" rx="1.6" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 5) {
            return `
                <div class="m-face tiao tiao-5">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="5.5" y="4.5" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="22.1" y="4.5" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="13.8" y="14.25" width="4.4" height="15.5" rx="1.5" fill="#dc2626"/>
                        <rect x="5.5" y="24" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="22.1" y="24" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 6) {
            return `
                <div class="m-face tiao tiao-6">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7.5" y="4" width="4.2" height="11.5" rx="1.4" fill="#16a34a"/>
                        <rect x="20.3" y="4" width="4.2" height="11.5" rx="1.4" fill="#16a34a"/>
                        <rect x="7.5" y="16.25" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="20.3" y="16.25" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="7.5" y="28.5" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="20.3" y="28.5" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 7) {
            return `
                <div class="m-face tiao tiao-7">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="13.9" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="21.8" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="8.5" y="19.5" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="19.3" y="19.5" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="8.5" y="31" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="19.3" y="31" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 8) {
            return `
                <div class="m-face tiao tiao-8">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7.5" y="3.5" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="3.5" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="13.3" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="13.3" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="23.1" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="23.1" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="32.9" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="32.9" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 9) {
            return `
                <div class="m-face tiao tiao-9">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4.8" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="13.9" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="23" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="4.8" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="13.9" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="23" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="4.8" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                        <rect x="13.9" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                        <rect x="23" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        return '';
    },
    /**
     * 渲染我方手牌及另外 3 家盖牌背牌 (Top, Left, Right)
     * @param {boolean} animateSort - 是否播放理牌滑动动画 (FLIP Sliding Sort Animation)
     */
    renderMahjongHandTiles(animateSort = false) {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        // 更新剩余牌墙计数器与视觉牌墙
        const countEl = document.getElementById('mahjongWallCount');
        if (countEl) countEl.textContent = engine.wallCount;
        this.renderMahjongVisualWall();

        // 听牌提示：轮到我方出牌（13或14张手牌）时计算可胡张
        const isMyTurnAndDrawn = (engine.currentTurn === mySlot && (engine.hands[mySlot] || []).length % 3 === 2);
        const tingInfo = (engine.currentTurn === mySlot && !engine.isGameOver) ? this.getMahjongTingInfo() : null;
        this.renderMahjongTingBadge(tingInfo);

        const containerBottom = document.getElementById('mahjongHandTilesContainer');
        if (!containerBottom) return;

        // 1. FLIP 动画前半段：记录我方手牌原有 DOM 坐标 (Left, Top)
        const oldPositions = new Map();
        if (animateSort) {
            const existingCards = containerBottom.querySelectorAll('.mahjong-tile-card');
            existingCards.forEach(card => {
                const tileId = card.dataset.tileId;
                if (tileId) {
                    oldPositions.set(tileId, card.getBoundingClientRect());
                }
            });
        }

        // 2. 渲染我方 (Seat mySlot) 手牌
        containerBottom.innerHTML = '';
        const myHand = engine.hands[mySlot] || [];

        myHand.forEach((tile, index) => {
            const card = document.createElement('div');
            card.className = 'mahjong-tile-card';
            card.dataset.tileId = tile.id || `${tile.type}_${tile.num}_${index}`;
            card.dataset.index = index;

            // 🀄 摸牌位：若轮到我方且有 14 张牌（或吃碰杠后 4/7/10/14 张），最右侧最后一张为摸牌位，离左侧手牌空开间隔
            if (isMyTurnAndDrawn && index === myHand.length - 1) {
                card.classList.add('is-drawn-tile');
            }

            // 🀄 听牌高亮：听牌状态下，能够凑成胡牌的关键搭子金色微光
            if (tingInfo && tingInfo.tingSet && tingInfo.tingSet.has(tile.name)) {
                card.classList.add('ting-key-tile');
            }

            if (this.selectedMahjongTileIndex === index) {
                card.classList.add('selected');
            }
            card.innerHTML = this.getMahjongTileFaceHTML(tile);
            // 记录牌名到 face 上，供碰/杠高亮匹配
            const faceEl = card.querySelector('.m-face');
            if (faceEl) faceEl.dataset.tileName = tile.name;

            // 📱 手机端：滑动选择 + 点击出牌（滑动经过即高亮，点出牌按钮打出）
            const isMobileTouch = ('ontouchstart' in window) || window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
            if (isMobileTouch) {
                // 触摸滑动选择：手指滑到哪张牌就高亮哪张（位移超阈值才拦截，避免干扰轻点选择）
                let touchStartX = 0;
                let touchStartY = 0;
                let swiping = false;
                card.addEventListener('touchstart', (e) => {
                    const t = e.touches[0];
                    if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
                    swiping = false;
                }, { passive: true });

                card.addEventListener('touchmove', (e) => {
                    const touch = e.touches[0];
                    if (!touch) return;
                    // 位移超过 8px 才算滑动（轻点抖动不拦截 click）
                    if (!swiping) {
                        const dx = touch.clientX - touchStartX;
                        const dy = touch.clientY - touchStartY;
                        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                        swiping = true;
                    }
                    e.preventDefault();
                    // 找到手指正下方的牌
                    const el = document.elementFromPoint(touch.clientX, touch.clientY);
                    const target = el ? el.closest('.mahjong-tile-card') : null;
                    if (target && target.dataset.index !== undefined) {
                        const idx = parseInt(target.dataset.index, 10);
                        if (this.selectedMahjongTileIndex !== idx) {
                            // 轻量切换高亮（只改 class，不重建整手牌，保证滑动流畅）
                            this.selectedMahjongTileIndex = idx;
                            containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                                c.classList.toggle('selected', parseInt(c.dataset.index, 10) === idx);
                            });
                            this.showMahjongDiscardBar(idx);
                        }
                    }
                }, { passive: false });

                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (swiping) return; // 刚滑动过，忽略本次点击
                    // 预选支持：无论是否轮到自己回合都允许选中/取消（非回合时按钮不亮，轮到自己时自动点亮）
                    const engine = window.mahjongEngine;
                    if (!engine || engine.isGameOver) return;
                    if (this.selectedMahjongTileIndex === index) {
                        // 再点已选中的牌：取消选中
                        this.selectedMahjongTileIndex = -1;
                        this.hideMahjongDiscardBar();
                        containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                            c.classList.remove('selected');
                        });
                    } else {
                        // 点选/滑动切换到此牌（预选）
                        this.selectedMahjongTileIndex = index;
                        if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                            SoundEngine.playCardFlipSound();
                        }
                        // 轻量高亮：不重建整个手牌，直接切换 selected class
                        containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                            c.classList.toggle('selected', parseInt(c.dataset.index, 10) === index);
                        });
                        this.showMahjongDiscardBar(index);
                    }
                });
            } else {
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.selectedMahjongTileIndex === index) {
                        // 第 2 次点击：确认打出此牌！
                        this.selectedMahjongTileIndex = -1;
                        this.handleMahjongTileDiscard(index);
                    } else {
                        // 第 1 次点击：高亮凸起选中此牌！
                        this.selectedMahjongTileIndex = index;
                        if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                            SoundEngine.playCardFlipSound();
                        }
                        this.renderMahjongHandTiles();
                    }
                });
            }

            containerBottom.appendChild(card);
        });

        // 3. FLIP 动画后半段：比对新旧坐标并播放理牌滑动动画 (0.28s)
        if (animateSort && oldPositions.size > 0) {
            const newCards = containerBottom.querySelectorAll('.mahjong-tile-card');
            let hasMoved = false;

            newCards.forEach(card => {
                const tileId = card.dataset.tileId;
                const oldRect = oldPositions.get(tileId);
                if (oldRect) {
                    const newRect = card.getBoundingClientRect();
                    const deltaX = oldRect.left - newRect.left;
                    if (Math.abs(deltaX) > 1) {
                        hasMoved = true;
                        card.style.transform = `translateX(${deltaX}px)`;
                        card.style.transition = 'none';

                        requestAnimationFrame(() => {
                            card.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.9, 0.35, 1)';
                            card.style.transform = 'translateX(0)';
                        });
                    }
                }
            });

            if (hasMoved && typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                try { SoundEngine.playCardFlipSound(); } catch (e) {}
            }
        }

        // 4. 渲染北家 (Top) 盖牌背牌
        const containerTop = document.getElementById('mahjongTilesTop');
        if (containerTop) {
            const topHand = engine.hands[(mySlot + 2) % 4] || [];
            const countTop = topHand.length;
            const isTopTurn = (engine.currentTurn === (mySlot + 2) % 4 && countTop % 3 === 2);
            let htmlTop = '';
            for (let i = 0; i < countTop; i++) {
                const isDrawn = (isTopTurn && i === countTop - 1) ? 'is-drawn-tile' : '';
                htmlTop += `<div class="standing-tile-top ${isDrawn}"></div>`;
            }
            containerTop.innerHTML = htmlTop;
        }

        // 5. 渲染西家 (Left) 盖牌背牌
        const containerLeft = document.getElementById('mahjongTilesLeft');
        if (containerLeft) {
            const leftHand = engine.hands[(mySlot + 3) % 4] || [];
            const countLeft = leftHand.length;
            const isLeftTurn = (engine.currentTurn === (mySlot + 3) % 4 && countLeft % 3 === 2);
            let htmlLeft = '';
            for (let i = 0; i < countLeft; i++) {
                const isDrawn = (isLeftTurn && i === countLeft - 1) ? 'is-drawn-tile' : '';
                htmlLeft += `<div class="standing-tile-left ${isDrawn}"></div>`;
            }
            containerLeft.innerHTML = htmlLeft;
        }

        // 6. 渲染东家 (Right) 盖牌背牌
        const containerRight = document.getElementById('mahjongTilesRight');
        if (containerRight) {
            const rightHand = engine.hands[(mySlot + 1) % 4] || [];
            const countRight = rightHand.length;
            const isRightTurn = (engine.currentTurn === (mySlot + 1) % 4 && countRight % 3 === 2);
            let htmlRight = '';
            for (let i = 0; i < countRight; i++) {
                const isDrawn = (isRightTurn && i === countRight - 1) ? 'is-drawn-tile' : '';
                htmlRight += `<div class="standing-tile-right ${isDrawn}"></div>`;
            }
            containerRight.innerHTML = htmlRight;
        }
    },
    /**
     * 🀄 渲染剩余张数区域下方的 3D 视觉砌牌墙 (即拿即销动画 Stack)
     */
    renderMahjongVisualWall() {
        const row = document.getElementById('mahjongVisualWallRow');
        if (!row || !window.mahjongEngine) return;

        const count = window.mahjongEngine.wallCount || 0;
        const maxCols = 22;
        const colCount = Math.min(maxCols, Math.max(0, Math.ceil(count / 3.8)));

        let html = '';
        for (let i = 0; i < colCount; i++) {
            const isDouble = (i * 3.8 < count);
            html += `<div class="wall-mini-tile-stack ${isDouble ? 'double-stack' : ''}"></div>`;
        }
        row.innerHTML = html;
    },
    /**
     * 🀄 听牌检测：遍历所有可能的牌张，返回能胡的牌集合
     * @returns {null|{tingSet:Set<string>, tingCount:number, tingTiles:string[]}}
     */
    getMahjongTingInfo() {
        const engine = window.mahjongEngine;
        if (!engine) return null;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const myHand = engine.hands[mySlot] || [];
        // 听牌判断：13 张（打完牌等待摸牌）或 14 张（刚摸牌未打出）均可判断
        const lenMod = myHand.length % 3;
        if (lenMod !== 1 && lenMod !== 2) return null;
        const isFourteen = (lenMod === 2); // 14 张：刚摸牌，需先虚拟打出一张再判断

        // 手牌已有的牌名计数，用于排除已有 4 张的牌
        const handCount = {};
        myHand.forEach(t => { handCount[t.name] = (handCount[t.name] || 0) + 1; });

        const tingSet = new Set();
        const tingTiles = [];
        const types = ['万', '条', '筒'];
        const candidates = [];
        types.forEach(t => { for (let n = 1; n <= 9; n++) candidates.push({ type: t, num: n, name: `${n}${t}`, id: `cand_${t}_${n}` }); });
        const winds = ['东', '南', '西', '北'];
        winds.forEach((w, idx) => candidates.push({ type: '字', num: idx + 1, name: `${w}风`, id: `cand_风_${w}` }));
        const dragons = [{ name: '红中', num: 5 }, { name: '发财', num: 6 }, { name: '白板', num: 7 }];
        dragons.forEach(d => candidates.push({ type: '字', num: d.num, name: d.name, id: `cand_箭_${d.name}` }));

        for (const cand of candidates) {
            // 该牌已在手 4 张，无法再胡
            if ((handCount[cand.name] || 0) >= 4) continue;
            try {
                if (isFourteen) {
                    // 14 张：遍历打出任意一张后，剩下的 13 张 + cand 能否胡
                    const seen = new Set();
                    for (let i = 0; i < myHand.length; i++) {
                        const drop = myHand[i];
                        const dropKey = drop.name + '_' + i;
                        if (seen.has(drop.name)) continue;
                        seen.add(drop.name);
                        const rest = myHand.filter((_, idx) => idx !== i);
                        if (engine.checkCanHu(rest, cand)) {
                            if (!tingSet.has(cand.name)) {
                                tingSet.add(cand.name);
                                tingTiles.push(cand.name);
                            }
                            break;
                        }
                    }
                } else {
                    if (engine.checkCanHu(myHand, cand)) {
                        if (!tingSet.has(cand.name)) {
                            tingSet.add(cand.name);
                            tingTiles.push(cand.name);
                        }
                    }
                }
            } catch (e) { /* 单张检测异常忽略 */ }
        }

        if (tingTiles.length === 0) return null;
        return { tingSet, tingCount: tingTiles.length, tingTiles };
    },
    /**
     * 🀄 渲染听牌徽章（顶部状态胶囊右侧）
     */
    renderMahjongTingBadge(tingInfo) {
        let badge = document.getElementById('mahjongTingBadge');
        if (!tingInfo) {
            if (badge) badge.style.display = 'none';
            return;
        }
        if (!badge) {
            const topBar = document.getElementById('mahjongTopBar');
            if (!topBar) return;
            badge = document.createElement('div');
            badge.id = 'mahjongTingBadge';
            badge.className = 'mahjong-ting-badge';
            topBar.appendChild(badge);
        }
        badge.innerHTML = `<span class="ting-title">🎯 听牌</span><span class="ting-count">${tingInfo.tingCount}张</span><span class="ting-tiles">${tingInfo.tingTiles.join(' ')}</span>`;
        badge.style.display = 'inline-flex';
    },
    /**
     * 🀄 发牌动画中渐进渲染 4 家手牌 (按步数递增: 4 -> 8 -> 12 -> 13/14)
     */
    renderMahjongHandTilesPartial(step) {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const myHand = engine.hands[mySlot] || [];
        const maxTilesToRender = Math.min(myHand.length, step * 4);

        const containerBottom = document.getElementById('mahjongHandTilesContainer');
        if (containerBottom) {
            containerBottom.innerHTML = '';
            for (let index = 0; index < maxTilesToRender; index++) {
                const tile = myHand[index];
                const card = document.createElement('div');
                card.className = 'mahjong-tile-card';
                card.innerHTML = this.getMahjongTileFaceHTML(tile);
                containerBottom.appendChild(card);
            }
        }

        const topHand = engine.hands[(mySlot + 2) % 4] || [];
        const leftHand = engine.hands[(mySlot + 3) % 4] || [];
        const rightHand = engine.hands[(mySlot + 1) % 4] || [];

        const countTop = Math.min(topHand.length, step * 4);
        const countLeft = Math.min(leftHand.length, step * 4);
        const countRight = Math.min(rightHand.length, step * 4);

        const containerTop = document.getElementById('mahjongTilesTop');
        if (containerTop) {
            let html = '';
            for (let i = 0; i < countTop; i++) html += `<div class="standing-tile-top"></div>`;
            containerTop.innerHTML = html;
        }

        const containerLeft = document.getElementById('mahjongTilesLeft');
        if (containerLeft) {
            let html = '';
            for (let i = 0; i < countLeft; i++) html += `<div class="standing-tile-left"></div>`;
            containerLeft.innerHTML = html;
        }

        const containerRight = document.getElementById('mahjongTilesRight');
        if (containerRight) {
            let html = '';
            for (let i = 0; i < countRight; i++) html += `<div class="standing-tile-right"></div>`;
            containerRight.innerHTML = html;
        }

        this.renderMahjongVisualWall();

        // 重渲染后恢复碰/杠高亮（若响应仍未结束）
        if (this.pendingDiscardRes) {
            this.highlightMahjongActionTiles(this.pendingDiscardRes);
        }
    },
    /**
     * 🀄 开局前置洗牌摆牌 + 上下左右分发 4 家手牌动画
     */
    triggerMahjongDealAnimation(onComplete) {
        const overlay = document.getElementById('mahjongDealingOverlay');
        if (!overlay) {
            if (onComplete) onComplete();
            return;
        }

        this.isMahjongDealingAnim = true;

        // 发牌之前所有人手上均无牌 (完全清空)
        this.renderMahjongHandTilesPartial(0);

        overlay.innerHTML = `
            <div class="deal-wall-center-grid" id="dealCenterGrid">
                ${Array(24).fill('<div class="deal-tile-back"></div>').join('')}
            </div>
        `;
        overlay.style.display = 'flex';
        overlay.classList.add('active');

        if (typeof SoundEngine !== 'undefined') {
            if (typeof SoundEngine.playMahjongShuffle === 'function') {
                SoundEngine.playMahjongShuffle();
            } else if (typeof SoundEngine.playCardSort === 'function') {
                SoundEngine.playCardSort();
            }
        }

        const seats = ['bottom', 'right', 'top', 'left'];
        let step = 0;
        const totalRounds = 4;

        const dealTimer = setInterval(() => {
            step++;
            if (step <= totalRounds) {
                // 4 个方向平滑飞牌动画
                seats.forEach((seat) => {
                    const flyingTile = document.createElement('div');
                    flyingTile.className = `flying-deal-tile fly-to-${seat}`;
                    overlay.appendChild(flyingTile);

                    setTimeout(() => {
                        flyingTile.classList.add('arrived');
                        setTimeout(() => flyingTile.remove(), 200);
                    }, 40);
                });

                if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playMahjongTile === 'function') {
                    SoundEngine.playMahjongTile();
                }

                this.renderMahjongHandTilesPartial(step);
            } else {
                clearInterval(dealTimer);
                setTimeout(() => {
                    overlay.classList.remove('active');
                    setTimeout(() => {
                        overlay.style.display = 'none';
                        this.isMahjongDealingAnim = false;
                        this.renderMahjongHandTiles();
                        this.renderMahjongDiscards();
                        this.renderMahjongMelds();
                        this.renderMahjongVisualWall();
                        if (onComplete) onComplete();
                    }, 250);
                }, 150);
            }
        }, 250);
    },
    /**
     * 渲染 4 方吃碰杠牌堆 (Melds)
     */
    renderMahjongMelds() {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const meldMap = [
            { id: 'meldsBottom', idx: mySlot },
            { id: 'meldsRight',  idx: (mySlot + 1) % 4 },
            { id: 'meldsTop',    idx: (mySlot + 2) % 4 },
            { id: 'meldsLeft',   idx: (mySlot + 3) % 4 }
        ];

        // 手机端：读取当前手牌卡片的实际宽度，让碰/吃/杠牌堆与手牌同尺寸
        let handTileW = null;
        const isMobileView = window.innerWidth <= 768;
        if (isMobileView) {
            const handTile = document.querySelector('.mahjong-tile-card');
            if (handTile) handTileW = Math.round(handTile.getBoundingClientRect().width);
        }

        meldMap.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                const list = engine.melds[item.idx] || [];
                el.innerHTML = list.map(m => {
                    const tilesHtml = m.tiles.map(t => `<div class="meld-tile" ${handTileW ? `style="width:${handTileW}px;height:${Math.round(handTileW * 1.34)}px;"` : ''}>${this.getMahjongTileFaceHTML(t)}</div>`).join('');
                    return `<div class="meld-group">${tilesHtml}</div>`;
                }).join('');
            }
        });
    },
    /**
     * 渲染 4 方弃牌堆（最新打出的牌添加红点高亮）
     */
    renderMahjongDiscards() {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const map = [
            { id: 'discardsBottom', idx: mySlot },
            { id: 'discardsRight',  idx: (mySlot + 1) % 4 },
            { id: 'discardsTop',    idx: (mySlot + 2) % 4 },
            { id: 'discardsLeft',   idx: (mySlot + 3) % 4 }
        ];

        const lastTile = engine.lastDiscard ? engine.lastDiscard.tile : null;
        const lastPlayer = engine.lastDiscard ? engine.lastDiscard.playerIdx : null;

        map.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                const list = engine.discards[item.idx] || [];
                el.innerHTML = list.map((t, index) => {
                    const isLatest = (item.idx === lastPlayer && index === list.length - 1);
                    return `<div class="discard-chip ${isLatest ? 'latest-discard' : ''}">${this.getMahjongTileFaceHTML(t)}</div>`;
                }).join('');
            }
        });
    },
    /**
     * 3D 抛掷出牌飞行动画
     */
    animateTileThrow(tile, playerIdx) {
        const table = document.querySelector('.vertical-mahjong-table');
        if (!table) return;

        const animTile = document.createElement('div');
        animTile.className = `throwing-mahjong-tile player-${playerIdx}`;
        animTile.innerHTML = tile ? this.getMahjongTileFaceHTML(tile) : '🀄';

        table.appendChild(animTile);

        setTimeout(() => {
            if (animTile.parentNode) {
                animTile.parentNode.removeChild(animTile);
            }
        }, 450);
    },
    /**
     * 🀄 拟真摸牌飞牌动画 (从剩余牌墙/中心桌台飞入当前出牌玩家手牌区)
     */
    animateTileDraw(playerIdx, tile, onComplete) {
        const table = document.querySelector('.vertical-mahjong-table');
        if (!table) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const relativePos = (playerIdx - mySlot + 4) % 4;

        // 播摸牌声音
        if (typeof SoundEngine !== 'undefined') {
            try {
                if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                else if (typeof SoundEngine.playCardFlipSound === 'function') SoundEngine.playCardFlipSound();
            } catch (e) {}
        }

        // 创建飞行动态抓牌元素
        const animTile = document.createElement('div');
        animTile.className = `drawing-mahjong-tile target-player-${relativePos}`;

        // 我方摸牌显示正面图案，其他玩家显示绿色盖牌背面
        if (relativePos === 0 && tile) {
            animTile.innerHTML = this.getMahjongTileFaceHTML(tile);
            animTile.classList.add('is-face');
        } else {
            animTile.classList.add('is-back');
        }

        table.appendChild(animTile);

        // 动画时长 260ms
        setTimeout(() => {
            if (animTile.parentNode) {
                animTile.parentNode.removeChild(animTile);
            }
            if (typeof onComplete === 'function') onComplete();
        }, 260);
    },
    /**
     * 启动/重置 25 秒麻将倒计时器 (与扑克风格一致，超时自动打出刚摸的牌)
     */
    resetMahjongTurnTimer() {
        if (this._mahjongTimerInterval) {
            clearInterval(this._mahjongTimerInterval);
            this._mahjongTimerInterval = null;
        }

        const timerEl = document.getElementById('mahjongTimer');
        const engine = window.mahjongEngine;
        if (!engine || engine.isGameOver) {
            if (timerEl) {
                timerEl.textContent = '25';
                timerEl.classList.remove('urgent');
            }
            return;
        }

        this._mahjongTimerSeconds = this.pendingDiscardRes ? 10 : 25;
        if (timerEl) {
            timerEl.textContent = String(this._mahjongTimerSeconds);
            timerEl.classList.remove('urgent');
        }

        // 响应浮条倒计时徽标同步
        const actTimerEl = document.getElementById('mahjongActionTimer');
        if (actTimerEl) {
            if (this.pendingDiscardRes) {
                actTimerEl.style.display = 'inline-block';
                actTimerEl.textContent = `⏱ ${this._mahjongTimerSeconds}s`;
                actTimerEl.classList.remove('urgent');
            } else {
                actTimerEl.style.display = 'none';
            }
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        this._mahjongTimerInterval = setInterval(() => {
            const mahjongScr = document.getElementById('mahjongGameScreen');
            if (!mahjongScr || mahjongScr.style.display === 'none' || !engine || engine.isGameOver) {
                clearInterval(this._mahjongTimerInterval);
                this._mahjongTimerInterval = null;
                return;
            }

            this._mahjongTimerSeconds--;
            if (timerEl) {
                timerEl.textContent = Math.max(0, this._mahjongTimerSeconds);
                if (this._mahjongTimerSeconds <= 5) timerEl.classList.add('urgent');
                else timerEl.classList.remove('urgent');
            }
            if (actTimerEl) {
                if (this.pendingDiscardRes) {
                    actTimerEl.textContent = `⏱ ${Math.max(0, this._mahjongTimerSeconds)}s`;
                    if (this._mahjongTimerSeconds <= 3) actTimerEl.classList.add('urgent');
                    else actTimerEl.classList.remove('urgent');
                } else {
                    actTimerEl.style.display = 'none';
                }
            }

            if (this._mahjongTimerSeconds <= 0) {
                clearInterval(this._mahjongTimerInterval);
                this._mahjongTimerInterval = null;

                // 超时托管判定
                if (this.pendingDiscardRes) {
                    // 吃碰杠胡响应超时 -> 自动过牌
                    UIRenderer.showToast('⏳ 响应超时，已自动过牌');
                    this.handleMahjongPassClick();
                } else if (engine.currentTurn === mySlot) {
                    // 我方回合打牌超时 -> 自动打出刚摸到的牌
                    const myHand = engine.hands[mySlot] || [];
                    if (myHand.length > 0) {
                        let targetIndex = myHand.length - 1;
                        if (engine.lastDrawnTile) {
                            const drawnIdx = myHand.findIndex(t => t.id === engine.lastDrawnTile.id || (t.type === engine.lastDrawnTile.type && t.num === engine.lastDrawnTile.num));
                            if (drawnIdx !== -1) targetIndex = drawnIdx;
                        }
                        UIRenderer.showToast('⏳ 出牌超时，已自动打出刚摸到的牌！');
                        this.handleMahjongTileDiscard(targetIndex);
                    }
                }
            }
        }, 1000);
    },
    /**
     * 更新 3D 局风罗盘与当前出牌回合指示
     */
    updateMahjongStatusUI(msg) {
        const textEl = document.getElementById('mahjongTurnText');
        if (textEl) textEl.textContent = msg;

        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const relativeTurn = (engine.currentTurn - mySlot + 4) % 4;

        const winds = ['windSouth', 'windEast', 'windNorth', 'windWest'];
        winds.forEach((wId, idx) => {
            const el = document.getElementById(wId);
            if (el) {
                if (relativeTurn === idx) el.classList.add('active');
                else el.classList.remove('active');
            }
        });

        // 回合强调：轮到我方时手牌区金色脉冲边框 + 顶部状态高亮
        const isMyTurn = (engine.currentTurn === mySlot && !engine.isGameOver);
        const handWrap = document.getElementById('mahjongHandTilesContainer');
        const turnStatus = document.getElementById('mahjongTurnStatus');
        if (handWrap) {
            if (isMyTurn) handWrap.classList.add('my-turn-glow');
            else handWrap.classList.remove('my-turn-glow');
        }
        if (turnStatus) {
            if (isMyTurn) turnStatus.classList.add('my-turn-active');
            else turnStatus.classList.remove('my-turn-active');
        }
        // 预选支持：非我方回合不清空选中（玩家可提前选好牌），仅隐藏出牌按钮；
        // 轮到自己时若有预选，自动点亮出牌按钮，可直接出牌
        if (isMyTurn) {
            if (this.selectedMahjongTileIndex >= 0) {
                this.showMahjongDiscardBar(this.selectedMahjongTileIndex);
            }
        } else {
            this.hideMahjongDiscardBar();
        }

        // 每次状态更新重新启动 25 秒倒计时
        this.resetMahjongTurnTimer();
    },
    /**
     * 检查我方在自己回合的自摸或杠牌选项
     */
    checkSelfActionsOnTurn() {
        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn !== mySlot) return;

        const actionBar = document.getElementById('mahjongActionBar');
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        const canSelfHu = engine.checkCanHu(engine.hands[mySlot] || []);
        const selfKongOptions = engine.getSelfKongOptions(mySlot);
        const canSelfKong = selfKongOptions.length > 0;

        if (canSelfHu || canSelfKong) {
            if (btnChow) btnChow.style.display = 'none';
            if (btnPong) btnPong.style.display = 'none';
            if (btnKong) btnKong.style.display = canSelfKong ? 'inline-block' : 'none';
            if (btnHu) btnHu.style.display = canSelfHu ? 'inline-block' : 'none';
            if (btnPass) btnPass.style.display = 'inline-block';
            if (actionBar) actionBar.style.display = 'flex';
        } else {
            if (actionBar) actionBar.style.display = 'none';
        }
    }

    /**
     * 我方打牌与 4 人 AI 顺序轮转
     */,
    /**
     * 📱 手机端：选中手牌后点亮出牌按钮（固定在 ID 信息右侧）
     */
    showMahjongDiscardBar(index) {
        const btn = document.getElementById('btnMahjongDiscard');
        const engine = window.mahjongEngine;
        if (!btn) return;
        if (!engine || engine.isGameOver || engine.currentTurn !== (NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0)) {
            this.hideMahjongDiscardBar();
            return;
        }
        const hand = engine.hands[NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0] || [];
        const tile = hand[index];
        btn.classList.add('armed');
        btn.title = tile ? `出牌：${tile.name}` : '出牌';
    },
    /**
     * 📱 手机端：取消选中时熄灭出牌按钮
     */
    hideMahjongDiscardBar() {
        const btn = document.getElementById('btnMahjongDiscard');
        if (btn) {
            btn.classList.remove('armed');
            btn.title = '选中手牌后点击出牌';
        }
    },
    handleMahjongTileDiscard(tileIndex) {
        if (this.isMahjongDealingAnim) return;
        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn !== mySlot) {
            UIRenderer.showToast('⏳ 正在等待其他玩家出牌...');
            return;
        }

        // 隐藏动作条
        const actionBar = document.getElementById('mahjongActionBar');
        if (actionBar) actionBar.style.display = 'none';
        this.hideMahjongDiscardBar();

        const res = engine.discardTile(mySlot, tileIndex);
        if (!res) return;

        if (typeof SoundEngine !== 'undefined') {
            try {
                if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                else if (typeof SoundEngine.playCardPlaySound === 'function') SoundEngine.playCardPlaySound();
            } catch (e) {}
        }

        this.animateTileThrow(res.discarded, 0);
        this.renderMahjongHandTiles(true);
        this.renderMahjongDiscards();

        // 注意: 下家摸牌动画移交至其行动流程 (triggerAiTurnLoop / 轮到我方时) 统一处理,
        // 出牌后不再立即摸牌 (响应判定先于摸牌, 修正手牌数错乱)

        // 广播出牌与最新全量牌桌状态至 Firebase 云端
        if (!NetworkManager.isAiMode && NetworkManager.roomId) {
            NetworkManager.sendMahjongMove(mySlot, tileIndex, res.discarded, engine.exportState());
        }
        this._mahjongLastMoveTs = Date.now();

        if (res.isGameOver) {
            this.showMahjongSettlement(-1, null);
            return;
        }

        const nextTurn = engine.currentTurn;
        const isNextAi = (this.gameState.players && this.gameState.players[nextTurn]) ? this.gameState.players[nextTurn].isAi : (nextTurn !== mySlot);
        const shouldRunAi = NetworkManager.isAiMode || !NetworkManager.roomId || (NetworkManager.isHost && isNextAi);

        if (shouldRunAi) {
            this.triggerAiTurnLoop();
        }
    },
    /**
     * 3 家 AI 依序打牌与响应循环 (AI 智能胡、碰、杠、吃)
     */
    triggerAiTurnLoop() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        if (!mahjongScr || mahjongScr.style.display === 'none') {
            this._mahjongAiBusy = false;
            return;
        }

        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn === mySlot) {
            this._mahjongAiBusy = false;
            return;
        }

        // 防重入守卫：同一时刻只允许一条 AI 链运行
        if (this._mahjongAiBusy) return;
        this._mahjongAiBusy = true;

        const aiIdx = engine.currentTurn;
        const relativePos = (aiIdx - mySlot + 4) % 4;
        const seatLabels = ['你', '右家', '对家', '左家'];
        const aiName = seatLabels[relativePos] || `AI-${aiIdx}`;
        this.updateMahjongStatusUI(`🍖 ${aiName} 正在烧烤...`);

        // 拟真玩家思维延迟 800ms ~ 1500ms
        const thinkDelay = 800 + Math.floor(Math.random() * 700);

        setTimeout(() => {
            // 回合即将执行，释放守卫
            this._mahjongAiBusy = false;
            try {
                // 界面脱离/退回大厅判定：如果在思考延迟期间用户已退出麻将屏，直接丢弃，严禁播音效或继续发牌！
                const scrCheck = document.getElementById('mahjongGameScreen');
                if (!scrCheck || scrCheck.style.display === 'none' || engine.isGameOver || engine.currentTurn === mySlot) return;

                const curIdx = engine.currentTurn;
                const isAiSeatNow = (this.gameState.players && this.gameState.players[curIdx]) ? this.gameState.players[curIdx].isAi : (curIdx !== mySlot);
                if (!isAiSeatNow) return;

                // AI 行动前摸牌 (响应判定之后轮到 AI 才摸; 杠后补摸或庄家首牌已摸则跳过)
                if (engine.pendingDraw) {
                    const drawRes = engine.drawTile(curIdx);
                    if (!drawRes) {
                        // 牌墙摸完 -> 流局平局
                        this.showMahjongSettlement(-1, null);
                        return;
                    }
                    this.animateTileDraw(curIdx, engine.lastDrawnTile);
                    this.renderMahjongHandTiles(true);
                }

                // AI 自摸胡 / 暗杠检查 (摸牌后)
                if (engine.checkCanHu(engine.hands[curIdx])) {
                    engine.isGameOver = true;
                    engine.winner = curIdx;
                    if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                        NetworkManager.sendMahjongMove(curIdx, -1, null, engine.exportState(), 'HU');
                    }
                    this.showMahjongSettlement(curIdx, engine.getHuDetails(curIdx, null, true));
                    return;
                }
                const aiSelfKong = engine.getSelfKongOptions(curIdx);
                if (aiSelfKong.length > 0 && Math.random() < 0.3) {
                    engine.executeSelfKong(curIdx, aiSelfKong[0]);
                    this.renderMahjongHandTiles(true);
                    this.renderMahjongMelds();
                    // 杠后补摸的牌继续检查能否再胡/再杠
                    if (engine.checkCanHu(engine.hands[curIdx])) {
                        engine.isGameOver = true;
                        engine.winner = curIdx;
                        if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                            NetworkManager.sendMahjongMove(curIdx, -1, null, engine.exportState(), 'HU');
                        }
                        this.showMahjongSettlement(curIdx, engine.getHuDetails(curIdx, null, true));
                        return;
                    }
                    const skAgain = engine.getSelfKongOptions(curIdx);
                    if (skAgain.length > 0 && Math.random() < 0.3) {
                        engine.executeSelfKong(curIdx, skAgain[0]);
                        this.renderMahjongHandTiles(true);
                        this.renderMahjongMelds();
                    }
                }

                const aiMoveIdx = engine.getBestAiMove(curIdx);
                const aiRes = engine.discardTile(curIdx, aiMoveIdx);

                // 广播 AI 出牌与最新全量牌桌状态至 Firebase 云端（保证非房主客户端同步）
                if (!NetworkManager.isAiMode && NetworkManager.roomId && aiRes && aiRes.discarded) {
                    NetworkManager.sendMahjongMove(curIdx, aiMoveIdx, aiRes.discarded, engine.exportState());
                }
                this._mahjongLastMoveTs = Date.now();

                if (typeof SoundEngine !== 'undefined') {
                    try {
                        if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                        else if (typeof SoundEngine.playCardPlaySound === 'function') SoundEngine.playCardPlaySound();
                    } catch (e) {
                        console.warn('[Mahjong] 音效播放异常(已忽略):', e);
                    }
                }

                if (aiRes && aiRes.discarded) {
                    this.animateTileThrow(aiRes.discarded, curIdx);
                }

                this.renderMahjongHandTiles(true);
                this.renderMahjongDiscards();

                if (aiRes && aiRes.isGameOver) {
                    this.showMahjongSettlement(-1, null);
                    return;
                }

                // 检查我方 (Seat 0) 对 AI 打出的牌是否有 碰/杠/吃/胡 响应 (含截胡判定)
                if (aiRes && (aiRes.canHu || aiRes.canPong || aiRes.canKong || aiRes.canChow)) {
                    if (aiRes.huBlocked) {
                        // 我方被更高优先级玩家截胡: 隐藏胡按钮并提示
                        aiRes.canHu = false;
                        const seatLabels2 = ['你', '右家', '对家', '左家'];
                        const blockerSeat = aiRes.huWinner >= 0 ? (seatLabels2[(aiRes.huWinner - mySlot + 4) % 4] || '其他玩家') : '其他玩家';
                        UIRenderer.showToast(`🈲 你的胡被${blockerSeat}截胡了！`);
                    }
                    this.pendingDiscardRes = aiRes;
                    this.showHumanResponseActionBar(aiRes);
                    this.updateMahjongStatusUI('⚠️ 可响应出牌：请选择【吃 / 碰 / 杠 / 胡 / 过】');
                    // 联机/单机统一：10 秒内未响应则自动过牌，避免响应按钮长时间悬挂（倒计时结束即轮到下家）
                    if (this._mahjongResponseTimer) clearTimeout(this._mahjongResponseTimer);
                    this._mahjongResponseTimer = setTimeout(() => {
                        if (this.pendingDiscardRes) {
                            this.handleMahjongPassClick();
                        }
                    }, 10000);
                    return;
                }

                // 轮到下一家摸牌与打牌 (摸牌由下家行动流程统一处理)
                if (engine.currentTurn !== mySlot) {
                    this.triggerAiTurnLoop();
                } else {
                    // 轮到我方: 摸牌 (若待摸) + 检查自摸/暗杠
                    if (engine.pendingDraw) {
                        const drawRes = engine.drawTile(mySlot);
                        if (!drawRes) {
                            this.showMahjongSettlement(-1, null);
                            return;
                        }
                        this.animateTileDraw(mySlot, engine.lastDrawnTile);
                        this.renderMahjongHandTiles(true);
                    }
                    this.updateMahjongStatusUI('🀄 轮到你出牌');
                    this.checkSelfActionsOnTurn();
                }
            } catch (err) {
                console.error('[Mahjong] AI 回合执行异常，自动恢复轮转:', err);
                // 兜底：渲染/动画/音效等任何一步出错都不能让 AI 链永久卡死
                try {
                    const scrCheck = document.getElementById('mahjongGameScreen');
                    if (!scrCheck || scrCheck.style.display === 'none' || engine.isGameOver) return;
                    if (engine.currentTurn !== mySlot) {
                        this.triggerAiTurnLoop();
                    } else {
                        this.updateMahjongStatusUI('🀄 轮到你出牌');
                        this.checkSelfActionsOnTurn();
                    }
                } catch (e2) {
                    console.error('[Mahjong] AI 回合恢复失败:', e2);
                }
            }
        }, thinkDelay);
    },
    /**
     * 房主 AI 回合看门狗：若 AI 回合因任何原因卡住(异常/竞态)，自动重新驱动，保证对局不死锁
     */
    _checkMahjongAiWatchdog() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        if (!mahjongScr || mahjongScr.style.display === 'none') {
            if (this._mahjongWatchdogId) {
                clearInterval(this._mahjongWatchdogId);
                this._mahjongWatchdogId = null;
            }
            return;
        }

        const engine = window.mahjongEngine;
        if (!engine || engine.isGameOver || engine.currentTurn === 0) return;
        if (!NetworkManager.isHost || NetworkManager.isAiMode || !NetworkManager.roomId) return;
        if (this._mahjongAiBusy) return;

        const p = this.gameState.players[engine.currentTurn];
        const isAiTurn = p ? !!p.isAi : (engine.currentTurn !== 0);
        if (!isAiTurn) return;
        if (Date.now() - (this._mahjongLastMoveTs || 0) < 6000) return;

        console.warn('[Mahjong] 检测到 AI 回合疑似卡住，看门狗自动恢复驱动');
        this.triggerAiTurnLoop();
    },
    /**
     * 展示我方吃碰杠胡响应动作浮条
     */
    showHumanResponseActionBar(res) {
        const actionBar = document.getElementById('mahjongActionBar');
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        if (btnChow) btnChow.style.display = res.canChow ? 'inline-block' : 'none';
        if (btnPong) btnPong.style.display = res.canPong ? 'inline-block' : 'none';
        if (btnKong) btnKong.style.display = res.canKong ? 'inline-block' : 'none';
        if (btnHu) btnHu.style.display = res.canHu ? 'inline-block' : 'none';
        if (btnPass) btnPass.style.display = 'inline-block';

        if (actionBar) actionBar.style.display = 'flex';

        // 🀄 碰/杠牌型高亮：高亮手牌中可与桌面弃牌组成碰/杠的搭子（金色脉冲提示）
        this.highlightMahjongActionTiles(res);
    },
    /**
     * 🀄 高亮可碰/可杠的手牌搭子（金色脉冲微光）
     */
    highlightMahjongActionTiles(res) {
        const container = document.getElementById('mahjongHandTilesContainer');
        if (!container || !res) return;

        // 清除旧高亮
        container.querySelectorAll('.mahjong-tile-card').forEach(c => c.classList.remove('action-highlight'));

        if (!res.canPong && !res.canKong) return;
        if (!res.discarded) return;

        const targetName = res.discarded.name;
        container.querySelectorAll('.mahjong-tile-card').forEach(card => {
            const face = card.querySelector('.m-face');
            if (!face) return;
            const tileName = face.dataset.tileName;
            if (tileName === targetName) {
                card.classList.add('action-highlight');
            }
        });
    },
    /**
     * 清除手牌上的碰/杠高亮（响应结束或重新渲染时调用）
     */
    clearMahjongActionHighlight() {
        const container = document.getElementById('mahjongHandTilesContainer');
        if (!container) return;
        container.querySelectorAll('.mahjong-tile-card').forEach(c => c.classList.remove('action-highlight'));
    },
    /**
     * 点击【吃】按钮逻辑
     */
    handleMahjongChowClick() {
        const engine = window.mahjongEngine;
        if (!engine || !this.pendingDiscardRes || !this.pendingDiscardRes.canChow) return;

        const options = this.pendingDiscardRes.chowOptions || [];
        if (options.length === 0) return;

        if (options.length === 1) {
            this.executeChowOption(options[0]);
        } else {
            // 多组吃牌组合，弹出选择框
            const modal = document.getElementById('mahjongChowModal');
            const listEl = document.getElementById('chowOptionsList');
            if (modal && listEl) {
                listEl.innerHTML = '';
                const tile = this.pendingDiscardRes.discarded;

                options.forEach((pair) => {
                    const btn = document.createElement('button');
                    btn.className = 'chow-option-btn';
                    btn.innerHTML = `<span>${pair[0].name}</span> + <span>${pair[1].name}</span> + <span style="color:#fef08a;">[${tile.name}]</span>`;
                    btn.onclick = () => {
                        modal.style.display = 'none';
                        this.executeChowOption(pair);
                    };
                    listEl.appendChild(btn);
                });
                modal.style.display = 'flex';
            }
        }
    },
    executeChowOption(pair) {
        const engine = window.mahjongEngine;
        const res = this.pendingDiscardRes;
        if (!engine || !res) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (engine.executeChow(mySlot, res.discarded, pair)) {
            this.pendingDiscardRes = null;
            this.showMahjongActionToast('吃！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
            this.renderMahjongHandTiles();
            this.renderMahjongMelds();
            const actionBar = document.getElementById('mahjongActionBar');
            if (actionBar) actionBar.style.display = 'none';
            this.updateMahjongStatusUI('🀁 吃牌成功 · 请出牌');

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, res.discarded, engine.exportState(), 'CHOW');
            }
        }
    },
    /**
     * 点击【碰】按钮逻辑
     */
    handleMahjongPongClick() {
        const engine = window.mahjongEngine;
        if (!engine || !this.pendingDiscardRes) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const discarded = this.pendingDiscardRes.discarded;
        if (engine.executePong(mySlot, discarded)) {
            this.pendingDiscardRes = null;
            this.showMahjongActionToast('碰！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
            this.renderMahjongHandTiles();
            this.renderMahjongMelds();
            const actionBar = document.getElementById('mahjongActionBar');
            if (actionBar) actionBar.style.display = 'none';
            this.updateMahjongStatusUI('🀄 碰牌成功 · 请出牌');

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, discarded, engine.exportState(), 'PONG');
            }
        }
    },
    /**
     * 点击【杠】按钮逻辑 (包含明杠、暗杠、补杠)
     */
    handleMahjongKongClick() {
        const engine = window.mahjongEngine;
        if (!engine) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (this.pendingDiscardRes) {
            // 明杠
            const discarded = this.pendingDiscardRes.discarded;
            if (engine.executeKong(mySlot, discarded)) {
                this.pendingDiscardRes = null;
                this.showMahjongActionToast('杠！');
                if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
                this.renderMahjongHandTiles();
                this.renderMahjongMelds();
                const actionBar = document.getElementById('mahjongActionBar');
                if (actionBar) actionBar.style.display = 'none';
                this.updateMahjongStatusUI('🀅 杠牌补摸一牌 · 请出牌');

                if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                    NetworkManager.sendMahjongMove(mySlot, -1, discarded, engine.exportState(), 'KONG');
                }
            }
        } else {
            // 暗杠 / 补杠
            const options = engine.getSelfKongOptions(mySlot);
            if (options.length > 0) {
                if (engine.executeSelfKong(mySlot, options[0])) {
                    this.pendingDiscardRes = null;
                    this.showMahjongActionToast(options[0].type === 'ANKONG' ? '暗杠！' : '补杠！');
                    if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
                    this.renderMahjongHandTiles();
                    this.renderMahjongMelds();
                    const actionBar = document.getElementById('mahjongActionBar');
                    if (actionBar) actionBar.style.display = 'none';
                    this.updateMahjongStatusUI('🀅 杠牌补摸一牌 · 请出牌');

                    if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                        NetworkManager.sendMahjongMove(mySlot, -1, null, engine.exportState(), 'KONG');
                    }
                }
            }
        }
    },
    /**
     * 点击【胡】按钮逻辑 (点炮胡 / 自摸胡)
     */
    handleMahjongHuClick() {
        const engine = window.mahjongEngine;
        if (!engine) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const isSelfDraw = !this.pendingDiscardRes;
        const extraTile = this.pendingDiscardRes ? this.pendingDiscardRes.discarded : null;

        // 点炮胡时二次校验截胡: 若该弃牌已被更高优先级玩家截胡则禁止胡牌 (防竞态/误触)
        if (this.pendingDiscardRes && this.pendingDiscardRes.huBlocked) {
            UIRenderer.showToast('🈲 你的胡已被截胡，无法胡牌！');
            return;
        }

        if (engine.checkCanHu(engine.hands[mySlot] || [], extraTile)) {
            const huDetails = engine.getHuDetails(mySlot, extraTile, isSelfDraw);
            this.showMahjongActionToast('胡！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playWin) {
                SoundEngine.playWin();
            }
            engine.isGameOver = true;
            engine.winner = mySlot;
            this.showMahjongSettlement(mySlot, huDetails);

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, extraTile, engine.exportState(), 'HU');
            }
        }
    },
    /**
     * 清除本端挂起的吃碰杠胡响应 (响应条/计时器/弹窗/高亮)
     */
    clearMahjongPendingResponse() {
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }
        this.pendingDiscardRes = null;
        const actionBar = document.getElementById('mahjongActionBar');
        if (actionBar) actionBar.style.display = 'none';
        const actTimerEl = document.getElementById('mahjongActionTimer');
        if (actTimerEl) actTimerEl.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';
        this.clearMahjongActionHighlight();
    },
    /**
     * 点击【过】按钮逻辑
     */
    handleMahjongPassClick() {
        this.clearMahjongPendingResponse();

        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        // 轮到自己出牌时点过 (无响应场景) 无需额外动作
        if (engine.currentTurn === mySlot) {
            this.updateMahjongStatusUI('🀄 轮到你出牌');
            return;
        }

        // 联机客户端: 广播 PASS 通知房主继续驱动 AI (避免双端各自驱动导致状态分叉)
        if (!NetworkManager.isAiMode && NetworkManager.roomId && !NetworkManager.isHost) {
            NetworkManager.sendMahjongMove(mySlot, -1, null, engine.exportState(), 'PASS');
            return;
        }

        // 房主 / 单机 AI: 直接驱动 AI 轮转
        this.triggerAiTurnLoop();
    },
    /**
     * 展示麻将奢华结算面板
     */
    showMahjongSettlement(winnerIdx, huDetails) {
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const modal = document.getElementById('mahjongSettlementModal');
        const iconEl = document.getElementById('mahjongWinIcon');
        const titleEl = document.getElementById('mahjongWinTitle');
        const subTitleEl = document.getElementById('mahjongWinSubtitle');
        const fanBadgeEl = document.getElementById('mahjongFanBadge');
        const fanListEl = document.getElementById('mahjongFanList');

        if (!modal) return;

        if (winnerIdx === -1) {
            // 流局平局
            if (iconEl) iconEl.textContent = '🤝';
            if (titleEl) titleEl.textContent = '流局平局';
            if (subTitleEl) subTitleEl.textContent = '牌墙已摸完，无家胡牌';
            if (fanBadgeEl) fanBadgeEl.textContent = '平局 0番';
            if (fanListEl) fanListEl.textContent = '· 荒庄流局';
        } else if (winnerIdx === mySlot) {
            // 我方大胜！
            if (iconEl) iconEl.textContent = '🏆';
            if (titleEl) titleEl.textContent = '胡牌大吉';
            if (subTitleEl) subTitleEl.textContent = '我方玩家 喜胡牌局！';
            const details = huDetails || { fanName: '平胡 1番', details: ['平胡 (1番)'] };
            if (fanBadgeEl) fanBadgeEl.textContent = details.fanName;
            if (fanListEl) fanListEl.innerHTML = details.details.map(d => `<span>· ${d}</span>`).join('<br>');
        } else {
            // 其他 AI 胡牌
            const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
            const winnerP = seatPlayers[winnerIdx];
            const winnerName = winnerP ? (winnerP.isAi ? `🤖 ${winnerP.name}` : winnerP.name) : `玩家${winnerIdx + 1}`;
            if (iconEl) iconEl.textContent = '🀄';
            if (titleEl) titleEl.textContent = '对局结束';
            if (subTitleEl) subTitleEl.textContent = `${winnerName} 抢先胡牌！`;
            if (fanBadgeEl) fanBadgeEl.textContent = '推倒胡';
            if (fanListEl) fanListEl.textContent = '· 对方胡牌';
        }

        // 💰 结算麻将【知因币】与动态渲染 4 席位知因币战报 (方案一: 线性番数乘率 + 放炮包赔)
        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
        const ratio = isPve ? 0.25 : 1.0;
        const fanCount = (huDetails && huDetails.fanCount) ? huDetails.fanCount : 1;
        const baseAmount = 80 * fanCount;
        const winAmount = Math.ceil(baseAmount * ratio);

        const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
        const windNames = ['东', '南', '西', '北'];

        // 判定放炮者与自摸
        const engine = window.mahjongEngine;
        const isSelfDraw = !engine || !engine.lastDiscard || engine.lastDiscard.playerIdx === winnerIdx;
        const discarderIdx = (!isSelfDraw && engine && engine.lastDiscard) ? engine.lastDiscard.playerIdx : -1;

        // 计算 4 家精准损益
        const coinDiffs = [0, 0, 0, 0];
        if (winnerIdx !== -1) {
            coinDiffs[winnerIdx] = winAmount;
            if (isSelfDraw || discarderIdx === -1) {
                // 自摸：其余 3 家平摊, 保证三家扣除合计 == winAmount (零和, 消除 ceil 取整误差)
                const base = Math.floor(winAmount / 3);
                const remainder = winAmount - base * 3;
                let cnt = 0;
                for (let i = 0; i < 4; i++) {
                    if (i !== winnerIdx) {
                        coinDiffs[i] = -(base + (cnt < remainder ? 1 : 0));
                        cnt++;
                    }
                }
            } else {
                // 放炮：放炮者一人承担全额 (放炮包赔)！另外 2 家 0 损益
                coinDiffs[discarderIdx] = -winAmount;
            }
        }

        // 动态渲染 4 家知因币结算战报
        for (let i = 0; i < 4; i++) {
            const rowEl = document.getElementById(`scoreRow${i}`);
            if (rowEl) {
                const relIdx = (mySlot + i) % 4;
                const p = seatPlayers[relIdx];
                const pName = p ? (p.isAi ? `🤖 ${p.name}` : p.name) : `玩家${relIdx + 1}`;
                const wTag = `(${windNames[relIdx]}风)`;
                const diff = coinDiffs[relIdx] || 0;

                if (winnerIdx === -1) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff" style="color:#94a3b8;">0 知因币</span>`;
                } else if (relIdx === winnerIdx) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff positive">+${diff} 知因币</span>`;
                } else if (relIdx === discarderIdx && !isSelfDraw) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag} <b style="color:#f87171;font-size:0.7rem;">(放炮包赔)</b></span><span class="p-diff negative">${diff} 知因币</span>`;
                } else {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff ${diff < 0 ? 'negative' : ''}" style="${diff === 0 ? 'color:#94a3b8;' : ''}">${diff} 知因币</span>`;
                }
            }
        }

        if (typeof AuthEngine !== 'undefined') {
            const myDiff = coinDiffs[mySlot] || 0;
            if (AuthEngine.updateCoins && winnerIdx !== -1 && myDiff !== 0) {
                const reasonStr = (winnerIdx === mySlot) 
                    ? (isPve ? `麻将切磋胡牌 (+${myDiff}币)` : `麻将大胜 (${fanCount}番 +${myDiff}币)`)
                    : (isPve ? `麻将切磋失利 (${myDiff}币)` : `麻将对局 (${myDiff}币)`);
                AuthEngine.updateCoins(myDiff, reasonStr);
            }

            // ⭐ 结算麻将【经验值】
            if (AuthEngine.addExp) {
                const isWin = (winnerIdx === mySlot);
                const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                AuthEngine.addExp(expVal, isPve ? '麻将切磋 (PVE)' : '麻将对局 (PVP)');
            }
        }

        const btnSettle = document.getElementById('btnMahjongSettleRematch');
        if (btnSettle) {
            btnSettle.disabled = false;
            btnSettle.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 再来一局';
            btnSettle.onclick = () => {
                if (NetworkManager.roomId && !NetworkManager.isAiMode) {
                    btnSettle.disabled = true;
                    btnSettle.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (等待全员...)';
                    this.handleSelfAction('RESTART_VOTE', { gameType: 'MAHJONG' });
                    if (NetworkManager.isHost) {
                        this.processRestartVote(0);
                    }
                } else {
                    modal.style.display = 'none';
                    this.startMahjongAiMode();
                }
            };
        }

        const btnLobby = document.getElementById('btnMahjongSettleLobby');
        if (btnLobby) {
            btnLobby.onclick = () => {
                modal.style.display = 'none';
                this.resetToLobby();
            };
        }

        if (NetworkManager.roomId && !NetworkManager.isAiMode) {
            NetworkManager.onMahjongRematchStatus((status) => {
                if (status && status.readyCount !== undefined) {
                    if (btnSettle) {
                        btnSettle.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (${status.readyCount}/${status.total || 4} 就绪)`;
                    }
                    UIRenderer.showToast(`⌛ 麻将对局就绪进度：${status.readyCount}/4`);
                }
            });
        }

        modal.style.display = 'flex';
    }


});
