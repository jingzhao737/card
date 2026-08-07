/* 全局禁止双指手势缩放 (Pinch zoom prevention while preserving fast clicks) */
(function disablePinchZoom() {
    // 禁止 iOS 捏合手势缩放 (Pinch gesture prevention)
    document.addEventListener('gesturestart', function (e) {
        e.preventDefault();
    }, { passive: false });

    // 禁止双指触控拖拽缩放
    document.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
})();

class GameEngineController {
    constructor() {
        this.gameState = {
            roomId: '',
            phase: 'LOBBY', // LOBBY, WAITING, BIDDING, PLAYING, GAMEOVER
            players: [
                { id: 0, name: '玩家 1', hand: [], isAi: false, isHost: true, role: 'FARMER' },
                { id: 1, name: '玩家 2', hand: [], isAi: false, isHost: false, role: 'FARMER' },
                { id: 2, name: '玩家 3', hand: [], isAi: false, isHost: false, role: 'FARMER' }
            ],
            currentTurn: 0,
            landlordIndex: -1,
            highestBid: 0,
            highestBidder: -1,
            bidsCount: 0,
            bottomCards: [],
            lastPlay: null, // { playerIndex: 0, cards: [] }
            multiplier: 1,
            baseScore: 150,
            winnerIndex: -1,
            readyPlayers: [false, false, false]
        };

        this.turnTimerId = null;
        this.timerSeconds = 20;

        // 五子棋回合倒计时 (30 秒超时托管/判负)
        this._gomokuTimerInterval = null;
        this._gomokuTimerSeconds = 30;

        // 围棋回合倒计时 (60 秒超时托管/判负)
        this._goTimerInterval = null;
        this._goTimerSeconds = 60;
        this.goBoardSize = 19; // 围棋 AI 模式棋盘路数 (9/13/19), 联机固定 19 路
        this.goUndoLeft = 3;
        this.goPendingMove = null;
        this.goMyRematchReady = false;
    }

    init() {
        UIRenderer.init();
        this.updateHeaderVisibility();

        // 优先使用上次保存的昵称，没有再随机生成
        const nickInput = document.getElementById('nicknameInput');
        if (nickInput) {
            const savedNick = localStorage.getItem('youjing_doudizhu_nickname');
            const nick = savedNick || this.generateUniqueNickname();
            nickInput.value = nick;
            localStorage.setItem('youjing_doudizhu_nickname', nick);
        }

        this.bindLobbyEvents();
        this.renderMiniLeaderboard();

        // 按账号已读记录隐藏游戏 NEW 角标 (点击过一次后不再显示)
        this.applySeenNewBadges();

        // 默认落在第一个导航游戏 (斗地主) 大厅
        if (this.switchGameLobby) {
            this.switchGameLobby('DOUDIZHU');
            this.updateHeaderVisibility();
        }

        // 监听网络层的全量状态同步与大厅同步事件
        NetworkManager.onStateUpdate = (state) => this.onReceiveStateUpdate(state);
        NetworkManager.onPlayerJoined = (slotIndex, nickname, avatarEmoji) => this.onPlayerJoined(slotIndex, nickname, avatarEmoji);
        NetworkManager.onLobbySync   = (lobbyData) => this.onReceiveLobbySync(lobbyData);
        NetworkManager.onToast       = (msg) => UIRenderer.showToast(msg);

        // 先检查是否有上次未完成的会话（断线/切 App 后回来）
        // 如果有，优先恢复；否则再走正常邀请链接流程
        const restored = this.checkSavedSession();
        if (!restored) {
            this.checkUrlRoomParam();
        }
    }

    /**
     * 按账号已读记录隐藏游戏 NEW 角标 (点击过一次后不再显示)
     */
    applySeenNewBadges() {
        try {
            if (typeof AuthEngine === 'undefined' || !AuthEngine.getSeenNewGames) return;
            const seen = AuthEngine.getSeenNewGames();
            document.querySelectorAll('.badge-corner-new').forEach(b => {
                const g = b.getAttribute('data-game');
                if (g && seen.includes(g)) b.style.display = 'none';
            });
        } catch (e) {}
    }

    /* ====================================================================
       会话恢复：检测 sessionStorage 中的旧会话并尝试重连
       ==================================================================== */
    checkSavedSession() {
        const session = NetworkManager.loadSession();
        // 只在游戏进行中的会话才恢复（BIDDING/PLAYING）
        if (!session || !['BIDDING', 'PLAYING'].includes(session.phase)) return false;

        console.log('[Session] 检测到旧会话:', session);

        // 显示重连横幅
        this._showRejoinBanner(session);
        return true;
    }

    _showRejoinBanner(session) {
        // 复用 quickJoinBanner 或动态创建一个重连横幅
        let banner = document.getElementById('rejoinBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'rejoinBanner';
            banner.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
                'background:linear-gradient(135deg,#1a1a2e,#16213e)',
                'border-bottom:2px solid rgba(201,146,42,0.6)',
                'color:#fff', 'padding:14px 20px',
                'display:flex', 'align-items:center', 'justify-content:space-between',
                'gap:12px', 'font-size:0.9rem', 'box-shadow:0 4px 20px rgba(0,0,0,0.5)'
            ].join(';');
            document.body.appendChild(banner);
        }

        const roleText = session.isHost ? '房主' : '玩家';
        banner.innerHTML = `
            <span>🔄 检测到上次的游戏（房间 <b>${session.roomId}</b>，你是<b>${roleText}</b>）</span>
            <div style="display:flex;gap:8px;flex-shrink:0">
                <button id="btnRejoinConfirm" style="background:#c9921a;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:700">重新加入</button>
                <button id="btnRejoinCancel" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer">不了</button>
            </div>
        `;

        document.getElementById('btnRejoinConfirm').addEventListener('click', () => {
            banner.remove();
            if (session.isHost) {
                this._rejoinAsHost(session);
            } else {
                this._rejoinAsClient(session);
            }
        });

        document.getElementById('btnRejoinCancel').addEventListener('click', () => {
            NetworkManager.clearSession();
            banner.remove();
            // 清除会话后再走正常邀请链接流程
            this.checkUrlRoomParam();
        });

