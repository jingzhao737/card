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
            NetworkManager.createRoom(nickname, (roomId) => {
                this.setupWaitingScreen(roomId);
            });
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

        // 在线公共房间大厅 (斗地主 & 五子棋)
        const btnPublicRooms       = document.getElementById('btnPublicRooms');
        const btnPublicGomokuRooms = document.getElementById('btnPublicGomokuRooms');
        const publicModal          = document.getElementById('publicRoomsModal');
        const closePublic          = document.getElementById('btnClosePublicRooms');
        const refreshPublic        = document.getElementById('btnRefreshPublicRooms');

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

        // 多游戏大厅切换 (斗地主 <-> 五子棋)
        const btnNavDoudizhu = document.getElementById('btnNavDoudizhu');
        const btnNavGomoku   = document.getElementById('btnNavGomoku');
        const cardDoudizhu   = document.getElementById('doudizhuLobbyCard');
        const cardGomoku     = document.getElementById('gomokuLobbyCard');

        const switchGameLobby = (gameType) => {
            if (gameType === 'GOMOKU') {
                document.body.classList.add('theme-gomoku');
                if (btnNavGomoku)   btnNavGomoku.classList.add('active');
                if (btnNavDoudizhu) btnNavDoudizhu.classList.remove('active');
                if (cardDoudizhu)   cardDoudizhu.style.display = 'none';
                if (cardGomoku)     cardGomoku.style.display = 'block';
            } else {
                document.body.classList.remove('theme-gomoku');
                if (btnNavDoudizhu) btnNavDoudizhu.classList.add('active');
                if (btnNavGomoku)   btnNavGomoku.classList.remove('active');
                if (cardGomoku)     cardGomoku.style.display = 'none';
                if (cardDoudizhu)   cardDoudizhu.style.display = 'block';
            }
        };

        if (btnNavDoudizhu) btnNavDoudizhu.addEventListener('click', () => switchGameLobby('DOUDIZHU'));
        if (btnNavGomoku)   btnNavGomoku.addEventListener('click', () => switchGameLobby('GOMOKU'));

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
                NetworkManager.createRoom(nickname, (roomId) => {
                    UIRenderer.showToast(`✅ 五子棋在线房间创建成功：#${roomId}`);
                    this.startGomokuAiMode();
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
                    this.startGomokuAiMode();
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

        // 五子棋对局控制按钮 (悔棋 / 重开 / 退出)
        const btnGomokuUndo = document.getElementById('btnGomokuUndo');
        const btnGomokuRestart = document.getElementById('btnGomokuRestart');
        const btnGomokuExit = document.getElementById('btnGomokuExit');

        if (btnGomokuUndo) {
            btnGomokuUndo.addEventListener('click', () => {
                if (window.gomokuEngine) {
                    window.gomokuEngine.undo();
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('已撤回，黑方落子中');
                }
            });
        }

        if (btnGomokuRestart) {
            btnGomokuRestart.addEventListener('click', () => {
                if (window.gomokuEngine) {
                    window.gomokuEngine.reset(true, 1);
                    this.initGomokuUI();
                    this.updateGomokuStatusUI('重新开始，黑方落子中');
                }
            });
        }

        if (btnGomokuExit) {
            btnGomokuExit.addEventListener('click', () => {
                const gomokuScr = document.getElementById('gomokuGameScreen');
                if (gomokuScr) {
                    gomokuScr.style.display = 'none';
                    gomokuScr.classList.remove('active');
                }
                this.resetToLobby();
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
                this.openStatsModal('LEADERBOARD');
            });
        }
        if (menuBtnHelp) {
            menuBtnHelp.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                const modal = document.getElementById('cardTypeModal');
                if (modal) modal.style.display = 'flex';
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

        // 补齐机器人开局 (null-safe)
        const _btnStartWithAi = document.getElementById('btnStartWithAi');
        if (_btnStartWithAi) _btnStartWithAi.addEventListener('click', () => this.fillAiAndStart());

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

        // 房主手动点击开始游戏（自动补齐空位为 AI）(null-safe)
        const _btnStartGame = document.getElementById('btnStartGame');
        if (_btnStartGame) _btnStartGame.addEventListener('click', () => this.fillAiAndStart());

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
                cardTypeModal.style.display = 'flex';
            });
            closeCardType.addEventListener('click', () => {
                cardTypeModal.style.display = 'none';
            });
            // 点击遮罩层外部关闭
            cardTypeModal.addEventListener('click', (e) => {
                if (e.target === cardTypeModal) cardTypeModal.style.display = 'none';
            });
        }


        // 按钮组事件绑定 (抢手速叫地主/不叫/出牌/不出/提示)
        const bidLandlordBtn = document.getElementById('btnBidLandlord');
        if (bidLandlordBtn) bidLandlordBtn.addEventListener('click', () => this.handleSelfAction('BID', 'CLAIM'));

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

        const hero = document.getElementById('userProfileHero');
        if (hero) {
            hero.innerHTML = `
                <div class="profile-top" style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div class="profile-avatar-big" id="btnChangeAvatar" title="点击更换头像" style="cursor:pointer;position:relative;">
                        <span>${data.avatar || '🤠'}</span>
                        <div style="position:absolute;bottom:-2px;right:-2px;font-size:0.6rem;background:#ffd700;color:#000;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-pen"></i></div>
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

                <!-- 头像选择框 (点击头像展开/关闭) -->
                <div id="avatarPickerBox" style="display:none;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:8px;margin:8px 0 4px;">
                    <div style="font-size:0.75rem;color:#ffd700;margin-bottom:6px;font-weight:700;">点击更换头像：</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                        ${avatarList.map(a => `<span class="avatar-opt" data-avatar="${a}" style="font-size:1.5rem;cursor:pointer;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);">${a}</span>`).join('')}
                    </div>
                </div>

                <div class="profile-grid" style="margin-top:10px;">
                    <div class="profile-stat-box">
                        <div class="stat-val" style="color:#ffd700;">🪙 ${currentYin}</div>
                        <div class="stat-lbl">知因币</div>
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
     * 渲染个人简略战绩与最近10场对局记录 (无头像、无资产等冗余信息)
     */
    renderDetailedStatsView() {
        const container = document.getElementById('userDetailedStatsHero');
        if (!container) return;

        const data = AuthEngine.userData || {
            nickname: localStorage.getItem('youjing_doudizhu_nickname') || '游客玩家',
            totalGames: 0,
            wins: 0,
            landlordWins: 0,
            farmerWins: 0,
            matchHistory: []
        };

        const total = data.totalGames || 0;
        const wins = data.wins || 0;
        const losses = Math.max(0, total - wins);
        const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0.0%';
        const landlordWins = data.landlordWins || 0;
        const farmerWins = data.farmerWins || 0;

        // 生成或读取最近10场对局历史
        let historyList = Array.isArray(data.matchHistory) && data.matchHistory.length > 0 ? data.matchHistory : [];
        if (historyList.length === 0 && total > 0) {
            for (let i = 0; i < Math.min(total, 10); i++) {
                const isW = i < wins;
                historyList.push({
                    id: Date.now() - i * 600000,
                    isWin: isW,
                    role: i % 2 === 0 ? '资本家' : '牛马',
                    multiplier: (i % 3 + 1) * 2,
                    time: `${String(18 - (i % 10)).padStart(2, '0')}:${String(10 + i * 5).padStart(2, '0')}`
                });
            }
        }

        const historyHtml = historyList.length > 0 ? historyList.slice(0, 10).map((m) => {
            const isWin = m.isWin;
            const resStyle = isWin ? 'color:#00e676;background:rgba(0,230,118,0.12);border-color:rgba(0,230,118,0.3);' : 'color:#ff2a2a;background:rgba(255,42,42,0.12);border-color:rgba(255,42,42,0.3);';
            const roleBadge = m.role;
            return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;font-size:0.78rem;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-weight:800;padding:1px 6px;border-radius:3px;border:1px solid;${resStyle}">
                            ${isWin ? '胜利' : '失败'}
                        </span>
                        <span style="color:#e2e8f0;font-weight:700;">${roleBadge}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;color:#94a3b8;font-size:0.74rem;">
                        <span>${m.multiplier || 2}倍局</span>
                        <span>${m.time || '12:00'}</span>
                    </div>
                </div>
            `;
        }).join('') : `<div style="text-align:center;color:#94a3b8;padding:24px 10px;font-size:0.78rem;">暂无最近对局记录，快去完成第一局游戏吧！</div>`;

        container.innerHTML = `
            <!-- 顶部极简数据网格 (无头像、无资产) -->
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;">
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#ffffff;">${winRate}</div>
                    <div class="stat-lbl">综合胜率</div>
                </div>
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#00e676;">${wins} 胜</div>
                    <div class="stat-lbl">胜场次数</div>
                </div>
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#ff2a2a;">${losses} 败</div>
                    <div class="stat-lbl">败场次数</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:2px;">
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#ffffff;">${total}</div>
                    <div class="stat-lbl">总对局数</div>
                </div>
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#ffffff;">${landlordWins}</div>
                    <div class="stat-lbl">资本家胜场</div>
                </div>
                <div class="profile-stat-box">
                    <div class="stat-val" style="color:#ffffff;">${farmerWins}</div>
                    <div class="stat-lbl">牛马胜场</div>
                </div>
            </div>

            <!-- 下方下滑滚动展示：最近 10 场对局基础记录 -->
            <div style="margin-top:10px;">
                <div style="font-size:0.78rem;font-weight:800;color:#ffd700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <i class="fa-solid fa-clock-rotate-left"></i> 最近 10 场对局记录
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;padding-right:2px;">
                    ${historyHtml}
                </div>
            </div>
        `;
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

        boardContainer.innerHTML = '';
        const starPoints = ['3,3', '3,11', '7,7', '11,3', '11,11']; // 15x15 盘面星位与天元

        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                const cell = document.createElement('div');
                cell.className = 'gomoku-cell';
                if (starPoints.includes(`${r},${c}`)) {
                    cell.classList.add('star-point');
                }
                if (r === 0)  cell.classList.add('row-top');
                if (r === 14) cell.classList.add('row-bottom');
                if (c === 0)  cell.classList.add('col-left');
                if (c === 14) cell.classList.add('col-right');

                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.addEventListener('click', () => this.handleGomokuCellClick(r, c));
                boardContainer.appendChild(cell);
            }
        }
    }

    /**
     * 开启单机 AI 五子棋切磋模式
     */
    startGomokuAiMode() {
        const lobbyScr = document.getElementById('lobbyScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');
        if (lobbyScr) {
            lobbyScr.style.display = 'none';
            lobbyScr.classList.remove('active');
        }
        if (gomokuScr) {
            gomokuScr.style.display = 'flex';
            gomokuScr.classList.add('active');
        }
        this.updateHeaderVisibility();

        const nick = (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';
        const nameBlack = document.getElementById('gNameBlack');
        const nameWhite = document.getElementById('gNameWhite');
        if (nameBlack) nameBlack.textContent = `${nick} (黑方)`;
        if (nameWhite) nameWhite.textContent = 'AI 棋圣 (白方)';

        window.gomokuEngine.reset(true, 1); // 玩家先手执黑
        this.initGomokuUI();
        this.renderGomokuBoard();
        this.updateGomokuStatusUI('黑方落子中 (你)');
        UIRenderer.showToast('🟢 游鲸五子棋对局开始！你是先手黑棋');
    }

    /**
     * 处理五子棋棋盘单元格点击落子
     */
    handleGomokuCellClick(r, c) {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) return; // 轮到 AI 落子

        const res = engine.placeStone(r, c);
        if (!res || !res.success) return;

        this.renderGomokuBoard();

        if (res.isGameOver) {
            this.handleGomokuWin(res.winner);
            return;
        }

        // 若为单机 AI 模式，触发 AI 落子
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            this.updateGomokuStatusUI('AI 棋圣思考中...');
            setTimeout(() => {
                const aiMove = engine.getBestAiMove();
                if (aiMove) {
                    const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                    this.renderGomokuBoard();
                    if (aiRes && aiRes.isGameOver) {
                        this.handleGomokuWin(aiRes.winner);
                    } else {
                        this.updateGomokuStatusUI('黑方落子中 (你)');
                    }
                }
            }, 350);
        } else {
            this.updateGomokuStatusUI(engine.currentTurn === 1 ? '黑方落子中' : '白方落子中');
        }
    }

    /**
     * 重新渲染盘面棋子
     */
    renderGomokuBoard() {
        const engine = window.gomokuEngine;
        if (!engine) return;

        // 播放真实物理落子音效
        if (typeof audioSynth !== 'undefined' && audioSynth.playStoneDrop) {
            audioSynth.playStoneDrop();
        }

        const winNodes = engine.winLine || [];
        const cells = document.querySelectorAll('.gomoku-cell');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const val = engine.board[r][c];

            cell.innerHTML = ''; // 清理旧棋子

            if (val !== 0) {
                const stone = document.createElement('div');
                stone.className = `gomoku-stone ${val === 1 ? 'black' : 'white'}`;
                if (engine.lastMove && engine.lastMove.r === r && engine.lastMove.c === c) {
                    stone.classList.add('last-move');
                }
                const isWinStone = winNodes.some(n => n.r === r && n.c === c);
                if (isWinStone) {
                    stone.classList.add('win-stone');
                }
                cell.appendChild(stone);
            }
        });
    }

    /**
     * 更新顶部对局状态指示
     */
    updateGomokuStatusUI(msg) {
        const textEl = document.getElementById('gomokuTurnText');
        if (textEl) textEl.textContent = msg;
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
        this.updateGomokuStatusUI(winner === 0 ? '平局' : (winner === 1 ? '黑方胜' : '白方胜'));
    }

    /**
     * 刷新并渲染云端公共房间大厅列表
     */
    refreshPublicRoomsList(gameType = 'DOUDIZHU') {
        const container = document.getElementById('publicRoomsListContainer');
        if (!container) return;

        const isGomoku = gameType === 'GOMOKU';
        const modalTitle = document.querySelector('#publicRoomsModal .ct-title');
        if (modalTitle) {
            modalTitle.innerHTML = isGomoku ?
                '<i class="fa-solid fa-chess-board" style="color:#34d399;"></i> 在线五子棋对局大厅' :
                '<i class="fa-solid fa-list-check" style="color:#e2a820;"></i> 在线房间大厅';
        }

        container.innerHTML = `<div style="text-align:center;color:${isGomoku ? '#34d399' : '#94a3b8'};padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 正在拉取${isGomoku ? '五子棋' : '斗地主'}在线房间...</div>`;

        NetworkManager.fetchPublicRooms((rooms) => {
            container.innerHTML = '';

            if (!rooms || rooms.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;color:#94a3b8;padding:36px 10px;font-size:0.88rem;">
                        <i class="fa-solid fa-ghost" style="font-size:2rem;margin-bottom:10px;color:#a07840;display:block;"></i>
                        <div>当前暂无活跃公开房间</div>
                        <div style="font-size:0.75rem;margin-top:6px;color:#64748b;">快去点击【创建房间】建立第一个对局吧！</div>
                    </div>
                `;
                return;
            }

            rooms.forEach(room => {
                const rId = room.roomId;
                const phase = (room.gameState && room.gameState.phase) ? room.gameState.phase : 'WAITING';
                const lobby = room.lobbyData || { players: [] };
                const players = lobby.players || [];

                let phaseText = '🟢 等待开局';
                let phaseClass = 'waiting';
                if (phase === 'BIDDING') { phaseText = '🟡 抢地主中'; phaseClass = 'bidding'; }
                if (phase === 'PLAYING') { phaseText = '🔴 打牌进行中'; phaseClass = 'playing'; }
                if (phase === 'GAMEOVER') { phaseText = '🎉 对局刚结束'; phaseClass = 'waiting'; }

                // 计算真人数量与 AI 数量
                const humanPlayers = players.filter(p => p && !p.isAi && p.name);
                const aiCount = 3 - humanPlayers.length;

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
     * 根据当前界面 (大厅 / 游戏房) 动态切换顶部 app-header 可见性
     * 主页大厅时彻底隐藏 app-header 导航条，进入房间或打牌时恢复显示
     */
    updateHeaderVisibility() {
        const appHeader = document.querySelector('.app-header');
        const lobbyScr = document.getElementById('lobbyScreen');
        if (!appHeader) return;

        if (lobbyScr && (lobbyScr.classList.contains('active') || lobbyScr.style.display !== 'none')) {
            appHeader.style.display = 'none';
            appHeader.classList.add('in-lobby');
        } else {
            appHeader.style.display = 'flex';
            appHeader.classList.remove('in-lobby');
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

        // 立即展示空位为 AI 机器人
        this._fillSlotWithAi(1);
        this._fillSlotWithAi(2);

        // 房主始终可以直接开始
        const btnStart = document.getElementById('btnStartGame');
        const btnAi = document.getElementById('btnStartWithAi');
        if (btnStart) btnStart.style.display = 'block';
        if (btnAi) btnAi.style.display = 'none';

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
        this.gameState.players[slotIndex].name = aiName;
        this.gameState.players[slotIndex].avatar = '🤖';
        this.gameState.players[slotIndex].isAi = true;

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
        const myIndex = NetworkManager.myPlayerIndex;

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
        this._stopKeepAlive();
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

        // 4. 界面瞬间平滑切回大厅 Screen (无需刷新网页)
        const waitingScreen = document.getElementById('waitingScreen');
        const gameTable     = document.getElementById('gameTable');
        const gameOverModal = document.getElementById('gameOverModal');
        const lobbyScreen   = document.getElementById('lobbyScreen');
        const roomInfoBar   = document.getElementById('roomInfoBar');
        const btnLeaveRoom  = document.getElementById('btnLeaveRoom');
        const btnGoHomeTop  = document.getElementById('btnGoHomeTop');

        if (waitingScreen) { waitingScreen.style.display = 'none'; waitingScreen.classList.remove('active'); }
        if (gameTable)     gameTable.style.display = 'none';
        if (gameOverModal) gameOverModal.style.display = 'none';
        if (roomInfoBar)   roomInfoBar.style.display = 'none';
        if (btnLeaveRoom)  btnLeaveRoom.style.display = 'none';
        if (btnGoHomeTop)  btnGoHomeTop.style.display = 'none';
        const menuLeaveBtn3 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn3) menuLeaveBtn3.style.display = 'none';

        if (lobbyScreen) {
            lobbyScreen.style.display = 'flex';
            lobbyScreen.classList.add('active');
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

        // 1. 生成洗牌
        const deck = DouDizhuRules.shuffle(DouDizhuRules.createDeck());

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
        this.gameState.recentPlays = { 0: null, 1: null, 2: null };
        this.gameState.multiplier = 1;
        this.gameState.winnerIndex = -1;
        this.gameState.readyPlayers = [false, false, false];

        this._hasPlayedSortSoundThisRound = false;

        // 先标记开局倒计时状态，再广播，确保客户端收到时能触发倒计时动画
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

        let elapsed = 0;
        const totalDuration = 3000; // 3.0 秒
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

        clearInterval(this._startCountdownTimer);
        this._startCountdownTimer = setInterval(() => {
            elapsed += step;

            const remainingSecs = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
            updateLights(remainingSecs);

            if (elapsed >= totalDuration) {
                clearInterval(this._startCountdownTimer);
                this._isCountingDownLocally = false;
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    if (NetworkManager.isHost) {
                        this.gameState.isOpeningCountdown = false;
                        NetworkManager.broadcastState(this.gameState); // 倒计时结束，同步状态解锁大家的操作按钮
                    }
                    this.updateControlButtons(NetworkManager.myPlayerIndex);
                    UIRenderer.showToast('🔥 3秒到！手速抢地主开始！');
                    SoundEngine.playBid();

                    // 如果是单机人机模式，AI 随机模拟拉长延迟以防抢不过玩家
                    if (NetworkManager.isHost && NetworkManager.isAiMode) {
                        this.scheduleAiBids();
                    }
                }, 200);
            }
        }, step);
    }

    /**
     * AI 单机模式下的手速叫牌模拟
     */
    scheduleAiBids() {
        [1, 2].forEach(aiIdx => {
            const delay = 2200 + Math.random() * 2600; // 给玩家留出 2 秒以上的抢按时间
            setTimeout(() => {
                if (this.gameState.phase === 'BIDDING' && !this.gameState.players[aiIdx].passedBid) {
                    // AI 有 40% 几率抢叫，60% 几率放弃不叫
                    const willClaim = Math.random() < 0.4;
                    this.processBid(aiIdx, willClaim ? 'CLAIM' : 'PASS');
                    NetworkManager.broadcastState(this.gameState);
                }
            }, delay);
        });
    }

    /**
     * 收到服务端/全网同步状态时的 UI 刷新入口
     */
    onReceiveStateUpdate(state) {
        this.gameState = state;
        const myIndex = NetworkManager.myPlayerIndex;
        const rel = UIRenderer.getRelativePlayerIndices(myIndex);

        // 如果游戏已经开始（叫牌/打牌阶段），确保手机客户端也自动切入牌桌界面！
        if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
            document.getElementById('lobbyScreen').classList.remove('active');
            document.getElementById('lobbyScreen').style.display = 'none';
            document.getElementById('waitingScreen').style.display = 'none';
            document.getElementById('gameOverModal').style.display = 'none';
            document.getElementById('gameTable').style.display = 'grid';
            const btnLeave = document.getElementById('btnLeaveRoom');
            if (btnLeave) btnLeave.style.display = 'inline-flex';
            const btnGoHomeTop = document.getElementById('btnGoHomeTop');
            if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';
            const menuLeave = document.getElementById('menuBtnLeaveRoom');
            if (menuLeave) menuLeave.style.display = 'flex';
        }

        // 客户端如果收到开局倒计时状态且本地未在倒数，则触发本地视觉倒计时
        if (this.gameState.isOpeningCountdown && !this._isCountingDownLocally) {
            this.startOpeningCountdown();
        }

        // 1. 顶部底牌与倍数
        const isBottomRevealed = this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER';
        UIRenderer.renderBottomCards(this.gameState.bottomCards, isBottomRevealed);
        const multEl = document.getElementById('gameMultiplier');
        if (multEl) multEl.textContent = `x${this.gameState.multiplier}`;

        // 2. 玩家面板信息 (头像/名字/剩余手牌)
        document.getElementById('nameSelf').textContent = this.gameState.players[rel.self].name;
        document.getElementById('nameLeft').textContent = this.gameState.players[rel.left].name;
        document.getElementById('nameRight').textContent = this.gameState.players[rel.right].name;

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

        renderSeatAvatar('avatarSelf', this.gameState.players[rel.self].avatar || (AuthEngine.userData ? AuthEngine.userData.avatar : '🤠'), this.gameState.players[rel.self].isAi);
        renderSeatAvatar('avatarLeft', this.gameState.players[rel.left].avatar, this.gameState.players[rel.left].isAi);
        renderSeatAvatar('avatarRight', this.gameState.players[rel.right].avatar, this.gameState.players[rel.right].isAi);

        document.getElementById('cardCountLeft').querySelector('.count').textContent = this.gameState.players[rel.left].hand.length;
        document.getElementById('cardCountRight').querySelector('.count').textContent = this.gameState.players[rel.right].hand.length;

        // 3. 身份徽章标识 (抢地主结束后，在每个人ID左侧高亮放置【👑 地主】或【🌾 农民】徽章)
        const isBiddingDone = (this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER');
        const landlordIdx = this.gameState.landlordIndex;

        const updateRoleBadge = (badgeId, playerIdx) => {
            const el = document.getElementById(badgeId);
            if (!el) return;
            if (isBiddingDone && landlordIdx !== -1) {
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
            if (!isBiddingDone || landlordIdx === -1) {
                // 叫分叫牌阶段隐藏编号
                Object.values(badges).forEach(b => { if (b) b.style.display = 'none'; });
                return;
            }

            const setNum = (badgeId, absIdx) => {
                const el = document.getElementById(badgeId);
                if (!el) return;
                // 出牌顺序：资本家固定为 1，顺时针下家为 2，顺时针上家为 3
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

        const myHand = this.gameState.players[myIndex].hand || [];
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
                    const winnerRole = (this.gameState.players[winnerIdx]) ? this.gameState.players[winnerIdx].role : 'FARMER';
                    const myRole = (this.gameState.players[myIndex]) ? this.gameState.players[myIndex].role : 'FARMER';
                    const isWin = (winnerIdx === myIndex) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                    AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);
                }
            }

            if (this.turnTimerInterval) {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
            }

            // 房主主导：确保 AI 机器人自动标记就绪
            if (NetworkManager.isHost) {
                if (!this.gameState.readyPlayers) this.gameState.readyPlayers = [false, false, false];
                this.gameState.players.forEach((p, idx) => {
                    if (p.isAi) this.gameState.readyPlayers[idx] = true;
                });
            }

            const victoryBox = document.getElementById('victoryBannerBox');
            if (victoryBox) {
                victoryBox.style.display = 'flex';
                const winner = this.gameState.players[this.gameState.winnerIndex];
                const isLandlordWin = (winner && winner.role === 'LANDLORD');

                let titleText = isLandlordWin ? '资本家胜利！' : '牛马胜利！';
                let winnerDesc = '';
                if (isLandlordWin) {
                    winnerDesc = `资本家【${winner.name}】独占鳌头`;
                } else {
                    const farmers = this.gameState.players.filter(p => p.role === 'FARMER').map(p => p.name).join(' & ');
                    winnerDesc = `牛马【${farmers}】联手翻盘`;
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
            UIRenderer.renderOpenHand('playedSelf', this.gameState.players[rel.self].hand || []);
            UIRenderer.renderOpenHand('playedLeft', this.gameState.players[rel.left].hand || []);
            UIRenderer.renderOpenHand('playedRight', this.gameState.players[rel.right].hand || []);
        } else {
            const bWrap = document.getElementById('bottomCardsWrapper');
            if (bWrap) bWrap.style.display = 'flex';
            const vBox = document.getElementById('victoryBannerBox');
            if (vBox) {
                vBox.style.display = 'none';
                delete vBox.dataset.minimized;
            }

            const recent = this.gameState.recentPlays || {};
            const selfPlay = recent[rel.self];
            const leftPlay = recent[rel.left];
            const rightPlay = recent[rel.right];

            UIRenderer.renderPlayedCards('playedSelf', selfPlay ? selfPlay.cards : [], selfPlay ? selfPlay.isLatest : false);
            UIRenderer.renderPlayedCards('playedLeft', leftPlay ? leftPlay.cards : [], leftPlay ? leftPlay.isLatest : false);
            UIRenderer.renderPlayedCards('playedRight', rightPlay ? rightPlay.cards : [], rightPlay ? rightPlay.isLatest : false);

            this._hasSettledThisRound = false;
        }

        // 6. 思考出牌/叫地主文本提示与头像高亮
        const currentTurnIdx = this.gameState.currentTurn;
        const currentTurnPlayer = this.gameState.players[currentTurnIdx];
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
            UIRenderer.updateTurnIndicator(this.gameState.currentTurn, myIndex, this.timerSeconds);
        }


        // 8. 处理 AI 或当前回合的自动触发 (如果是房主)
        if (NetworkManager.isHost && this.gameState.phase !== 'GAMEOVER') {
            this.checkAiTurn();
        }

        // 9. 结算处理
        if (this.gameState.phase === 'GAMEOVER') {
            this.showGameOverModal();
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
            const isOpeningCountdown = !!this.gameState.isOpeningCountdown;
            const hasPassed = myPlayer && myPlayer.passedBid;

            const passBtn = document.getElementById('btnBidPass');
            const landlordBtn = document.getElementById('btnBidLandlord');

            if (isOpeningCountdown || hasPassed) {
                // 3秒倒计时中，或者已经放弃的玩家，置灰按钮
                if (passBtn) { passBtn.disabled = true; passBtn.classList.add('disabled'); }
                if (landlordBtn) { landlordBtn.disabled = true; landlordBtn.classList.add('disabled'); }
            } else {
                // 倒计时结束，全员拼手速！
                if (passBtn) { passBtn.disabled = false; passBtn.classList.remove('disabled'); }
                if (landlordBtn) { landlordBtn.disabled = false; landlordBtn.classList.remove('disabled'); }
            }
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
     * 处理抢手速叫地主逻辑
     */
    processBid(playerIndex, action) {
        if (this.gameState.phase !== 'BIDDING') return;

        // 如果处于 3 秒开局倒计时中，拒绝任何叫牌操作
        if (this.gameState.isOpeningCountdown) return;

        const player = this.gameState.players[playerIndex];
        if (!player || player.passedBid) return; // 已经不叫退出的玩家不能再叫

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        if (action === 'CLAIM' || action === 1 || action === 2 || action === 3) {
            // 谁先点击到了【叫地主】，谁就瞬间成为地主！
            SoundEngine.playBid();
            UIRenderer.showBubble(bubbleTarget, '👑 叫地主！');
            UIRenderer.showToast(`👑 ${player.name} 手速拔得头筹，成功抢到地主！`);
            this.finalizeLandlord(playerIndex);
            return;
        } else if (action === 'PASS' || action === 0) {
            // 玩家点击【不叫】，退出叫地主
            player.passedBid = true;
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '不叫');
            UIRenderer.showToast(`${player.name} 放弃叫地主`);

            // 统计剩下没有退出的玩家
            const activeBidders = this.gameState.players.filter(p => !p.passedBid);

            if (activeBidders.length === 1) {
                // 其他人都退出了，剩下的唯一一个人自动变成地主！
                const lastPlayer = activeBidders[0];
                SoundEngine.playBid();
                UIRenderer.showToast(`🌾 其他玩家均已退出，${lastPlayer.name} 自动获封地主！`);
                setTimeout(() => {
                    this.finalizeLandlord(lastPlayer.id);
                }, 1000);
                return;
            } else if (activeBidders.length === 0) {
                // 3 个玩家全都退出了 -> 重新发牌
                UIRenderer.showToast('全员放弃叫地主，重新发牌！');
                setTimeout(() => this.startNewRound(), 1500);
                return;
            }
        }
    }

    /**
     * 确定地主身份并把底牌分发给地主
     */
    finalizeLandlord(landlordIdx) {
        // 防重机制：防止网络延迟或定时器导致重复触发领底牌产生 5张Q/重复卡牌 bug！
        if (this.gameState.phase === 'PLAYING') return;

        this.gameState.landlordIndex = landlordIdx;
        this.gameState.phase = 'PLAYING';
        this.gameState.currentTurn = landlordIdx;
        this.gameState.multiplier = Math.max(1, this.gameState.highestBid);

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
            if (isFreePlay) {
                this.gameState.recentPlays = { 0: null, 1: null, 2: null };
            }

            // 规则合规！从玩家手牌中扣除
            const playedIds = new Set(cards.map(c => c.id));
            this.gameState.players[playerIndex].hand = this.gameState.players[playerIndex].hand.filter(c => !playedIds.has(c.id));

            this.gameState.lastPlay = { playerIndex, cards };

            if (!this.gameState.recentPlays) {
                this.gameState.recentPlays = { 0: null, 1: null, 2: null };
            }

            // 取消之前玩家出牌的 isLatest 金光高亮标记
            for (let i = 0; i < 3; i++) {
                if (this.gameState.recentPlays[i]) {
                    this.gameState.recentPlays[i].isLatest = false;
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
                NetworkManager.broadcastState(this.gameState);

                // 战绩结算与天梯积分更新
                if (typeof AuthEngine !== 'undefined') {
                    const myIdx = NetworkManager.myPlayerIndex;
                    const winnerRole = this.gameState.players[playerIndex].role;
                    const myRole = (this.gameState.players[myIdx]) ? this.gameState.players[myIdx].role : 'FARMER';
                    const isWin = (playerIndex === myIdx) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                    AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);
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
        NetworkManager.broadcastState(this.gameState);

        this.turnTimerInterval = setInterval(() => {
            if (this.gameState.phase !== 'BIDDING' && this.gameState.phase !== 'PLAYING') {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                return;
            }

            this.gameState.timerSeconds--;

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
