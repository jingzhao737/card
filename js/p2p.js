/* ==========================================================================
   云端实时同步与房间网络引擎 (Firebase Realtime Database Cloud Engine)
   ========================================================================== */

const firebaseConfig = {
    apiKey: "AIzaSyAMWg7S6RD2HTBfqWVSEmlTAsTc7-qRWI",
    authDomain: "yjcard.firebaseapp.com",
    databaseURL: "https://yjcard-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "yjcard",
    storageBucket: "yjcard.firebasestorage.app",
    messagingSenderId: "179385847942",
    appId: "1:179385847942:web:1b4b36b4749d7cf806c107",
    measurementId: "G-1WKXG1DLBJ"
};

// 初始化 Firebase (Compat 模式)
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const SESSION_KEY     = 'ddz_session';     // sessionStorage key
const GAMESTATE_KEY   = 'ddz_gamestate';   // localStorage key
const SESSION_MAX_AGE = 30 * 60 * 1000;   // 30 分钟内的会话可恢复

class P2PManager {
    constructor() {
        this.db            = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
        this.roomRef       = null;
        this.isHost        = false;
        this.myPlayerIndex = 0;
        this.roomId        = null;
        this.nickname      = '一键三连';
        this.isAiMode      = false;
        this.sessionId     = this._getOrCreateSessionId();

        // 渲染与网络事件回调
        this.onStateUpdate  = null;
        this.onPlayerJoined = null;
        this.onLobbySync    = null;
        this.onToast        = null;

        this._lastProcessedActionId = null;
        this._lastProcessedChatId   = null;
        this._listeners = [];

        this._bindVisibilityChange();
    }

    _getOrCreateSessionId() {
        let sid = sessionStorage.getItem('ddz_client_sid');
        if (!sid) {
            sid = 'sid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            sessionStorage.setItem('ddz_client_sid', sid);
        }
        return sid;
    }

    generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /* ====================================================================
       会话持久化
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

            if (gameState && gameState.phase !== 'GAMEOVER') {
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

    _bindVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            // 当用户切回网页时，重新强行拉取最新云端状态，解决切后台挂起问题！
            if (this.roomRef && !this.isAiMode) {
                this.roomRef.child('gameState').once('value').then(snapshot => {
                    const state = snapshot.val();
                    if (state && this.onStateUpdate) {
                        console.log('[CloudSync] 页面恢复，同步云端最新状态');
                        this.onStateUpdate(state);
                    }
                });
            }
        });
    }

    _removeAllListeners() {
        if (this.roomRef) {
            this.roomRef.off();
            this.roomRef.child('gameState').off();
            this.roomRef.child('lobbyData').off();
            this.roomRef.child('action').off();
            this.roomRef.child('chat').off();
            this.roomRef.child('players').off();
        }
    }

    /* ====================================================================
       创建房间 (作为 Host) - Firebase 云端版
       ==================================================================== */
    createRoom(nickname, onReady, roomIdOverride) {
        this.nickname      = nickname;
        this.isHost        = true;
        this.myPlayerIndex = 0;
        this.roomId        = roomIdOverride || this.generateRoomId();
        this.isAiMode      = false;

        this._removeAllListeners();
        this.roomRef = this.db.ref('rooms/' + this.roomId);

        if (this.onToast) this.onToast('☁️ 正在创建云端数据房间...', 3000);

        const initialLobby = {
            players: [
                { name: nickname, isAi: false, isHost: true, sid: this.sessionId },
                { name: '🤖 机器人 AI_1', isAi: true, isHost: false },
                { name: '🤖 机器人 AI_2', isAi: true, isHost: false }
            ]
        };

        const roomPayload = {
            roomId: this.roomId,
            created: firebase.database.ServerValue.TIMESTAMP,
            hostSid: this.sessionId,
            lobbyData: initialLobby,
            gameState: null,
            action: null,
            chat: null
        };

        this.roomRef.set(roomPayload).then(() => {
            console.log('[CloudEngine] 房主创建云端房间成功 ID:', this.roomId);
            if (onReady) onReady(this.roomId);

            // 监听玩家加入（监听 players 节点变化）
            this.roomRef.child('lobbyData/players').on('value', snapshot => {
                const players = snapshot.val();
                if (!players) return;

                players.forEach((p, idx) => {
                    if (idx > 0 && !p.isAi && p.name) {
                        if (this.onPlayerJoined) {
                            this.onPlayerJoined(idx, p.name);
                        }
                    }
                });
            });

            // 房主监听客户端发来的操作指令
            this.roomRef.child('action').on('value', snapshot => {
                const act = snapshot.val();
                if (act && act.id && act.id !== this._lastProcessedActionId) {
                    this._lastProcessedActionId = act.id;
                    if (window.GameEngine) {
                        window.GameEngine.handlePlayerAction(act.playerIndex, act.action, act.payload);
                    }
                }
            });

            // 房主也监听快捷聊天
            this.roomRef.child('chat').on('value', snapshot => {
                const chat = snapshot.val();
                if (chat && chat.id && chat.id !== this._lastProcessedChatId) {
                    this._lastProcessedChatId = chat.id;
                    if (window.GameEngine) {
                        window.GameEngine.processChatPhrase(chat.senderIndex, chat.text);
                    }
                }
            });

        }).catch(err => {
            console.error('[CloudEngine] 创建房间失败:', err);
            if (this.onToast) this.onToast(`创建云端房间失败: ${err.message}`, 4000);
        });
    }