        // 5秒内没操作，自动尝试重连
        this._rejoinTimer = setTimeout(() => {
            if (document.getElementById('rejoinBanner')) {
                banner.remove();
                if (session.isHost) {
                    this._rejoinAsHost(session);
                } else {
                    this._rejoinAsClient(session);
                }
            }
        }, 5000);
    }

    _rejoinAsHost(session) {
        const nickname = session.nickname || localStorage.getItem('youjing_doudizhu_nickname') || '房主';
        UIRenderer.showToast('正在恢复房间，请稍候...', 4000);

        NetworkManager.createRoom(nickname, (roomId) => {
            this.setupWaitingScreen(roomId);

            // 恢复上次保存的游戏状态（如果有且游戏已开始）
            const savedState = NetworkManager.loadSavedGameState();
            if (savedState && savedState.phase === 'PLAYING') {
                UIRenderer.showToast('✅ 房间已恢复！等待玩家重新加入...', 4000);
                // 稍等玩家重连后恢复状态广播
                setTimeout(() => {
                    this.gameState = savedState;
                    // 保留房主玩家信息
                    this.gameState.players[0].name = nickname;
                    NetworkManager.broadcastState(this.gameState);
                }, 2000);
            } else {
                UIRenderer.showToast('✅ 房间已恢复！', 3000);
            }
        }, session.roomId);
    }

    _rejoinAsClient(session) {
        const nickname = session.nickname || localStorage.getItem('youjing_doudizhu_nickname') || '玩家';
        UIRenderer.showToast('正在重新加入房间...', 4000);

        // 填充房间号并触发加入流程
        const joinInput = document.getElementById('joinRoomInput');
        if (joinInput) joinInput.value = session.roomId;

        NetworkManager.myPlayerIndex = session.playerIndex;
        NetworkManager.joinRoom(session.roomId, nickname, () => {
            this.enterRoomAsClient(session.roomId);
            UIRenderer.showToast('✅ 已重新加入房间！', 3000);
        }, (err) => {
            UIRenderer.showToast(`重连失败：${err}，请手动加入房间`, 4000);
            NetworkManager.clearSession();
            // 降级：自动填写房间号让用户手动点击
            if (joinInput) joinInput.value = session.roomId;
        });
    }

    /**
     * 随机生成 2026 最新爆火热梗与 B站经典弹幕纯文字昵称
     */
    generateUniqueNickname() {
        const bStationMemes = [
            // B站经典弹幕与文化梗
            '一键三连', '我要验牌', '前方高能', '破防了家人们', '下次一定',
            '满级大佬回新手村', '格局打开', '战术后仰', '要素过多', '伤害不高侮辱极强',
            '大佬请喝茶', '弹幕护体', '空降成功', '真香定律', '邪修出牌',
            '硬币都给你', '这波在第五层', '不讲武德', '优势在我', '名场面打卡',
            // 2026 现象级热梗
            '爱你老己', '低山臭水遇知音', '助我破鼎', 'DeepSeek附体', '班味退散',
            '外耗大师', '真冰凉', '活人感拉满', '赛博对账', '浪浪山小妖怪',
            '敬自己一杯', '情绪价值拉满', '建议手臂加强', '留友看', '后面有车',
            '硬核拆车', '过程基础结果不基础', '谷子人', '来财', '对三要不起',
            '绝地王炸', '顺子专业户', '底牌收割机', '王炸破鼎'
        ];
        return bStationMemes[Math.floor(Math.random() * bStationMemes.length)];
    }

    /**
     * 检查 URL 是否携带有 ?room=XXXXXX 参数，如果有则自动进入加入模式
     */
    checkUrlRoomParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdParam = urlParams.get('room');
        if (!roomIdParam) return;

        // 填充房间号输入框
        document.getElementById('joinRoomInput').value = roomIdParam;

        // 显示顶部流量标识条
        const banner = document.getElementById('quickJoinBanner');
        if (banner) {
            banner.style.display = 'block';
            document.getElementById('quickJoinRoomDisplay').textContent = roomIdParam;
        }

        // 隐藏「创建房间」和「单机 AI」按钮，防止手机用户误操作
        const createBtn = document.getElementById('btnCreateRoom');
        const aiBtn = document.getElementById('btnPlayAi');
        const divider = document.querySelector('.divider');
        if (createBtn) createBtn.style.display = 'none';
        if (aiBtn) aiBtn.style.display = 'none';
        if (divider) divider.style.display = 'none';

        // 加入按钮升點显示
        const joinBtn = document.getElementById('btnJoinRoom');
        if (joinBtn) {
            joinBtn.style.background = 'linear-gradient(135deg, #f1c40f, #f39c12)';
            joinBtn.style.color = '#000';
            joinBtn.style.fontWeight = '800';
            joinBtn.style.padding = '12px 24px';
            joinBtn.textContent = '加入房间 →';
        }

        // 自动帮助好友秒级加入房间，无需手动再次点击
        setTimeout(() => {
            const joinBtn = document.getElementById('btnJoinRoom');
            if (joinBtn) joinBtn.click();
        }, 400);
    }

    /**
     * 大厅按钮事件绑定
     */
    bindLobbyEvents() {
        // 🎲 随机昵称生成按钮
        const randNickBtn = document.getElementById('btnRandomNickname');
        if (randNickBtn) {
            randNickBtn.addEventListener('click', () => {
                const newNick = this.generateUniqueNickname();
                const input = document.getElementById('nicknameInput');
                if (input) input.value = newNick;
                localStorage.setItem('youjing_doudizhu_nickname', newNick);
                UIRenderer.showToast(`🎲 已随机分配昵称：${newNick}`);
            });
        }

        // 获取或产生最终昵称并记录本地 (实时自动清洗 乃, 坚, cnj, nj 敏感词)
        const getNickname = () => {
            const input = document.getElementById('nicknameInput');
            let val = input ? input.value.trim() : '';
            if (typeof window.sanitizeNickname === 'function') {
                val = window.sanitizeNickname(val);
            }
            if (!val) val = this.generateUniqueNickname();
            if (input) input.value = val;
            localStorage.setItem('youjing_doudizhu_nickname', val);
            return val;
        };

        // 创建房间 (null-safe)
        const _btnCreateRoom = document.getElementById('btnCreateRoom');
        if (_btnCreateRoom) _btnCreateRoom.addEventListener('click', () => {
            const nickname = getNickname();
            this.activeGameType = 'DOUDIZHU';
            NetworkManager.gameType = 'DOUDIZHU';
            NetworkManager.createRoom(nickname, (roomId) => {
                this.setupWaitingScreen(roomId);
            }, null, 'DOUDIZHU');
        });

        // 加入房间输入框增强 (自动转大写、回车快捷提交、卡片点击聚焦)
        const joinInput = document.getElementById('joinRoomInput');
        const joinCard = document.querySelector('.join-card');
        if (joinInput) {
            joinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('btnJoinRoom').click();
                }
            });
            joinInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            });
        }
        if (joinCard && joinInput) {
            joinCard.addEventListener('click', (e) => {
                if (e.target !== joinInput && !e.target.closest('#btnJoinRoom')) {
                    joinInput.focus();
                }
            });
        }

        // 加入房间 (null-safe)
        const _btnJoinRoom = document.getElementById('btnJoinRoom');
        if (_btnJoinRoom) _btnJoinRoom.addEventListener('click', () => {
            const roomId = (document.getElementById('joinRoomInput') || {}).value?.trim() || '';
            const nickname = getNickname();
            if (!roomId) {
                UIRenderer.showToast('请输入有效的 6 位房间号');
                return;
            }
            NetworkManager.joinRoom(roomId, nickname, () => {
                this.enterRoomAsClient(roomId);
            }, (errMsg) => {
                UIRenderer.showToast(errMsg);
            });
        });

        // 单机练习模式 (null-safe)
        const _btnPlayAi = document.getElementById('btnPlayAi');
        if (_btnPlayAi) _btnPlayAi.addEventListener('click', () => {
            const nickname = getNickname();
            this.startAiGame(nickname);
        });

        // 在线公共房间大厅 (斗地主 & 五子棋 & 游鲸麻将)
        const btnPublicRooms        = document.getElementById('btnPublicRooms');
        const btnPublicGomokuRooms  = document.getElementById('btnPublicGomokuRooms');
        const btnPublicMahjongRooms = document.getElementById('btnPublicMahjongRooms');
        const publicModal           = document.getElementById('publicRoomsModal');
        const closePublic           = document.getElementById('btnClosePublicRooms');
        const refreshPublic         = document.getElementById('btnRefreshPublicRooms');

        let currentPublicGameType = 'DOUDIZHU';

        if (btnPublicRooms && publicModal) {
            btnPublicRooms.addEventListener('click', () => {
                currentPublicGameType = 'DOUDIZHU';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('DOUDIZHU');
            });
        }
        if (btnPublicGomokuRooms && publicModal) {
            btnPublicGomokuRooms.addEventListener('click', () => {
                currentPublicGameType = 'GOMOKU';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('GOMOKU');
            });
        }
        if (btnPublicMahjongRooms && publicModal) {
            btnPublicMahjongRooms.addEventListener('click', () => {
                currentPublicGameType = 'MAHJONG';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('MAHJONG');
            });
        }
        if (publicModal) {
            if (closePublic) {
                closePublic.addEventListener('click', () => publicModal.style.display = 'none');
            }
            if (refreshPublic) {
                refreshPublic.addEventListener('click', () => this.refreshPublicRoomsList(currentPublicGameType));
            }
            publicModal.addEventListener('click', (e) => {
                if (e.target === publicModal) publicModal.style.display = 'none';
            });
        }

        // 多游戏大厅切换 (斗地主 <-> 五子棋 <-> 游鲸麻将)
        const btnNavGo       = document.getElementById('btnNavGo');
        const btnNavDoudizhu = document.getElementById('btnNavDoudizhu');
        const btnNavGomoku   = document.getElementById('btnNavGomoku');
        const btnNavMahjong  = document.getElementById('btnNavMahjong');
        const btnNavXiangqi  = document.getElementById('btnNavXiangqi');
        const cardGo         = document.getElementById('goLobbyCard');
        const cardDoudizhu   = document.getElementById('doudizhuLobbyCard');
        const cardGomoku     = document.getElementById('gomokuLobbyCard');
        const cardMahjong    = document.getElementById('mahjongLobbyCard');
        const cardXiangqi    = document.getElementById('xiangqiLobbyCard');

        const switchGameLobby = (gameType, direction) => {
            document.body.classList.remove('theme-go', 'theme-gomoku', 'theme-mahjong', 'theme-xiangqi');
            this.activeGameType = gameType;
            NetworkManager.gameType = gameType;

            // NEW 角标已读: 点击该游戏即标记, 之后不再显示 (账号级)
            if (typeof AuthEngine !== 'undefined' && AuthEngine.markGameSeen) {
                AuthEngine.markGameSeen(gameType);
            }
            const seenBadge = document.querySelector(`.badge-corner-new[data-game="${gameType}"]`);
            if (seenBadge) seenBadge.style.display = 'none';

            // 主题切换
            if (gameType === 'GO') document.body.classList.add('theme-go');
            else if (gameType === 'MAHJONG') document.body.classList.add('theme-mahjong');
            else if (gameType === 'GOMOKU') document.body.classList.add('theme-gomoku');
            else if (gameType === 'XIANGQI') document.body.classList.add('theme-xiangqi');

            // 导航激活状态
            const navBtns = { GO: btnNavGo, DOUDIZHU: btnNavDoudizhu, GOMOKU: btnNavGomoku, MAHJONG: btnNavMahjong, XIANGQI: btnNavXiangqi };
            Object.keys(navBtns).forEach(k => { if (navBtns[k]) navBtns[k].classList.toggle('active', k === gameType); });

            // 卡片滑动切换动画: 方向跟随手势 (direction=1 下一个/左滑, direction=-1 上一个/右滑)
            const cardMap = { GO: cardGo, DOUDIZHU: cardDoudizhu, GOMOKU: cardGomoku, MAHJONG: cardMahjong, XIANGQI: cardXiangqi };
            const newCard = cardMap[gameType];
            if (!newCard) return;

            const cardsAll = [cardGo, cardDoudizhu, cardGomoku, cardMahjong, cardXiangqi];
            let oldCard = null;
            Object.keys(cardMap).forEach(k => {
                const c = cardMap[k];
                if (c && c !== newCard && c.style.display !== 'none') oldCard = c;
            });

            // 清理可能残留的滑出动画类
            cardsAll.forEach(c => { if (c) c.classList.remove('lobby-card-out', 'lobby-card-out-right'); });

            // direction 缺省时按导航顺序推断 (向前)
            const gameOrder = ['DOUDIZHU', 'GO', 'GOMOKU', 'MAHJONG', 'XIANGQI'];
            if (direction === undefined) {
                const fromIdx = gameOrder.indexOf(this._lastLobbyGame || 'DOUDIZHU');
                const toIdx = gameOrder.indexOf(gameType);
                direction = (toIdx >= fromIdx) ? 1 : -1;
            }
            this._lastLobbyGame = gameType;

            // 动画类: 前向(下一个)旧卡左出/新卡右进; 后向(上一个)旧卡右出/新卡左进
            const outCls = direction > 0 ? 'lobby-card-out' : 'lobby-card-out-right';
            const inCls = direction > 0 ? 'lobby-card-in' : 'lobby-card-in-left';

            // 切换后刷新头部品牌标题 (游鲸围棋/五子棋/斗地主/麻将/象棋)
            if (typeof this.updateHeaderVisibility === 'function') {
                this.updateHeaderVisibility();
            }

            // ========== 切换执行 (防竞态) ==========
            // 1. 清理上一次动画的 pending 回调与残留类, 避免快速连续切换时卡片状态错乱 (区域/页面消失 bug)
            if (this._lobbySwitchTimer) { clearTimeout(this._lobbySwitchTimer); this._lobbySwitchTimer = null; }
            if (this._lobbySwitchTimer2) { clearTimeout(this._lobbySwitchTimer2); this._lobbySwitchTimer2 = null; }
            this._lobbySwitchBusy = false;
            cardsAll.forEach(c => { if (c) c.classList.remove('lobby-card-out', 'lobby-card-out-right', 'lobby-card-in', 'lobby-card-in-left'); });

            // 2. 硬切: 只显示目标卡 (旧卡立即隐藏, 新卡滑入动画)
            cardsAll.forEach(c => { if (c) c.style.display = (c === newCard) ? 'block' : 'none'; });
            const lobbyScr = document.getElementById('lobbyScreen');
            if (lobbyScr) lobbyScr.scrollTop = 0;

            // 3. 新卡按方向滑入 (前向从右滑入, 后向从左滑入)
            void newCard.offsetWidth; // 强制 reflow 触发动画
            newCard.classList.add(inCls);
            this._lobbySwitchTimer2 = setTimeout(() => {
                newCard.classList.remove(inCls);
                this._lobbySwitchTimer2 = null;
            }, 350);

            // 4. 导航自动滚动到当前游戏按钮 (横向居中, 保持顺序一目了然)
            const navFollowEl = document.querySelector('.game-switch-nav');
            const activeNavBtn = navBtns[gameType];
            if (navFollowEl && activeNavBtn && navFollowEl.scrollWidth > navFollowEl.clientWidth) {
                const navRect = navFollowEl.getBoundingClientRect();
                const btnRect = activeNavBtn.getBoundingClientRect();
                const btnLeftInNav = btnRect.left - navRect.left + navFollowEl.scrollLeft;
                const targetScroll = Math.max(0, btnLeftInNav - (navFollowEl.clientWidth - btnRect.width) / 2);
                // 平滑滚动导航到当前游戏按钮居中 (不再瞬间跳变)
                if (navFollowEl.scrollTo) {
                    navFollowEl.scrollTo({ left: targetScroll, behavior: 'smooth' });
                } else {
                    navFollowEl.scrollLeft = targetScroll;
                }
                // 平滑滚动结束后刷新边缘渐隐 (scroll 事件对 smooth 动画会多次触发, 这里兜底刷新)
                setTimeout(() => { if (this.updateNavScrollMask) this.updateNavScrollMask(); }, 400);
            }
        };
        this.switchGameLobby = switchGameLobby;

        if (btnNavGo)       btnNavGo.addEventListener('click', () => switchGameLobby('GO'));
        if (btnNavDoudizhu) btnNavDoudizhu.addEventListener('click', () => switchGameLobby('DOUDIZHU'));
        if (btnNavGomoku)   btnNavGomoku.addEventListener('click', () => switchGameLobby('GOMOKU'));
        if (btnNavMahjong)  btnNavMahjong.addEventListener('click', () => switchGameLobby('MAHJONG'));
        if (btnNavXiangqi)  btnNavXiangqi.addEventListener('click', () => switchGameLobby('XIANGQI'));

        // 导航区鼠标拖拽滚动 (桌面端, 与手机端触摸滚动体验一致)
        const navEl = document.querySelector('.game-switch-nav');
        if (navEl) {
            // 动态渐隐: 滚到最左时左侧渐隐消失, 最右时右侧渐隐消失
            const updateNavScrollMask = () => {
                const el = document.querySelector('.game-switch-nav');
                if (!el) return;
                const maxScroll = el.scrollWidth - el.clientWidth;
                if (maxScroll <= 0) {
                    el.style.webkitMaskImage = 'none';
                    el.style.maskImage = 'none';
                    return;
                }
                const leftFade = el.scrollLeft > 2 ? 'transparent 0%, black 7%' : 'black 0%';
                const rightFade = el.scrollLeft < maxScroll - 2 ? 'black 93%, transparent 100%' : 'black 100%';
                const mask = 'linear-gradient(to right, ' + leftFade + ', ' + rightFade + ')';
                el.style.webkitMaskImage = mask;
                el.style.maskImage = mask;
            };
            this.updateNavScrollMask = updateNavScrollMask;
            navEl.addEventListener('scroll', updateNavScrollMask, { passive: true });
            // 初始化 + 切换游戏平滑滚动结束后也刷新
            setTimeout(updateNavScrollMask, 100);
            updateNavScrollMask();

            // 惯性滚动 + 边界弹性 (滚轮/拖拽结束后平滑衰减, 到底回弹)
            let navVel = 0;
            let navAnimId = null;
            let navOvershoot = 0;
            const navInertiaTick = () => {
                const maxS = navEl.scrollWidth - navEl.clientWidth;
                if (maxS <= 0) { navAnimId = null; navEl.style.transform = ''; return; }
                // 边界: 到最左/最右时速度归零 + 小幅弹性回弹一次 (不再反向加速, 避免往复鬼畜)
                if (navEl.scrollLeft <= 0 && navVel < 0) {
                    navOvershoot = Math.min(8, navOvershoot + (-navVel) * 0.15);
                    navVel = 0;
                    navEl.style.transform = 'translateX(' + navOvershoot + 'px)';
                } else if (navEl.scrollLeft >= maxS && navVel > 0) {
                    navOvershoot = Math.min(8, navOvershoot + navVel * 0.15);
                    navVel = 0;
                    navEl.style.transform = 'translateX(' + (-navOvershoot) + 'px)';
                } else {
                    navEl.scrollLeft += navVel;
                    if (navOvershoot > 0.5) {
                        navOvershoot *= 0.7;
                        const dir = navVel < 0 ? 1 : -1;
                        navEl.style.transform = 'translateX(' + (navOvershoot * dir) + 'px)';
                    } else if (navOvershoot !== 0) {
                        navOvershoot = 0;
                        navEl.style.transform = '';
                    }
                }
                navVel *= 0.82; // 阻尼: 更快停止
                if (Math.abs(navVel) < 0.5 && navOvershoot === 0) {
                    navAnimId = null;
                    navEl.style.transform = '';
                    return;
                }
                navAnimId = requestAnimationFrame(navInertiaTick);
            };
            // 鼠标滚轮: 累积速度带动画惯性 (每格距离缩放0.4更细腻, 限幅防夸张)
            navEl.addEventListener('wheel', (e) => {
                if (navEl.scrollWidth <= navEl.clientWidth) return;
                if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
                e.preventDefault();
                navVel = Math.max(-140, Math.min(140, navVel + e.deltaY * 0.4));
                if (!navAnimId) navAnimId = requestAnimationFrame(navInertiaTick);
            }, { passive: false });
            // 拖拽开始时停止惯性动画, 避免冲突
            navEl.addEventListener('mousedown', () => {
                if (navAnimId) { cancelAnimationFrame(navAnimId); navAnimId = null; navVel = 0; navEl.style.transform = ''; navOvershoot = 0; }
            });

            let navDragging = false;
            let navStartX = 0;
            let navStartScroll = 0;
            let navDragged = false;

            navEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                navDragging = true;
                navDragged = false;
                navStartX = e.clientX;
                navStartScroll = navEl.scrollLeft;
                navEl.classList.add('nav-dragging');
            });

            window.addEventListener('mousemove', (e) => {
                if (!navDragging) return;
                const dx = e.clientX - navStartX;
                if (Math.abs(dx) > 5) navDragged = true;
                navEl.scrollLeft = navStartScroll - dx;
            });

            window.addEventListener('mouseup', () => {
                if (!navDragging) return;
                navDragging = false;
                navEl.classList.remove('nav-dragging');
                // 拖拽后短暂抑制按钮点击, 避免误触发游戏切换
                if (navDragged) {
                    navEl.dataset.suppressClick = '1';
                    setTimeout(() => { navEl.dataset.suppressClick = ''; }, 200);
                }
            });

            // 捕获阶段拦截拖拽后的误点击
            navEl.addEventListener('click', (e) => {
                if (navEl.dataset.suppressClick === '1') {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, true);
        }

        // 绑定麻将模式按键
        const btnMahjongAuth = document.getElementById('btnMahjongAuth');
        if (btnMahjongAuth) {
            btnMahjongAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        const btnCreateMahjongRoom = document.getElementById('btnCreateMahjongRoom');
        if (btnCreateMahjongRoom) {
            btnCreateMahjongRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'MAHJONG';
                NetworkManager.gameType = 'MAHJONG';
                NetworkManager.createRoom(nickname, (roomId) => {
                    UIRenderer.showToast(`✅ 游鲸麻将在线房间创建成功：#${roomId}`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建麻将房间失败');
                }, 'MAHJONG');
            });
        }

        const btnJoinMahjong = document.getElementById('btnJoinMahjong');
        const joinMahjongInput = document.getElementById('joinMahjongInput');
        if (btnJoinMahjong && joinMahjongInput) {
            btnJoinMahjong.addEventListener('click', () => {
                const roomId = joinMahjongInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位麻将房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入麻将房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入麻将房间失败');
                });
            });
        }

        const btnPlayMahjongAi = document.getElementById('btnPlayMahjongAi');
        if (btnPlayMahjongAi) {
            btnPlayMahjongAi.addEventListener('click', () => this.startMahjongAiMode());
        }

        // 绑定五子棋个人信息按钮点击
        const btnGomokuAuth = document.getElementById('btnGomokuAuth');
        if (btnGomokuAuth) {
            btnGomokuAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 手势左滑 / 右滑切换游戏大厅
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartInNav = false;
        const lobbyScr = document.getElementById('lobbyScreen');
        if (lobbyScr) {
            lobbyScr.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                // 记录滑动起点是否在导航区 (导航区滑动只滚动导航, 不触发大厅切换)
                touchStartInNav = !!(e.target && e.target.closest && e.target.closest('.game-switch-nav'));
            }, { passive: true });

            // 横向滑动意图明显时阻止纵向滚动 (避免左右滑时页面上下跳动); 导航区自身滚动不受影响
            lobbyScr.addEventListener('touchmove', (e) => {
                const inNav = e.target && e.target.closest && e.target.closest('.game-switch-nav');
                if (inNav) return; // 导航区横向滚动交给浏览器自身处理
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                // 横向主导 (水平位移超过纵向) 即阻止页面滚动, 保证左右滑时页面不跟着动
                if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });

            lobbyScr.addEventListener('touchend', (e) => {
                // 从导航区开始的手势: 只滚动导航, 不触发大厅切换
                if (touchStartInNav) return;

                const diffX = e.changedTouches[0].clientX - touchStartX;
                const diffY = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                    // 按导航顺序循环: 斗地主 -> 围棋 -> 五子棋 -> 麻将 -> 象棋
                    const gameOrder = ['DOUDIZHU', 'GO', 'GOMOKU', 'MAHJONG', 'XIANGQI'];
                    const curIdx = gameOrder.indexOf(this.activeGameType || 'DOUDIZHU');
                    if (diffX < 0) {
                        // 左滑切换下一个游戏 (动画向左滑出/从右滑入)
                        switchGameLobby(gameOrder[(curIdx + 1) % gameOrder.length], 1);
                    } else {
                        // 右滑切换上一个游戏 (动画向右滑出/从左滑入)  (curIdx + 长度 - 1) % 长度 = 上一个
                        switchGameLobby(gameOrder[(curIdx + gameOrder.length - 1) % gameOrder.length], -1);
                    }
                }
            }, { passive: true });
        }

        // 创建五子棋在线对局
        const btnCreateGomokuRoom = document.getElementById('btnCreateGomokuRoom');
        if (btnCreateGomokuRoom) {
            btnCreateGomokuRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'GOMOKU';
                NetworkManager.gameType = 'GOMOKU';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 五子棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建五子棋房间失败');
                }, 'GOMOKU');
            });
        }

        // 输入 6 位房间号加入五子棋对局
        const btnJoinGomoku = document.getElementById('btnJoinGomoku');
        const joinGomokuInput = document.getElementById('joinGomokuInput');
        if (btnJoinGomoku && joinGomokuInput) {
            btnJoinGomoku.addEventListener('click', () => {
                const roomId = joinGomokuInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位五子棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入五子棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入五子棋房间失败');
                });
            });
        }

        // 五子棋单机 AI 按钮绑定
        const btnPlayGomokuAi = document.getElementById('btnPlayGomokuAi');
        if (btnPlayGomokuAi) {
            btnPlayGomokuAi.addEventListener('click', () => this.startGomokuAiMode());
        }

        // 五子棋对局控制按钮 (单局限悔棋 3 次，需对方确认)
        const btnGomokuUndo = document.getElementById('btnGomokuUndo');
        if (btnGomokuUndo) {
            btnGomokuUndo.addEventListener('click', () => {
                const engine = window.gomokuEngine;
                if (!engine) return;
                if (this.gomokuUndoLeft === undefined) this.gomokuUndoLeft = 3;

                if (this.gomokuUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }

                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 盘面上暂无棋子可撤回');
                    return;
                }

                // 如果是单机 AI 模式，AI 自动同意悔棋，直接撤回并扣除次数
                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.gomokuUndoLeft--;
                        const countEl = document.getElementById('gomokuUndoCount');
                        if (countEl) countEl.textContent = this.gomokuUndoLeft;

                        if (this.gomokuUndoLeft <= 0) {
                            btnGomokuUndo.disabled = true;
                            btnGomokuUndo.classList.add('disabled');
                        }

                        this.renderGomokuBoard();
                        this.updateGomokuStatusUI(`已撤回，本局还可悔棋 ${this.gomokuUndoLeft} 次`);
                        UIRenderer.showToast(`↺ 悔棋成功！单局剩余 ${this.gomokuUndoLeft} 次`);
                        // 悔棋后回到玩家回合：重启倒计时
                        if (engine.currentTurn === engine.playerColor) this.startGomokuTurnTimer();
                        else this.stopGomokuTurnTimer();
                    }
                    return;
                }

                // 在线双人模式：向对方发送悔棋申请
                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendGomokuUndoRequest(NetworkManager.nickname);
            });
        }

        // 绑定五子棋悔棋申请弹窗按钮
        const btnAgreeGomokuUndo = document.getElementById('btnAgreeGomokuUndo');
        const btnRejectGomokuUndo = document.getElementById('btnRejectGomokuUndo');
        const undoModal = document.getElementById('gomokuUndoModal');

        if (btnAgreeGomokuUndo) {
            btnAgreeGomokuUndo.addEventListener('click', () => {
                if (undoModal) undoModal.style.display = 'none';
                if (window.gomokuEngine) {
                    window.gomokuEngine.undo();
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('已同意悔棋，局面已更新');
                }
                NetworkManager.sendGomokuUndoResponse(true);
                UIRenderer.showToast('✅ 你已同意对方悔棋');
            });
        }

        if (btnRejectGomokuUndo) {
            btnRejectGomokuUndo.addEventListener('click', () => {
                if (undoModal) undoModal.style.display = 'none';
                NetworkManager.sendGomokuUndoResponse(false);
                UIRenderer.showToast('❌ 你拒绝了对方的悔棋申请');
            });
        }

        // 绑定五子棋对局结束【重来一局】按钮
        const btnGomokuRematch = document.getElementById('btnGomokuRematch');
        if (btnGomokuRematch) {
            btnGomokuRematch.addEventListener('click', () => {
                const engine = window.gomokuEngine;
                if (!engine) return;

                // 单机 AI 模式：直接重置开始新局
                if (engine.isAiMode) {
                    engine.reset(true, 1);
                    this.initGomokuUI();
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('黑方落子中 (你)');
                    UIRenderer.showToast('🟢 重新开始！你是先手黑棋');
                    this.startGomokuTurnTimer(); // 重新开局：玩家先手启动倒计时
                    return;
                }

                // 在线双人模式：向云端发送准备重来一局信号
                this.gomokuMyRematchReady = true;
                btnGomokuRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnGomokuRematch.disabled = true;
                btnGomokuRematch.classList.add('disabled');

                NetworkManager.sendGomokuRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // ============================================================
        // ⚫⚪ 游鲸围棋 大厅按钮绑定 (创建/加入/在线大厅/AI/路数选择/对局控制)
        // ============================================================

        // 围棋个人信息按钮
        const btnGoAuth = document.getElementById('btnGoAuth');
        if (btnGoAuth) {
            btnGoAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 在线围棋房间大厅
        const btnPublicGoRooms = document.getElementById('btnPublicGoRooms');
        if (btnPublicGoRooms && publicModal) {
            btnPublicGoRooms.addEventListener('click', () => {
                currentPublicGameType = 'GO';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('GO');
            });
        }

        // 创建围棋在线对局
        const btnCreateGoRoom = document.getElementById('btnCreateGoRoom');
        if (btnCreateGoRoom) {
            btnCreateGoRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'GO';
                NetworkManager.gameType = 'GO';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 围棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建围棋房间失败');
                }, 'GO');
            });
        }

        // 输入 6 位房间号加入围棋对局
        const btnJoinGo = document.getElementById('btnJoinGo');
        const joinGoInput = document.getElementById('joinGoInput');
        if (btnJoinGo && joinGoInput) {
            btnJoinGo.addEventListener('click', () => {
                const roomId = joinGoInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位围棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入围棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入围棋房间失败');
                });
            });
        }

        // 围棋单机 AI 按钮
        const btnPlayGoAi = document.getElementById('btnPlayGoAi');
        if (btnPlayGoAi) {
            btnPlayGoAi.addEventListener('click', () => this.startGoAiMode());
        }

        // 围棋 AI 棋盘路数选择 (9 / 13 / 19)
        const sizeButtons = [
            { btn: document.getElementById('btnGoSize9'), size: 9 },
            { btn: document.getElementById('btnGoSize13'), size: 13 },
            { btn: document.getElementById('btnGoSize19'), size: 19 }
        ];
        sizeButtons.forEach(({ btn, size }) => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                this.goBoardSize = size;
                sizeButtons.forEach(({ btn: b }) => { if (b) b.classList.remove('active'); });
                btn.classList.add('active');
                UIRenderer.showToast(`🎯 人机围棋棋盘已切换为 ${size} 路`);
            });
        });

        // 围棋停一手 (Pass)
        const btnGoPass = document.getElementById('btnGoPass');
        if (btnGoPass) {
            btnGoPass.addEventListener('click', () => this.handleGoPass());
        }

        // 围棋数目结算
        const btnGoScore = document.getElementById('btnGoScore');
        if (btnGoScore) {
            btnGoScore.addEventListener('click', () => this.handleGoScore());
        }

        // 围棋认输
        const btnGoResign = document.getElementById('btnGoResign');
        if (btnGoResign) {
            btnGoResign.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine || engine.isGameOver) return;
                const myColor = engine.playerColor;
                if (!engine.isAiMode && NetworkManager.isHost !== undefined && !NetworkManager.isHost && engine.currentTurn !== myColor) {
                    UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                    return;
                }
                engine.resign(myColor);
                this.stopGoTurnTimer();
                const winner = myColor === 1 ? 2 : 1;
                this.handleGoEnd(winner, 'RESIGN');
                // 联机广播认输结果
                if (!engine.isAiMode && NetworkManager.sendGoEnd) {
                    NetworkManager.sendGoEnd('RESIGN', winner);
                }
            });
        }

        // 围棋悔棋 (单局限 3 次，需对方确认)
        const btnGoUndo = document.getElementById('btnGoUndo');
        if (btnGoUndo) {
            btnGoUndo.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine) return;
                if (this.goUndoLeft === undefined) this.goUndoLeft = 3;

                if (this.goUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }

                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 盘面上暂无落子可撤回');
                    return;
                }

                // 单机 AI 模式：AI 自动同意悔棋，直接撤回并扣除次数
                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.goUndoLeft--;
                        const countEl = document.getElementById('goUndoCount');
                        if (countEl) countEl.textContent = this.goUndoLeft;

                        if (this.goUndoLeft <= 0) {
                            btnGoUndo.disabled = true;
                            btnGoUndo.classList.add('disabled');
                        }

                        this.renderGoBoard();
                        this.updateGoStatusUI(`已撤回，本局还可悔棋 ${this.goUndoLeft} 次`);
                        UIRenderer.showToast(`↺ 悔棋成功！单局剩余 ${this.goUndoLeft} 次`);
                        // 悔棋后回到玩家回合：重启倒计时
                        if (engine.currentTurn === engine.playerColor) this.startGoTurnTimer();
                        else this.stopGoTurnTimer();
                    }
                    return;
                }

                // 在线双人模式：向对方发送悔棋申请
                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendGoUndoRequest(NetworkManager.nickname);
            });
        }

        // 围棋悔棋申请弹窗按钮
        const btnAgreeGoUndo = document.getElementById('btnAgreeGoUndo');
        const btnRejectGoUndo = document.getElementById('btnRejectGoUndo');
        const goUndoModal = document.getElementById('goUndoModal');

        if (btnAgreeGoUndo) {
            btnAgreeGoUndo.addEventListener('click', () => {
                if (goUndoModal) goUndoModal.style.display = 'none';
                if (window.goEngine) {
                    window.goEngine.undo();
                    this.renderGoBoard();
                    this.updateGoStatusUI('已同意悔棋，局面已更新');
                }
                NetworkManager.sendGoUndoResponse(true);
                UIRenderer.showToast('✅ 你已同意对方悔棋');
            });
        }

        if (btnRejectGoUndo) {
            btnRejectGoUndo.addEventListener('click', () => {
                if (goUndoModal) goUndoModal.style.display = 'none';
                NetworkManager.sendGoUndoResponse(false);
                UIRenderer.showToast('❌ 你拒绝了对方的悔棋申请');
            });
        }

        // 围棋数目结算弹窗关闭
        const btnCloseGoScore = document.getElementById('btnCloseGoScore');
        const goScoreModal = document.getElementById('goScoreModal');
        if (btnCloseGoScore) {
            btnCloseGoScore.addEventListener('click', () => {
                if (goScoreModal) goScoreModal.style.display = 'none';
            });
        }
        if (goScoreModal) {
            goScoreModal.addEventListener('click', (e) => {
                if (e.target === goScoreModal) goScoreModal.style.display = 'none';
            });
        }

        // 围棋对局结束【重来一局】按钮
        const btnGoRematch = document.getElementById('btnGoRematch');
        if (btnGoRematch) {
            btnGoRematch.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine) return;

                // 单机 AI 模式：直接重置开始新局
                if (engine.isAiMode) {
                    engine.reset(true, 1, this.goBoardSize || 19);
                    this.initGoUI();
                    this.renderGoBoard();
                    this.updateGoStatusUI('⚫ 黑方落子中 (你)');
                    UIRenderer.showToast('🟢 重新开始！你是先手黑棋');
                    this.startGoTurnTimer();
                    return;
                }

                // 在线双人模式：向云端发送准备重来一局信号
                this.goMyRematchReady = true;
                btnGoRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnGoRematch.disabled = true;
                btnGoRematch.classList.add('disabled');

                NetworkManager.sendGoRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // ============================================================
        // ♞ 游鲸中国象棋 大厅按钮绑定
        // ============================================================

        // 象棋个人信息
        const btnXqAuth = document.getElementById('btnXqAuth');
        if (btnXqAuth) {
            btnXqAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 创建象棋在线对局
        const btnCreateXiangqiRoom = document.getElementById('btnCreateXiangqiRoom');
        if (btnCreateXiangqiRoom) {
            btnCreateXiangqiRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'XIANGQI';
                NetworkManager.gameType = 'XIANGQI';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 象棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建象棋房间失败');
                }, 'XIANGQI');
            });
        }

        // 输入房间号加入象棋
        const btnJoinXiangqi = document.getElementById('btnJoinXiangqi');
        const joinXiangqiInput = document.getElementById('joinXiangqiInput');
        if (btnJoinXiangqi && joinXiangqiInput) {
            btnJoinXiangqi.addEventListener('click', () => {
                const roomId = joinXiangqiInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位象棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入象棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入象棋房间失败');
                });
            });
        }

        // 在线象棋房间大厅
        const btnPublicXiangqiRooms = document.getElementById('btnPublicXiangqiRooms');
        if (btnPublicXiangqiRooms && publicModal) {
            btnPublicXiangqiRooms.addEventListener('click', () => {
                currentPublicGameType = 'XIANGQI';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('XIANGQI');
            });
        }

        // 象棋单机 AI
        const btnPlayXiangqiAi = document.getElementById('btnPlayXiangqiAi');
        if (btnPlayXiangqiAi) {
            btnPlayXiangqiAi.addEventListener('click', () => this.startXiangqiAiMode());
        }

        // 象棋悔棋 (AI 模式直接撤回, 联机发申请)
        const btnXqUndo = document.getElementById('btnXqUndo');
        if (btnXqUndo) {
            btnXqUndo.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine) return;
                if (this.xqUndoLeft === undefined) this.xqUndoLeft = 3;
                if (this.xqUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }
                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 棋盘上暂无走子可撤回');
                    return;
                }

                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.xqUndoLeft--;
                        const countEl = document.getElementById('xqUndoCount');
                        if (countEl) countEl.textContent = this.xqUndoLeft;
                        if (this.xqUndoLeft <= 0) {
                            btnXqUndo.disabled = true;
                            btnXqUndo.classList.add('disabled');
                        }
                        this.xqSelected = null;
                        this.xqMoveDots = [];
                        this.renderXiangqiBoard();
                        this.updateXiangqiStatusUI(`↺ 已撤回，本局还可悔棋 ${this.xqUndoLeft} 次`);
                        if (engine.currentTurn === engine.playerColor) this.startXiangqiTurnTimer();
                        else { this.stopXiangqiTurnTimer(); this.triggerXiangqiAiMove(); }
                    }
                    return;
                }

                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendXiangqiUndoRequest(NetworkManager.nickname);
            });
        }

        // 象棋认输
        const btnXqResign = document.getElementById('btnXqResign');
        if (btnXqResign) {
            btnXqResign.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine || engine.isGameOver) return;
                const myColor = engine.playerColor;
                if (!engine.isAiMode && NetworkManager.isHost !== undefined && !NetworkManager.isHost && engine.currentTurn !== myColor) {
                    UIRenderer.showToast('⏳ 还没轮到你，请等待对方走子');
                    return;
                }
                engine.resign(myColor);
                this.stopXiangqiTurnTimer();
                const winner = myColor === 'R' ? 'B' : 'R';
                this.handleXiangqiEnd(winner, 'RESIGN');
                if (!engine.isAiMode && NetworkManager.sendXiangqiEnd) {
                    NetworkManager.sendXiangqiEnd('RESIGN', winner);
                }
            });
        }

        // 象棋重来一局
        const btnXqRematch = document.getElementById('btnXqRematch');
        if (btnXqRematch) {
            btnXqRematch.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine) return;
                if (engine.isAiMode) {
                    engine.reset(true, 1, 0);
                    // AI 模式重开: 重新随机先后手
                    window.xiangqiEngine.reset(true, Math.random() < 0.5 ? 'R' : 'B');
                    this.initXiangqiUI();
                    this.renderXiangqiBoard();
                    const myColor = window.xiangqiEngine.playerColor;
                    this.updateXiangqiStatusUI(myColor === 'R' ? '🔴 轮到你落子 (红方先手)' : '🤖 AI 棋圣 (红方) 思考中...');
                    UIRenderer.showToast(myColor === 'R' ? '🟢 重新开始！你是红方先手' : '🟢 重新开始！你是黑方后手');
                    if (myColor === 'R') this.startXiangqiTurnTimer();
                    else this.triggerXiangqiAiMove();
                    return;
                }
                this.xqMyRematchReady = true;
                btnXqRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnXqRematch.disabled = true;
                btnXqRematch.classList.add('disabled');
                NetworkManager.sendXiangqiRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // 代理列表项中的"一键加入/替换AI"按钮点击
        const listContainer = document.getElementById('publicRoomsListContainer');
        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const joinBtn = e.target.closest('[data-join-room-id]');
                if (!joinBtn) return;
                const roomId = joinBtn.dataset.joinRoomId;
                if (!roomId) return;

                publicModal.style.display = 'none';
                const nickname = getNickname();
                const joinInput = document.getElementById('joinRoomInput');
                if (joinInput) joinInput.value = roomId;

                NetworkManager.joinRoom(roomId, nickname, () => {
                    this.enterRoomAsClient(roomId);
                    UIRenderer.showToast(`✅ 已进入房间 ${roomId}`);
                }, (err) => {
                    UIRenderer.showToast(err);
                });
            });
        }

        // 复制邀请链接 & 复制房间号 (null-safe)
        const _copyInvite1  = document.getElementById('btnCopyInviteUrl');
        const _copyLink     = document.getElementById('btnCopyLink');
        const _btnCopyRoomId= document.getElementById('btnCopyRoomId');
        if (_copyInvite1)  _copyInvite1.addEventListener('click', () => this.copyInviteUrl());
        if (_copyLink)     _copyLink.addEventListener('click', () => this.copyInviteUrl());
        if (_btnCopyRoomId)_btnCopyRoomId.addEventListener('click', () => this.copyRoomId());

        // ====== 账号认证 & 全网排行榜事件绑定 ======
        const userHeaderBadge  = document.getElementById('userHeaderBadge');
        const btnLeaderboard   = document.getElementById('btnOpenLeaderboard');
        const authModal        = document.getElementById('authModal');
        const statsModal       = document.getElementById('statsModal');
        const btnCloseAuth     = document.getElementById('btnCloseAuthModal');
        const btnCloseStats    = document.getElementById('btnCloseStatsModal');

        // 打开登录/战绩弹窗
        const handleOpenAuthOrStats = () => {
            if (AuthEngine.user && AuthEngine.userData) {
                this.openStatsModal('MY_STATS');
            } else {
                if (authModal) authModal.style.display = 'flex';
            }
        };

        if (userHeaderBadge) userHeaderBadge.addEventListener('click', handleOpenAuthOrStats);
        const btnLobbyAuth = document.getElementById('btnLobbyAuth');
        const lobbyAuthBanner = document.getElementById('lobbyAuthBanner');
        if (btnLobbyAuth) btnLobbyAuth.addEventListener('click', handleOpenAuthOrStats);
        if (lobbyAuthBanner) lobbyAuthBanner.addEventListener('click', (e) => {
            if (e.target !== btnLobbyAuth) handleOpenAuthOrStats();
        });

        if (btnLeaderboard) {
            btnLeaderboard.addEventListener('click', () => {
                this.openStatsModal('LEADERBOARD');
            });
        }

        // ====== 顶部统一功能下拉菜单 ======
        const btnNavMenu       = document.getElementById('btnNavMenu');
        const navMenuDropdown  = document.getElementById('navMenuDropdown');
        const menuBtnStats     = document.getElementById('menuBtnStats');
        const menuBtnLb        = document.getElementById('menuBtnLeaderboard');
        const menuBtnHelp      = document.getElementById('menuBtnCardHelp');
        const menuBtnSound     = document.getElementById('menuBtnToggleSound');
        const menuBtnLeave     = document.getElementById('menuBtnLeaveRoom');

        if (btnNavMenu && navMenuDropdown) {
            btnNavMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                navMenuDropdown.style.display = navMenuDropdown.style.display === 'none' ? 'flex' : 'none';
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.nav-menu-container')) {
                    navMenuDropdown.style.display = 'none';
                }
            });
        }

        if (menuBtnStats) {
            menuBtnStats.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                handleOpenAuthOrStats();
            });
        }
        if (menuBtnLb) {
            menuBtnLb.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                const lbModal = document.getElementById('leaderboardModal');
                if (lbModal) lbModal.style.display = 'flex';
                this.renderLeaderboard();
            });
        }
        if (menuBtnHelp) {
            menuBtnHelp.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                this.openRulesModal();
            });
        }
        if (menuBtnSound) {
            menuBtnSound.addEventListener('click', () => {
                const isEnabled = SoundEngine.toggleSound();
                const soundIcon = document.getElementById('soundIcon');
                const menuSoundIcon = document.getElementById('menuSoundIcon');
                const menuSoundText = document.getElementById('menuSoundText');

                if (soundIcon) soundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                if (menuSoundIcon) menuSoundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                if (menuSoundText) menuSoundText.textContent = isEnabled ? '音效已开启' : '音效已静音';

                UIRenderer.showToast(isEnabled ? '音效已开启' : '音效已静音');
            });
        }
        if (menuBtnLeave) {
            menuBtnLeave.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                this.resetToLobby();
            });
        }

        if (btnCloseAuth && authModal) btnCloseAuth.addEventListener('click', () => authModal.style.display = 'none');
        if (btnCloseStats && statsModal) btnCloseStats.addEventListener('click', () => statsModal.style.display = 'none');

        // Auth 弹窗选项卡
        const tabLogin    = document.getElementById('tabLogin');
        const tabRegister = document.getElementById('tabRegister');
        const formLogin   = document.getElementById('formLogin');
        const formRegister= document.getElementById('formRegister');

        if (tabLogin && tabRegister) {
            tabLogin.addEventListener('click', () => {
                tabLogin.classList.add('active');
                tabRegister.classList.remove('active');
                if (formLogin) formLogin.style.display = 'block';
                if (formRegister) formRegister.style.display = 'none';
            });
            tabRegister.addEventListener('click', () => {
                tabRegister.classList.add('active');
                tabLogin.classList.remove('active');
                if (formRegister) formRegister.style.display = 'block';
                if (formLogin) formLogin.style.display = 'none';
            });
        }

        // 登录提交
        if (formLogin) {
            formLogin.addEventListener('submit', (e) => {
                e.preventDefault();
                const acc = document.getElementById('loginAccount').value;
                const pwd = document.getElementById('loginPassword').value;
                AuthEngine.loginWithEmail(acc, pwd, (data) => {
                    if (authModal) authModal.style.display = 'none';
                    UIRenderer.showToast(`🎉 欢迎回来，${data.nickname}！`);
                }, (errMsg) => {
                    UIRenderer.showToast(`❌ ${errMsg}`);
                });
            });
        }

        // 注册提交
        if (formRegister) {
            formRegister.addEventListener('submit', (e) => {
                e.preventDefault();
                const acc  = document.getElementById('regAccount').value;
                const pwd  = document.getElementById('regPassword').value;
                const nick = document.getElementById('regNickname').value;
                AuthEngine.registerWithEmail(acc, pwd, nick, (data) => {
                    if (authModal) authModal.style.display = 'none';
                    UIRenderer.showToast(`🎉 注册成功！欢迎入住游鲸斗地主，${data.nickname}！`);
                }, (errMsg) => {
                    UIRenderer.showToast(`❌ ${errMsg}`);
                });
            });
        }

        // 微信登录暂未接入，按鈕保留但不操作 (防止调用不存在的方法)

        // 退出登录
        const btnLogout = document.getElementById('btnLogout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                AuthEngine.logout(() => {
                    if (statsModal) statsModal.style.display = 'none';
                    UIRenderer.showToast('已退出登录');
                });
            });
        }

        // 更换外观与皮肤工坊 Modal 绑定
        const appearanceModal = document.getElementById('appearanceModal');
        const btnLobbyAppearance = document.getElementById('btnLobbyAppearance');
        const btnStatsAppearance = document.getElementById('btnStatsAppearance');
        const btnCloseAppearanceModal = document.getElementById('btnCloseAppearanceModal');

        const openAppearance = () => {
            if (appearanceModal) appearanceModal.style.display = 'flex';
        };

        if (btnLobbyAppearance) btnLobbyAppearance.addEventListener('click', openAppearance);
        if (btnStatsAppearance) btnStatsAppearance.addEventListener('click', openAppearance);
        if (btnCloseAppearanceModal) {
            btnCloseAppearanceModal.addEventListener('click', () => {
                if (appearanceModal) appearanceModal.style.display = 'none';
            });
        }

        // 皮肤 Tabs 切换
        const tabSkinTheme = document.getElementById('tabSkinTheme');
        const tabSkinAvatar = document.getElementById('tabSkinAvatar');
        const tabSkinGlow = document.getElementById('tabSkinGlow');
        const viewSkinTheme = document.getElementById('viewSkinTheme');
        const viewSkinAvatar = document.getElementById('viewSkinAvatar');
        const viewSkinGlow = document.getElementById('viewSkinGlow');

        const switchSkinTab = (activeTab, activeView) => {
            [tabSkinTheme, tabSkinAvatar, tabSkinGlow].forEach(t => { if (t) t.classList.remove('active'); });
            [viewSkinTheme, viewSkinAvatar, viewSkinGlow].forEach(v => { if (v) v.style.display = 'none'; });
            if (activeTab) activeTab.classList.add('active');
            if (activeView) activeView.style.display = 'grid';
        };

        if (tabSkinTheme)  tabSkinTheme.addEventListener('click', () => switchSkinTab(tabSkinTheme, viewSkinTheme));
        if (tabSkinAvatar) tabSkinAvatar.addEventListener('click', () => switchSkinTab(tabSkinAvatar, viewSkinAvatar));
        if (tabSkinGlow)   tabSkinGlow.addEventListener('click', () => switchSkinTab(tabSkinGlow, viewSkinGlow));

        // 独立全网高手榜 Modal 绑定
        const leaderboardModal = document.getElementById('leaderboardModal');
        const lobbyMiniLb = document.getElementById('lobbyMiniLeaderboard');
        const menuBtnLeaderboard = document.getElementById('menuBtnLeaderboard');
        const btnCloseLbModal = document.getElementById('btnCloseLeaderboardModal');

        const openLeaderboardModal = () => {
            if (leaderboardModal) leaderboardModal.style.display = 'flex';
            this.renderLeaderboard();
        };

        if (lobbyMiniLb) lobbyMiniLb.addEventListener('click', openLeaderboardModal);
        if (menuBtnLeaderboard) menuBtnLeaderboard.addEventListener('click', openLeaderboardModal);
        if (btnCloseLbModal) {
            btnCloseLbModal.addEventListener('click', () => {
                if (leaderboardModal) leaderboardModal.style.display = 'none';
            });
        }

        // 个人信息 与 个人战绩 左上方延伸 Bar 页签切换绑定
        const tabBarInfo = document.getElementById('tabBarInfo');
        const tabBarStats = document.getElementById('tabBarStats');
        const viewMyStats = document.getElementById('viewMyStats');
        const viewDetailedStats = document.getElementById('viewDetailedStats');

        const switchProtrudingTab = (isInfo) => {
            if (isInfo) {
                if (tabBarInfo) tabBarInfo.classList.add('active');
                if (tabBarStats) tabBarStats.classList.remove('active');
                if (viewMyStats) viewMyStats.style.display = 'flex';
                if (viewDetailedStats) viewDetailedStats.style.display = 'none';
            } else {
                if (tabBarStats) tabBarStats.classList.add('active');
                if (tabBarInfo) tabBarInfo.classList.remove('active');
                if (viewDetailedStats) viewDetailedStats.style.display = 'flex';
                if (viewMyStats) viewMyStats.style.display = 'none';
                this.renderDetailedStatsView();
            }
        };

        if (tabBarInfo) tabBarInfo.addEventListener('click', () => switchProtrudingTab(true));
        if (tabBarStats) tabBarStats.addEventListener('click', () => switchProtrudingTab(false));

        // 房主点击开局按钮 (按游戏类型 DOUDIZHU vs GOMOKU vs MAHJONG 分流广播)
        const _btnStartGame = document.getElementById('btnStartGame');
        if (_btnStartGame) {
            _btnStartGame.addEventListener('click', () => {
                const isMahjong = (NetworkManager.gameType === 'MAHJONG') || (this.activeGameType === 'MAHJONG');
                const isGomoku = (NetworkManager.gameType === 'GOMOKU') || (this.activeGameType === 'GOMOKU');
                const isGo = (NetworkManager.gameType === 'GO') || (this.activeGameType === 'GO');
                const isXiangqi = (NetworkManager.gameType === 'XIANGQI') || (this.activeGameType === 'XIANGQI');
                if (isMahjong) {
                    this.startMahjongOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                } else if (isXiangqi) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendXiangqiStart(NetworkManager.roomId);
                        this.startXiangqiOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startXiangqiAiMode();
                    }
                } else if (isGo) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendGoStart(NetworkManager.roomId);
                        this.startGoOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startGoAiMode();
                    }
                } else if (isGomoku) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendGomokuStart(NetworkManager.roomId);
                        this.startGomokuOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startGomokuAiMode();
                    }
                } else {
                    this.fillAiAndStart();
                }
            });
        }

        // 补齐机器人开局 (null-safe)
        const _btnStartWithAi = document.getElementById('btnStartWithAi');
        if (_btnStartWithAi) {
            _btnStartWithAi.addEventListener('click', () => {
                const isMahjong = (NetworkManager.gameType === 'MAHJONG') || (this.activeGameType === 'MAHJONG');
                const isGomoku = (NetworkManager.gameType === 'GOMOKU') || (this.activeGameType === 'GOMOKU');
                const isGo = (NetworkManager.gameType === 'GO') || (this.activeGameType === 'GO');
                const isXiangqi = (NetworkManager.gameType === 'XIANGQI') || (this.activeGameType === 'XIANGQI');

                if (isMahjong) {
                    this.startMahjongAiMode();
                } else if (isXiangqi) {
                    this.startXiangqiAiMode();
                } else if (isGo) {
                    this.startGoAiMode();
                } else if (isGomoku) {
                    this.startGomokuAiMode();
                } else {
                    this.fillAiAndStart();
                }
            });
        }

        // 绑定胜负横幅【再来一局】、【收起/关闭】与【展开】事件
        document.addEventListener('click', (e) => {
            const restartBtn = e.target.closest('#btnRestartGame');
            if (restartBtn) {
                const myIndex = NetworkManager.myPlayerIndex;
                if (NetworkManager.isHost) {
                    this.processRestartVote(myIndex);
                } else {
                    NetworkManager.sendActionToHost('RESTART_VOTE', { playerIndex: myIndex });
                }
                return;
            }

            const closeBtn = e.target.closest('#btnCloseVictoryBanner');
            if (closeBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'true';
                    this.onReceiveStateUpdate(this.gameState);
                    // 同时显示统一右下角重开徽章
                    this._lastBoardSettleReopen = () => {
                        const vBox = document.getElementById('victoryBannerBox');
                        if (vBox) {
                            vBox.dataset.minimized = 'false';
                            this.onReceiveStateUpdate(this.gameState);
                        }
                    };
                    this.showSettlementReopenBadge();
                }
                return;
            }

            const expandBtn = e.target.closest('#btnExpandVictory');
            if (expandBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'false';
                    this.onReceiveStateUpdate(this.gameState);
                    this.hideSettlementReopenBadge();
                }
                return;
            }
        });

        // 绑定【理牌】按钮事件
        const btnSort = document.getElementById('btnSortCards');
        if (btnSort) {
            btnSort.addEventListener('click', () => {
                this.sortSelfHand();
            });
        }

        // 绑定仅点击【自己头像】弹出经典快捷用语菜单与短语发送
        document.addEventListener('click', (e) => {
            const avatarTarget = e.target.closest('#avatarSelf, .self-avatar');
            const menu = document.getElementById('quickPhraseMenu');
            if (avatarTarget && menu) {
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                return;
            }

            const closeBtn = e.target.closest('#btnClosePhrase');
            if (closeBtn && menu) {
                menu.style.display = 'none';
                return;
            }

            const phraseItem = e.target.closest('.phrase-item');
            if (phraseItem && menu) {
                const text = phraseItem.textContent.trim();
                menu.style.display = 'none';
                this.sendChatPhrase(text);
                return;
            }

            // 点击外部自动关闭短语弹窗
            if (menu && menu.style.display !== 'none' && !e.target.closest('#quickPhraseMenu')) {
                menu.style.display = 'none';
            }
        });

        // 绑定左上角【回到主页】与离开房间按钮
        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.addEventListener('click', () => this.resetToLobby());

        // 游鲸五子棋 Header 艺术黑白双棋子点击互动弹跳缩放 + 击石双落音效
        const gomokuStonesDeco = document.querySelector('.gomoku-stones-decoration');
        if (gomokuStonesDeco) {
            gomokuStonesDeco.addEventListener('click', () => {
                gomokuStonesDeco.classList.remove('animate');
                void gomokuStonesDeco.offsetWidth; // 强制重发 Keyframe
                gomokuStonesDeco.classList.add('animate');
                if (window.SoundEngine && window.SoundEngine.playStoneDrop) {
                    window.SoundEngine.playStoneDrop(false);
                    setTimeout(() => window.SoundEngine.playStoneDrop(true), 90);
                }
            });
        }

        // 游鲸斗地主 Header 艺术大小王王炸卡牌点击/触摸互动弹跳缩放 + 翻牌音效 (sound/card-flip.wav)
        const doudizhuCardsDeco = document.querySelector('.doudizhu-cards-decoration');
        if (doudizhuCardsDeco) {
            const triggerJokerAction = () => {
                if (window.SoundEngine) {
                    window.SoundEngine.unlockMobileAudio();
                }
                doudizhuCardsDeco.classList.remove('animate');
                void doudizhuCardsDeco.offsetWidth; // 强制重发 Keyframe
                doudizhuCardsDeco.classList.add('animate');
                if (window.SoundEngine) {
                    if (typeof window.SoundEngine.playCardFlipSound === 'function') {
                        window.SoundEngine.playCardFlipSound();
                    } else if (typeof window.SoundEngine.playCardPlace === 'function') {
                        window.SoundEngine.playCardPlace();
                    }
                }
            };
            doudizhuCardsDeco.addEventListener('touchstart', () => {
                doudizhuCardsDeco._touchHandled = true;
                triggerJokerAction();
            }, { passive: true });

            doudizhuCardsDeco.addEventListener('click', () => {
                if (doudizhuCardsDeco._touchHandled) {
                    doudizhuCardsDeco._touchHandled = false;
                    return;
                }
                triggerJokerAction();
            });
        }

        // 离开/取消等待/返回大厅 (null-safe, 无重复绑定)
        const btnCancelWaiting = document.getElementById('btnCancelWaiting');
        const btnLeaveRoom     = document.getElementById('btnLeaveRoom');
        const btnBackToLobby   = document.getElementById('btnBackToLobby');
        if (btnCancelWaiting) btnCancelWaiting.addEventListener('click', () => this.resetToLobby());
        if (btnLeaveRoom)     btnLeaveRoom.addEventListener('click', () => this.resetToLobby());
        if (btnBackToLobby)   btnBackToLobby.addEventListener('click', () => this.resetToLobby());

        // 音效开关 (null-safe)
        const _btnSound = document.getElementById('btnToggleSound');
        if (_btnSound) _btnSound.addEventListener('click', () => {
            const isEnabled = SoundEngine.toggleSound();
            const soundIcon = document.getElementById('soundIcon');
            if (soundIcon) soundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
            UIRenderer.showToast(isEnabled ? '音效已开启' : '音效已静音');
        });

        // 牌型说明弹窗
        const cardHelpBtn  = document.getElementById('btnCardHelp');
        const cardTypeModal = document.getElementById('cardTypeModal');
        const closeCardType = document.getElementById('btnCloseCardType');

        if (cardHelpBtn && cardTypeModal) {
            cardHelpBtn.addEventListener('click', () => {
                this.openRulesModal();
            });
            closeCardType.addEventListener('click', () => {
                cardTypeModal.style.display = 'none';
            });
            // 点击遮罩层外部关闭
            cardTypeModal.addEventListener('click', (e) => {
                if (e.target === cardTypeModal) cardTypeModal.style.display = 'none';
            });
        }


        // 按钮组事件绑定 (叫地主 1分/2分/3分/不叫/出牌/不出/提示)
        const bid1Btn = document.getElementById('btnBid1');
        if (bid1Btn) bid1Btn.addEventListener('click', () => this.handleSelfAction('BID', 1));

        const bid2Btn = document.getElementById('btnBid2');
        if (bid2Btn) bid2Btn.addEventListener('click', () => this.handleSelfAction('BID', 2));

        const bid3Btn = document.getElementById('btnBid3');
        if (bid3Btn) bid3Btn.addEventListener('click', () => this.handleSelfAction('BID', 3));

        const bidLandlordBtn = document.getElementById('btnBidLandlord');
        if (bidLandlordBtn) bidLandlordBtn.addEventListener('click', () => this.handleSelfAction('BID', 3));

        const bidPassBtn = document.getElementById('btnBidPass');
        if (bidPassBtn) bidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        const reBid1Btn = document.getElementById('btnReBid1');
        if (reBid1Btn) reBid1Btn.addEventListener('click', () => this.handleSelfAction('BID', 'CLAIM'));

        const reBidPassBtn = document.getElementById('btnReBidPass');
        if (reBidPassBtn) reBidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        const _btnPass        = document.getElementById('btnPass');
        const _btnHint        = document.getElementById('btnHint');
        const _btnPlayCard    = document.getElementById('btnPlayCard');
        const _btnPlayAgain   = document.getElementById('btnPlayAgain');
        const _btnBackToLobby2= document.getElementById('btnBackToLobby');
        if (_btnPass)      _btnPass.addEventListener('click', () => this.handleSelfAction('PLAY', []));
        if (_btnHint)      _btnHint.addEventListener('click', () => this.triggerSmartHint());
        if (_btnPlayCard)  _btnPlayCard.addEventListener('click', () => this.triggerPlayCard());

        // 结算屏按钮 (null-safe)
        if (_btnPlayAgain) _btnPlayAgain.addEventListener('click', () => {
            if (NetworkManager.isHost || NetworkManager.isAiMode) {
                this.startNewRound();
            } else {
                UIRenderer.showToast('请等待房主重新开局');
            }
        });
        if (_btnBackToLobby2) _btnBackToLobby2.addEventListener('click', () => this.resetToLobby());
    }

    /**
     * 彻底终止斗地主的回合倒计时与 AI 叫牌定时器
     * (切换麻将/五子棋/返回大厅时必须调用，否则残留 timer 会在其他游戏中触发 handleTurnTimeout)
     */
    stopDoudizhuTimers() {
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }
        if (this.turnTimerId) {
            clearInterval(this.turnTimerId);
            this.turnTimerId = null;
        }
        if (this._aiBidTimer) {
            clearTimeout(this._aiBidTimer);
            this._aiBidTimer = null;
        }
        if (this._gomokuTimerInterval) {
            clearInterval(this._gomokuTimerInterval);
            this._gomokuTimerInterval = null;
        }
        const gBadge = document.getElementById('gomokuTimerBadge');
        if (gBadge) gBadge.style.display = 'none';
        this.gameState.phase = 'LOBBY';
    }

    /**
     * 彻底终止麻将对局中的所有定时器、看门狗与 AI 轮转 loop
     */
    stopMahjongGame() {
        if (window.mahjongEngine) {
            window.mahjongEngine.isGameOver = true;
        }
        if (this._mahjongWatchdogId) {
            clearInterval(this._mahjongWatchdogId);
            this._mahjongWatchdogId = null;
        }
        if (this._mahjongTimerInterval) {
            clearInterval(this._mahjongTimerInterval);
            this._mahjongTimerInterval = null;
        }
        if (this._mahjongResponseTimer) {
            clearTimeout(this._mahjongResponseTimer);
            this._mahjongResponseTimer = null;
        }
        this._mahjongAiBusy = false;
        this.pendingDiscardRes = null;

        const timerEl = document.getElementById('mahjongTimer');
        if (timerEl) {
            timerEl.textContent = '25';
            timerEl.classList.remove('urgent');
        }
    }

    /**
     * 重置界面并退出当前房间 (无论是人机还是玩家对局，只要无真人玩家立即删除云端房间)
     */
    /**
     * 打开个人战绩名片与排行榜弹窗 (支持每日改名一次 + 更换头像)
     */
    openStatsModal(activeTab) {
        const statsModal = document.getElementById('statsModal');
        if (!statsModal) return;
        statsModal.style.display = 'flex';

        // 默认重置回 个人信息 延伸页签
        const tabBarInfo = document.getElementById('tabBarInfo');
        const tabBarStats = document.getElementById('tabBarStats');
        const viewMyStats = document.getElementById('viewMyStats');
        const viewDetailedStats = document.getElementById('viewDetailedStats');

        if (tabBarInfo) tabBarInfo.classList.add('active');
        if (tabBarStats) tabBarStats.classList.remove('active');
        if (viewMyStats) viewMyStats.style.display = 'flex';
        if (viewDetailedStats) viewDetailedStats.style.display = 'none';

        const data = AuthEngine.userData || {
            nickname: localStorage.getItem('youjing_doudizhu_nickname') || '游客玩家',
            email: '游客账号（未绑定）',
            avatar: '🤠',
            yinCoins: 1000,
            totalGames: 0,
            wins: 0
        };

        const total    = data.totalGames || 0;
        const wins     = data.wins || 0;
        const winRate  = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0%';
        const currentYin = data.yinCoins !== undefined ? data.yinCoins : 1000;
        const canRename = AuthEngine.canRenameToday();

        const avatarList = ['🤠', '👑', '🦁', '🦊', '🐱', '🐶', '🐼', '🐯', '🦄', '🚀', '🤖', '💎', '🔥', '⚡', '🎃', '👽'];

        const createdTs = data.created || Date.now();
        const dateObj = new Date(createdTs);
        const regDateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        const uidStr = data.uid ? `UID: ${data.uid}` : 'UID: 10001';

        const level = data.level || 1;
        const exp = data.exp || 0;
        const reqExp = AuthEngine.getReqExp(level);
        const title = AuthEngine.getLevelTitle(level);
        const expPct = (level >= 60) ? 100 : Math.min(100, Math.floor((exp / reqExp) * 100));
        const expDisplay = (level >= 60) ? '已达到 60 级巅峰满级' : `${exp} / ${reqExp} EXP (${expPct}%)`;

        const hero = document.getElementById('userProfileHero');
        if (hero) {
            hero.innerHTML = `
                <div class="profile-top" style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div class="profile-avatar-big" id="btnChangeAvatar" title="点击更换头像" style="cursor:pointer;position:relative;">
                        <span>${data.avatar || '🤠'}</span>
                        <div class="avatar-level-tag" style="bottom:-2px;right:-2px;width:18px;height:18px;font-size:0.65rem;border-width:2px;">${level}</div>
                    </div>
                    <div class="profile-names">
                        <div class="profile-nick" style="display:flex;align-items:center;gap:8px;">
                            <span>${data.nickname}</span>
                            ${canRename ? `
                                <button id="btnEditNick" style="background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.3);color:#ffd700;border-radius:3px;padding:2px 6px;font-size:0.72rem;cursor:pointer;font-weight:700;">
                                    <i class="fa-solid fa-pen-to-square"></i> 改名
                                </button>
                            ` : `
                                <span style="font-size:0.7rem;color:#94a3b8;">(今日已改名)</span>
                            `}
                        </div>
                        <div style="font-size:0.75rem;color:#94a3b8;margin-top:4px;display:flex;align-items:center;gap:10px;">
                            <span>${data.email || '游客账号'}</span>
                            <span style="color:#ffd700;font-weight:700;">${uidStr}</span>
                        </div>
                    </div>
                </div>

                <!-- 等级与经验条 -->
                <div style="margin-top:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,215,0,0.18);border-radius:6px;padding:8px 10px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;font-weight:700;margin-bottom:4px;">
                        <span style="color:#ffd700;display:flex;align-items:center;gap:6px;">
                            <i class="fa-solid fa-crown"></i> <span>${title}</span>
                        </span>
                        <span style="color:#94a3b8;font-size:0.72rem;">${expDisplay}</span>
                    </div>
                    <div style="width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                        <div style="width:${expPct}%;height:100%;background:linear-gradient(90deg,#f1c40f,#f39c12);border-radius:3px;transition:width 0.4s ease;"></div>
                    </div>
                </div>

                <!-- 头像选择框 (点击头像展开/关闭) -->

                <!-- 头像选择框 (点击头像展开/关闭) -->
                <div id="avatarPickerBox" style="display:none;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:8px;margin:8px 0 4px;">
                    <div style="font-size:0.75rem;color:#ffd700;margin-bottom:6px;font-weight:700;">点击更换头像：</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                        ${avatarList.map(a => `<span class="avatar-opt" data-avatar="${a}" style="font-size:1.5rem;cursor:pointer;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);">${a}</span>`).join('')}
                    </div>
                </div>

                <div class="profile-grid" style="margin-top:10px;">
                    <div class="profile-stat-box" style="cursor:pointer;" id="btnClaimBankruptcyInModal" title="点击领取破产救济 (+100 知因币)">
                        <div class="stat-val" style="color:#ffd700;">🪙 ${currentYin}</div>
                        <div class="stat-lbl">${currentYin < 50 ? '🆘 领破产补助(+100)' : '知因币'}</div>
                    </div>
                    <div class="profile-stat-box">
                        <div class="stat-val">${winRate}</div>
                        <div class="stat-lbl">胜率 (${wins}/${total})</div>
                    </div>
                    <div class="profile-stat-box">
                        <div class="stat-val">${wins} 胜</div>
                        <div class="stat-lbl">胜场</div>
                    </div>
                </div>
            `;

            // 点击领取破产救济金
            const btnClaimBank = document.getElementById('btnClaimBankruptcyInModal');
            if (btnClaimBank) {
                btnClaimBank.addEventListener('click', () => {
                    if (AuthEngine.claimBankruptcyAid()) {
                        this.openStatsModal('MY_STATS');
                    }
                });
            }

            // 头像点击展开/收起选择面板
            const avatarBtn = document.getElementById('btnChangeAvatar');
            const pickerBox = document.getElementById('avatarPickerBox');
            if (avatarBtn && pickerBox) {
                avatarBtn.addEventListener('click', () => {
                    pickerBox.style.display = pickerBox.style.display === 'none' ? 'block' : 'none';
                });
            }

            // 选择新头像
            const avatarOpts = hero.querySelectorAll('.avatar-opt');
            avatarOpts.forEach(opt => {
                opt.addEventListener('click', () => {
                    const newAvatar = opt.dataset.avatar;
                    AuthEngine.changeAvatar(newAvatar, (a) => {
                        UIRenderer.showToast(`✨ 头像已更换为 ${a}`);
                        this.openStatsModal('MY_STATS');
                    }, (err) => UIRenderer.showToast(`❌ ${err}`));
                });
            });

            // 点击【改名】按钮
            const editNickBtn = document.getElementById('btnEditNick');
            if (editNickBtn) {
                editNickBtn.addEventListener('click', () => {
                    const newNick = prompt('请输入新游戏昵称 (1-10个字符，每天仅可修改1次)：', data.nickname);
                    if (newNick !== null) {
                        AuthEngine.changeNickname(newNick, (nick) => {
                            UIRenderer.showToast(`🎉 昵称已成功修改为：${nick}`);
                            this.openStatsModal('MY_STATS');
                        }, (err) => {
                            UIRenderer.showToast(`❌ ${err}`);
                        });
                    }
                });
            }
        }

        const tabStats = document.getElementById('tabMyStats');
        const tabLb    = document.getElementById('tabLeaderboard');
        if (activeTab === 'LEADERBOARD' && tabLb) {
            tabLb.click();
        } else if (tabStats) {
            tabStats.click();
        }
    }

    /**
     * 渲染个人详细战绩 (隔离区分斗地主战绩与五子棋独立战绩)
     */
    renderDetailedStatsView(selectedGameType = null) {
        const container = document.getElementById('userDetailedStatsHero');
        if (!container) return;

        // 如果未指定，根据当前大厅 Tab 或界面自动决定初始视图
        const currentMode = selectedGameType || (this.activeGameType === 'GOMOKU' ? 'GOMOKU' : 'DOUDIZHU');

        const data = AuthEngine.userData || {
            totalGames: 0,
            wins: 0,
            landlordWins: 0,
            farmerWins: 0,
            matchHistory: [],
            gomokuStats: { totalGames: 0, wins: 0, losses: 0, draws: 0, matchHistory: [] }
        };

        const isGomoku = currentMode === 'GOMOKU';

        // 战绩选择切换按钮 Bar
        const selectorHtml = `
            <div style="display:flex;gap:8px;margin-bottom:12px;width:100%;">
                <button id="btnStatsTabDoudizhu" style="flex:1;padding:7px 10px;border-radius:8px;font-size:0.78rem;font-weight:800;cursor:pointer;transition:all 0.2s;border:1px solid ${!isGomoku ? '#e2a820' : 'rgba(255,255,255,0.1)'};background:${!isGomoku ? 'rgba(226,168,32,0.2)' : 'rgba(0,0,0,0.3)'};color:${!isGomoku ? '#ffd700' : '#94a3b8'};">
                    <i class="fa-solid fa-layer-group"></i> 斗地主战绩
                </button>
                <button id="btnStatsTabGomoku" style="flex:1;padding:7px 10px;border-radius:8px;font-size:0.78rem;font-weight:800;cursor:pointer;transition:all 0.2s;border:1px solid ${isGomoku ? '#34d399' : 'rgba(255,255,255,0.1)'};background:${isGomoku ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)'};color:${isGomoku ? '#34d399' : '#94a3b8'};">
                    <i class="fa-solid fa-chess-board"></i> 五子棋战绩
                </button>
            </div>
        `;

        let contentHtml = '';

        if (!isGomoku) {
            // 🃏 斗地主战绩渲染
            const total = data.totalGames || 0;
            const wins = data.wins || 0;
            const losses = Math.max(0, total - wins);
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0.0%';
            const landlordWins = data.landlordWins || 0;
            const farmerWins = data.farmerWins || 0;

            let historyList = Array.isArray(data.matchHistory) ? data.matchHistory : [];
            const historyHtml = historyList.length > 0 ? historyList.slice(0, 10).map((m) => {
                const isWin = m.isWin;
                const resStyle = isWin ? 'color:#00e676;background:rgba(0,230,118,0.12);border-color:rgba(0,230,118,0.3);' : 'color:#ff2a2a;background:rgba(255,42,42,0.12);border-color:rgba(255,42,42,0.3);';
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;font-size:0.78rem;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-weight:800;padding:1px 6px;border-radius:3px;border:1px solid;${resStyle}">
                                ${isWin ? '胜利' : '失败'}
                            </span>
                            <span style="color:#e2e8f0;font-weight:700;">${m.role || '斗地主'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;color:#94a3b8;font-size:0.74rem;">
                            <span>${m.multiplier || 2}倍局</span>
                            <span>${m.time || '12:00'}</span>
                        </div>
                    </div>
                `;
            }).join('') : `<div style="text-align:center;color:#94a3b8;padding:24px 10px;font-size:0.78rem;">暂无斗地主对局记录</div>`;

            contentHtml = `
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${winRate}</div><div class="stat-lbl">斗地主胜率</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#00e676;">${wins} 胜</div><div class="stat-lbl">胜场次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ff2a2a;">${losses} 败</div><div class="stat-lbl">败场次数</div></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${total}</div><div class="stat-lbl">总对局数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${landlordWins}</div><div class="stat-lbl">资本家胜场</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${farmerWins}</div><div class="stat-lbl">牛马胜场</div></div>
                </div>
                <div style="margin-top:10px;">
                    <div style="font-size:0.78rem;font-weight:800;color:#ffd700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                        <i class="fa-solid fa-clock-rotate-left"></i> 最近 10 场斗地主战报
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;padding-right:2px;">
                        ${historyHtml}
                    </div>
                </div>
            `;
        } else {
            // 🟢 五子棋战绩渲染
            const gStats = data.gomokuStats || { totalGames: 0, wins: 0, losses: 0, draws: 0, matchHistory: [] };
            const total = gStats.totalGames || 0;
            const wins = gStats.wins || 0;
            const losses = gStats.losses || 0;
            const draws = gStats.draws || 0;
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0.0%';

            let historyList = Array.isArray(gStats.matchHistory) ? gStats.matchHistory : [];
            const historyHtml = historyList.length > 0 ? historyList.slice(0, 10).map((m) => {
                const isWin = m.isWin;
                const isDraw = m.isDraw;
                let resStyle = 'color:#00e676;background:rgba(0,230,118,0.12);border-color:rgba(0,230,118,0.3);';
                let tagText = '胜利';
                if (isDraw) {
                    resStyle = 'color:#fbbf24;background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);';
                    tagText = '平局';
                } else if (!isWin) {
                    resStyle = 'color:#ff2a2a;background:rgba(255,42,42,0.12);border-color:rgba(255,42,42,0.3);';
                    tagText = '失败';
                }
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;font-size:0.78rem;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-weight:800;padding:1px 6px;border-radius:3px;border:1px solid;${resStyle}">
                                ${tagText}
                            </span>
                            <span style="color:#e2e8f0;font-weight:700;">${m.role || '五子棋'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;color:#94a3b8;font-size:0.74rem;">
                            <span>${m.time || '12:00'}</span>
                        </div>
                    </div>
                `;
            }).join('') : `<div style="text-align:center;color:#34d399;padding:24px 10px;font-size:0.78rem;">暂无五子棋对局记录，快去棋盘切磋一局吧！</div>`;

            contentHtml = `
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#34d399;">${winRate}</div><div class="stat-lbl">五子棋胜率</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#00e676;">${wins} 胜</div><div class="stat-lbl">胜场次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ff2a2a;">${losses} 败</div><div class="stat-lbl">败场次数</div></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${total}</div><div class="stat-lbl">总对局数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#fbbf24;">${draws} 平</div><div class="stat-lbl">平局次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#34d399;">${wins}</div><div class="stat-lbl">五子连珠</div></div>
                </div>
                <div style="margin-top:10px;">
                    <div style="font-size:0.78rem;font-weight:800;color:#34d399;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                        <i class="fa-solid fa-clock-rotate-left"></i> 最近 10 场五子棋战报
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;padding-right:2px;">
                        ${historyHtml}
                    </div>
                </div>
            `;
        }

        container.innerHTML = selectorHtml + contentHtml;

        // 绑定战绩类型 Tab 切换
        const btnDoudizhu = document.getElementById('btnStatsTabDoudizhu');
        const btnGomoku   = document.getElementById('btnStatsTabGomoku');
        if (btnDoudizhu) btnDoudizhu.addEventListener('click', () => this.renderDetailedStatsView('DOUDIZHU'));
        if (btnGomoku)   btnGomoku.addEventListener('click', () => this.renderDetailedStatsView('GOMOKU'));
    }

    /**
     * 渲染主页顶部简略排行榜 (展示 Top 10，前三名加大间隔与奖牌，平滑无缝走马灯)
     */
    renderMiniLeaderboard() {
        const ticker = document.getElementById('miniLeaderboardTicker');
        if (!ticker) return;

        AuthEngine.fetchLeaderboard(list => {
            if (!list) {
                // 云端 SDK 尚未就绪或查询超时: 明确提示, 不再无限"加载中"
                ticker.innerHTML = '<span style="color:#94a3b8"><i class="fa-solid fa-cloud-arrow-down"></i> 排行榜暂不可用 · 游戏不受影响</span>';
                return;
            }
            if (list.length === 0) {
                ticker.innerHTML = '<span style="color:#94a3b8">暂无上榜玩家，注册开局即可登顶！</span>';
                return;
            }

            // 轮播总共展示前十名
            const top10 = list.slice(0, 10);

            const buildItemsHtml = (items) => {
                return items.map((u, i) => {
                    const rank = i + 1;
                    let medal = `<span style="font-weight:700;color:#94a3b8;font-size:0.68rem;">No.${rank}</span>`;
                    if (rank === 1) medal = '🥇';
                    if (rank === 2) medal = '🥈';
                    if (rank === 3) medal = '🥉';
                    const isTop3 = rank <= 3 ? 'is-top3' : '';
                    const cleanNick = typeof window.sanitizeNickname === 'function' ? window.sanitizeNickname(u.nickname) : u.nickname;
                    return `<span class="lb-top-item ${isTop3}"><span>${medal}</span><span class="lb-top-name">${cleanNick}</span><span class="lb-top-score">(${u.yinCoins !== undefined ? u.yinCoins : 1000}知因币)</span></span>`;
                }).join('<span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>');
            };

            const groupHtml = buildItemsHtml(top10);

            // 复制两两无缝衔接，实现 360° 无卡顿平滑循环走马灯
            ticker.innerHTML = `
                <div class="mini-lb-track">
                    ${groupHtml}
                    <span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>
                    ${groupHtml}
                    <span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>
                </div>
            `;
        });
    }

    /**
     * 渲染全网知因币资产排行榜 Top 10
     */
    renderLeaderboard() {
        const container = document.getElementById('leaderboardListContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 加载知因币资产榜...</div>';

        AuthEngine.fetchLeaderboard(list => {
            container.innerHTML = '';
            if (!list) {
                // 云端 SDK 尚未就绪或查询超时
                container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;"><i class="fa-solid fa-cloud-arrow-down"></i> 排行榜暂不可用，游戏不受影响</div>';
                return;
            }
            if (list.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;">暂无上榜玩家，注册即送 1000 因币！</div>';
                return;
            }

            list.forEach((user, idx) => {
                const rank = idx + 1;
                let rankClass = '';
                if (rank === 1) rankClass = 'top1';
                if (rank === 2) rankClass = 'top2';
                if (rank === 3) rankClass = 'top3';

                const cleanNick = typeof window.sanitizeNickname === 'function' ? window.sanitizeNickname(user.nickname) : user.nickname;
                const item = document.createElement('div');
                item.className = 'lb-item';
                item.innerHTML = `
                    <div class="lb-rank ${rankClass}">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
                    <div class="lb-nick">${user.avatar || '🤠'} ${cleanNick}</div>
                    <div class="lb-score">🪙 ${user.yinCoins !== undefined ? user.yinCoins : 1000} 知因币</div>
                `;
                container.appendChild(item);
            });
        });
    }

    /* ============================================================
       🟢 游鲸五子棋 UI 控制组件 (Gomoku UI Methods)
       ============================================================ */

    /**
     * 刷新并渲染云端公共房间大厅列表
     */
    refreshPublicRoomsList(gameType = 'DOUDIZHU') {
        const container = document.getElementById('publicRoomsListContainer');
        if (!container) return;

        const isMahjong = gameType === 'MAHJONG';
        const isGomoku  = gameType === 'GOMOKU';
        const isGo      = gameType === 'GO';
        const isXiangqi = gameType === 'XIANGQI';
        const totalSeats = isMahjong ? 4 : ((isGomoku || isGo || isXiangqi) ? 2 : 3);
        const gameName   = isMahjong ? '游鲸麻将' : (isGomoku ? '五子棋' : (isGo ? '围棋' : (isXiangqi ? '象棋' : '斗地主')));

        const modalTitle = document.querySelector('#publicRoomsModal .ct-title');
        if (modalTitle) {
            modalTitle.innerHTML = isMahjong ?
                '<i class="fa-solid fa-square-full" style="color:#34d399;"></i> 在线游鲸麻将大厅' :
                (isGomoku ?
                '<i class="fa-solid fa-chess-board" style="color:#34d399;"></i> 在线五子棋对局大厅' :
                (isGo ?
                '<i class="fa-solid fa-circle" style="color:#e2e8f0;"></i> 在线围棋对局大厅' :
                (isXiangqi ?
                '<i class="fa-solid fa-chess-knight" style="color:#fecaca;"></i> 在线象棋对局大厅' :
                '<i class="fa-solid fa-list-check" style="color:#e2a820;"></i> 在线房间大厅')));
        }

        container.innerHTML = `<div style="text-align:center;color:${isMahjong || isGomoku || isGo || isXiangqi ? '#34d399' : '#94a3b8'};padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 正在拉取${gameName}在线房间...</div>`;

        NetworkManager.fetchPublicRooms((rooms) => {
            container.innerHTML = '';

            if (!rooms || rooms.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;color:#94a3b8;padding:36px 10px;font-size:0.88rem;">
                        <i class="fa-solid fa-ghost" style="font-size:2rem;margin-bottom:10px;color:#a07840;display:block;"></i>
                        <div>当前暂无活跃 ${gameName} 公开房间</div>
                        <div style="font-size:0.75rem;margin-top:6px;color:#64748b;">快去点击【创建${gameName}对局】建立第一个房间吧！</div>
                    </div>
                `;
                return;
            }

            rooms.forEach(room => {
                const rId = room.roomId;
                const phase = (room.gameState && room.gameState.phase) ? room.gameState.phase : 'WAITING';
                const lobby = room.lobbyData || { players: [] };
                const rawP = lobby.players;
                const players = Array.isArray(rawP) ? rawP : (rawP ? Object.values(rawP) : []);

                let phaseText = '🟢 等待开局';
                let phaseClass = 'waiting';
                if (phase === 'BIDDING') { phaseText = isMahjong ? '🟡 摸牌起手' : '🟡 抢地主中'; phaseClass = 'bidding'; }
                if (phase === 'PLAYING') { phaseText = isMahjong ? '🀄 雀局进行中' : (isGomoku ? '♟️ 棋局进行中' : (isGo ? '⚫⚪ 棋局进行中' : (isXiangqi ? '♞ 棋局进行中' : '🔴 打牌进行中'))); phaseClass = 'playing'; }
                if (phase === 'GAMEOVER') { phaseText = '🎉 对局刚结束'; phaseClass = 'waiting'; }

                // 计算真人数量与 AI 数量
                const humanPlayers = players.filter(p => p && !p.isAi && p.name);
                const aiCount = totalSeats - humanPlayers.length;

                // 渲染玩家列表标签
                let playersHtml = players.map((p, idx) => {
                    if (!p) return '<span class="pr-player-pill ai">🤖 机器人</span>';
                    if (p.isAi) return `<span class="pr-player-pill ai">🤖 AI</span>`;
                    return `<span class="pr-player-pill human"><i class="fa-solid fa-user"></i> ${p.name}${idx === 0 ? ' (房主)' : ''}</span>`;
                }).join('');

                const item = document.createElement('div');
                item.className = 'public-room-item';
                item.innerHTML = `
                    <div class="pr-left">
                        <div class="pr-room-header">
                            <span class="pr-room-id"># ${rId}</span>
                            <span class="pr-phase-tag ${phaseClass}">${phaseText}</span>
                        </div>
                        <div class="pr-players">
                            ${playersHtml}
                        </div>
                    </div>
                    <button class="btn-join-public-room" data-join-room-id="${rId}">
                        ${aiCount > 0 ? `<i class="fa-solid fa-user-plus"></i> 替换 AI 加入` : `<i class="fa-solid fa-right-to-bracket"></i> 进入房间`}
                    </button>
                `;
                container.appendChild(item);
            });
        }, gameType);
    }

    /**
     * 点击一键复制房间号
     */
    copyRoomId() {
        const roomDisp = document.getElementById('waitingRoomIdDisplay');
        const roomId = roomDisp ? roomDisp.textContent.trim() : '';
        if (roomId && roomId !== '------') {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(roomId);
            } else {
                const t = document.createElement('textarea');
                t.value = roomId;
                document.body.appendChild(t);
                t.select();
                document.execCommand('copy');
                document.body.removeChild(t);
            }
            UIRenderer.showToast(`✅ 已复制房间号：${roomId}`);
        }
    }

    /**
     * 根据当前游戏动态拉取并展示【规则与牌型/番型说明】弹窗
     */
    openRulesModal() {
        const modal = document.getElementById('cardTypeModal');
        if (!modal) return;

        const mahjongScr = document.getElementById('mahjongGameScreen');
        const isMahjong = (this.activeGameType === 'MAHJONG') || (mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none')) || document.body.classList.contains('theme-mahjong');

        const modalTitle = modal.querySelector('.ct-title');
        const modalBody  = modal.querySelector('.ct-body');

        if (isMahjong) {
            if (modalTitle) {
                modalTitle.innerHTML = '<i class="fa-solid fa-square-full" style="color:#34d399;"></i> 国粹麻将规则 & 番型速查';
            }
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="ct-section" style="border-color:rgba(52,211,153,0.3);">
                        <div class="ct-section-title" style="color:#34d399;">🀄 基础胡牌与动作说明</div>
                        <div class="ct-row">
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#34d399;font-size:0.85rem;font-weight:800;">推倒胡 (3n+2)</div>
                                <div class="ct-desc">满足 4 组顺子/刻子 + 1 对将牌即可胡牌 (1番)</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#34d399;font-size:0.85rem;font-weight:800;">吃 / 碰 / 杠 / 过</div>
                                <div class="ct-desc">可吃上家牌组顺子，可碰/杠任意家相同牌组刻子</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section" style="border-color:rgba(245,158,11,0.3);">
                        <div class="ct-section-title" style="color:#fbbf24;">🔥 高番型特色大胡</div>
                        <div class="ct-row">
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#fbbf24;font-size:0.85rem;font-weight:800;">七对子 (4番)</div>
                                <div class="ct-desc">手牌 14 张全由 7 个相同对子组成，无需顺子</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#fbbf24;font-size:0.85rem;font-weight:800;">清一色 (4番)</div>
                                <div class="ct-desc">整副牌全由同一种花色(全万/全筒/全条)组成</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#ef4444;font-size:0.85rem;font-weight:800;">清十八 (6番)</div>
                                <div class="ct-desc">吃碰杠 4 组同花色刻子/杠子 + 单张将牌</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section" style="border-color:rgba(255,255,255,0.1);">
                        <div class="ct-section-title" style="color:#60a5fa;">💡 摸牌与结算提示</div>
                        <div class="ct-row">
                            <div class="ct-item" style="width:100%;">
                                <div class="ct-desc" style="color:#cbd5e1;line-height:1.6;font-size:0.78rem;">
                                    • 自摸胡额外加番，放炮胡由放炮者单赔。<br>
                                    • 暗杠与明杠可在结算时获得额外杠分收益！
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } else {
            if (modalTitle) {
                modalTitle.innerHTML = '<i class="fa-solid fa-book-open" style="color:#ffd700;"></i> 斗地主牌型速查';
            }
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="ct-section">
                        <div class="ct-section-title">🔥 特殊牌型（无敌）</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card joker-big">大王</span><span class="ct-card joker-small">小王</span></div>
                                <div class="ct-name">火箭</div>
                                <div class="ct-desc">大小王合一，天下无敌</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">A</span><span class="ct-card">A</span><span class="ct-card">A</span><span class="ct-card">A</span></div>
                                <div class="ct-name">炸弹</div>
                                <div class="ct-desc">4张相同点数，可压任意普通牌型</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section">
                        <div class="ct-section-title">🃏 基础牌型</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">K</span></div>
                                <div class="ct-name">单张</div>
                                <div class="ct-desc">任意一张牌</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">8</span><span class="ct-card">8</span></div>
                                <div class="ct-name">对子</div>
                                <div class="ct-desc">2张相同点数</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">J</span><span class="ct-card">J</span><span class="ct-card">J</span></div>
                                <div class="ct-name">三张</div>
                                <div class="ct-desc">3张相同点数</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section">
                        <div class="ct-section-title">🚀 三带系列</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card red">5</span></div>
                                <div class="ct-name">三带一</div>
                                <div class="ct-desc">三张 + 任意1单张</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card red">7</span><span class="ct-card red">7</span></div>
                                <div class="ct-name">三带二</div>
                                <div class="ct-desc">三张 + 1个对子</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        modal.style.display = 'flex';
    }

    /**
     * 根据当前界面 (大厅 / 游戏房) 动态切换顶部 app-header 可见性及品牌标题名称
     */
    updateHeaderVisibility() {
        const appHeader = document.querySelector('.app-header');
        const lobbyScr = document.getElementById('lobbyScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');
        const goScr = document.getElementById('goGameScreen');
        const xiangqiScr = document.getElementById('xiangqiGameScreen');

        const menuBtnHelp = document.getElementById('menuBtnCardHelp');
        const menuBtnLeave = document.getElementById('menuBtnLeaveRoom');
        const brandTitle = document.getElementById('appHeaderBrandTitle');

        const isMahjongScreen = mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none');
        const isGomokuScreen  = gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none');
        const isGoScreen      = goScr && (goScr.classList.contains('active') || goScr.style.display !== 'none');
        const isXiangqiScreen = xiangqiScr && (xiangqiScr.classList.contains('active') || xiangqiScr.style.display !== 'none');
        const isLobbyScreen   = lobbyScr && (lobbyScr.classList.contains('active') || lobbyScr.style.display !== 'none');

        // 动态更换 Header 左上角游戏品牌标题 (游鲸围棋 <-> 游鲸五子棋 <-> 游鲸斗地主 <-> 游鲸麻将 <-> 游鲸象棋)
        if (brandTitle) {
            if (isGoScreen || (isLobbyScreen && this.activeGameType === 'GO')) {
                brandTitle.textContent = '游鲸围棋';
            } else if (isMahjongScreen || (isLobbyScreen && this.activeGameType === 'MAHJONG')) {
                brandTitle.textContent = '游鲸麻将';
            } else if (isGomokuScreen || (isLobbyScreen && this.activeGameType === 'GOMOKU')) {
                brandTitle.textContent = '游鲸五子棋';
            } else if (isXiangqiScreen || (isLobbyScreen && this.activeGameType === 'XIANGQI')) {
                brandTitle.textContent = '游鲸象棋';
            } else {
                brandTitle.textContent = '游鲸斗地主';
            }
        }

        // 围棋/五子棋界面或大厅时隐藏“牌型说明”
        if (menuBtnHelp) {
            menuBtnHelp.style.display = (isGomokuScreen || isGoScreen || isXiangqiScreen || (isLobbyScreen && (this.activeGameType === 'GOMOKU' || this.activeGameType === 'GO' || this.activeGameType === 'XIANGQI'))) ? 'none' : 'flex';
        }

        // 非主界面时在右上角下拉菜单中显示“退出/离开房间”按钮
        if (menuBtnLeave) {
            menuBtnLeave.style.display = isLobbyScreen ? 'none' : 'flex';
        }

        if (!appHeader) return;

        if (isLobbyScreen) {
            appHeader.style.display = 'none';
            appHeader.classList.add('in-lobby');
            if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndShowPendingLevelUp) {
                AuthEngine.checkAndShowPendingLevelUp();
            }
        } else {
            appHeader.style.display = 'flex';
            appHeader.classList.remove('in-lobby');
        }

        // 动态在顶部 Nav 栏显示不显眼的房间号与一键邀请按钮（支持斗地主、麻将、五子棋在线局）
        const roomInfoBar = document.getElementById('roomInfoBar');
        const displayRoomId = document.getElementById('displayRoomId');
        const currentRoomId = NetworkManager.roomId || (this.gameState ? this.gameState.roomId : '');

        if (roomInfoBar) {
            if (!isLobbyScreen && currentRoomId && !NetworkManager.isAiMode) {
                if (displayRoomId) displayRoomId.textContent = currentRoomId;
                roomInfoBar.style.display = 'inline-flex';
            } else {
                roomInfoBar.style.display = 'none';
            }
        }
    }

    /**
     * 进入等待界面 (Host视角)
     */
    setupWaitingScreen(roomId) {
        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'flex';
        document.getElementById('waitingScreen').classList.add('active');
        this.updateHeaderVisibility();

        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';

        // 生成真实访问 URL
        let origin = window.location.origin;
        if (!origin || origin === 'null') origin = window.location.protocol + '//' + window.location.host;

        const shareUrl = `${origin}${window.location.pathname}?room=${roomId}`;
        const inviteInput = document.getElementById('inviteUrlInput');
        if (inviteInput) inviteInput.value = shareUrl;

        const displayRoom = document.getElementById('displayRoomId');
        if (displayRoom) displayRoom.textContent = roomId;
        // 等待屏内的房间号块单独展示 (ID 读取选第一个)
        const waitingRoomDisp = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp) waitingRoomDisp.textContent = roomId;

        const roomInfoBar = document.getElementById('roomInfoBar');
        if (roomInfoBar) roomInfoBar.style.display = 'none'; // 房间等待界面隐去顶部 NAV 栏重复的房间号

        const menuLeaveBtn = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn) menuLeaveBtn.style.display = 'flex';

        // 生成二维码
        const qrContainer = document.getElementById('qrcode');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            if (window.QRCode) {
                new QRCode(qrContainer, {
                    text: shareUrl,
                    width: 100,
                    height: 100
                });
            }
        }

        // 初始化房主 slot0
        const nick = NetworkManager.nickname || '房主';
        const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';
        this.gameState.players[0].name = nick;
        this.gameState.players[0].avatar = currentAvatar;
        this.gameState.players[0].isAi = false;

        const slotName0 = document.getElementById('slotName0');
        const slotAvatar0 = document.getElementById('slotAvatar0');
        if (slotName0) slotName0.textContent = `${nick} (房主)`;
        if (slotAvatar0) slotAvatar0.textContent = currentAvatar;

        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');
        const btnStart = document.getElementById('btnStartGame');
        const btnAi = document.getElementById('btnStartWithAi');

        const currentType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (currentType === 'MAHJONG');
        const isGomoku  = (currentType === 'GOMOKU');
        const isGo      = (currentType === 'GO');
        const isXiangqi = (currentType === 'XIANGQI');

        if (isMahjong) {
            NetworkManager.gameType = 'MAHJONG';
            this.activeGameType = 'MAHJONG';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4 (差人自动补AI)</span>';
            }
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';

            this._fillSlotWithAi(1);
            this._fillSlotWithAi(2);
            this._fillSlotWithAi(3);
            const slotName1 = document.getElementById('slotName1');
            const slotName2 = document.getElementById('slotName2');
            const slotName3 = document.getElementById('slotName3');
            if (slotName1) slotName1.textContent = 'AI 雀圣 1';
            if (slotName2) slotName2.textContent = 'AI 雀圣 2';
            if (slotName3) slotName3.textContent = 'AI 雀圣 3';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启 4 人麻将对局';
            }
            if (btnAi) btnAi.style.display = 'none';
        } else if (isXiangqi) {
            NetworkManager.gameType = 'XIANGQI';
            this.activeGameType = 'XIANGQI';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 象棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启象棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else if (isGo) {
            NetworkManager.gameType = 'GO';
            this.activeGameType = 'GO';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 围棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启围棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else if (isGomoku) {
            NetworkManager.gameType = 'GOMOKU';
            this.activeGameType = 'GOMOKU';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 五子棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启五子棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else {
            NetworkManager.gameType = 'DOUDIZHU';
            this.activeGameType = 'DOUDIZHU';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
            }
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            this._fillSlotWithAi(2);

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> START';
            }
            if (btnAi) {
                btnAi.style.display = 'none';
            }
        }

        this.broadcastLobbyState();

        // 激活房主保活机制
        this._activateHostKeepAlive();
    }

    /**
     * 房主保活：Screen Wake Lock + 静音 Web Audio 防后台挂起
     */
    _activateHostKeepAlive() {
        // 1. Screen Wake Lock API（阻止手机熄屏）
        this._requestWakeLock();
        // 2. 静音 Web Audio 振荡器保活
        this._startAudioKeepAlive();

        // 移除旧的房主前台警告
        const oldWarn = document.getElementById('hostStayWarning');
        if (oldWarn) oldWarn.remove();
    }

    async _requestWakeLock() {
        if ('wakeLock' in navigator && navigator.wakeLock) {
            try {
                this._wakeLockObj = await navigator.wakeLock.request('screen');
            } catch (err) {
                console.log('[WakeLock] 屏幕常亮申请被忽略:', err);
            }
        }
    }

    _startAudioKeepAlive() {
        try {
            if (!this._audioKeepAliveCtx) {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtxClass) return;
                this._audioKeepAliveCtx = new AudioCtxClass();
                const osc = this._audioKeepAliveCtx.createOscillator();
                const gain = this._audioKeepAliveCtx.createGain();
                gain.gain.value = 0.0001; // 静音保活
                osc.connect(gain);
                gain.connect(this._audioKeepAliveCtx.destination);
                osc.start();
            }
        } catch (e) {
            console.log('[AudioKeepAlive] 静音保活忽略:', e);
        }
    }

    /**
     * 退出房间时停止所有保活机制（Screen Wake Lock + 静音 Audio）
     */
    _stopKeepAlive() {
        // 释放 Screen Wake Lock
        if (this._wakeLockObj) {
            try { this._wakeLockObj.release(); } catch (e) {}
            this._wakeLockObj = null;
        }
        // 关闭静音 Audio 振荡器
        if (this._audioKeepAliveCtx) {
            try { this._audioKeepAliveCtx.close(); } catch (e) {}
            this._audioKeepAliveCtx = null;
        }
    }

    /**
     * 将指定 slot 标记为 AI 机器人，并更新 UI
     */
    _fillSlotWithAi(slotIndex) {
        const aiName = `AI-${slotIndex}`;
        if (!this.gameState.players[slotIndex]) {
            this.gameState.players[slotIndex] = { id: slotIndex, name: aiName, hand: [], isAi: true, isHost: false, role: 'FARMER', avatar: '🤖' };
        } else {
            this.gameState.players[slotIndex].name = aiName;
            this.gameState.players[slotIndex].avatar = '🤖';
            this.gameState.players[slotIndex].isAi = true;
        }

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const avatarEl = document.getElementById(`slotAvatar${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = aiName;
        if (avatarEl) avatarEl.textContent = '🤖';
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status-pill');
            if (statusEl) {
                statusEl.textContent = '⚙️ 备选 AI';
                statusEl.classList.remove('ready');
            }
        }
    }

    /**
     * 客户端加入房间视图更新
     */
    enterRoomAsClient(roomId) {
        const lobbyScr  = document.getElementById('lobbyScreen');
        const waitScr   = document.getElementById('waitingScreen');
        const dispRoom  = document.getElementById('displayRoomId');
        const roomBar   = document.getElementById('roomInfoBar');
        const btnStart  = document.getElementById('btnStartGame');
        const btnAiBtn  = document.getElementById('btnStartWithAi');
        const btnGoHome = document.getElementById('btnGoHomeTop');

        if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
        if (waitScr)  { waitScr.style.display = 'flex'; waitScr.classList.add('active'); }
        this.updateHeaderVisibility();
        if (dispRoom) dispRoom.textContent = roomId;
        const waitingRoomDisp2 = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp2) waitingRoomDisp2.textContent = roomId;
        if (roomBar)  roomBar.style.display = 'none'; // 房间等待界面隐去顶部 NAV 栏重复的房间号
        if (btnStart) btnStart.style.display = 'none';
        if (btnAiBtn) btnAiBtn.style.display = 'none';
        if (btnGoHome) btnGoHome.style.display = 'inline-flex';
        const menuLeaveBtn2 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn2) menuLeaveBtn2.style.display = 'flex';

        // 根据 gameType 动态呈现或隐去槽位 (五子棋 2 人、斗地主 3 人、麻将 4 人)
        const gameType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (gameType === 'MAHJONG');
        const isGomoku  = (gameType === 'GOMOKU');
        const isGo      = (gameType === 'GO');
        const isXiangqi = (gameType === 'XIANGQI');
        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isMahjong) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';
        } else if (isXiangqi) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isGo) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isGomoku) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';
        }

        // 客户端监听房主开启象棋对局信号
        NetworkManager.onXiangqiStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsRed = (data && data.hostIsRed !== undefined) ? data.hostIsRed : true;
                this.startXiangqiOnlineGame(roomId, false, hostIsRed);
            }
        });

        // 客户端监听房主开启围棋 / 五子棋 / 麻将对局信号，全员同步进入游戏！
        NetworkManager.onGoStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsBlack = (data && data.hostIsBlack !== undefined) ? data.hostIsBlack : true;
                this.startGoOnlineGame(roomId, false, hostIsBlack);
            }
        });

        NetworkManager.onGomokuStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsBlack = (data && data.hostIsBlack !== undefined) ? data.hostIsBlack : true;
                this.startGomokuOnlineGame(roomId, false, hostIsBlack);
            }
        });

        NetworkManager.onMahjongStart(() => {
            if (!NetworkManager.isHost) {
                this.startMahjongOnlineGame(roomId, false);
            }
        });

        UIRenderer.showToast('已进入房间，等待房主开始游戏...');
    }

    /**
     * 当有新玩家加入 (Host处理) — 替换最早的一个 AI 占位符
     */
    onPlayerJoined(slotIndex, nickname, avatarEmoji) {
        if (!NetworkManager.isHost) return;

        const name = nickname || `玩家 ${slotIndex + 1}`;
        const avatar = avatarEmoji || '🤠';
        this.gameState.players[slotIndex].name = name;
        this.gameState.players[slotIndex].avatar = avatar;
        this.gameState.players[slotIndex].isAi = false;

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const avatarEl = document.getElementById(`slotAvatar${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = name;
        if (avatarEl) avatarEl.textContent = avatar;
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status-pill');
            if (statusEl) {
                statusEl.textContent = '✅ 已就绪';
                statusEl.classList.add('ready');
            }
        }

        const humanCount = this.gameState.players.filter(p => !p.isAi).length;
        const countEl = document.getElementById('connectedCount');
        if (countEl) countEl.textContent = humanCount;

        if (humanCount === 3) {
            UIRenderer.showToast('🎉 全员就位，可以开始游戏了！');
        }

        this.broadcastLobbyState();
    }

    /**
     * 房主广播组局大厅玩家状态
     */
    broadcastLobbyState() {
        if (!NetworkManager.isHost) return;
        const lobbyData = {
            players: this.gameState.players.map(p => ({
                name: p.name,
                avatar: p.avatar || (p.isAi ? '🤖' : '🤠'),
                isAi: p.isAi,
                isHost: p.isHost
            }))
        };
        NetworkManager.broadcastLobbySync(lobbyData);
    }

    /**
     * 客户端接收并渲染房间大厅玩家列表
     */
    onReceiveLobbySync(lobbyData) {
        if (!lobbyData || !lobbyData.players) return;
        // 缓存最新大厅玩家列表，供麻将牌桌座位昵称/风向显示使用
        this.latestLobbyPlayers = lobbyData.players || null;

        // 房主接收到大厅列表更新时，精准同步 gameState.players 中的 isAi/name/avatar 标志
        if (NetworkManager.isHost && this.gameState && this.gameState.players) {
            lobbyData.players.forEach((p, i) => {
                if (this.gameState.players[i] && p) {
                    this.gameState.players[i].name = p.name || this.gameState.players[i].name;
                    this.gameState.players[i].avatar = p.avatar || this.gameState.players[i].avatar;
                    this.gameState.players[i].isAi = !!p.isAi;
                }
            });
        }

        const myIndex = NetworkManager.myPlayerIndex;

        const gameType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (gameType === 'MAHJONG');
        const isGomoku  = (gameType === 'GOMOKU');
        const isGo      = (gameType === 'GO');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isGomoku || isGo) {
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isMahjong) {
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';
        } else {
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';
        }

        let humanCount = 0;
        lobbyData.players.forEach((p, i) => {
            const slotEl   = document.getElementById(`slot${i}`);
            const nameEl   = document.getElementById(`slotName${i}`);
            const avatarEl = document.getElementById(`slotAvatar${i}`);
            if (!slotEl || !nameEl) return;

            const statusEl = slotEl.querySelector('.slot-status-pill');

            if (p.isAi) {
                nameEl.textContent = `🤖 ${p.name}`;
                if (avatarEl) avatarEl.textContent = '🤖';
                if (statusEl) {
                    statusEl.textContent = '⚙️ 备选 AI';
                    statusEl.classList.remove('ready');
                }
            } else if (p.name) {
                humanCount++;
                let displayName = p.name;
                if (i === 0) displayName += ' (房主)';
                if (i === myIndex && i !== 0) displayName += ' (你)';
                nameEl.textContent = displayName;
                if (avatarEl) avatarEl.textContent = p.avatar || '🤠';
                if (statusEl) {
                    statusEl.textContent = '✅ 已就绪';
                    statusEl.classList.add('ready');
                }
            }
        });

        const ccEl = document.getElementById('connectedCount');
        if (ccEl) ccEl.textContent = humanCount;
    }

    /**
     * 复制分享链接
     */
    copyInviteUrl() {
        const input = document.getElementById('inviteUrlInput');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value).then(() => {
                UIRenderer.showToast('邀请链接已复制！快速发给微信/QQ好友吧！');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                UIRenderer.showToast('链接已复制到剪贴板');
            });
        }
    }

    /**
     * 重新回到初始大厅 (安全退房、清除URL邀请参数、切回主页屏幕)
     */
    /**
     * 通用棋类结算弹窗 (五子棋/围棋/象棋共用)
     * @param {object} opts { icon, title, subtitle, reasonBadge, reasonList, scores, theme }
     */
    showBoardSettlement(opts) {
        const modal = document.getElementById('boardSettlementModal');
        if (!modal) return;
        const o = opts || {};
        const iconEl = document.getElementById('boardSettleIcon');
        const titleEl = document.getElementById('boardSettleTitle');
        const subEl = document.getElementById('boardSettleSubtitle');
        const badgeEl = document.getElementById('boardSettleReasonBadge');
        const listEl = document.getElementById('boardSettleReasonList');
        const scoresEl = document.getElementById('boardSettleScores');
        const inner = document.getElementById('boardSettlementInner');

        if (iconEl) iconEl.textContent = o.icon || '🏆';
        if (titleEl) titleEl.textContent = o.title || '胜利！';
        if (subEl) subEl.textContent = o.subtitle || '恭喜获胜';
        if (badgeEl) badgeEl.textContent = o.reasonBadge || '对局结束';
        if (listEl) listEl.innerHTML = (o.reasonList || []).map(r => `<span>· ${r}</span>`).join('<br>');

        if (scoresEl) {
            scoresEl.innerHTML = (o.scores || []).map(pl => {
                const cls = pl.cls || (pl.diff >= 0 ? 'positive' : 'negative');
                const sign = (typeof pl.diff === 'number' && pl.diff > 0) ? '+' : '';
                return `<div class="score-row-item"><span class="p-label">${pl.name}</span><span class="p-diff ${cls}">${sign}${pl.diff || 0} 知因币</span></div>`;
            }).join('');
        }

        const theme = o.theme || 'gomoku';
        if (inner) {
            inner.classList.remove('theme-gomoku', 'theme-go', 'theme-xiangqi', 'theme-doudizhu');
            inner.classList.add('theme-' + theme);
        }

        modal.style.display = 'flex';
        this.hideSettlementReopenBadge();

        const btnRematch = document.getElementById('btnBoardSettleRematch');
        const btnLobby = document.getElementById('btnBoardSettleLobby');
        const gameType = theme === 'xiangqi' ? 'XIANGQI' : (theme === 'go' ? 'GO' : 'GOMOKU');
        if (btnRematch) {
            btnRematch.onclick = () => {
                modal.style.display = 'none';
                if (typeof this.startGomokuAiMode === 'function' && gameType === 'GOMOKU') this.startGomokuAiMode();
                else if (typeof this.startGoAiMode === 'function' && gameType === 'GO') this.startGoAiMode();
                else if (typeof this.startXiangqiAiMode === 'function' && gameType === 'XIANGQI') this.startXiangqiAiMode();
            };
        }
        if (btnLobby) {
            btnLobby.onclick = () => {
                modal.style.display = 'none';
                this.resetToLobby();
            };
        }

        // 关闭按钮: 隐藏弹窗 + 显示重开徽章
        const btnClose = document.getElementById('btnBoardSettleClose');
        if (btnClose) {
            btnClose.onclick = () => {
                modal.style.display = 'none';
                this._lastBoardSettleReopen = () => this.showBoardSettlement(o);
                this.showSettlementReopenBadge();
            };
        }
    }

    /**
     * 显示/隐藏 结算重开徽章
     */
    showSettlementReopenBadge() {
        const badge = document.getElementById('settlementReopenBadge');
        if (!badge) return;
        badge.style.display = 'inline-flex';
        badge.onclick = () => {
            badge.style.display = 'none';
            if (typeof this._lastBoardSettleReopen === 'function') this._lastBoardSettleReopen();
        };
    }

    hideSettlementReopenBadge() {
        const badge = document.getElementById('settlementReopenBadge');
        if (badge) badge.style.display = 'none';
    }
    resetToLobby() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        const gomokuScr  = document.getElementById('gomokuGameScreen');
        const goScr      = document.getElementById('goGameScreen');
        const xiangqiScr = document.getElementById('xiangqiGameScreen');
        const isMahjongExit = (this.activeGameType === 'MAHJONG') || (mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none'));
        const isGomokuExit  = (this.activeGameType === 'GOMOKU') || (gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none'));
        const isGoExit      = (this.activeGameType === 'GO') || (goScr && (goScr.classList.contains('active') || goScr.style.display !== 'none'));
        const isXiangqiExit = (this.activeGameType === 'XIANGQI') || (xiangqiScr && (xiangqiScr.classList.contains('active') || xiangqiScr.style.display !== 'none'));

        this._stopKeepAlive();
        if (this._mahjongWatchdogId) { clearInterval(this._mahjongWatchdogId); this._mahjongWatchdogId = null; }
        NetworkManager.clearSession();

        // 1. 如果在房间中，清除云端对应的槽位或房间
        if (NetworkManager.roomId && NetworkManager.db) {
            const rId = NetworkManager.roomId;
            const myIdx = NetworkManager.myPlayerIndex;
            try {
                if (NetworkManager.isHost && !NetworkManager.isAiMode) {
                    // 如果房主主动退出，物理注销移除整个房间
                    NetworkManager.db.ref('rooms/' + rId).remove().catch(() => {});
                } else if (myIdx > 0 && !NetworkManager.isAiMode) {
                    // 如果客户端主动退出，将其槽位重置为 AI 候补
                    NetworkManager.db.ref(`rooms/${rId}/lobbyData/players/${myIdx}`).set({
                        name: `AI-${myIdx}`,
                        isAi: true,
                        isHost: false
                    }).catch(() => {});
                }
            } catch (e) {}
        }

        // 2. 清除云端网络监听
        NetworkManager._removeAllListeners();
        NetworkManager.roomId = null;
        NetworkManager.isHost = false;
        NetworkManager.isAiMode = false;

        // 3. 关键修复：清除浏览器 URL 地址栏里的 ?room=XXXXXX 邀请参数
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 4. 界面瞬间平滑切回大厅 Screen (彻底隐藏麻将/五子棋/斗地主对局屏与结算弹窗)
        const waitingScreen   = document.getElementById('waitingScreen');
        const gameTable       = document.getElementById('gameTable');
        const gameOverModal   = document.getElementById('gameOverModal');
        const mahjongSettle   = document.getElementById('mahjongSettlementModal');
        const lobbyScreen     = document.getElementById('lobbyScreen');
        const roomInfoBar     = document.getElementById('roomInfoBar');
        const btnLeaveRoom    = document.getElementById('btnLeaveRoom');
        const btnGoHomeTop    = document.getElementById('btnGoHomeTop');

        if (waitingScreen) { waitingScreen.style.display = 'none'; waitingScreen.classList.remove('active'); }
        if (gameTable)     { gameTable.style.display = 'none'; gameTable.classList.remove('active'); }
        if (gameOverModal) gameOverModal.style.display = 'none';
        if (gomokuScr)     { gomokuScr.style.display = 'none'; gomokuScr.classList.remove('active'); }
        if (goScr)         { goScr.style.display = 'none'; goScr.classList.remove('active'); }
        if (xiangqiScr)    { xiangqiScr.style.display = 'none'; xiangqiScr.classList.remove('active'); }
        if (mahjongScr)    { mahjongScr.style.display = 'none'; mahjongScr.classList.remove('active'); }
        // 清理围棋/象棋回合计时器, 防止退出后后台 AI 继续走/计时
        if (this.stopGoTurnTimer) this.stopGoTurnTimer();
        if (this.stopXiangqiTurnTimer) this.stopXiangqiTurnTimer();
        if (mahjongSettle) { mahjongSettle.style.display = 'none'; mahjongSettle.classList.remove('active'); }
        if (roomInfoBar)   roomInfoBar.style.display = 'none';
        if (btnLeaveRoom)  btnLeaveRoom.style.display = 'none';
        if (btnGoHomeTop)  btnGoHomeTop.style.display = 'none';
        const menuLeaveBtn3 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn3) menuLeaveBtn3.style.display = 'none';

        if (lobbyScreen) {
            lobbyScreen.style.display = 'flex';
            lobbyScreen.classList.add('active');
        }

        // 如果是从麻将/五子棋/围棋退出的，退回主页时自动切为对应的主厅 Tab
        if (isMahjongExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('MAHJONG');
        } else if (isGoExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('GO');
        } else if (isGomokuExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('GOMOKU');
        } else if (isXiangqiExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('XIANGQI');
        }

        this.updateHeaderVisibility();

        // 恢复大厅基础按钮可见性
        const createBtn = document.getElementById('btnCreateRoom');
        const aiBtn     = document.getElementById('btnPlayAi');
        const divider   = document.querySelector('.divider');
        const banner    = document.getElementById('quickJoinBanner');
        if (createBtn) createBtn.style.display = 'flex';
        if (aiBtn)     aiBtn.style.display = 'flex';
        if (divider)   divider.style.display = 'flex';
        if (banner)    banner.style.display = 'none';
    }

}

// 挂载引擎单例
window.GameEngine = new GameEngineController();
document.addEventListener('DOMContentLoaded', () => {
    window.GameEngine.init();
});
