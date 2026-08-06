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
        const btnNavDoudizhu = document.getElementById('btnNavDoudizhu');
        const btnNavGomoku   = document.getElementById('btnNavGomoku');
        const btnNavMahjong  = document.getElementById('btnNavMahjong');
        const cardDoudizhu   = document.getElementById('doudizhuLobbyCard');
        const cardGomoku     = document.getElementById('gomokuLobbyCard');
        const cardMahjong    = document.getElementById('mahjongLobbyCard');

        const switchGameLobby = (gameType) => {
            document.body.classList.remove('theme-gomoku', 'theme-mahjong');
            this.activeGameType = gameType;
            NetworkManager.gameType = gameType;

            if (gameType === 'MAHJONG') {
                document.body.classList.add('theme-mahjong');
                if (btnNavMahjong)  btnNavMahjong.classList.add('active');
                if (btnNavDoudizhu) btnNavDoudizhu.classList.remove('active');
                if (btnNavGomoku)   btnNavGomoku.classList.remove('active');
                if (cardDoudizhu)   cardDoudizhu.style.display = 'none';
                if (cardGomoku)     cardGomoku.style.display = 'none';
                if (cardMahjong)    cardMahjong.style.display = 'block';
            } else if (gameType === 'GOMOKU') {
                document.body.classList.add('theme-gomoku');
                if (btnNavGomoku)   btnNavGomoku.classList.add('active');
                if (btnNavDoudizhu) btnNavDoudizhu.classList.remove('active');
                if (btnNavMahjong)  btnNavMahjong.classList.remove('active');
                if (cardDoudizhu)   cardDoudizhu.style.display = 'none';
                if (cardGomoku)     cardGomoku.style.display = 'block';
                if (cardMahjong)    cardMahjong.style.display = 'none';
            } else {
                if (btnNavDoudizhu) btnNavDoudizhu.classList.add('active');
                if (btnNavGomoku)   btnNavGomoku.classList.remove('active');
                if (btnNavMahjong)  btnNavMahjong.classList.remove('active');
                if (cardDoudizhu)   cardDoudizhu.style.display = 'block';
                if (cardGomoku)     cardGomoku.style.display = 'none';
                if (cardMahjong)    cardMahjong.style.display = 'none';
            }
        };
        this.switchGameLobby = switchGameLobby;

        if (btnNavDoudizhu) btnNavDoudizhu.addEventListener('click', () => switchGameLobby('DOUDIZHU'));
        if (btnNavGomoku)   btnNavGomoku.addEventListener('click', () => switchGameLobby('GOMOKU'));
        if (btnNavMahjong)  btnNavMahjong.addEventListener('click', () => switchGameLobby('MAHJONG'));

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
        const lobbyScr = document.getElementById('lobbyScreen');
        if (lobbyScr) {
            lobbyScr.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });

            lobbyScr.addEventListener('touchend', (e) => {
                const diffX = e.changedTouches[0].clientX - touchStartX;
                const diffY = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                    if (diffX < 0) {
                        // 左滑切换到五子棋
                        switchGameLobby('GOMOKU');
                    } else {
                        // 右滑切换到斗地主
                        switchGameLobby('DOUDIZHU');
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
                if (isMahjong) {
                    this.startMahjongOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
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

                if (isMahjong) {
                    this.startMahjongAiMode();
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
                }
                return;
            }

            const expandBtn = e.target.closest('#btnExpandVictory');
            if (expandBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'false';
                    this.onReceiveStateUpdate(this.gameState);
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
    resetToLobby() {
        // 彻底清空麻将与斗地主所有定时器，防止离开大厅后后台 AI 继续走牌并播音效！
        this.stopMahjongGame();
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }
        if (this.turnTimerId) {
            clearInterval(this.turnTimerId);
            this.turnTimerId = null;
        }
        this.gameState.phase = 'LOBBY';

        const doResetUI = () => {
            const lobbyScr = document.getElementById('lobbyScreen');
            const waitingScr = document.getElementById('waitingScreen');
            const doudizhuScr = document.getElementById('gameScreen');
            const gomokuScr = document.getElementById('gomokuGameScreen');
            const mahjongScr = document.getElementById('mahjongGameScreen');

            if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
            if (doudizhuScr) { doudizhuScr.style.display = 'none'; doudizhuScr.classList.remove('active'); }
            if (gomokuScr) { gomokuScr.style.display = 'none'; gomokuScr.classList.remove('active'); }
            if (mahjongScr) { mahjongScr.style.display = 'none'; mahjongScr.classList.remove('active'); }

            if (lobbyScr) { lobbyScr.style.display = 'flex'; lobbyScr.classList.add('active'); }

            this.updateHeaderVisibility();
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardSort) SoundEngine.playCardSort();
        };

        if (typeof NetworkManager !== 'undefined' && NetworkManager.leaveRoom) {
            NetworkManager.leaveRoom(() => {
                doResetUI();
            });
        } else {
            doResetUI();
        }
    }

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
                    <i class="fa-solid fa-cards"></i> 斗地主战绩
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
            if (!list || list.length === 0) {
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
            if (!list || list.length === 0) {
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
     * 初始化五子棋棋盘 UI 界面 (15x15 网格)
     */
    initGomokuUI() {
        const boardContainer = document.getElementById('gomokuBoardContainer');
        if (!boardContainer) return;

        // 重置单局 3 次悔棋计数器、预选落子与重来一局状态
        this.gomokuUndoLeft = 3;
        this.gomokuPendingMove = null;
        this.gomokuMyRematchReady = false;

        const countEl = document.getElementById('gomokuUndoCount');
        if (countEl) countEl.textContent = '3';

        const btnUndo = document.getElementById('btnGomokuUndo');
        if (btnUndo) {
            btnUndo.style.display = 'flex';
            btnUndo.disabled = false;
            btnUndo.classList.remove('disabled');
        }

        const btnRematch = document.getElementById('btnGomokuRematch');
        if (btnRematch) {
            btnRematch.style.display = 'none';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }

        boardContainer.innerHTML = '';
        const starPoints = ['3,3', '3,11', '7,7', '11,3', '11,11']; // 15x15 盘面星位与天元

        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                const cell = document.createElement('div');
                cell.className = 'gomoku-cell';

                if (r === 0)  cell.classList.add('row-top');
                if (r === 14) cell.classList.add('row-bottom');
                if (c === 0)  cell.classList.add('col-left');
                if (c === 14) cell.classList.add('col-right');

                if (starPoints.includes(`${r},${c}`)) {
                    const dot = document.createElement('div');
                    dot.className = 'star-dot';
                    cell.appendChild(dot);
                }

                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.addEventListener('click', () => this.handleGomokuCellClick(r, c));
                boardContainer.appendChild(cell);
            }
        }
    }

    /**
     * 播放棋盘中央开局先后手 苹果级奢华微标语 (1.4秒影院级微滑入滑出)
     */
    showGomokuCenterBanner(isMyTurnFirst) {
        const banner = document.getElementById('gomokuCenterBanner');
        const badgeEl = document.getElementById('gomokuBannerBadge');
        const textEl = document.getElementById('gomokuCenterBannerText');
        if (!banner || !textEl) return;

        if (this._bannerTimeout) clearTimeout(this._bannerTimeout);

        banner.style.display = 'none';
        banner.offsetHeight; // 触发 reflow 重置动画
        banner.style.display = 'flex';

        if (isMyTurnFirst) {
            if (badgeEl) badgeEl.className = 'stone-badge black';
            textEl.textContent = '你先手';
            textEl.className = 'black-first';
        } else {
            if (badgeEl) badgeEl.className = 'stone-badge white';
            textEl.textContent = '你后手';
            textEl.className = 'white-second';
        }

        this._bannerTimeout = setTimeout(() => {
            banner.style.display = 'none';
        }, 1400);
    }

    /**
     * 开启在线五子棋真人双人对战模式 (随机先后手，我方固定在左侧)
     */
    startGomokuOnlineGame(roomId, isHost = false, hostIsBlackSynced = null) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
            AuthEngine.checkAndDeductEntryFee('GOMOKU', isPve);
        }

        // 切换游戏前清理斗地主残留定时器
        this.stopDoudizhuTimers();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');

        if (lobbyScr) {
            lobbyScr.style.display = 'none';
            lobbyScr.classList.remove('active');
        }
        if (waitingScr) {
            waitingScr.style.display = 'none';
            waitingScr.classList.remove('active');
        }
        if (gomokuScr) {
            gomokuScr.style.display = 'flex';
            gomokuScr.classList.add('active');
        }
        this.updateHeaderVisibility();

        // 房主随机决定先手黑棋归属并广播同步
        let hostIsBlack;
        if (isHost) {
            hostIsBlack = (hostIsBlackSynced !== null && hostIsBlackSynced !== undefined) ? hostIsBlackSynced : (Math.random() < 0.5);
            NetworkManager.clearGomokuMoves();
            NetworkManager.sendGomokuStart(roomId, hostIsBlack);
        } else {
            hostIsBlack = (hostIsBlackSynced !== null && hostIsBlackSynced !== undefined) ? hostIsBlackSynced : true;
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : (isHost ? 0 : 1);
        const myColor = (mySlot === 0 && hostIsBlack) || (mySlot === 1 && !hostIsBlack) ? 1 : 2;
        const iAmBlack = (myColor === 1);

        const hostNick = isHost ? NetworkManager.nickname : '房主';
        const guestNick = !isHost ? NetworkManager.nickname : '对手';
        const myNick = NetworkManager.nickname || '玩家';
        const oppNick = isHost ? guestNick : hostNick;

        // 左侧卡片 (固定是我方)
        const nameLeft = document.getElementById('gNameLeft');
        const roleLeft = document.getElementById('gRoleLeft');
        const avatarLeft = document.getElementById('gAvatarLeft');
        if (nameLeft) nameLeft.textContent = myNick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是对手)
        const nameRight = document.getElementById('gNameRight');
        const roleRight = document.getElementById('gRoleRight');
        const avatarRight = document.getElementById('gAvatarRight');
        if (nameRight) nameRight.textContent = oppNick;
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.gomokuEngine.reset(false, myColor); // 双人在线模式
        this.initGomokuUI();
        this.renderGomokuBoard();

        const isMyTurn = window.gomokuEngine.currentTurn === myColor;
        this.updateGomokuStatusUI(isMyTurn ? `⚫ 轮到你落子 (先手黑棋)` : `⚪ 对方思考中 (后手白棋)...`);
        UIRenderer.showToast(isMyTurn ? '🎲 随机先后手：你执先手黑棋！' : '🎲 随机先后手：你执后手白棋！');
        this.showGomokuCenterBanner(isMyTurn);

        // 监听云端落子广播
        NetworkManager.onGomokuMove((move) => {
            if (!move || move.senderSlot === NetworkManager.myPlayerIndex) return;
            const engine = window.gomokuEngine;
            if (engine.board[move.r][move.c] === 0) {
                const res = engine.placeStone(move.r, move.c);
                this.renderGomokuBoard();
                if (res && res.isGameOver) {
                    this.handleGomokuWin(res.winner);
                } else {
                    const isNowMyTurn = engine.currentTurn === myColor;
                    this.updateGomokuStatusUI(isNowMyTurn ? (myColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '⏳ 对方思考中...');
                }
            }
        });

        // 监听在线悔棋申请广播
        NetworkManager.onGomokuUndoRequest((req) => {
            if (!req || req.senderSlot === NetworkManager.myPlayerIndex) return;
            const undoModal = document.getElementById('gomokuUndoModal');
            const modalText = document.getElementById('gomokuUndoModalText');
            if (undoModal && modalText) {
                modalText.textContent = `玩家 ${req.applicantNick || '对方'} 申请悔棋一步，是否同意？`;
                undoModal.style.display = 'flex';
            }
        });

        // 监听在线悔棋响应广播 (同意才扣次数，拒绝不扣次数)
        NetworkManager.onGomokuUndoResponse((resp) => {
            if (!resp || resp.senderSlot === NetworkManager.myPlayerIndex) return;
            if (resp.approved) {
                const engine = window.gomokuEngine;
                if (engine) {
                    engine.undo();
                    this.renderGomokuBoard();
                }
                if (this.gomokuUndoLeft > 0) {
                    this.gomokuUndoLeft--;
                    const countEl = document.getElementById('gomokuUndoCount');
                    if (countEl) countEl.textContent = this.gomokuUndoLeft;
                    const btnUndo = document.getElementById('btnGomokuUndo');
                    if (this.gomokuUndoLeft <= 0 && btnUndo) {
                        btnUndo.disabled = true;
                        btnUndo.classList.add('disabled');
                    }
                }
                UIRenderer.showToast(`🎉 对方同意了你的悔棋申请！本局还剩 ${this.gomokuUndoLeft} 次`);
                this.updateGomokuStatusUI(`对方同意悔棋！本局还可悔棋 ${this.gomokuUndoLeft} 次`);
            } else {
                UIRenderer.showToast(`❌ 对方拒绝了你的悔棋申请，未扣除悔棋次数 (剩余 ${this.gomokuUndoLeft} 次)`);
                this.updateGomokuStatusUI(`对方拒绝悔棋，请继续落子`);
            }
        });

        // 监听在线双人【重来一局】投票 (双方均准备后自动开启新一局)
        NetworkManager.onGomokuRematchVote((votes) => {
            if (!votes) return;
            const hostVote = votes[0] && votes[0].ready;
            const joinerVote = votes[1] && votes[1].ready;

            const mySlot = NetworkManager.myPlayerIndex;
            const oppSlot = mySlot === 0 ? 1 : 0;
            const myVote = votes[mySlot] && votes[mySlot].ready;
            const oppVote = votes[oppSlot] && votes[oppSlot].ready;

            if (oppVote && !myVote) {
                this.updateGomokuStatusUI('🤝 对方已点击【重来一局】，等你准备...');
                UIRenderer.showToast('🤝 对方已申请【重来一局】，请点击确认！');
            }

            // 双方都点击了【重来一局】！重置盘面，开启新对局！
            if (hostVote && joinerVote) {
                NetworkManager.clearGomokuRematchVotes();
                this.startGomokuOnlineGame(roomId, isHost);
            }
        });
    }

    /**
     * 开启单机 AI 五子棋切磋模式 (随机先后手，我方固定在左侧)
     */
    startGomokuAiMode() {
        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');

        // 切换游戏前清理斗地主残留定时器
        this.stopDoudizhuTimers();
        if (lobbyScr) {
            lobbyScr.style.display = 'none';
            lobbyScr.classList.remove('active');
        }
        if (waitingScr) {
            waitingScr.style.display = 'none';
            waitingScr.classList.remove('active');
        }
        if (gomokuScr) {
            gomokuScr.style.display = 'flex';
            gomokuScr.classList.add('active');
        }
        this.updateHeaderVisibility();

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';

        // 随机决定先后手
        const iAmBlack = Math.random() < 0.5;
        const myColor = iAmBlack ? 1 : 2;

        // 左侧卡片 (固定是我方)
        const nameLeft = document.getElementById('gNameLeft');
        const roleLeft = document.getElementById('gRoleLeft');
        const avatarLeft = document.getElementById('gAvatarLeft');
        if (nameLeft) nameLeft.textContent = nick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是 AI 棋圣)
        const nameRight = document.getElementById('gNameRight');
        const roleRight = document.getElementById('gRoleRight');
        const avatarRight = document.getElementById('gAvatarRight');
        if (nameRight) nameRight.textContent = 'AI 棋圣';
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.gomokuEngine.reset(true, myColor);
        this.initGomokuUI();
        this.renderGomokuBoard();

        this.showGomokuCenterBanner(iAmBlack);

        if (iAmBlack) {
            this.updateGomokuStatusUI('⚫ 轮到你落子 (先手黑棋)');
            UIRenderer.showToast('🎲 随机分配完成：你执先手黑棋！');
        } else {
            this.updateGomokuStatusUI('🤖 AI 棋圣 (先手黑棋) 思考中...');
            UIRenderer.showToast('🎲 随机分配完成：AI 棋圣执先手黑棋！');
            setTimeout(() => {
                const aiMove = window.gomokuEngine.getBestAiMove();
                if (aiMove) {
                    window.gomokuEngine.placeStone(aiMove.r, aiMove.c);
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('⚪ 轮到你落子 (后手白棋)');
                }
            }, 800);
        }
    }

    /**
     * 处理五子棋棋盘单元格点击落子 (严格校验当前回合，手机端支持 2-Tap 二次确认落子)
     */
    handleGomokuCellClick(r, c) {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;
        if (engine.board[r][c] !== 0) return; // 该位置已有棋子

        // 1. 严格回合校验：非我方回合时，禁止任何点击 (无论是第一次还是第二次)
        if (!engine.isAiMode) {
            // 双人在线对战模式
            const myColor = engine.playerColor;
            if (engine.currentTurn !== myColor) {
                UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                return;
            }
        } else {
            // 单机 AI 切磋模式
            if (engine.currentTurn !== engine.playerColor) {
                UIRenderer.showToast('⏳ 🤖 AI 棋圣思考中，请稍候...');
                return;
            }
        }

        // 2. 判断是否为移动端设备/触摸屏/小屏 (包括手机及 Chrome 模拟器)
        const isMobile = ('ontouchstart' in window) || window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

        // 📱 手机端 2-Tap 二次确认落子流程 (已在回合校验之后，确保仅轮到自己时生效)
        if (isMobile) {
            if (!this.gomokuPendingMove || this.gomokuPendingMove.r !== r || this.gomokuPendingMove.c !== c) {
                // 第一次点击：预选该位置，渲染虚影预览并提示再次点击确定
                this.gomokuPendingMove = { r, c };
                this.renderGomokuBoard();
                UIRenderer.showToast('🎯 已选定位置，再次点击确定落子');
                return;
            }
            // 第二次点击同一位置：清除预选，正式确认落子！
            this.gomokuPendingMove = null;
        } else {
            this.gomokuPendingMove = null;
        }

        // 3. 执行正式落子逻辑
        if (!engine.isAiMode) {
            const myColor = engine.playerColor;
            const res = engine.placeStone(r, c);
            if (!res || !res.success) return;

            this.renderGomokuBoard();
            NetworkManager.sendGomokuMove(r, c, myColor);

            if (res.isGameOver) {
                this.handleGomokuWin(res.winner);
            } else {
                this.updateGomokuStatusUI('⏳ 对方思考中...');
            }
            return;
        }

        // 单机 AI 模式落子
        const res = engine.placeStone(r, c);
        if (!res || !res.success) return;

        this.renderGomokuBoard();

        if (res.isGameOver) {
            this.handleGomokuWin(res.winner);
            return;
        }

        // 若为单机 AI 模式，触发 AI 落子 (模拟拟人化随机思考 600ms ~ 1400ms)
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            this.updateGomokuStatusUI('🤖 AI 棋圣思考中...');
            const randomThinkTime = Math.floor(Math.random() * 800 + 600); // 600ms - 1400ms 随机思考时长
            setTimeout(() => {
                const aiMove = engine.getBestAiMove();
                if (aiMove) {
                    const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                    this.renderGomokuBoard();
                    if (aiRes && aiRes.isGameOver) {
                        this.handleGomokuWin(aiRes.winner);
                    } else {
                        this.updateGomokuStatusUI('⚫ 黑方落子中 (你)');
                    }
                }
            }, randomThinkTime);
        } else {
            this.updateGomokuStatusUI(engine.currentTurn === 1 ? '⚫ 黑方落子中' : '⚪ 白方落子中');
        }
    }

    /**
     * 重新渲染盘面棋子
     */
    renderGomokuBoard() {
        const engine = window.gomokuEngine;
        if (!engine) return;

        const winNodes = engine.winLine || [];
        const cells = document.querySelectorAll('.gomoku-cell');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const val = engine.board[r][c];

            let stone = cell.querySelector('.gomoku-stone');

            if (val === 0) {
                // 如果格子上无正式棋子
                if (stone) {
                    stone.remove();
                    stone = null;
                }

                // 如果该格被选中作为 2-Tap 预选位置，渲染半透明预览虚影棋子
                if (this.gomokuPendingMove && this.gomokuPendingMove.r === r && this.gomokuPendingMove.c === c) {
                    const currentTurn = engine.currentTurn;
                    const previewStone = document.createElement('div');
                    previewStone.className = `gomoku-stone ${currentTurn === 1 ? 'black' : 'white'} preview`;
                    cell.appendChild(previewStone);
                }
            } else {
                // 标准大众麻将固定座位风向：0=东风(房主/庄家)、1=南风、2=西风、3=北风
                const windNames = ['东', '南', '西', '北'];
                const isLastMove = engine.lastMove && engine.lastMove.r === r && engine.lastMove.c === c;
                const isWinStone = winNodes.some(n => n.r === r && n.c === c);

                if (!stone || stone.classList.contains('preview')) {
                    if (stone) stone.remove();
                    // 仅当这颗棋子是新落下的，新建 DOM 节点并播放微随机物理落子音效
                    stone = document.createElement('div');
                    stone.className = `gomoku-stone ${val === 1 ? 'black' : 'white'}`;
                    cell.appendChild(stone);

                    const soundObj = typeof SoundEngine !== 'undefined' ? SoundEngine : (typeof audioSynth !== 'undefined' ? audioSynth : null);
                    if (soundObj && soundObj.playStoneDrop) {
                        soundObj.playStoneDrop(val === 2); // 白棋音高更高脆，黑棋更沉稳，带±12%微随机音调！
                    }
                } else {
                    stone.className = `gomoku-stone ${val === 1 ? 'black' : 'white'}`;
                }

                if (isLastMove) stone.classList.add('last-move');
                else stone.classList.remove('last-move');

                if (isWinStone) stone.classList.add('win-stone');
                else stone.classList.remove('win-stone');
            }
        });
    }

    /**
     * 更新顶部对局状态指示与当前回合玩家高亮 (左侧固定为我方，右侧固定为对方)
     */
    updateGomokuStatusUI(msg) {
        const textEl = document.getElementById('gomokuTurnText');
        if (textEl) textEl.textContent = msg;

        const pillLeft = document.getElementById('gomokuPlayerLeft');
        const pillRight = document.getElementById('gomokuPlayerRight');
        const engine = window.gomokuEngine;

        if (pillLeft && pillRight && engine) {
            const isMyTurn = (engine.currentTurn === engine.playerColor);
            if (isMyTurn) {
                pillLeft.classList.add('turn-active');
                pillRight.classList.remove('turn-active');
            } else {
                pillRight.classList.add('turn-active');
                pillLeft.classList.remove('turn-active');
            }
        }
    }

    /**
     * 处理胜负结算
     */
    handleGomokuWin(winner) {
        let msg = '';
        if (winner === 1) msg = '🎉 恭喜黑方获得胜利 (五子连珠)！';
        else if (winner === 2) msg = '🤖 游鲸 AI 棋圣获得胜利！';
        else msg = '🤝 盘满平局！';

        UIRenderer.showToast(msg);
        this.updateGomokuStatusUI(winner === 0 ? '平局 · 请点击【重来一局】' : (winner === 1 ? '黑方胜 · 请点击【重来一局】' : '白方胜 · 请点击【重来一局】'));

        const myColor = window.gomokuEngine ? window.gomokuEngine.playerColor : 1;
        if (typeof AuthEngine !== 'undefined' && AuthEngine.recordGomokuMatchResult) {
            if (winner === 0) {
                AuthEngine.recordGomokuMatchResult(false, true); // 平局
            } else if (winner === myColor) {
                AuthEngine.recordGomokuMatchResult(true, false); // 胜利
            } else {
                AuthEngine.recordGomokuMatchResult(false, false); // 失败
            }

            // 💰 结算五子棋【知因币】 (零分保底，PVE 25% 比例)
            if (AuthEngine.updateCoins) {
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                const ratio = isPve ? 0.25 : 1.0;

                if (winner === myColor) {
                    const totalMoves = window.gomokuEngine ? window.gomokuEngine.moveHistory.length : 20;
                    const quickBonus = (totalMoves <= 15) ? 10 : 0;
                    const winCoins = Math.ceil((30 + quickBonus) * ratio);
                    AuthEngine.updateCoins(winCoins, isPve ? '五子棋切磋胜 (PVE)' : '五子棋胜 (PVP)');
                } else if (winner !== 0) {
                    const loseCoins = -Math.ceil(20 * ratio);
                    AuthEngine.updateCoins(loseCoins, isPve ? '五子棋切磋负 (PVE)' : '五子棋负 (PVP)');
                }

                // ⭐ 结算五子棋【经验值】
                if (AuthEngine.addExp) {
                    const isWin = (winner === myColor);
                    const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                    AuthEngine.addExp(expVal, isPve ? '五子棋切磋 (PVE)' : '五子棋对局 (PVP)');
                }
            }
        }

        // 对局结束：隐藏悔棋按键，开启【重来一局】按键
        const btnUndo = document.getElementById('btnGomokuUndo');
        if (btnUndo) btnUndo.style.display = 'none';

        const btnRematch = document.getElementById('btnGomokuRematch');
        if (btnRematch) {
            btnRematch.style.display = 'flex';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }
    }

    /* ============================================================
       🀄 游鲸麻将 UI 控制与交互逻辑 (Mahjong UI Methods)
       ============================================================ */

    /**
     * 开启单机 AI 游鲸麻将切磋模式
     */
    /* ============================================================
       🀄 游鲸麻将 4人围桌 UI 控制与交互逻辑 (4-Player Table Mahjong UI)
       ============================================================ */

    /**
     * 开启在线多人/补齐 AI 游鲸麻将模式 (真正多人云端同步局)
     */
    startMahjongOnlineGame(roomId, isHost = false) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
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

        const getPlayerNameAtRelativePos = (offset) => {
            const absIdx = (mySlot + offset) % 4;
            const p = players[absIdx];
            const name = p ? (p.isAi ? `🤖 ${p.name}` : p.name) : `AI-${absIdx + 1}`;
            return `${name} (${windNames[absIdx]}风)`;
        };

        if (mNameBottom) mNameBottom.textContent = getPlayerNameAtRelativePos(0);
        if (mNameRight)  mNameRight.textContent  = getPlayerNameAtRelativePos(1);
        if (mNameTop)    mNameTop.textContent    = getPlayerNameAtRelativePos(2);
        if (mNameLeft)   mNameLeft.textContent   = getPlayerNameAtRelativePos(3);

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
                    this.showMahjongSettlement(window.mahjongEngine.winner, null);
                    return;
                }

                const relativeSender = (move.senderSlot - mySlot + 4) % 4;
                if (move.discardedTile) {
                    this.animateTileThrow(move.discardedTile, relativeSender);
                }
                if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playMahjongTile === 'function') {
                    SoundEngine.playMahjongTile();
                }

                const currTurn = window.mahjongEngine.currentTurn;
                const isMyTurnNow = (currTurn === mySlot);

                // 检查我方 (mySlot) 对远程打出的牌是否有 吃/碰/杠/胡 响应
                if (move.discardedTile && move.actionType !== 'CHOW' && move.actionType !== 'PONG' && move.actionType !== 'HU') {
                    const engine = window.mahjongEngine;
                    const isUpperHouse = (move.senderSlot + 1) % 4 === mySlot;
                    const chowOptions = isUpperHouse ? engine.getChowOptions(mySlot, move.discardedTile) : [];
                    const canChow = chowOptions.length > 0;
                    const canPong = engine.checkCanPong(mySlot, move.discardedTile);
                    const canKong = engine.checkCanKong(mySlot, move.discardedTile);
                    const canHu   = engine.checkCanHu(engine.hands[mySlot] || [], move.discardedTile);

                    if (canChow || canPong || canKong || canHu) {
                        this.pendingDiscardRes = {
                            discarded: move.discardedTile,
                            fromPlayer: move.senderSlot,
                            canChow,
                            chowOptions,
                            canPong,
                            canKong,
                            canHu
                        };
                        this.showHumanResponseActionBar(this.pendingDiscardRes);
                        this.updateMahjongStatusUI(`⚠️ 玩家打出 [${move.discardedTile.name}]：请选择【吃 / 碰 / 杠 / 胡 / 过】`);
                        return;
                    }
                }

                if (isMyTurnNow) {
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
    }

    /**
     * 开启正宗 4 人围桌游鲸麻将模式 (单机 AI / 线上)
     */
    startMahjongAiMode() {
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
    }

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
        if (btnHu) btnHu.onclick = () => this.handleMahjongHuClick();
        if (btnPass) btnPass.onclick = () => this.handleMahjongPassClick();
    }

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
    }

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
    }

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
    }

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
        const isMyTurnAndDrawn = (engine.currentTurn === mySlot && myHand.length % 3 === 2);

        myHand.forEach((tile, index) => {
            const card = document.createElement('div');
            card.className = 'mahjong-tile-card';
            card.dataset.tileId = tile.id || `${tile.type}_${tile.num}_${index}`;
            card.dataset.index = index;

            // 🀄 摸牌位：若轮到我方且有 14 张牌（或吃碰杠后 4/7/10/14 张），最右侧最后一张为摸牌位，离左侧手牌空开间隔
            if (isMyTurnAndDrawn && index === myHand.length - 1) {
                card.classList.add('is-drawn-tile');
            }

            if (this.selectedMahjongTileIndex === index) {
                card.classList.add('selected');
            }
            card.innerHTML = this.getMahjongTileFaceHTML(tile);

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
    }

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
    }

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
    }

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
    }

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

        meldMap.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                const list = engine.melds[item.idx] || [];
                el.innerHTML = list.map(m => {
                    const tilesHtml = m.tiles.map(t => `<div class="meld-tile">${this.getMahjongTileFaceHTML(t)}</div>`).join('');
                    return `<div class="meld-group">${tilesHtml}</div>`;
                }).join('');
            }
        });
    }

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
    }

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
    }

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
    }

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

        this._mahjongTimerSeconds = 25;
        if (timerEl) {
            timerEl.textContent = '25';
            timerEl.classList.remove('urgent');
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

            if (this._mahjongTimerSeconds <= 0) {
                clearInterval(this._mahjongTimerInterval);
                this._mahjongTimerInterval = null;

                // 超时托管判定
                if (this.pendingDiscardRes) {
                    // 吃碰杠胡响应超时 -> 自动过牌
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
    }

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

        // 每次状态更新重新启动 25 秒倒计时
        this.resetMahjongTurnTimer();
    }

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
     */
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

        if (res.nextPlayer !== undefined && !res.isGameOver) {
            this.animateTileDraw(res.nextPlayer, engine.lastDrawnTile);
        }

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
    }

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

                // 检查我方 (Seat 0) 对 AI 打出的牌是否有 碰/杠/吃/胡 响应
                if (aiRes && (aiRes.canHu || aiRes.canPong || aiRes.canKong || aiRes.canChow)) {
                    this.pendingDiscardRes = aiRes;
                    this.showHumanResponseActionBar(aiRes);
                    this.updateMahjongStatusUI('⚠️ 可响应出牌：请选择【吃 / 碰 / 杠 / 胡 / 过】');
                    // 联机多人局：房主 5 秒内未响应则自动过牌，防止 AI 回合被永久卡住
                    if (!NetworkManager.isAiMode) {
                        if (this._mahjongResponseTimer) clearTimeout(this._mahjongResponseTimer);
                        this._mahjongResponseTimer = setTimeout(() => {
                            if (this.pendingDiscardRes) {
                                this.handleMahjongPassClick();
                            }
                        }, 5000);
                    }
                    return;
                }

                // 轮到下一家摸牌与打牌
                if (engine.currentTurn !== mySlot) {
                    this.animateTileDraw(engine.currentTurn, engine.lastDrawnTile);
                    this.triggerAiTurnLoop();
                } else {
                    this.animateTileDraw(mySlot, engine.lastDrawnTile);
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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    /**
     * 点击【过】按钮逻辑
     */
    handleMahjongPassClick() {
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }
        const actionBar = document.getElementById('mahjongActionBar');
        if (actionBar) actionBar.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';

        const engine = window.mahjongEngine;
        if (!engine) return;

        if (this.pendingDiscardRes) {
            this.pendingDiscardRes = null;
            // 跳过我方响应，继续 AI 轮转
            if (engine.currentTurn !== 0) {
                this.triggerAiTurnLoop();
            } else {
                this.updateMahjongStatusUI('🀄 轮到你出牌');
            }
        }
    }

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
        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
        const ratio = isPve ? 0.25 : 1.0;
        const fanCount = (huDetails && huDetails.fanCount) ? huDetails.fanCount : 1;
        const baseAmount = 100 * fanCount;
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
                // 自摸：其余 3 家平摊 (三家分包)
                const perPlayerLoss = Math.ceil(winAmount / 3);
                for (let i = 0; i < 4; i++) {
                    if (i !== winnerIdx) {
                        coinDiffs[i] = -perPlayerLoss;
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

    /**
     * 刷新并渲染云端公共房间大厅列表
     */
    refreshPublicRoomsList(gameType = 'DOUDIZHU') {
        const container = document.getElementById('publicRoomsListContainer');
        if (!container) return;

        const isMahjong = gameType === 'MAHJONG';
        const isGomoku  = gameType === 'GOMOKU';
        const totalSeats = isMahjong ? 4 : (isGomoku ? 2 : 3);
        const gameName   = isMahjong ? '游鲸麻将' : (isGomoku ? '五子棋' : '斗地主');

        const modalTitle = document.querySelector('#publicRoomsModal .ct-title');
        if (modalTitle) {
            modalTitle.innerHTML = isMahjong ?
                '<i class="fa-solid fa-square-full" style="color:#34d399;"></i> 在线游鲸麻将大厅' :
                (isGomoku ?
                '<i class="fa-solid fa-chess-board" style="color:#34d399;"></i> 在线五子棋对局大厅' :
                '<i class="fa-solid fa-list-check" style="color:#e2a820;"></i> 在线房间大厅');
        }

        container.innerHTML = `<div style="text-align:center;color:${isMahjong || isGomoku ? '#34d399' : '#94a3b8'};padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 正在拉取${gameName}在线房间...</div>`;

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
                if (phase === 'PLAYING') { phaseText = isMahjong ? '🀄 雀局进行中' : (isGomoku ? '♟️ 棋局进行中' : '🔴 打牌进行中'); phaseClass = 'playing'; }
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

        const menuBtnHelp = document.getElementById('menuBtnCardHelp');
        const menuBtnLeave = document.getElementById('menuBtnLeaveRoom');
        const brandTitle = document.getElementById('appHeaderBrandTitle');

        const isMahjongScreen = mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none');
        const isGomokuScreen  = gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none');
        const isLobbyScreen   = lobbyScr && (lobbyScr.classList.contains('active') || lobbyScr.style.display !== 'none');

        // 动态更换 Header 左上角游戏品牌标题 (游鲸斗地主 <-> 游鲸五子棋 <-> 游鲸麻将)
        if (brandTitle) {
            if (isMahjongScreen || (isLobbyScreen && this.activeGameType === 'MAHJONG')) {
                brandTitle.textContent = '游鲸麻将';
            } else if (isGomokuScreen || (isLobbyScreen && this.activeGameType === 'GOMOKU')) {
                brandTitle.textContent = '游鲸五子棋';
            } else {
                brandTitle.textContent = '游鲸斗地主';
            }
        }

        // 五子棋界面或五子棋大厅时隐藏“牌型说明”
        if (menuBtnHelp) {
            menuBtnHelp.style.display = (isGomokuScreen || (isLobbyScreen && this.activeGameType === 'GOMOKU')) ? 'none' : 'flex';
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
        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isMahjong) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';
        } else if (isGomoku) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';
        }

        // 客户端监听房主开启五子棋 / 麻将对局信号，全员同步进入游戏！
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
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isGomoku) {
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
    }

    /**
     * 启动单机练习模式 (对战 2 个 AI 机器人)
     */
    startAiGame(nickname) {
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        this.gameState.players[0] = { id: 0, name: nickname, hand: [], isAi: false, isHost: true, role: 'FARMER', passedBid: false };
        this.gameState.players[1] = { id: 1, name: 'AI-1', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };
        this.gameState.players[2] = { id: 2, name: 'AI-2', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };

        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.startNewRound();
    }

    /**
     * 重新回到初始大厅 (安全退房、清除URL邀请参数、切回主页屏幕)
     */
    resetToLobby() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        const gomokuScr  = document.getElementById('gomokuGameScreen');
        const isMahjongExit = (this.activeGameType === 'MAHJONG') || (mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none'));
        const isGomokuExit  = (this.activeGameType === 'GOMOKU') || (gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none'));

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
        if (mahjongScr)    { mahjongScr.style.display = 'none'; mahjongScr.classList.remove('active'); }
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

        // 如果是从麻将/五子棋退出的，退回主页时自动切为对应的麻将/五子棋主页 Tab
        if (isMahjongExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('MAHJONG');
        } else if (isGomokuExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('GOMOKU');
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

        UIRenderer.showToast('已成功退出并安全返回主页大厅');
    }

    /**
     * 开始新一局 (洗牌、发牌、全员就位加载完毕后展开 3秒倒计时 + 动态进度条)
     */
    startNewRound() {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
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
    }

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
    }

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
    }

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
    }

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
    }

    /**
     * 响应玩家（自己或远程客户端）的点击动作
     */
    handleSelfAction(actionType, payload) {
        NetworkManager.sendActionToHost(actionType, payload);
    }

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
    }

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
    }

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
        if (!player || player.passedBid) return; // 已退出的玩家不能再操作

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
    }

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
    }

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
    }

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
                        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
}

// 挂载引擎单例
window.GameEngine = new GameEngineController();
document.addEventListener('DOMContentLoaded', () => {
    window.GameEngine.init();
});