    /* ====================================================================
       加入房间 (作为 Client) - Firebase 云端版
       ==================================================================== */
    joinRoom(roomId, nickname, onSuccess, onError) {
        this.nickname  = nickname;
        this.isHost    = false;
        this.roomId    = roomId;
        this.isAiMode  = false;

        this._removeAllListeners();
        this.roomRef = this.db.ref('rooms/' + roomId);

        if (this.onToast) this.onToast('☁️ 正在连接云端服务器...', 4000);

        this.roomRef.once('value').then(snapshot => {
            const roomData = snapshot.val();
            if (!roomData) {
                if (onError) onError('房间不存在，请检查 6 位房间号');
                return;
            }

            const lobby = roomData.lobbyData || { players: [] };
            const players = lobby.players || [];

            // 查找属于当前玩家的槽位或可加入槽位
            let assignedSlot = -1;

            // 优先匹配相同 sid (重连)
            for (let i = 1; i < 3; i++) {
                if (players[i] && players[i].sid === this.sessionId) {
                    assignedSlot = i;
                    break;
                }
            }

            // 否则查找第一个 AI 槽位
            if (assignedSlot === -1) {
                for (let i = 1; i < 3; i++) {
                    if (!players[i] || players[i].isAi) {
                        assignedSlot = i;
                        break;
                    }
                }
            }

            if (assignedSlot === -1) {
                if (onError) onError('房间人数已满！');
                return;
            }

            this.myPlayerIndex = assignedSlot;
            console.log(`[CloudEngine] 客户端加入房间成功，分配槽位 ${assignedSlot}`);

            // 更新云端该槽位的玩家信息
            players[assignedSlot] = {
                name: nickname,
                isAi: false,
                isHost: false,
                sid: this.sessionId
            };

            return this.roomRef.child('lobbyData/players').set(players).then(() => {
                // 监听全局状态更新
                this.roomRef.child('gameState').on('value', snap => {
                    const state = snap.val();
                    if (state && this.onStateUpdate) {
                        this.onStateUpdate(state);
                    }
                });

                // 监听大厅玩家列表同步
                this.roomRef.child('lobbyData').on('value', snap => {
                    const lData = snap.val();
                    if (lData && this.onLobbySync) {
                        this.onLobbySync(lData);
                    }
                });

                // 监听快捷聊天
                this.roomRef.child('chat').on('value', snap => {
                    const chat = snap.val();
                    if (chat && chat.id && chat.id !== this._lastProcessedChatId) {
                        this._lastProcessedChatId = chat.id;
                        if (window.GameEngine) {
                            window.GameEngine.processChatPhrase(chat.senderIndex, chat.text);
                        }
                    }
                });

                if (onSuccess) onSuccess();
            });

        }).catch(err => {
            console.error('[CloudEngine] 加入房间异常:', err);
            if (onError) onError(`连接异常: ${err.message}`);
        });
    }

    /* ====================================================================
       广播全量游戏状态（写入云端）
       ==================================================================== */
    broadcastState(gameState) {
        if (!this.isHost && !this.isAiMode) return;

        this.saveSession(gameState);

        if (this.onStateUpdate) {
            this.onStateUpdate(gameState);
        }

        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('gameState').set(gameState).catch(err => {
                console.warn('[CloudSync] 写入云端失败:', err);
            });
        }
    }

    /* ====================================================================
       客户端发送指令（写入云端 action 节点）
       ==================================================================== */
    sendActionToHost(action, payload) {
        if (this.isHost || this.isAiMode) {
            if (window.GameEngine) {
                window.GameEngine.handlePlayerAction(this.myPlayerIndex, action, payload);
            }
        } else if (this.roomRef) {
            const actionPayload = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                playerIndex: this.myPlayerIndex,
                action: action,
                payload: payload
            };
            this.roomRef.child('action').set(actionPayload);
        }
    }

    /* ====================================================================
       广播大厅就绪列表（写入云端）
       ==================================================================== */
    broadcastLobbySync(lobbyData) {
        if (!this.isHost && !this.isAiMode) return;
        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('lobbyData').set(lobbyData);
        }
    }

    /* ====================================================================
       广播快捷聊天短语
       ==================================================================== */
    broadcastChatPhrase(senderIndex, text) {
        if (this.roomRef && !this.isAiMode) {
            const chatPayload = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                senderIndex: senderIndex,
                text: text
            };
            this.roomRef.child('chat').set(chatPayload);
        } else if (window.GameEngine) {
            window.GameEngine.processChatPhrase(senderIndex, text);
        }
    }
}

const NetworkManager = new P2PManager();
