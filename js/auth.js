/* ==========================================================================
   用户认证与个人战绩管理系统 (Firebase Realtime Database Direct Engine)
   因币资产 (Yin Coins) + 每日登录活跃自动静默发放 100 因币 (0点刷新)
   ========================================================================== */

/**
 * 敏感字符过滤与昵称安全化函数
 * 自动强行剔除：乃、奶、坚、cnj（不区分大小写）、nj（不区分大小写）
 */
window.sanitizeNickname = function(nick) {
    if (!nick) return '';
    let clean = String(nick).replace(/乃|奶|坚|cnj|nj/gi, '').trim();
    if (!clean) {
        clean = '玩家_' + Math.floor(100 + Math.random() * 900);
    }
    return clean;
};

class AuthManager {
    constructor() {
        this.db = null;
        this.user = null;
        this.userData = null;
        this.onAuthChanged = null;

        this._initDB();
    }

    _initDB() {
        if (typeof firebase !== 'undefined' && firebase.database) {
            this.db = firebase.database();
            this.checkAutoLogin();
        } else {
            setTimeout(() => this._initDB(), 400);
        }
    }

    /* 获取当天日期字符串 (YYYY-MM-DD，每天0点刷新) */
    getTodayDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /* 账号 Key 安全转义 (去除 Firebase 禁止字符) */
    _encodeKey(str) {
        return (str || '').trim().toLowerCase().replace(/[\.\$\#\[\]\/]/g, '_');
    }

    /* ====================================================================
       自动补全与追溯历史账号的数字 UID (从 10001 开始按注册时间递增)
       ==================================================================== */
    _assignUidsToExistingUsers(callback) {
        if (!this.db) {
            if (callback) callback(0);
            return;
        }

        this.db.ref('users').once('value').then(snap => {
            const usersMap = snap.val() || {};
            const usersList = Object.keys(usersMap).map(k => usersMap[k]);

            // 按注册创建时间升序排序 (未带 created 的按 0 处理)
            usersList.sort((a, b) => (a.created || 0) - (b.created || 0));

            const updatePromises = [];
            usersList.forEach((user, idx) => {
                const assignedUid = 10001 + idx;
                if (!user.uid || user.uid !== assignedUid) {
                    user.uid = assignedUid;
                    if (user.accountKey) {
                        updatePromises.push(this.db.ref('users/' + user.accountKey + '/uid').set(assignedUid));
                    }
                }
            });

            Promise.all(updatePromises).then(() => {
                if (callback) callback(usersList.length);
            }).catch(() => {
                if (callback) callback(usersList.length);
            });
        }).catch(() => {
            if (callback) callback(0);
        });
    }

    /* ====================================================================
       自动静默领取每日 100 因币 (像 B站 一样：检测到账号今天活跃直接发放)
       ==================================================================== */
    checkAndAutoClaimDailyReward() {
        if (!this.userData || !this.db || !this.userData.accountKey) return;

        const today = this.getTodayDateString();

        // 已经领过今天的福利，无需重复发放
        if (this.userData.lastClaimDate === today) return;

        const accountKey = this.userData.accountKey;
        const newYinCoins = (this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000) + 100;

        // 记录发放状态
        this.userData.lastClaimDate = today;
        this.userData.yinCoins = newYinCoins;

        this.db.ref('users/' + accountKey).update({
            yinCoins: newYinCoins,
            lastClaimDate: today
        }).then(() => {
            this.updateUserHeaderUI();
            if (typeof UIRenderer !== 'undefined') {
                UIRenderer.showToast(`🎁 检测到今日活跃，已自动发放今日福利：+100 知因币！(累计: ${newYinCoins})`, 4000);
            }
        }).catch(() => {});
    }

    /* ====================================================================
       自动登录恢复 (从 localStorage 恢复已登录账号)
       ==================================================================== */
    checkAutoLogin() {
        const savedAccountKey = localStorage.getItem('youjing_doudizhu_account_key');
        if (savedAccountKey && this.db) {
            this.db.ref('users/' + savedAccountKey).once('value').then(snap => {
                const data = snap.val();
                if (data) {
                    // 数据兼容：如果旧数据只有 coins/score，自动迁移到 yinCoins
                    if (data.yinCoins === undefined) {
                        data.yinCoins = data.coins || 1000;
                    }
                    // 补全旧账号缺失的 UID
                    if (!data.uid) {
                        this._assignUidsToExistingUsers(() => {
                            this.db.ref('users/' + savedAccountKey).once('value').then(s2 => {
                                this.userData = s2.val() || data;
                                this.checkAndAutoClaimDailyReward();
                                this.updateUserHeaderUI();
                            });
                        });
                    }
                    // 检查并清洗已存在账号的敏感字符 (乃, 坚, cnj, nj)
                    if (data.nickname) {
                        const cleanNick = window.sanitizeNickname(data.nickname);
                        if (cleanNick !== data.nickname) {
                            console.log('[Sanitize] 已屏蔽敏感词，自动更新旧昵称:', data.nickname, '->', cleanNick);
                            data.nickname = cleanNick;
                            this.db.ref('users/' + savedAccountKey + '/nickname').set(cleanNick);
                        }
                    }
                    this.userData = data;
                    this.user = { uid: savedAccountKey };
                    localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
                    const input = document.getElementById('nicknameInput');
                    if (input) input.value = data.nickname;
                    if (this.onAuthChanged) this.onAuthChanged(this.user, data);
                    
                    // 自动发放今日活跃 100 因币
                    this.checkAndAutoClaimDailyReward();
                    this.updateUserHeaderUI();
                }
            }).catch(() => {});
        } else {
            this.updateUserHeaderUI();
        }
    }

    /* 格式化 QQ 邮箱 / 普通账号 */
    _formatEmail(inputStr) {
        let trimmed = (inputStr || '').trim();
        if (/^\d+$/.test(trimmed)) return `${trimmed}@qq.com`;
        if (!trimmed.includes('@')) return `${trimmed}@qq.com`;
        return trimmed;
    }

    /* ====================================================================
       专用测试账号 09966 / 09966 特殊快速登录与自动创建逻辑
       ==================================================================== */
    _handleTestAccountLogin(onSuccess, onError) {
        const testAccountKey = '09966_qq_com';
        const today = this.getTodayDateString();
        const testData = {
            uid: 9966,
            accountKey: testAccountKey,
            email: '09966@qq.com',
            password: '09966',
            nickname: '测试账号 09966',
            avatar: '⚡',
            yinCoins: 99999,
            lastClaimDate: today,
            totalGames: 99,
            wins: 66,
            landlordWins: 33,
            farmerWins: 33,
            bombsPlayed: 88,
            created: Date.now()
        };

        const completeLogin = (data) => {
            this.userData = data;
            this.user = { uid: testAccountKey };
            localStorage.setItem('youjing_doudizhu_account_key', testAccountKey);
            localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = data.nickname;

            this.checkAndAutoClaimDailyReward();
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(data);
        };

        if (!this.db) {
            completeLogin(testData);
            return;
        }

        this.db.ref('users/' + testAccountKey).once('value').then(snap => {
            if (snap.exists()) {
                const data = snap.val();
                completeLogin(data);
            } else {
                this.db.ref('users/' + testAccountKey).set(testData).then(() => {
                    completeLogin(testData);
                }).catch(() => {
                    completeLogin(testData);
                });
            }
        }).catch(() => {
            completeLogin(testData);
        });
    }

    /* ====================================================================
       账号密码注册 (自动计算递增 UID，初始赠送 1000 因币)
       ==================================================================== */
    registerWithEmail(inputAccount, password, nickname, onSuccess, onError) {
        const cleanInput = (inputAccount || '').trim();
        if ((cleanInput === '09966' || cleanInput === '09966@qq.com') && password === '09966') {
            this._handleTestAccountLogin(onSuccess, onError);
            return;
        }

        if (!this.db) {
            if (onError) onError('云端服务未连接，请刷新页面重试');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const accountKey = this._encodeKey(email);
        let nick = window.sanitizeNickname(nickname || '斗地主高手');

        if (!password || password.length < 6) {
            if (onError) onError('密码长度至少需要 6 位');
            return;
        }

        // 检查账号是否已被注册
        this.db.ref('users/' + accountKey).once('value').then(snap => {
            if (snap.exists()) {
                if (onError) onError('该 QQ 邮箱/账号已被注册！');
                return;
            }

            // 计算全局累积玩家数量，自动生成按时间递增的 UID
            this._assignUidsToExistingUsers((totalUsersCount) => {
                const assignedUid = 10001 + totalUsersCount;
                const nowTs = Date.now();
                const today = this.getTodayDateString();

                const initialData = {
                    uid: assignedUid,        // 专属递增数字 UID
                    accountKey: accountKey,
                    email: email,
                    password: password,
                    nickname: nick,
                    avatar: '🤠',
                    yinCoins: 1000,          // 默认新注册就赠送 1000 因币
                    lastClaimDate: today,    // 注册当天标记为已自动获得今日因币
                    totalGames: 0,
                    wins: 0,
                    landlordWins: 0,
                    farmerWins: 0,
                    bombsPlayed: 0,
                    created: nowTs           // 记录精准注册时间戳
                };

                return this.db.ref('users/' + accountKey).set(initialData).then(() => {
                    this.userData = initialData;
                    this.user = { uid: accountKey };
                    localStorage.setItem('youjing_doudizhu_account_key', accountKey);
                    localStorage.setItem('youjing_doudizhu_nickname', nick);
                    const input = document.getElementById('nicknameInput');
                    if (input) input.value = nick;
                    this.updateUserHeaderUI();
                    if (onSuccess) onSuccess(initialData);
                });
            });
        }).catch(err => {
            console.error('[Auth] 注册失败:', err);
            if (onError) onError('注册失败: ' + err.message);
        });
    }

    /* ====================================================================
       账号密码登录
       ==================================================================== */
    loginWithEmail(inputAccount, password, onSuccess, onError) {
        const cleanInput = (inputAccount || '').trim();
        if ((cleanInput === '09966' || cleanInput === '09966@qq.com') && password === '09966') {
            this._handleTestAccountLogin(onSuccess, onError);
            return;
        }

        if (!this.db) {
            if (onError) onError('云端服务未连接，请刷新页面重试');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const accountKey = this._encodeKey(email);

        this.db.ref('users/' + accountKey).once('value').then(snap => {
            const data = snap.val();
            if (!data) {
                if (onError) onError('账号不存在，请先注册');
                return;
            }

            if (data.password !== password) {
                if (onError) onError('密码错误，请检查后再试');
                return;
            }

            if (data.yinCoins === undefined) {
                data.yinCoins = data.coins || 1000;
            }

            // 检查并清洗已存在账号的敏感字符 (乃, 坚, cnj, nj)
            if (data.nickname) {
                const cleanNick = window.sanitizeNickname(data.nickname);
                if (cleanNick !== data.nickname) {
                    console.log('[Sanitize] 已屏蔽敏感词，自动更新旧昵称:', data.nickname, '->', cleanNick);
                    data.nickname = cleanNick;
                    this.db.ref('users/' + accountKey + '/nickname').set(cleanNick);
                }
            }

            this.userData = data;
            this.user = { uid: accountKey };
            localStorage.setItem('youjing_doudizhu_account_key', accountKey);
            localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = data.nickname;

            // 登录成功，自动检查发放今日 100 因币
            this.checkAndAutoClaimDailyReward();

            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(data);
        }).catch(err => {
            console.error('[Auth] 登录失败:', err);
            if (onError) onError('登录失败: ' + err.message);
        });
    }

    /* ====================================================================
       退出登录
       ==================================================================== */
    logout(onSuccess) {
        this.userData = null;
        this.user = null;
        localStorage.removeItem('youjing_doudizhu_account_key');
        this.updateUserHeaderUI();
        if (onSuccess) onSuccess();
    }

    /* 检查今天是否可以修改昵称 (每天限改1次) */
    canRenameToday() {
        if (!this.userData) return false;
        const today = this.getTodayDateString();
        return this.userData.lastRenameDate !== today;
    }

    /* 修改玩家昵称 (每天限1次) */
    changeNickname(newNickname, onSuccess, onError) {
        if (!this.userData || !this.db || !this.userData.accountKey) {
            if (onError) onError('请先登录账号后再修改昵称');
            return;
        }

        if (!this.canRenameToday()) {
            if (onError) onError('每天只能修改一次昵称，明天0点后可再次修改');
            return;
        }

        let nick = window.sanitizeNickname(newNickname);
        if (!nick || nick.length > 10) {
            if (onError) onError('改名后有效字符不能为空且不能超过 10 个字符');
            return;
        }

        const today = this.getTodayDateString();
        const accountKey = this.userData.accountKey;

        this.db.ref('users/' + accountKey).update({
            nickname: nick,
            lastRenameDate: today
        }).then(() => {
            this.userData.nickname = nick;
            this.userData.lastRenameDate = today;
            localStorage.setItem('youjing_doudizhu_nickname', nick);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = nick;
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(nick);
        }).catch(err => {
            if (onError) onError('修改昵称失败：' + err.message);
        });
    }

    /* 更换玩家头像 */
    changeAvatar(newAvatar, onSuccess, onError) {
        if (!this.userData || !this.db || !this.userData.accountKey) {
            if (onError) onError('请先登录账号后再更换头像');
            return;
        }

        const avatar = (newAvatar || '🤠').trim();
        const accountKey = this.userData.accountKey;

        this.db.ref('users/' + accountKey).update({
            avatar: avatar
        }).then(() => {
            this.userData.avatar = avatar;
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(avatar);
        }).catch(err => {
            if (onError) onError('更换头像失败：' + err.message);
        });
    }

    /* ====================================================================
       更新比赛战绩（只记录对局输赢，暂不扣除/加因币）
       ==================================================================== */
    updateStats(isWin, role, bombsCount, multiplier) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const isLandlord  = (role === 'LANDLORD');
        const newTotal = (this.userData.totalGames || 0) + 1;
        const newWins  = (this.userData.wins || 0) + (isWin ? 1 : 0);
        const newLWins = (this.userData.landlordWins || 0) + (isWin && isLandlord ? 1 : 0);
        const newFWins = (this.userData.farmerWins || 0) + (isWin && !isLandlord ? 1 : 0);
        const newBombs = (this.userData.bombsPlayed || 0) + (bombsCount || 0);

        const historyItem = {
            id: Date.now(),
            isWin: isWin,
            role: isLandlord ? '资本家' : '牛马',
            multiplier: multiplier || 1,
            bombs: bombsCount || 0,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        const currentHistory = Array.isArray(this.userData.matchHistory) ? this.userData.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const updatePayload = {
            totalGames: newTotal,
            wins: newWins,
            landlordWins: newLWins,
            farmerWins: newFWins,
            bombsPlayed: newBombs,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey).update(updatePayload).then(() => {
            Object.assign(this.userData, updatePayload);
            this.updateUserHeaderUI();
        });
    }

    /**
     * 独立记录五子棋战绩 (胜、负、平，与斗地主战绩隔离)
     */
    recordGomokuMatchResult(isWin, isDraw = false) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const currentGomoku = this.userData.gomokuStats || {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchHistory: []
        };

        const newTotal = (currentGomoku.totalGames || 0) + 1;
        const newWins = (currentGomoku.wins || 0) + (isWin ? 1 : 0);
        const newDraws = (currentGomoku.draws || 0) + (isDraw ? 1 : 0);
        const newLosses = (currentGomoku.losses || 0) + (!isWin && !isDraw ? 1 : 0);

        let roleText = isWin ? '五子连珠' : (isDraw ? '盘满平局' : '败局');
        const historyItem = {
            id: Date.now(),
            gameType: 'GOMOKU',
            isWin: isWin,
            isDraw: isDraw,
            role: roleText,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };

        const currentHistory = Array.isArray(currentGomoku.matchHistory) ? currentGomoku.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const newGomokuStats = {
            totalGames: newTotal,
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey + '/gomokuStats').set(newGomokuStats).then(() => {
            if (!this.userData.gomokuStats) this.userData.gomokuStats = {};
            Object.assign(this.userData.gomokuStats, newGomokuStats);
        }).catch(() => {});
    }

    /* ====================================================================
       获取全网因币资产排行榜 Top 10
       ==================================================================== */
    fetchLeaderboard(callback) {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('users').orderByChild('yinCoins').limitToLast(15).once('value').then(snap => {
            const map = snap.val() || {};
            const list = [];
            Object.keys(map).forEach(key => {
                const u = map[key];
                if (u && u.accountKey !== '09966_qq_com' && u.uid !== 9966 && u.email !== '09966@qq.com') {
                    list.push(u);
                }
            });
            list.sort((a, b) => (b.yinCoins || 0) - (a.yinCoins || 0));
            if (callback) callback(list.slice(0, 10));
        }).catch(err => {
            console.error('[Auth] 排行榜加载失败:', err);
            if (callback) callback([]);
        });
    }

    /**
     * 更新/结算玩家【知因币】资产 (支持增加正值、扣除负值，强制带零分保底保值)
     */
    updateCoins(deltaCoins, reason = '') {
        if (!this.userData) return 0;

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        let newCoins = currentCoins + deltaCoins;

        // 🛡️ 零分保底法则：绝不产生负数积分
        if (newCoins < 0) newCoins = 0;

        this.userData.yinCoins = newCoins;

        if (this.db && this.userData.accountKey) {
            this.db.ref('users/' + this.userData.accountKey + '/yinCoins').set(newCoins);
        }

        this.updateUserHeaderUI();

        if (reason && typeof UIRenderer !== 'undefined') {
            const sign = deltaCoins >= 0 ? '+' : '';
            const colorStr = deltaCoins >= 0 ? '#4cd964' : '#ff3b30';
            UIRenderer.showToast(`🪙 知因币: <span style="color:${colorStr};font-weight:bold;">${sign}${deltaCoins}</span> (${reason})`);
        }

        return newCoins;
    }

    /**
     * 校验并扣除游戏开局【对局入场费】
     * 五子棋: 10 币 (PVE 3 币)
     * 斗地主: 20 币 (PVE 5 币)
     * 麻将:   30 币 (PVE 8 币)
     */
    checkAndDeductEntryFee(gameType = 'DOUDIZHU', isPve = false) {
        if (!this.userData) return true;

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        let fee = 20;
        if (isPve) {
            fee = 1; // 人机局切磋统一固定仅收 1 知因币！
        } else if (gameType === 'GOMOKU') {
            fee = 10;
        } else if (gameType === 'MAHJONG') {
            fee = 30;
        } else {
            fee = 20;
        }

        if (currentCoins < fee) {
            if (typeof UIRenderer !== 'undefined') {
                UIRenderer.showToast(`⚠️ 知因币不足！开启对局需缴发入场费 ${fee} 币 (当前余额: ${currentCoins})`, 4000);
            }
            if (currentCoins < 50) {
                this.claimBankruptcyAid();
            }
            return false;
        }

        this.updateCoins(-fee, `对局入场费 (-${fee}币)`);
        return true;
    }

    /**
     * 领取破产救济金 (+100 知因币，每天限 3 次)
     */
    claimBankruptcyAid() {
        if (!this.userData) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('⚠️ 请先登录账号再领取破产补助！');
            return false;
        }

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        if (currentCoins >= 50) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('💡 知因币余额仍充足 (≥50)，暂无需领取破产补助');
            return false;
        }

        const today = this.getTodayDateString();
        const countKey = 'bankruptcyCount_' + today;

        let claimCount = (this.userData[countKey] || 0);
        if (claimCount >= 3) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('🛑 今日 3 次破产补助额度已用完，明天 0点 自动恢复！');
            return false;
        }

        claimCount += 1;
        this.userData[countKey] = claimCount;
        this.updateCoins(100, `破产补助 ${claimCount}/3`);

        if (this.db && this.userData.accountKey) {
            this.db.ref('users/' + this.userData.accountKey + '/' + countKey).set(claimCount);
        }
        return true;
    }

