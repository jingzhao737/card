/**
 * 游鲸棋牌 - 大厅与房间管理模块 (LobbyManager)
 * 负责大厅 UI 逻辑、公开房间列表拉取、组局等待室槽位同步与二维码邀请链接
 */
const LobbyManager = {
    /**
     * 进入等待组局大厅 (Screen 切换)
     */
    setupWaitingScreen(roomId) {
        const lobbyScr  = document.getElementById('lobbyScreen');
        const waitScr   = document.getElementById('waitingScreen');
        const dispRoom  = document.getElementById('displayRoomId');
        const roomBar   = document.getElementById('roomInfoBar');
        const btnStart  = document.getElementById('btnStartGame');
        const btnAiBtn  = document.getElementById('btnStartWithAi');
        const btnGoHome = document.getElementById('btnGoHomeTop');

        if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
        if (waitScr)  { waitScr.style.display = 'flex'; waitScr.classList.add('active'); }
        if (window.GameEngine && typeof window.GameEngine.updateHeaderVisibility === 'function') {
            window.GameEngine.updateHeaderVisibility();
        }
        if (dispRoom) dispRoom.textContent = roomId;
        const waitingRoomDisp2 = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp2) waitingRoomDisp2.textContent = roomId;
        if (roomBar)  roomBar.style.display = 'none';
        if (btnStart) btnStart.style.display = 'none';
        if (btnAiBtn) btnAiBtn.style.display = 'none';
        if (btnGoHome) btnGoHome.style.display = 'inline-flex';
        const menuLeaveBtn2 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn2) menuLeaveBtn2.style.display = 'flex';

        // 根据 gameType 动态呈现或隐去槽位 (五子棋 2 人、斗地主 3 人、麻将 4 人)
        const gameType = NetworkManager.gameType || (window.GameEngine ? window.GameEngine.activeGameType : null) || 'DOUDIZHU';
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

        // 客户端监听房主开启五子棋 / 麻将对局信号
        NetworkManager.onGomokuStart(() => {
            if (!NetworkManager.isHost && window.GameEngine) {
                window.GameEngine.startGomokuOnlineGame(roomId, false);
            }
        });

        NetworkManager.onMahjongStart(() => {
            if (!NetworkManager.isHost && window.GameEngine) {
                window.GameEngine.startMahjongOnlineGame(roomId, false);
            }
        });

        if (typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast('已进入房间，等待房主开始游戏...');
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
