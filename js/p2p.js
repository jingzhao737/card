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

// 初始化 Firebase 改为异步动态加载: 不在 <head> 同步阻塞
// SDK 从 gstatic CDN 加载 (昨版本验证该 CDN 在用户网络下稳定), 避免全部资源集中到 Cloudflare 下载
const FIREBASE_SDK_URLS = [
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-database-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js'
];

let _firebaseReady = false;
let _firebaseFailed = false;
let _firebaseLoading = false;
const _firebaseWaiters = [];

/**
 * 异步加载 Firebase SDK (按序注入, 完成后 initializeApp)
 * @param {Function} callback  (ok: boolean)
 */
function loadFirebaseSDK(callback) {
    if (_firebaseReady) { if (callback) callback(true); return; }

    // 全局已就绪 (例如后续加载完成后再次调用)
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        _firebaseReady = true;
        _firebaseFailed = false;
        if (callback) callback(true);
        return;
    }

    if (_firebaseFailed) { if (callback) callback(false); return; }
    if (callback) _firebaseWaiters.push(callback);
    if (_firebaseLoading) return;
    _firebaseLoading = true;

    let idx = 0;
    const loadNext = () => {
        if (idx >= FIREBASE_SDK_URLS.length) {
            // 全部加载完成: 初始化 App (auth.js 的 400ms 重试会自动接入)
            try {
                if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
            } catch (e) {
                console.error('[Firebase] initializeApp 失败:', e);
            }
            _firebaseReady = true;
            _firebaseFailed = false;
            _firebaseLoading = false;
            const waiters = _firebaseWaiters.splice(0);
            waiters.forEach(w => { if (w) w(true); });
            return;
        }
        const s = document.createElement('script');
        s.src = FIREBASE_SDK_URLS[idx];
        s.async = true;
        s.onload = () => { idx++; loadNext(); };
        s.onerror = () => { idx++; loadNext(); }; // 单个失败继续尝试下一个
        document.head.appendChild(s);
    };
    loadNext();

    // 25 秒超时兜底: 网络极差时不再无限等待, 通知等待方失败 (游戏本体不受影响)
    setTimeout(() => {
        if (!_firebaseReady) {
            _firebaseFailed = true;
            _firebaseLoading = false;
            const waiters = _firebaseWaiters.splice(0);
            waiters.forEach(w => { if (w) w(false); });
        }
    }, 25000);
}

const SESSION_KEY       = 'ddz_session';     // localStorage key
const GAMESTATE_KEY     = 'ddz_gamestate';   // localStorage key
const SESSION_MAX_AGE   = 30 * 60 * 1000;   // 30 分钟内的会话可恢复
const MAX_INACTIVE_TIME = 3 * 60 * 1000;    // 3 分钟（180,000ms）无真人操作自动销毁房间

class P2PManager {
    constructor() {
        this.db            = null; // Firebase SDK 就绪后自动赋值
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
        this._initDbAsync();
    }

