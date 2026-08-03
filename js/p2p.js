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

const SESSION_KEY       = 'ddz_session';     // localStorage key
const GAMESTATE_KEY     = 'ddz_gamestate';   // localStorage key
const SESSION_MAX_AGE   = 30 * 60 * 1000;   // 30 分钟内的会话可恢复
const MAX_INACTIVE_TIME = 3 * 60 * 1000;    // 3 分钟（180,000ms）无真人操作自动销毁房间

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

    /* ====================================================================
       微信 Webview 兼容支持：Cookie + localStorage 双重设备唯一标识
       ==================================================================== */
    _getOrCreateSessionId() {
        let sid = localStorage.getItem('ddz_client_sid');
        if (!sid) {
            // Cookie 备选恢复 (专门解决微信内置浏览器关闭 Webview 清空 localStorage 的问题)
            const match = document.cookie.match(/(?:^|; )ddz_client_sid=([^;]*)/);
            if (match && match[1]) sid = match[1];
        }
        if (!sid) {
            sid = 'sid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        // 写入 localStorage + Cookie (有效期 30 天)
        try { localStorage.setItem('ddz_client_sid', sid); } catch (e) {}
        try { document.cookie = `ddz_client_sid=${sid}; max-age=${30 * 24 * 3600}; path=/`; } catch (e) {}

        return sid;
    }

    generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /* ====================================================================
       会话持久化 (localStorage + Cookie 双重保护)
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
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));

            if (gameState && gameState.phase !== 'GAMEOVER') {
                localStorage.setItem(GAMESTATE_KEY, JSON.stringify(gameState));
            }
        } catch (e) {
            console.warn('[Session] 保存会话失败:', e);
        }
    }

    loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (!session || !session.roomId) return null;
            if (Date.now() - session.ts > SESSION_MAX_AGE) {
                localStorage.removeItem(SESSION_KEY);
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
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(GAMESTATE_KEY);
    }

    /* ====================================================================
       规则 1 实施：单设备单房间（创建/加入新房间前自动清除旧房间/旧槽位，带1.5秒超时保护）
       ==================================================================== */
    _leavePreviousRooms(targetRoomId, callback) {
        if (!this.db || !this.sessionId) {
            if (callback) callback();
            return;
        }

        let done = false;
        const safeCallback = () => {
            if (!done) {
                done = true;
                if (callback) callback();
            }
        };

        // 1.5 秒超时保护，防止云端网络慢时房间创建卡住挂起
        const timer = setTimeout(safeCallback, 1500);

        this.db.ref('rooms').limitToLast(15).once('value').then(snapshot => {
            clearTimeout(timer);
            const roomsMap = snapshot.val() || {};
            const updatePromises = [];

            Object.keys(roomsMap).forEach(rId => {
                if (rId === targetRoomId) return; // 忽略目标房间
                const room = roomsMap[rId];
                if (!room) return;

                // 如果该设备是旧房间的房主 -> 直接移除旧房间
                if (room.hostSid === this.sessionId) {
                    console.log('[CleanRoom] 自动清除同设备的旧房主房间:', rId);
                    updatePromises.push(this.db.ref('rooms/' + rId).remove());
                } else if (room.lobbyData && room.lobbyData.players) {
                    // 如果该设备是旧房间的客户端 -> 将其槽位重置为 AI 候补
                    const players = room.lobbyData.players;
                    let modified = false;
                    for (let i = 1; i < 3; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            console.log(`[CleanRoom] 自动清除同设备在旧房间 ${rId} 的槽位 ${i}`);
                            players[i] = { name: `🤖 机器人 AI_${i}`, avatar: '🤖', isAi: true, isHost: false };
                            modified = true;
                        }
                    }
                    if (modified) {
                        updatePromises.push(this.db.ref(`rooms/${rId}/lobbyData/players`).set(players));
                    }
                }
            });

            Promise.all(updatePromises).then(safeCallback).catch(safeCallback);
        }).catch(safeCallback);
    }

    /* ====================================================================
       规则 3 实施：在线玩家 ID / 昵称去重处理（排除玩家自身槽位）
       ==================================================================== */
    _ensureUniqueNickname(requestedNick, existingPlayers, ignoreSlotIndex) {
        let unique = (requestedNick || '').trim();
        if (!unique) unique = '玩家';

        if (ignoreSlotIndex !== undefined && ignoreSlotIndex >= 0 && existingPlayers && existingPlayers[ignoreSlotIndex]) {
            if (existingPlayers[ignoreSlotIndex].name === unique) {
                return unique;
            }
        }

        let isDuplicate = false;
        if (existingPlayers && Array.isArray(existingPlayers)) {
            existingPlayers.forEach((p, idx) => {
                if (idx !== ignoreSlotIndex && p && p.name === unique) {
                    isDuplicate = true;
                }
            });
        }

        if (isDuplicate) {
            let suffix = Math.floor(Math.random() * 900 + 100);
            if (typeof AuthEngine !== 'undefined' && AuthEngine.userData && AuthEngine.userData.uid) {
                suffix = String(AuthEngine.userData.uid).slice(-3);
            }
            const newUnique = `${unique}_${suffix}`;
            if (this.onToast) {
                this.onToast(`💡 房间内已有同名玩家，昵称已自动调整为：${newUnique}`, 3500);
            }
            unique = newUnique;
        }

        this.nickname = unique;
        try { localStorage.setItem('youjing_doudizhu_nickname', unique); } catch(e) {}
        const input = document.getElementById('nicknameInput');
        if (input) input.value = unique;

        return unique;
    }

    /* ====================================================================
       拉取云端公共房间列表 (自动清理 >3分钟 无真人操作的过期房间)
       ==================================================================== */
    fetchPublicRooms(callback) {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('rooms').limitToLast(20).once('value').then(snapshot => {
            const roomsMap = snapshot.val() || {};
            const activeRooms = [];
            const now = Date.now();

            Object.keys(roomsMap).forEach(roomId => {
                const room = roomsMap[roomId];
                if (room && room.lobbyData && room.lobbyData.players) {
                    const lastHuman = room.lastHumanActivity || room.created || 0;
                    const inactiveDuration = now - lastHuman;

                    // 规则 2：超过 3 分钟无真人操作 -> 自动从云端数据库清除销毁！
                    if (inactiveDuration > MAX_INACTIVE_TIME) {
                        console.log(`[AutoClean] 房间 ${roomId} 超过 3 分钟无真人操作，自动销毁`);
                        this.db.ref('rooms/' + roomId).remove();
                    } else {
                        activeRooms.push(room);
                    }
                }
            });

            activeRooms.reverse(); // 最新创建在前
            if (callback) callback(activeRooms);
        }).catch(err => {
            console.error('[CloudEngine] 拉取公开房间列表失败:', err);
            if (callback) callback([]);
        });
    }

    _bindVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            // 当用户切回网页时，重新强行拉取最新云端状态，解决切后台挂起问题！
            if (this.roomRef && !this.isAiMode) {
                this.roomRef.once('value').then(snapshot => {
                    const roomData = snapshot.val();
                    if (!roomData) {
                        // 房间已被销毁（如超过 3 分钟超时）
                        if (this.onToast) this.onToast('⌛ 该房间超过 3 分钟无真人操作已被销毁关闭');
                        this.clearSession();
                        window.location.href = window.location.pathname;
                        return;
                    }

                    const state = roomData.gameState;
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
       创建房间 (作为 Host) - Firebase 云端版 (带连接异常捕获与超时保护)
       ==================================================================== */
    createRoom(nickname, onReady, roomIdOverride) {
        this.roomId = roomIdOverride || this.generateRoomId();
        this.isHost = true;
        this.myPlayerIndex = 0;
        this.isAiMode = false;

        if (!this.db) {
            if (this.onToast) this.onToast('❌ 云端服务未连接，请检查网络或刷新页面', 4000);
            return;
        }

        // 实施规则 1：创建前先清除同设备的旧房间 (带 1.5 秒超时保护)
        this._leavePreviousRooms(this.roomId, () => {
            this._removeAllListeners();
            this.roomRef = this.db.ref('rooms/' + this.roomId);

            if (this.onToast) this.onToast('☁️ 正在创建云端数据房间...', 2500);

            // 实施规则 3：昵称去重
            const finalNick = this._ensureUniqueNickname(nickname, [], 0);
            const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';

            const initialLobby = {
                players: [
                    { name: finalNick, avatar: currentAvatar, isAi: false, isHost: true, sid: this.sessionId },
                    { name: '🤖 机器人 AI_1', avatar: '🤖', isAi: true, isHost: false },
                    { name: '🤖 机器人 AI_2', avatar: '🤖', isAi: true, isHost: false }
                ]
            };

            const now = Date.now();
            const roomPayload = {
                roomId: this.roomId,
                created: firebase.database.ServerValue.TIMESTAMP,
                lastHumanActivity: now, // 规则 2：记录真人初始活动时间
                hostSid: this.sessionId,
                lobbyData: initialLobby,
                gameState: null,
                action: null,
                chat: null
            };

            this.roomRef.set(roomPayload).then(() => {
                console.log('[CloudEngine] 房主创建云端房间成功 ID:', this.roomId);
                if (onReady) onReady(this.roomId);

                // 监听玩家加入
                this.roomRef.child('lobbyData/players').on('value', snapshot => {
                    const players = snapshot.val();
                    if (!players) return;

                    players.forEach((p, idx) => {
                        if (idx > 0 && !p.isAi && p.name) {
                            if (this.onPlayerJoined) {
                                this.onPlayerJoined(idx, p.name, p.avatar);
                            }
                        }
                    });
                });

                // 房主监听客户端发来的操作指令
                this.roomRef.child('action').on('value', snapshot => {
                    const act = snapshot.val();
                    if (act && act.id && act.id !== this._lastProcessedActionId) {
                        this._lastProcessedActionId = act.id;
                        // 规则 2：接收到真人操作指令，刷新真人活动时间
                        this.roomRef.child('lastHumanActivity').set(Date.now());
                        if (window.GameEngine) {
                            window.GameEngine.handlePlayerAction(act.playerIndex, act.action, act.payload);
                        }
                    }
                });

                // 房主监听快捷聊天
                this.roomRef.child('chat').on('value', snapshot => {
                    const chat = snapshot.val();
                    if (chat && chat.id && chat.id !== this._lastProcessedChatId) {
                        this._lastProcessedChatId = chat.id;
                        this.roomRef.child('lastHumanActivity').set(Date.now());
                        if (window.GameEngine) {
                            window.GameEngine.processChatPhrase(chat.senderIndex, chat.text);
                        }
                    }
                });

            }).catch(err => {
                console.error('[CloudEngine] 创建房间失败:', err);
                const isPermission = err.code === 'PERMISSION_DENIED' || (err.message || '').includes('PERMISSION_DENIED');
                const msg = isPermission
                    ? '❌ 数据库权限被拒绝，请在 Firebase Console → Realtime Database → 规则 中将读写权限改为 true'
                    : `创建云端房间失败: ${err.message}`;
                if (this.onToast) this.onToast(msg, 6000);
            });
        });
    }

    /* ====================================================================
       加入房间 (作为 Client) - Firebase 云端版
       ==================================================================== */
    joinRoom(roomId, nickname, onSuccess, onError) {
        this.roomId   = roomId;
        this.isAiMode = false;

        // 实施规则 1：加入前先清除同设备的旧房间/旧槽位
        this._leavePreviousRooms(roomId, () => {
            this._removeAllListeners();
            this.roomRef = this.db.ref('rooms/' + roomId);

            if (this.onToast) this.onToast('☁️ 正在连接云端服务器...', 4000);

            this.roomRef.once('value').then(snapshot => {
                const roomData = snapshot.val();
                if (!roomData) {
                    if (onError) onError('房间不存在，或超时无真人操作已被销毁');
                    return;
                }

                // 规则 2：检查该房间是否已超 3 分钟无真人操作
                const lastHuman = roomData.lastHumanActivity || roomData.created || 0;
                if (Date.now() - lastHuman > MAX_INACTIVE_TIME) {
                    this.db.ref('rooms/' + roomId).remove();
                    if (onError) onError('该房间超过 3 分钟无真人操作已自动销毁');
                    return;
                }

                const lobby = roomData.lobbyData || { players: [] };
                const players = lobby.players || [];

                // 查找属于当前玩家的槽位 (0=房主, 1=玩家2, 2=玩家3)
                let assignedSlot = -1;

                // 1. 检查是否是房主 (槽位 0) 重连/加入
                if (roomData.hostSid === this.sessionId || (players[0] && (players[0].sid === this.sessionId || players[0].name === nickname))) {
                    assignedSlot = 0;
                    this.isHost = true;
                } else {
                    this.isHost = false;

                    // 2. 客户端重连：优先匹配相同 sid
                    for (let i = 1; i < 3; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            assignedSlot = i;
                            break;
                        }
                    }

                    // 3. 客户端重连：退而求其次匹配相同 nickname (非 AI)
                    if (assignedSlot === -1) {
                        for (let i = 1; i < 3; i++) {
                            if (players[i] && !players[i].isAi && players[i].name === nickname) {
                                assignedSlot = i;
                                break;
                            }
                        }
                    }

                    // 4. 新玩家加入：查找第一个 AI 候补槽位
                    if (assignedSlot === -1) {
                        for (let i = 1; i < 3; i++) {
                            if (!players[i] || players[i].isAi) {
                                assignedSlot = i;
                                break;
                            }
                        }
                    }
                }

                if (assignedSlot === -1) {
                    if (onError) onError('房间人数已满！');
                    return;
                }

                // 实施规则 3：昵称去重（传入 assignedSlot 排除玩家自身槽位，避免重连被误判重名加 _2 后缀）
                const finalNick = this._ensureUniqueNickname(nickname, players, assignedSlot);

                this.myPlayerIndex = assignedSlot;
                console.log(`[CloudEngine] 加入房间成功，分配槽位 ${assignedSlot} (${this.isHost ? '房主' : '玩家'})`);

                const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';

                // 更新云端该槽位的玩家信息 + 刷新真人活动时间
                players[assignedSlot] = {
                    name: finalNick,
                    avatar: currentAvatar,
                    isAi: false,
                    isHost: this.isHost,
                    sid: this.sessionId
                };

                this.roomRef.child('lastHumanActivity').set(Date.now());

                return this.roomRef.child('lobbyData/players').set(players).then(() => {
                    // 如果是房主重连，挂载房主监听
                    if (this.isHost) {
                        this.roomRef.child('action').on('value', snap => {
                            const act = snap.val();
                            if (act && act.id && act.id !== this._lastProcessedActionId) {
                                this._lastProcessedActionId = act.id;
                                this.roomRef.child('lastHumanActivity').set(Date.now());
                                if (window.GameEngine) {
                                    window.GameEngine.handlePlayerAction(act.playerIndex, act.action, act.payload);
                                }
                            }
                        });
                    }

                    // 监听全局状态更新
                    this.roomRef.child('gameState').on('value', snap => {
                        const state = snap.val();
                        if (!state && roomData.gameState) {
                            // 房间被物理移除
                            if (this.onToast) this.onToast('⌛ 房间超时关闭');
                            this.clearSession();
                            window.location.href = window.location.pathname;
                            return;
                        }
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
                            this.roomRef.child('lastHumanActivity').set(Date.now());
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
       客户端发送指令（写入云端 action 节点，刷新真人活动时间）
       ==================================================================== */
    sendActionToHost(action, payload) {
        if (this.isHost || this.isAiMode) {
            if (window.GameEngine) {
                // 规则 2：真人房主点击按键，刷新真人活动时间
                if (this.roomRef && !this.isAiMode) {
                    this.roomRef.child('lastHumanActivity').set(Date.now());
                }
                window.GameEngine.handlePlayerAction(this.myPlayerIndex, action, payload);
            }
        } else if (this.roomRef) {
            // 规则 2：真人客户端发送动作，刷新真人活动时间
            this.roomRef.child('lastHumanActivity').set(Date.now());

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
       广播快捷聊天短语（写入云端）
       ==================================================================== */
    broadcastChatPhrase(senderIndex, text) {
        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('lastHumanActivity').set(Date.now());
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

    /* ====================================================================
       清除所有 Firebase 云端监听器（退出房间时调用）
       ==================================================================== */
    _removeAllListeners() {
        try {
            if (this.roomRef) {
                this.roomRef.off();
                this.roomRef = null;
            }
        } catch (e) {}
    }
}

const NetworkManager = new P2PManager();
