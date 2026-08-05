/**
 * 游鲸棋牌 - 大厅与房间管理模块 (LobbyManager)
 * 负责大厅 UI 逻辑、公开房间列表拉取、组局等待室槽位同步与二维码邀请链接
 */
const LobbyManager = {
    /**
     * 进入等待组局大厅 (Host & Client 视角)
     */
    setupWaitingScreen(roomId) {
        const engine = window.GameEngine;
        const lobbyScr  = document.getElementById('lobbyScreen');
        const waitScr   = document.getElementById('waitingScreen');
        const dispRoom  = document.getElementById('displayRoomId');
        const roomBar   = document.getElementById('roomInfoBar');
        const btnStart  = document.getElementById('btnStartGame');
        const btnAiBtn  = document.getElementById('btnStartWithAi');
        const btnGoHome = document.getElementById('btnGoHomeTop');

        if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
        if (waitScr)  { waitScr.style.display = 'flex'; waitScr.classList.add('active'); }
        if (engine && typeof engine.updateHeaderVisibility === 'function') {
            engine.updateHeaderVisibility();
        }
        if (dispRoom) dispRoom.textContent = roomId;
        const waitingRoomDisp2 = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp2) waitingRoomDisp2.textContent = roomId;
        if (roomBar)  roomBar.style.display = 'none';
        if (btnGoHome) btnGoHome.style.display = 'inline-flex';
        const menuLeaveBtn2 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn2) menuLeaveBtn2.style.display = 'flex';

        // 生成真实访问 URL & 写入邀请框
        let origin = window.location.origin;
        if (!origin || origin === 'null') origin = window.location.protocol + '//' + window.location.host;
        const shareUrl = `${origin}${window.location.pathname}?room=${roomId}`;
        const inviteInput = document.getElementById('inviteUrlInput');
        if (inviteInput) inviteInput.value = shareUrl;

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

        const gameType = NetworkManager.gameType || (engine ? engine.activeGameType : null) || 'DOUDIZHU';
        const isMahjong = (gameType === 'MAHJONG');
        const isGomoku  = (gameType === 'GOMOKU');
        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (NetworkManager.isHost) {
            // 初始化房主 slot0
            const nick = NetworkManager.nickname || '房主';
            const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';
            if (engine && engine.gameState && engine.gameState.players) {
                engine.gameState.players[0].name = nick;
                engine.gameState.players[0].avatar = currentAvatar;
                engine.gameState.players[0].isAi = false;
            }

            const slotName0 = document.getElementById('slotName0');
            const slotAvatar0 = document.getElementById('slotAvatar0');
            if (slotName0) slotName0.textContent = `${nick} (房主)`;
            if (slotAvatar0) slotAvatar0.textContent = currentAvatar;

            if (isMahjong) {
                if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4 (差人自动补AI)</span>';
                if (slot2) slot2.style.display = 'flex';
                if (slot3) slot3.style.display = 'flex';
                this.fillSlotWithAi(1);
                this.fillSlotWithAi(2);
                this.fillSlotWithAi(3);
                if (btnStart) {
                    btnStart.style.display = 'block';
                    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启 4 人麻将对局';
                }
                if (btnAiBtn) btnAiBtn.style.display = 'none';
            } else if (isGomoku) {
                if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
                if (slot2) slot2.style.display = 'none';
                if (slot3) slot3.style.display = 'none';
                this.fillSlotWithAi(1);
                if (btnStart) {
                    btnStart.style.display = 'block';
                    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启五子棋对局';
                }
                if (btnAiBtn) btnAiBtn.style.display = 'none';
            } else {
                if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
                if (slot2) slot2.style.display = 'flex';
                if (slot3) slot3.style.display = 'none';
                this.fillSlotWithAi(1);
                this.fillSlotWithAi(2);
                if (btnStart) {
                    btnStart.style.display = 'block';
                    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> START';
                }
                if (btnAiBtn) btnAiBtn.style.display = 'none';
            }

            this.broadcastLobbyState();
        } else {
            // 客户端加入视角
            if (btnStart) btnStart.style.display = 'none';
            if (btnAiBtn) btnAiBtn.style.display = 'none';
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
        }

        // 客户端监听房主开启五子棋 / 麻将对局信号
        NetworkManager.onGomokuStart(() => {
            if (!NetworkManager.isHost && engine) {
                engine.startGomokuOnlineGame(roomId, false);
            }
        });

        NetworkManager.onMahjongStart(() => {
            if (!NetworkManager.isHost && engine) {
                engine.startMahjongOnlineGame(roomId, false);
            }
        });

        if (typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast('已进入房间，等待房主开始游戏...');
        }
    },

    /**
     * 将指定 slot 标记为 AI 机器人，并更新 UI
     */
    fillSlotWithAi(slotIndex) {
        const engine = window.GameEngine;
        if (!engine || !engine.gameState || !engine.gameState.players) return;

        const aiName = `AI-${slotIndex}`;
        if (!engine.gameState.players[slotIndex]) {
            engine.gameState.players[slotIndex] = { id: slotIndex, name: aiName, hand: [], isAi: true, isHost: false, role: 'FARMER', avatar: '🤖' };
        } else {
            engine.gameState.players[slotIndex].name = aiName;
            engine.gameState.players[slotIndex].avatar = '🤖';
            engine.gameState.players[slotIndex].isAi = true;
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
    },

    /**
     * 当有新玩家加入 (Host处理)
     */
    onPlayerJoined(slotIndex, nickname, avatarEmoji) {
        if (!NetworkManager.isHost || !window.GameEngine) return;

        const name = nickname || `玩家 ${slotIndex + 1}`;
        const avatar = avatarEmoji || '🤠';
        const gameState = window.GameEngine.gameState;
        if (!gameState || !gameState.players) return;

        gameState.players[slotIndex].name = name;
        gameState.players[slotIndex].avatar = avatar;
        gameState.players[slotIndex].isAi = false;

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

        const humanCount = gameState.players.filter(p => !p.isAi).length;
        const countEl = document.getElementById('connectedCount');
        if (countEl) countEl.textContent = humanCount;

        if (humanCount === 3 && typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast('🎉 全员就位，可以开始游戏了！');
        }

        this.broadcastLobbyState();
    },

    /**
     * 房主广播组局大厅玩家状态
     */
    broadcastLobbyState() {
        if (!NetworkManager.isHost || !window.GameEngine) return;
        const gameState = window.GameEngine.gameState;
        if (!gameState || !gameState.players) return;

        const lobbyData = {
            players: gameState.players.map(p => ({
                name: p.name,
                avatar: p.avatar || (p.isAi ? '🤖' : '🤠'),
                isAi: p.isAi,
                isHost: p.isHost
            }))
        };
        NetworkManager.broadcastLobbySync(lobbyData);
    },

    /**
     * 客户端接收并渲染房间大厅玩家列表
     */
    onReceiveLobbySync(lobbyData) {
        if (!lobbyData || !lobbyData.players) return;
        if (window.GameEngine) {
            window.GameEngine.latestLobbyPlayers = lobbyData.players || null;
            const gameState = window.GameEngine.gameState;

            // 房主接收到大厅列表更新时精准同步 gameState.players
            if (NetworkManager.isHost && gameState && gameState.players) {
                lobbyData.players.forEach((p, i) => {
                    if (gameState.players[i] && p) {
                        gameState.players[i].name = p.name || gameState.players[i].name;
                        gameState.players[i].avatar = p.avatar || gameState.players[i].avatar;
                        gameState.players[i].isAi = !!p.isAi;
                    }
                });
            }
        }

        const myIndex = NetworkManager.myPlayerIndex;
        const gameType = NetworkManager.gameType || (window.GameEngine ? window.GameEngine.activeGameType : null) || 'DOUDIZHU';
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
    },

    /**
     * 复制分享链接
     */
    copyInviteUrl() {
        const input = document.getElementById('inviteUrlInput');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value).then(() => {
                if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('邀请链接已复制！快速发给微信/QQ好友吧！');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('链接已复制到剪贴板');
            });
        }
    }
};

window.LobbyManager = LobbyManager;
