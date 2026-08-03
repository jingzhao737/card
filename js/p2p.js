/* ==========================================================================
   P2P 通信与房间状态同步引擎 (WebRTC P2P Engine & Network Sync)
   ========================================================================== */

const FAST_ICE_SERVERS = [
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.chat.bilibili.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

const SESSION_KEY      = 'ddz_session';     // sessionStorage key
const GAMESTATE_KEY    = 'ddz_gamestate';   // localStorage key (host only)
const SESSION_MAX_AGE  = 20 * 60 * 1000;   // 20 分钟内的会话可以恢复

class P2PManager {
    constructor() {
        this.peer        = null;
        this.connections = [];          // 房主保存已连接的客户端
        this._pendingConnCount = 0;     // Bug修复：预计数，防止两人同时加入突破上限
        this.hostConn    = null;        // 客户端与房主的连接
        this.isHost      = false;
        this.myPlayerIndex = 0;
        this.roomId      = null;
        this.nickname    = '一键三连';
        this.isAiMode    = false;

        this.onStateUpdate  = null;
        this.onPlayerJoined = null;
        this.onLobbySync    = null;
        this.onToast        = null;
        this.onReconnecting = null;     // 重连状态回调

        this.startHeartbeat();
        this._bindVisibilityChange();
    }

    /* ====================================================================
       心跳保活
       ==================================================================== */
    startHeartbeat() {
        setInterval(() => {
            if (this.isHost) {
                this.connections.forEach(conn => {
                    if (conn && conn.open) {
                        try { conn.send({ type: 'PING' }); } catch (e) {}
                    }
                });
            } else if (this.hostConn && this.hostConn.open) {
                try { this.hostConn.send({ type: 'PING' }); } catch (e) {}
            }
        }, 2500);
    }

    /* ====================================================================
       页面可见性变化：切回来时尝试检查并重连
       ==================================================================== */
    _bindVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            // 用户切回了标签页
            if (this.isAiMode) return;
            if (this.isHost) {
                // 房主：检查所有客户端连接是否还活着（心跳已处理，无需额外操作）
            } else if (this.hostConn && !this.hostConn.open) {
                // 客户端：与房主的连接断了，尝试重连
                console.log('[P2P] 检测到与房主连接断开，尝试重连...');
                if (this.onToast) this.onToast('检测到断线，正在尝试重连...', 4000);
                this._attemptClientReconnect();
            }
        });
    }

    /* ====================================================================
       工具方法
       ==================================================================== */
    generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /* ====================================================================
       会话持久化（sessionStorage + localStorage）
       ==================================================================== */
    saveSession(gameState) {
        try {
            const session = {
                roomId:      this.roomId,
                playerIndex: this.myPlayerIndex,
                nickname:    this.nickname,
                isHost:      this.isHost,
                phase:       gameState ? gameState.phase : 'WAITING',
                ts:          Date.now()
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

            // 仅房主保存完整 gameState，用于重连后恢复
            if (this.isHost && gameState && gameState.phase !== 'GAMEOVER') {
                localStorage.setItem(GAMESTATE_KEY, JSON.stringify(gameState));
            }
        } catch (e) {
            console.warn('[Session] 保存会话失败:', e);
        }
    }

    loadSession() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (!session || !session.roomId) return null;
            if (Date.now() - session.ts > SESSION_MAX_AGE) {
                sessionStorage.removeItem(SESSION_KEY);
                return null;
            }
            return session;
        } catch (e) { return null; }
    }

    loadSavedGameState() {
        try {
            const raw = localStorage.getItem(GAMESTATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(GAMESTATE_KEY);
    }

    /* ====================================================================
       创建 P2P 房间（房主）
       Bug修复：onReady 移到 peer.on('open') 内，确保 Peer 真正注册后才显示邀请链接
       ==================================================================== */
    createRoom(nickname, onReady, roomIdOverride) {
        this.nickname  = nickname;
        this.isHost    = true;
        this.myPlayerIndex = 0;
        this.roomId    = roomIdOverride || this.generateRoomId();
        const peerId   = `youjing-doudizhu-${this.roomId}`;

        if (this.peer) {
            try { this.peer.destroy(); } catch (e) {}
        }
        this._pendingConnCount = 0;
        this.connections = [];

        // 显示"正在建立房间..."提示
        if (this.onToast) this.onToast('正在建立房间连接，请稍候...', 5000);

        this.peer = new Peer(peerId, {
            debug: 1,
            config: { iceServers: FAST_ICE_SERVERS }
        });

        this.peer.on('open', (id) => {
            console.log('[P2P] 房主 Peer 就绪，ID:', id);
            // Bug修复：Peer 真正注册成功后才回调，确保朋友点链接时能连上
            if (onReady) onReady(this.roomId);
        });

        this.peer.on('connection', (conn) => {
            console.log('[P2P] 收到连接请求:', conn.peer);
            this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[P2P] PeerJS 错误:', err);
            // ID 已被占用（如断线重连时旧 peer 尚未注销）
            if (err.type === 'unavailable-id') {
                if (this.onToast) this.onToast('房间 ID 占用中，等待旧连接释放后重试...', 4000);
                setTimeout(() => this.createRoom(nickname, onReady, this.roomId), 3000);
            } else {
                if (this.onToast) this.onToast(`网络连接提示: ${err.type || '信号建立中'}`);
            }
        });
    }

    /* ====================================================================
       房主处理新客户端加入
       Bug修复：使用 _pendingConnCount 预计数，防止两人同时加入突破2人上限
       ==================================================================== */
    handleIncomingConnection(conn) {
        // 用已连接数 + 待握手数 判断是否超员
        const occupied = this.connections.length + this._pendingConnCount;
        if (occupied >= 2) {
            conn.on('open', () => {
                conn.send({ type: 'ERROR', message: '房间人数已满' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        this._pendingConnCount++;  // 预占一个槽位

        conn.on('open', () => {
            this._pendingConnCount--;  // 握手完成，正式记入 connections
            this.connections.push(conn);
            const assignedIndex = this.connections.length; // 1 或 2
            conn._assignedIndex = assignedIndex;

            console.log(`[P2P] 玩家 ${assignedIndex} 握手成功`);

            conn.send({
                type: 'WELCOME',
                playerIndex: assignedIndex,
                roomId: this.roomId,
                lobbyData: (window.GameEngine && window.GameEngine.gameState) ? {
                    players: window.GameEngine.gameState.players.map(p => ({
                        name: p.name,
                        isAi: p.isAi,
                        isHost: p.isHost
                    }))
                } : null
            });
        });

        conn.on('data', (data) => {
            this.handleDataFromClient(conn, data);
        });

        conn.on('close', () => {
            console.log('[P2P] 玩家断开连接');
            this.connections = this.connections.filter(c => c !== conn);
            if (this.onToast) this.onToast('已有玩家断开网络，等待重连...');
        });

        conn.on('error', () => {
            this._pendingConnCount = Math.max(0, this._pendingConnCount - 1);
        });
    }

    /* ====================================================================
       加入房间（客户端）
       Bug修复：超时条件改为只判断 !connected，修复"连接卡住不报错"问题
       ==================================================================== */
    joinRoom(roomId, nickname, onSuccess, onError) {
        this.nickname  = nickname;
        this.isHost    = false;
        this.roomId    = roomId;
        const hostPeerId = `youjing-doudizhu-${roomId}`;

        if (this.onToast) this.onToast('正在穿透 P2P 网络建立连接...', 4000);

        if (this.peer) {
            try { this.peer.destroy(); } catch (e) {}
        }

        this.peer = new Peer({
            debug: 1,
            config: { iceServers: FAST_ICE_SERVERS }
        });

        let connected = false;

        this.peer.on('open', () => {
            console.log('[P2P] 客户端 Peer 准备就绪，正在连接房主...');
            const conn = this.peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
            this.hostConn = conn;

            conn.on('open', () => {
                connected = true;
                console.log('[P2P] 已连接到房主！');
                conn.send({ type: 'JOIN_REQ', nickname: this.nickname });
                if (onSuccess) onSuccess();
            });

            conn.on('data', (data) => {
                this.handleDataFromHost(data);
            });

            conn.on('close', () => {
                console.log('[P2P] 与房主的连接已断开');
                if (this.onToast) this.onToast('与房主的连接已断开', 3000);
            });

            conn.on('error', (err) => {
                console.error('[P2P] 连接房主失败:', err);
                if (onError) onError('无法连接到房主，请确认房主处于等待界面');
            });
        });

        // Bug修复：超时只判断 !connected，不判断 !this.hostConn
        // 之前的 !connected && !this.hostConn 会因 hostConn 已赋值而永不触发错误
        setTimeout(() => {
            if (!connected) {
                if (onError) onError('连接超时，请确认房间号正确或重试');
            }
        }, 12000);

        this.peer.on('error', (err) => {
            console.error('[P2P] PeerJS error:', err);
            if (!connected && onError) onError('网络建立失败，请检查网络或重试');
        });
    }

    /* ====================================================================
       客户端断线后尝试重连
       ==================================================================== */
    _attemptClientReconnect() {
        if (!this.roomId || !this.nickname) return;
        const savedSession = this.loadSession();
        if (!savedSession) return;

        this.joinRoom(
            this.roomId,
            this.nickname,
            () => {
                if (this.onToast) this.onToast('✅ 已重新连接到房间！');
                // 重连成功后请求最新状态
                if (this.hostConn && this.hostConn.open) {
                    this.hostConn.send({ type: 'JOIN_REQ', nickname: this.nickname, isRejoin: true });
                }
            },
            (err) => {
                if (this.onToast) this.onToast(`重连失败：${err}`, 4000);
            }
        );
    }

    /* ====================================================================
       数据收发
       ==================================================================== */
    handleDataFromHost(data) {
        if (data.type === 'PING') return;
        if (data.type === 'WELCOME') {
            this.myPlayerIndex = data.playerIndex;
            console.log('[P2P] 分配槽位:', this.myPlayerIndex);
            if (data.lobbyData && this.onLobbySync) {
                this.onLobbySync(data.lobbyData);
            }
        } else if (data.type === 'STATE_SYNC') {
            if (this.onStateUpdate) {
                this.onStateUpdate(data.gameState);
            }
        } else if (data.type === 'LOBBY_SYNC') {
            if (this.onLobbySync) {
                this.onLobbySync(data.lobbyData);
            }
        } else if (data.type === 'TOAST') {
            if (this.onToast) this.onToast(data.message);
        } else if (data.type === 'CHAT_PHRASE') {
            if (window.GameEngine) {
                window.GameEngine.processChatPhrase(data.senderIndex, data.text);
            }
        }
    }

    handleDataFromClient(conn, data) {
        if (data.type === 'PING') return;
        if (data.type === 'JOIN_REQ') {
            const idx = conn._assignedIndex;
            if (idx !== undefined && this.onPlayerJoined) {
                this.onPlayerJoined(idx, data.nickname, !!data.isRejoin);
            }
        } else if (data.type === 'CLIENT_ACTION') {
            if (window.GameEngine) {
                window.GameEngine.handlePlayerAction(data.playerIndex, data.action, data.payload);
            }
        }
    }

    /* ====================================================================
       广播：同时保存会话
       ==================================================================== */
    broadcastState(gameState) {
        if (!this.isHost && !this.isAiMode) return;

        // 持久化会话与游戏状态
        this.saveSession(gameState);

        if (this.onStateUpdate) {
            this.onStateUpdate(gameState);
        }

        const packet = { type: 'STATE_SYNC', gameState };
        this.connections.forEach(conn => {
            if (conn && conn.open) {
                conn.send(packet);
            }
        });
    }

    broadcastChatPhrase(senderIndex, text) {
        const packet = { type: 'CHAT_PHRASE', senderIndex, text };
        this.connections.forEach(conn => {
            if (conn && conn.open) conn.send(packet);
        });
    }

    sendActionToHost(action, payload) {
        if (this.isHost || this.isAiMode) {
            if (window.GameEngine) {
                window.GameEngine.handlePlayerAction(this.myPlayerIndex, action, payload);
            }
        } else if (this.hostConn && this.hostConn.open) {
            this.hostConn.send({
                type: 'CLIENT_ACTION',
                playerIndex: this.myPlayerIndex,
                action,
                payload
            });
        }
    }

    broadcastLobbySync(lobbyData) {
        if (!this.isHost && !this.isAiMode) return;
        const packet = { type: 'LOBBY_SYNC', lobbyData };
        this.connections.forEach(conn => {
            if (conn && conn.open) {
                try { conn.send(packet); } catch(e) {}
            }
        });
    }
}

const NetworkManager = new P2PManager();
