/* ==========================================================================
   用户认证与个人战绩管理系统 (Firebase Realtime Database Direct Engine)
   因币资产 (Yin Coins) + 每日100因币领取 (0点刷新)
   ========================================================================== */

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
                                this.updateUserHeaderUI();
                            });
                        });
                    }
                    this.userData = data;
                    this.user = { uid: savedAccountKey };
                    localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
                    const input = document.getElementById('nicknameInput');
                    if (input) input.value = data.nickname;
                    if (this.onAuthChanged) this.onAuthChanged(this.user, data);
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
       账号密码注册 (自动计算递增 UID，初始赠送 1000 因币)
       ==================================================================== */
    registerWithEmail(inputAccount, password, nickname, onSuccess, onError) {
        if (!this.db) {
            if (onError) onError('云端服务未连接，请刷新页面重试');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const accountKey = this._encodeKey(email);
        const nick = (nickname || '').trim() || '斗地主高手';

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

                const initialData = {
                    uid: assignedUid,        // 专属递增数字 UID
                    accountKey: accountKey,
                    email: email,
                    password: password,
                    nickname: nick,
                    avatar: '🤠',
                    yinCoins: 1000,          // 默认新注册就赠送 1000 因币
                    lastClaimDate: '',       // 上次领取每日因币的日期
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

            this.userData = data;
            this.user = { uid: accountKey };
            localStorage.setItem('youjing_doudizhu_account_key', accountKey);
            localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = data.nickname;

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

    /* ====================================================================
       检查今天是否可以领取 100 因币 (每天0点刷新)
       ==================================================================== */
    canClaimDailyReward() {
        if (!this.userData) return false;
        const today = this.getTodayDateString();
        return this.userData.lastClaimDate !== today;
    }

    /* ====================================================================
       领取每日 100 因币福利
       ==================================================================== */
    claimDailyReward(onSuccess, onError) {
        if (!this.userData || !this.db || !this.userData.accountKey) {
            if (onError) onError('请先登录账号后再领取福利');
            return;
        }

        if (!this.canClaimDailyReward()) {
            if (onError) onError('今日 100 因币已领取过，明天0点刷新！');
            return;
        }

        const today = this.getTodayDateString();
        const newYinCoins = (this.userData.yinCoins || 1000) + 100;
        const accountKey = this.userData.accountKey;

        this.db.ref('users/' + accountKey).update({
            yinCoins: newYinCoins,
            lastClaimDate: today
        }).then(() => {
            this.userData.yinCoins = newYinCoins;
            this.userData.lastClaimDate = today;
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(newYinCoins);
        }).catch(err => {
            if (onError) onError('领取失败：' + err.message);
        });
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

        const nick = (newNickname || '').trim();
        if (!nick || nick.length > 10) {
            if (onError) onError('昵称不能为空且不能超过 10 个字符');
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

        const updatePayload = {
            totalGames: newTotal,
            wins: newWins,
            landlordWins: newLWins,
            farmerWins: newFWins,
            bombsPlayed: newBombs
        };

        this.db.ref('users/' + accountKey).update(updatePayload).then(() => {
            Object.assign(this.userData, updatePayload);
            this.updateUserHeaderUI();
        });
    }

    /* ====================================================================
       获取全网因币资产排行榜 Top 10
       ==================================================================== */
    fetchLeaderboard(callback) {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('users').orderByChild('yinCoins').limitToLast(10).once('value').then(snap => {
            const map = snap.val() || {};
            const list = [];
            Object.keys(map).forEach(key => {
                list.push(map[key]);
            });
            list.sort((a, b) => (b.yinCoins || 0) - (a.yinCoins || 0));
            if (callback) callback(list);
        }).catch(err => {
            console.error('[Auth] 排行榜加载失败:', err);
            if (callback) callback([]);
        });
    }

    /* ====================================================================
       刷新顶部栏与大厅用户信息组件
       ==================================================================== */
    updateUserHeaderUI() {
        const badge = document.getElementById('userHeaderBadge');
        const lUserNick = document.getElementById('lobbyUserNick');
        const lUserSub  = document.getElementById('lobbyUserSub');
        const lBtnAuth  = document.getElementById('btnLobbyAuth');
        const lAuthIcon = document.getElementById('lobbyAuthIcon');
        const nickSec   = document.querySelector('.nickname-section');

        if (this.userData) {
            const currentYin = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
            const canClaim = this.canClaimDailyReward();

            if (badge) {
                badge.innerHTML = `
                    <span class="user-avatar-text">${this.userData.avatar || '🤠'}</span>
                    <div class="user-header-info">
                        <span class="user-header-nick">${this.userData.nickname}</span>
                        <span class="user-header-score">🔮 ${currentYin} 因币${canClaim ? ' <span style="color:#34d399;font-size:0.6rem;">(可领)</span>' : ''}</span>
                    </div>
                `;
            }
            if (lUserNick) lUserNick.textContent = `${this.userData.avatar || '🤠'} ${this.userData.nickname}`;
            if (lUserSub)  lUserSub.textContent  = `账号: ${this.userData.email || '已绑定'} | 🔮 资产: ${currentYin} 因币`;
            if (lBtnAuth)  lBtnAuth.textContent  = canClaim ? '🎁 领因币' : '个人信息';
            if (lAuthIcon) lAuthIcon.className   = 'fa-solid fa-id-card-clip auth-avatar-icon';

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
            if (lUserNick) lUserNick.textContent = '未登录 (当前为游客)';
            if (lUserSub)  lUserSub.textContent  = '注册立领 1000 因币，每天登录再发 100 因币！';
            if (lBtnAuth)  lBtnAuth.textContent  = '登录 / 注册';
            if (lAuthIcon) lAuthIcon.className   = 'fa-solid fa-circle-user auth-avatar-icon';

            // 游客模式显示随机昵称区块
            if (nickSec) nickSec.style.display   = 'block';
        }
    }
}

const AuthEngine = new AuthManager();