    /* ====================================================================
       刷新顶部栏与大厅用户信息组件
       ==================================================================== */
    updateUserHeaderUI() {
        const badge = document.getElementById('userHeaderBadge');
        const lAuthAvatar = document.getElementById('lobbyAuthAvatar');
        const lUserNick = document.getElementById('lobbyUserNick');
        const lUserSub  = document.getElementById('lobbyUserSub');
        const lBtnAuth  = document.getElementById('btnLobbyAuth');
        const gAuthAvatar = document.getElementById('gomokuAuthAvatar');
        const gUserNick = document.getElementById('gomokuUserNick');
        const gUserSub  = document.getElementById('gomokuUserSub');
        const gBtnAuth  = document.getElementById('btnGomokuAuth');
        const mAuthAvatar = document.getElementById('mahjongAuthAvatar');
        const mUserNick = document.getElementById('mahjongUserNick');
        const mUserSub  = document.getElementById('mahjongUserSub');
        const mBtnAuth  = document.getElementById('btnMahjongAuth');
        const nickSec   = document.querySelector('.nickname-section');

        if (this.userData) {
            const currentYin = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;

            if (badge) {
                badge.innerHTML = `
                    <span class="user-avatar-text">${this.userData.avatar || '🤠'}</span>
                    <div class="user-header-info">
                        <span class="user-header-nick">${this.userData.nickname}</span>
                        <span class="user-header-score">🪙 ${currentYin} 知因币</span>
                    </div>
                `;
            }
            if (lAuthAvatar) lAuthAvatar.textContent = this.userData.avatar || '🤠';
            if (lUserNick)   lUserNick.textContent   = this.userData.nickname;
            if (lUserSub)    lUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (lBtnAuth)    lBtnAuth.textContent    = '个人信息';

            if (gAuthAvatar) gAuthAvatar.textContent = this.userData.avatar || '🤠';
            if (gUserNick)   gUserNick.textContent   = this.userData.nickname;
            if (gUserSub)    gUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (gBtnAuth)    gBtnAuth.textContent    = '个人信息';

            if (mAuthAvatar) mAuthAvatar.textContent = this.userData.avatar || '🤠';
            if (mUserNick)   mUserNick.textContent   = this.userData.nickname;
            if (mUserSub)    mUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (mBtnAuth)    mBtnAuth.textContent    = '个人信息';

            // 登录后隐去随机昵称区块，避免误导
            if (nickSec) nickSec.style.display   = 'none';

            // 保持 nicknameInput 与账号昵称严格同步
            const input = document.getElementById('nicknameInput');
            if (input) input.value = this.userData.nickname;
        } else {
            if (badge) {
                badge.innerHTML = `
                    <i class="fa-solid fa-circle-user" style="font-size:1.2rem;color:#ffd700;"></i>
                    <span style="font-size:0.8rem;font-weight:700;color:#fff;">登录 / 注册</span>
                `;
            }
            if (lAuthAvatar) lAuthAvatar.textContent = '👤';
            if (lUserNick)   lUserNick.textContent   = '未登录 (游客)';
            if (lUserSub)    lUserSub.textContent    = '🪙 知因币: 0';
            if (lBtnAuth)    lBtnAuth.textContent    = '登录 / 注册';

            if (gAuthAvatar) gAuthAvatar.textContent = '👤';
            if (gUserNick)   gUserNick.textContent   = '未登录 (游客)';
            if (gUserSub)    gUserSub.textContent    = '🪙 知因币: 0';
            if (gBtnAuth)    gBtnAuth.textContent    = '登录 / 注册';

            if (mAuthAvatar) mAuthAvatar.textContent = '👤';
            if (mUserNick)   mUserNick.textContent   = '未登录 (游客)';
            if (mUserSub)    mUserSub.textContent    = '🪙 知因币: 0';
            if (mBtnAuth)    mBtnAuth.textContent    = '登录 / 注册';

            // 游客模式显示随机昵称区块
            if (nickSec) nickSec.style.display   = 'block';
        }
    }
}

const AuthEngine = new AuthManager();
