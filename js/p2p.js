/* ==========================================================================
   P2P 通信与房间状态同步引擎 (WebRTC P2P Engine & Network Sync)
   ========================================================================== */

// 国内与国际超高速 STUN 节点 (包含 3478 标准端口与 Google/小米/B站 节点，保障移动端 4G/5G 秒级穿透)
const FAST_ICE_SERVERS = [
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.chat.bilibili.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

class P2PManager {
    constructor() {
        this.peer = null;
        this.connections = []; // 房主保存连接的客户端 (PeerJS DataConnections)
        this.hostConn = null;  // 客户端保存与房主的连接
        this.isHost = false;
        this.myPlayerIndex = 0; // 0, 1, 或 2
        this.roomId = null;
        this.nickname = '一键三连';
        this.isAiMode = false;
        
        // 渲染更新回调
        this.onStateUpdate = null;
        this.onPlayerJoined = null;
        this.onLobbySync = null;
        this.onToast = null;

        // 开启 2.5 秒心跳保活，防止手机移动网络 (4G/5G) NAT 映射超时断连卡顿
        this.startHeartbeat();
    }

    /**
     * 移动网络 WebRTC 心跳保活 (防止手机锁屏或长思考时 NAT 端口老化掉线)
     */
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

    /**
     * 生成随机 6 位六进制/数字房间号
     */
    generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * 创建 P2P 房间 (作为 Host)
     */
    createRoom(nickname, onReady) {
        this.nickname = nickname;
        this.isHost = true;
        this.myPlayerIndex = 0;
        this.roomId = this.generateRoomId();
        const peerId = `youjing-doudizhu-${this.roomId}`;

        // 立即回调UI进行界面切换，提供 0ms 闪电响应
        if (onReady) onReady(this.roomId);

        if (this.peer) {
            try { this.peer.destroy(); } catch (e) {}
        }

        this.peer = new Peer(peerId, {
            debug: 1,
            config: {
                iceServers: FAST_ICE_SERVERS
            }
        });

        this.peer.on('open', (id) => {
            console.log('[P2P] 房主 Peer 穿透接入完成 ID:', id);
        });

        this.peer.on('connection', (conn) => {
            console.log('[P2P] 收到来自玩家的连接请求:', conn.peer);
            this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[P2P] PeerJS 错误:', err);
            if (this.onToast) this.onToast(`网络连接提示: ${err.type || '信号建立中'}`);
        });
    }

    /**
     * 房主处理客户端加入连接
     */
    handleIncomingConnection(conn) {
        if (this.connections.length >= 2) {
            conn.on('open', () => {
                conn.send({ type: 'ERROR', message: '房间人数已满' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        conn.on('open', () => {
            this.connections.push(conn);
            const assignedIndex = this.connections.length; // 1 或 2
            conn._assignedIndex = assignedIndex;

            console.log(`[P2P] 玩家 ${assignedIndex} 连接建立成功，等待 JOIN_REQ...`);

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
            if (this.onToast) this.onToast('已有玩家断开网络');
        });
    }

    /**
     * 加入已建立的 P2P 房间 (作为 Client)
     */
    joinRoom(roomId, nickname, onSuccess, onError) {
        this.nickname = nickname;
        this.isHost = false;
        this.roomId = roomId;
        const hostPeerId = `youjing-doudizhu-${roomId}`;

        if (this.onToast) this.onToast('正在穿透 P2P 网络建立连接...', 4000);

        this.peer = new Peer({
            debug: 1,
            config: {
                iceServers: FAST_ICE_SERVERS
            }
        });

        let connected = false;

        this.peer.on('open', () => {
            console.log('[P2P] Client Peer 准备就绪，正在发起对房主的连接...');
            const conn = this.peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
            this.hostConn = conn;

            conn.on('open', () => {
                connected = true;
                console.log('[P2P] 已连接到房主！');
                conn.send({
                    type: 'JOIN_REQ',
                    nickname: this.nickname
                });
                if (onSuccess) onSuccess();
            });

            conn.on('data', (data) => {
                this.handleDataFromHost(data);
            });

            conn.on('error', (err) => {
                console.error('[P2P] 连接房主失败:', err);
                if (onError) onError('无法连接到房主，请确认房主处于等待界面');
            });
        });

        // 超时保护 (10s)
        setTimeout(() => {
            if (!connected && !this.hostConn) {
                if (onError) onError('连接超时，请确认房间号正确或重试');
            }
        }, 10000);

        this.peer.on('error', (err) => {
            console.error('[P2P] PeerJS error:', err);
            if (onError) onError('网络建立失败，请检查网络或重试');
        });
    }

    /**
     * 客户端收到房主的数据消息
     */
    handleDataFromHost(data) {
        if (data.type === 'PING') return; // 心跳包直接忽略
        if (data.type === 'WELCOME') {
            this.myPlayerIndex = data.playerIndex;
            console.log('[P2P] 得到房主分配的槽位:', this.myPlayerIndex);
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

    /**
     * 房主收到客户端发来的指令操作
     */
    handleDataFromClient(conn, data) {
        if (data.type === 'PING') return; // 心跳包直接忽略
        if (data.type === 'JOIN_REQ') {
            // JOIN_REQ 携带了昵称，现在才通知上层
            const idx = conn._assignedIndex;
            if (idx !== undefined && this.onPlayerJoined) {
                this.onPlayerJoined(idx, data.nickname);
            }
        } else if (data.type === 'CLIENT_ACTION') {
            // 将客户端玩家的操作转发给本地游戏主机引擎
            if (window.GameEngine) {
                window.GameEngine.handlePlayerAction(data.playerIndex, data.action, data.payload);
            }
        }
    }

    /**
     * 广播快捷聊天短语给所有人
     */
    broadcastChatPhrase(senderIndex, text) {
        const packet = {
            type: 'CHAT_PHRASE',
            senderIndex: senderIndex,
            text: text
        };
        this.connections.forEach(conn => {
            if (conn && conn.open) {
                conn.send(packet);
            }
        });
    }

    /**
     * 房主广播全量游戏状态给所有接入的玩家
     */
    broadcastState(gameState) {
        if (!this.isHost && !this.isAiMode) return;

        // 本地主玩家直接更新
        if (this.onStateUpdate) {
            this.onStateUpdate(gameState);
        }

        // 广播给从节点玩家
        const packet = {
            type: 'STATE_SYNC',
            gameState: gameState
        };

        this.connections.forEach(conn => {
            if (conn && conn.open) {
                conn.send(packet);
            }
        });
    }

    /**
     * 客户端发送操作指令给房主
     */
    sendActionToHost(action, payload) {
        if (this.isHost || this.isAiMode) {
            // 本地处理
            if (window.GameEngine) {
                window.GameEngine.handlePlayerAction(this.myPlayerIndex, action, payload);
            }
        } else if (this.hostConn && this.hostConn.open) {
            this.hostConn.send({
                type: 'CLIENT_ACTION',
                playerIndex: this.myPlayerIndex,
                action: action,
                payload: payload
            });
        }
    }

    /**
     * 房主广播大厅就绪列表给所有客户端
     */
    broadcastLobbySync(lobbyData) {
        if (!this.isHost && !this.isAiMode) return;
        const packet = {
            type: 'LOBBY_SYNC',
            lobbyData: lobbyData
        };
        this.connections.forEach(conn => {
            if (conn && conn.open) {
                try { conn.send(packet); } catch(e) {}
            }
        });
    }
}

const NetworkManager = new P2PManager();