    /**
     * 异步初始化 Firebase 数据库连接 (SDK 可能仍在后台加载)
     */
    _initDbAsync() {
        const tryInit = () => {
            if (typeof firebase !== 'undefined' && firebase.database) {
                try {
                    this.db = firebase.database();
                } catch (e) {
                    this.db = null;
                }
            }
            return !!this.db;
        };

        if (tryInit()) return;

        loadFirebaseSDK(ok => {
            if (ok) {
                tryInit();
                // 通知就绪 (排行榜/大厅可立即拉取)
                if (typeof window.__onFirebaseReady === 'function') {
                    try { window.__onFirebaseReady(); } catch (e) {}
                }
            } else {
                console.warn('[CloudEngine] Firebase SDK 加载超时/失败, 云端房间/排行榜暂不可用, 单机游戏不受影响');
                if (this.onToast) this.onToast('☁️ 云端连接较慢，排行榜可能暂不可用（单机游戏不受影响）', 4000);
            }
        });
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

                const rawPlayers = (room.lobbyData && room.lobbyData.players) ? room.lobbyData.players : [];
                const players = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
                const remainingHumans = players.filter(p => p && !p.isAi && p.sid !== this.sessionId && p.name);

                // 规则：只要该房间内没有其他真人玩家了（无论是房主还是客户端退出），立即彻底销毁删除该房间！
                if (room.hostSid === this.sessionId || remainingHumans.length === 0) {
                    console.log('[CleanRoom] 房间内无其他真人玩家，自动销毁云端房间:', rId);
                    updatePromises.push(this.db.ref('rooms/' + rId).remove());
                } else {
                    // 有其他真人玩家：仅将本设备槽位重置为 AI
                    let modified = false;
                    for (let i = 1; i < players.length; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            console.log(`[CleanRoom] 自动重置旧房间 ${rId} 的槽位 ${i} 为 AI`);
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
        if (typeof window.sanitizeNickname === 'function') {
            unique = window.sanitizeNickname(unique);
        }
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
    fetchPublicRooms(callback, gameTypeFilter = 'DOUDIZHU') {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('rooms').limitToLast(30).once('value').then(snapshot => {
            const roomsMap = snapshot.val() || {};
            const activeRooms = [];
            const now = Date.now();

            Object.keys(roomsMap).forEach(roomId => {
                const room = roomsMap[roomId];
                if (room && room.lobbyData) {
                    room.roomId = roomId;
                    const rawPlayers = room.lobbyData.players;
                    const players = Array.isArray(rawPlayers) ? rawPlayers : (rawPlayers ? Object.values(rawPlayers) : []);
                    room.lobbyData.players = players; // 确保标准化为 Array

                    const lastHuman = (typeof room.lastHumanActivity === 'number' && room.lastHumanActivity > 0)
                        ? room.lastHumanActivity
                        : ((typeof room.created === 'number' && room.created > 0) ? room.created : now);
                    const inactiveDuration = now - lastHuman;

                    // 超过 3 分钟无真人操作 -> 自动从云端数据库清除销毁！
                    if (inactiveDuration > MAX_INACTIVE_TIME) {
                        console.log(`[AutoClean] 房间 ${roomId} 超过 3 分钟无真人操作，自动销毁`);
                        this.db.ref('rooms/' + roomId).remove().catch(() => {});
                    } else {
                        const roomGameType = room.gameType || 'DOUDIZHU';
                        const targetFilter = gameTypeFilter || 'DOUDIZHU';

                        if (roomGameType === targetFilter) {
                            activeRooms.push(room);
                        }
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
    createRoom(nickname, onReady, param3, param4) {
        let roomIdOverride = null;
        let onError = null;
        let gameType = 'DOUDIZHU';

        if (typeof param3 === 'string') {
            roomIdOverride = param3;
            if (typeof param4 === 'string') gameType = param4;
        } else if (typeof param3 === 'function') {
            onError = param3;
            if (typeof param4 === 'string') gameType = param4;
        } else if (typeof param4 === 'string') {
            gameType = param4;
        }

        this.roomId = (typeof roomIdOverride === 'string' && roomIdOverride) ? roomIdOverride : this.generateRoomId();
        this.isHost = true;
        this.myPlayerIndex = 0;
        this.isAiMode = false;
        this.gameType = gameType;

        if (!this.db) {
            if (this.onToast) this.onToast('❌ 云端服务未连接，请检查网络或刷新页面', 4000);
            if (onError) onError('云端服务未连接');
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

            const isGomoku = gameType === 'GOMOKU';
            const isGo = gameType === 'GO';
            const isXiangqi = gameType === 'XIANGQI';
            const isTwoPlayer = isGomoku || isGo || isXiangqi;
            const initialLobby = {
                players: isTwoPlayer ? [
                    { name: finalNick, avatar: currentAvatar, isAi: false, isHost: true, sid: this.sessionId },
                    { name: 'AI 棋圣', avatar: '🤖', isAi: true, isHost: false }
                ] : [
                    { name: finalNick, avatar: currentAvatar, isAi: false, isHost: true, sid: this.sessionId },
                    { name: 'AI-1', avatar: '🤖', isAi: true, isHost: false },
                    { name: 'AI-2', avatar: '🤖', isAi: true, isHost: false }
                ]
            };

            const now = Date.now();
            const roomPayload = {
                roomId: this.roomId,
                gameType: gameType,
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
                this.gameType = roomData.gameType || 'DOUDIZHU';

                // 规则 2：检查该房间是否已超 3 分钟无真人操作
                const lastHuman = roomData.lastHumanActivity || roomData.created || 0;
                if (Date.now() - lastHuman > MAX_INACTIVE_TIME) {
                    this.db.ref('rooms/' + roomId).remove();
                    if (onError) onError('该房间超过 3 分钟无真人操作已自动销毁');
                    return;
                }

                const gameType = roomData.gameType || 'DOUDIZHU';
                this.gameType = gameType;
                if (window.GameEngine) {
                    window.GameEngine.activeGameType = gameType;
                }

                const lobby = roomData.lobbyData || { players: [] };
                const players = lobby.players || [];
                const maxSlotIndex = gameType === 'MAHJONG' ? 3 : ((gameType === 'GOMOKU' || gameType === 'GO' || gameType === 'XIANGQI') ? 1 : 2);

                // 查找属于当前玩家的槽位 (0=房主, 1=玩家2, 2=玩家3, 3=玩家4)
                let assignedSlot = -1;

                // 1. 检查是否是房主 (槽位 0) 重连/加入
                // 注意：只有 sid 匹配才认定房主重连；单纯同名不应覆盖房主槽位，
                // 防止不同设备用相同昵称加入时误抢房主身份
                const isHostSidMatch = roomData.hostSid && roomData.hostSid === this.sessionId;
                const isSlot0SidMatch = players[0] && players[0].sid && players[0].sid === this.sessionId;
                if (isHostSidMatch || isSlot0SidMatch) {
                    assignedSlot = 0;
                    this.isHost = true;
                } else {
                    this.isHost = false;

                    // 2. 客户端重连：优先匹配相同 sid
                    for (let i = 1; i <= maxSlotIndex; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            assignedSlot = i;
                            break;
                        }
                    }

                    // 3. 客户端重连：退而求其次匹配相同 nickname (非 AI)
                    if (assignedSlot === -1) {
                        for (let i = 1; i <= maxSlotIndex; i++) {
                            if (players[i] && !players[i].isAi && players[i].name === nickname) {
                                assignedSlot = i;
                                break;
                            }
                        }
                    }

                    // 4. 新玩家加入：查找第一个 AI 候补槽位
                    if (assignedSlot === -1) {
                        for (let i = 1; i <= maxSlotIndex; i++) {
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

    /**
     * 主动退出房间 (只要房间内没有其他真人玩家了，无论人机还是对局，立即在 Firebase 销毁移除房间)
     */
    leaveRoom(callback) {
        const finish = () => {
            this.clearSession();
            this._removeAllListeners();
            this.roomId = null;
            if (callback) callback();
        };

        if (!this.db || !this.roomId) {
            finish();
            return;
        }

        const currentRoomId = this.roomId;
        const currentSid = this.sessionId;

        this.db.ref('rooms/' + currentRoomId).once('value').then(snapshot => {
            const roomData = snapshot.val();
            if (!roomData) {
                finish();
                return;
            }

            const players = (roomData.lobbyData && roomData.lobbyData.players) ? roomData.lobbyData.players : [];
            const remainingHumans = players.filter(p => p && !p.isAi && p.sid !== currentSid && p.name);

            if (this.isHost || remainingHumans.length === 0) {
                // 房主退出，或者房间内已无其他真人玩家 -> 瞬间彻底关掉删除房间！
                console.log(`[LeaveRoom] 房间 ${currentRoomId} 内无其他真人玩家，立即彻底关掉销毁`);
                this.db.ref('rooms/' + currentRoomId).remove().then(finish).catch(finish);
            } else {
                // 还有其他真人玩家：仅将本设备槽位重置为 AI
                const updatedPlayers = players.map(p => {
                    if (p && p.sid === currentSid) {
                        return { name: '🤖 机器人 AI', avatar: '🤖', isAi: true, isHost: false };
                    }
                    return p;
                });
                this.db.ref(`rooms/${currentRoomId}/lobbyData/players`).set(updatedPlayers).then(finish).catch(finish);
            }
        }).catch(finish);
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
    sendGomokuMove(r, c, color) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').set({
            r,
            c,
            color,
            ts: Date.now()
        });
    }

    sendGomokuTimeout(winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuTimeout').set({
            winnerColor,
            ts: Date.now()
        });
    }

    onGomokuTimeout(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuTimeout').off();
        this.roomRef.child('gomokuTimeout').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    onGomokuMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').off();
        this.roomRef.child('gomokuMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGomokuUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoReq').off();
        this.roomRef.child('gomokuUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGomokuUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoResp').off();
        this.roomRef.child('gomokuUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`gomokuRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onGomokuRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuRematchVotes').off();
        this.roomRef.child('gomokuRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearGomokuRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuRematchVotes').remove();
    }

    sendGomokuClaimBlack(claimedSlot) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').set({
            claimedSlot,
            ts: Date.now()
        });
    }

    onGomokuClaimBlack(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').off();
        this.roomRef.child('gomokuClaimBlack').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearGomokuClaimBlack() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').remove();
    }

    sendMahjongMove(senderSlot, tileIndex, discardedTile, stateData, actionType = 'DISCARD') {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongLastMove').set({
            senderSlot,
            tileIndex,
            discardedTile,
            stateData,
            actionType,
            ts: Date.now()
        });
    }

    onMahjongMove(callback) {
        if (!this.roomRef) return;
        // 先解除旧监听，避免重开一局时监听器累积/旧闭包误判座位
        this.roomRef.child('mahjongLastMove').off();
        this.roomRef.child('mahjongLastMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearMahjongMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongLastMove').remove();
    }

    clearGomokuMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').remove();
    }

    sendGomokuStart(roomId, hostIsBlack = true) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsBlack
        });
    }

    onGomokuStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    /* ============================================================
       ⚫⚪ 围棋 (GO) 云端通信方法
       ============================================================ */
    sendGoMove(r, c, color, pass = false) {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').set({
            r, c, color, pass,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    sendGoPass(color) {
        this.sendGoMove(-1, -1, color, true);
    }

    onGoMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').off();
        this.roomRef.child('goMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearGoMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').remove();
    }

    sendGoStart(roomId, hostIsBlack = true) {
        if (!this.roomRef) return;
        this.roomRef.child('goStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsBlack
        });
    }

    onGoStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoEnd(reason, winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('goEnd').set({
            reason,
            winnerColor,
            ts: Date.now()
        });
    }

    onGoEnd(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goEnd').off();
        this.roomRef.child('goEnd').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGoUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoReq').off();
        this.roomRef.child('goUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGoUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoResp').off();
        this.roomRef.child('goUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`goRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onGoRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goRematchVotes').off();
        this.roomRef.child('goRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearGoRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('goRematchVotes').remove();
    }

    /* ============================================================
       ♞ 中国象棋 (XIANGQI) 云端通信方法
       ============================================================ */
    sendXiangqiMove(fr, fc, tr, tc) {
        if (!this.roomRef) return;
        this.roomRef.child('xqMove').set({
            fr, fc, tr, tc,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqMove').off();
        this.roomRef.child('xqMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiStart(roomId, hostIsRed = true) {
        if (!this.roomRef) return;
        this.roomRef.child('xqStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsRed
        });
    }

    onXiangqiStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiEnd(reason, winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('xqEnd').set({
            reason,
            winnerColor,
            ts: Date.now()
        });
    }

    onXiangqiEnd(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqEnd').off();
        this.roomRef.child('xqEnd').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoReq').off();
        this.roomRef.child('xqUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoResp').off();
        this.roomRef.child('xqUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`xqRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onXiangqiRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqRematchVotes').off();
        this.roomRef.child('xqRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearXiangqiRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('xqRematchVotes').remove();
    }

    sendMahjongStart(roomId) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongStart').set({
            ts: Date.now(),
            hostNick: this.nickname
        });
    }

    onMahjongStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongStart').off();
        this.roomRef.child('mahjongStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendMahjongInitState(stateData) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongInitData').set(stateData);
    }

    onMahjongInitState(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongInitData').off();
        this.roomRef.child('mahjongInitData').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendMahjongRematchStatus(status) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').set(status);
    }

    onMahjongRematchStatus(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').off();
        this.roomRef.child('mahjongRematchStatus').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearMahjongRematchStatus() {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').remove();
    }
}

const NetworkManager = new P2PManager();
