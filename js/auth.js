/* ==========================================================================
   用户认证与个人战绩管理系统 (Firebase Realtime Database Direct Engine)
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

    /* 账号 Key 安全转义 (去除 Firebase 禁止的 . $ # [ ] / 字符) */
    _encodeKey(str) {
        return (str || '').trim().toLowerCase().replace(/[\.\$\#\[\]\/]/g, '_');
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

    /* ====================================================================
       格式化 QQ 邮箱 / 普通账号
       ==================================================================== */
    _formatEmail(inputStr) {
        let trimmed = (inputStr || '').trim();
        if (/^\d+$/.test(trimmed)) return `${trimmed}@qq.com`;
        if (!trimmed.includes('@')) return `${trimmed}@qq.com`;
        return trimmed;
    }

    /* ====================================================================
       账号密码注册 (存储于 Firebase Realtime Database users/ 节点)
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

            const initialData = {
                accountKey: accountKey,
                email: email,
                password: password,
                nickname: nick,
                avatar: '🤠',
                coins: 1000,
                score: 1000,
                totalGames: 0,
                wins: 0,
                landlordWins: 0,
                farmerWins: 0,
                bombsPlayed: 0,
                created: firebase.database.ServerValue.TIMESTAMP
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
       微信快捷登录 (自动为该设备/微信生成持久化凭证)
       ==================================================================== */
    loginWeChatQuick(onSuccess, onError) {
        if (!this.db) {
            if (onError) onError('云端服务未连接');
            return;
        }

        let wxSid = localStorage.getItem('ddz_wechat_sid');
        if (!wxSid) {
            wxSid = 'wx_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('ddz_wechat_sid', wxSid);
        }

        const accountKey = this._encodeKey(wxSid);

        this.db.ref('users/' + accountKey).once('value').then(snap => {
            let data = snap.val();
            if (!data) {
                const savedNick = localStorage.getItem('youjing_doudizhu_nickname') || '微信大玩家';
                data = {
                    accountKey: accountKey,
                    email: '微信快捷账号',
                    nickname: savedNick,
                    avatar: '💚',
                    isWechat: true,
                    coins: 1000,
                    score: 1000,
                    totalGames: 0,
                    wins: 0,
                    landlordWins: 0,
                    farmerWins: 0,
                    bombsPlayed: 0,
                    created: firebase.database.ServerValue.TIMESTAMP
                };
                this.db.ref('users/' + accountKey).set(data);
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
            console.error('[Auth] 微信登录失败:', err);
            if (onError) onError('微信登录失败: ' + err.message);
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
       更新比赛战绩与金币积分
       ==================================================================== */
    updateStats(isWin, role, bombsCount, multiplier) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const isLandlord  = (role === 'LANDLORD');
        const scoreChange = isWin ? (multiplier * 50) : -(multiplier * 30);
        const coinChange  = isWin ? (multiplier * 100) : -(multiplier * 50);

        const newTotal = (this.userData.totalGames || 0) + 1;
        const newWins  = (this.userData.wins || 0) + (isWin ? 1 : 0);
        const newLWins = (this.userData.landlordWins || 0) + (isWin && isLandlord ? 1 : 0);
        const newFWins = (this.userData.farmerWins || 0) + (isWin && !isLandlord ? 1 : 0);
        const newBombs = (this.userData.bombsPlayed || 0) + (bombsCount || 0);
        const newScore = Math.max(100, (this.userData.score || 1000) + scoreChange);
        const newCoins = Math.max(0, (this.userData.coins || 1000) + coinChange);

        const updatePayload = {
            totalGames: newTotal,
            wins: newWins,
            landlordWins: newLWins,
            farmerWins: newFWins,
            bombsPlayed: newBombs,
            score: newScore,
            coins: newCoins
        };

        this.db.ref('users/' + accountKey).update(updatePayload).then(() => {
            Object.assign(this.userData, updatePayload);
            this.updateUserHeaderUI();
        });
    }

    /* ====================================================================
       获取全网积分排行榜 Top 10
       ==================================================================== */
    fetchLeaderboard(callback) {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('users').orderByChild('score').limitToLast(10).once('value').then(snap => {
            const map = snap.val() || {};
            const list = [];
            Object.keys(map).forEach(key => {
                list.push(map[key]);
            });
            list.sort((a, b) => (b.score || 0) - (a.score || 0));
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

        if (this.userData) {
            if (badge) {
                badge.innerHTML = `
                    <span class="user-avatar-text">${this.userData.avatar || '🤠'}</span>
                    <div class="user-header-info">
                        <span class="user-header-nick">${this.userData.nickname}</span>
                        <span class="user-header-score">💰 ${this.userData.coins || 1000} | 🏆 ${this.userData.score || 1000}</span>
                    </div>
                `;
            }
            if (lUserNick) lUserNick.textContent = `${this.userData.avatar || '🤠'} ${this.userData.nickname}`;
            if (lUserSub)  lUserSub.textContent  = `💰 资产: ${this.userData.coins || 1000} 金币 | 🏆 积分: ${this.userData.score || 1000}`;
            if (lBtnAuth)  lBtnAuth.textContent  = '查看名片';
            if (lAuthIcon) lAuthIcon.className   = 'fa-solid fa-id-card-clip auth-avatar-icon';
        } else {
            if (badge) {
                badge.innerHTML = `
                    <i class="fa-solid fa-circle-user" style="font-size:1.2rem;color:#ffd700;"></i>
                    <span style="font-size:0.8rem;font-weight:700;color:#fff;">登录 / 注册</span>
                `;
            }
            if (lUserNick) lUserNick.textContent = '未登录 (当前为游客)';
            if (lUserSub)  lUserSub.textContent  = '登录保存战绩名片、天梯积分与金币系统';
            if (lBtnAuth)  lBtnAuth.textContent  = '登录 / 注册';
            if (lAuthIcon) lAuthIcon.className   = 'fa-solid fa-circle-user auth-avatar-icon';
        }
    }
}

const AuthEngine = new AuthManager();
