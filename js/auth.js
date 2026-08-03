/* ==========================================================================
   用户认证与个人战绩管理系统 (Firebase Auth & Stats System)
   ========================================================================== */

class AuthManager {
    constructor() {
        this.auth = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
        this.db   = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
        this.user = null;
        this.userData = null;

        this.onAuthChanged = null;

        this._initAuthListener();
    }

    _initAuthListener() {
        if (!this.auth) return;
        this.auth.onAuthStateChanged(user => {
            this.user = user;
            if (user) {
                this.fetchUserData(user.uid, (data) => {
                    this.userData = data;
                    if (data && data.nickname) {
                        localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
                        const input = document.getElementById('nicknameInput');
                        if (input) input.value = data.nickname;
                    }
                    if (this.onAuthChanged) this.onAuthChanged(user, data);
                    this.updateUserHeaderUI();
                });
            } else {
                this.userData = null;
                if (this.onAuthChanged) this.onAuthChanged(null, null);
                this.updateUserHeaderUI();
            }
        });
    }

    /* ====================================================================
       格式化 QQ 邮箱 / 普通账号
       ==================================================================== */
    _formatEmail(inputStr) {
        let trimmed = (inputStr || '').trim();
        // 如果用户只输入了纯数字（如 12345678），自动补充为 12345678@qq.com
        if (/^\d+$/.test(trimmed)) {
            return `${trimmed}@qq.com`;
        }
        // 如果没包含 @，补充为 @qq.com
        if (!trimmed.includes('@')) {
            return `${trimmed}@qq.com`;
        }
        return trimmed;
    }

    /* ====================================================================
       账号密码注册 (支持 QQ 邮箱)
       ==================================================================== */
    registerWithEmail(inputAccount, password, nickname, onSuccess, onError) {
        if (!this.auth) {
            if (onError) onError('认证服务未加载');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const nick  = (nickname || '').trim() || '斗地主高手';

        if (!password || password.length < 6) {
            if (onError) onError('密码长度至少需要 6 位');
            return;
        }

        this.auth.createUserWithEmailAndPassword(email, password).then(cred => {
            const uid = cred.user.uid;
            const initialData = {
                uid: uid,
                email: email,
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

            return this.db.ref('users/' + uid).set(initialData).then(() => {
                this.userData = initialData;
                localStorage.setItem('youjing_doudizhu_nickname', nick);
                if (onSuccess) onSuccess(initialData);
            });
        }).catch(err => {
            console.error('[Auth] 注册失败:', err);
            let msg = err.message;
            if (err.code === 'auth/email-already-in-use') msg = '该 QQ 邮箱/账号已被注册！';
            if (err.code === 'auth/invalid-email') msg = '请输入有效的账号或 QQ 邮箱';
            if (onError) onError(msg);
        });
    }

    /* ====================================================================
       账号密码登录 (支持 QQ 邮箱)
       ==================================================================== */
    loginWithEmail(inputAccount, password, onSuccess, onError) {
        if (!this.auth) {
            if (onError) onError('认证服务未加载');
            return;
        }

        const email = this._formatEmail(inputAccount);

        this.auth.signInWithEmailAndPassword(email, password).then(cred => {
            this.fetchUserData(cred.user.uid, (data) => {
                this.userData = data;
                if (onSuccess) onSuccess(data);
            });
        }).catch(err => {
            console.error('[Auth] 登录失败:', err);
            let msg = err.message;
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                msg = '账号或密码错误，请检查后再试';
            }
            if (onError) onError(msg);
        });
    }

    /* ====================================================================
       微信 / 快捷模拟登录
       ==================================================================== */
    loginWeChatQuick(onSuccess, onError) {
        if (!this.auth) {
            if (onError) onError('认证服务未加载');
            return;
        }

        // 使用 Firebase 匿名/快捷认证登录
        this.auth.signInAnonymously().then(cred => {
            const uid = cred.user.uid;
            this.db.ref('users/' + uid).once('value').then(snap => {
                let data = snap.val();
                if (!data) {
                    const savedNick = localStorage.getItem('youjing_doudizhu_nickname') || '微信大玩家';
                    data = {
                        uid: uid,
                        email: 'wechat_quick@wx.com',
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
                    this.db.ref('users/' + uid).set(data);
                }
                this.userData = data;
                if (onSuccess) onSuccess(data);
            });
        }).catch(err => {
            console.error('[Auth] 微信快捷登录异常:', err);
            if (onError) onError('快捷登录失败: ' + err.message);
        });
    }

    /* ====================================================================
       退出登录
       ==================================================================== */
    logout(onSuccess) {
        if (!this.auth) return;
        this.auth.signOut().then(() => {
            this.userData = null;
            if (onSuccess) onSuccess();
        });
    }

    /* ====================================================================
       拉取用户个人数据
       ==================================================================== */
    fetchUserData(uid, callback) {
        if (!this.db || !uid) return;
        this.db.ref('users/' + uid).once('value').then(snap => {
            const data = snap.val();
            if (callback) callback(data);
        }).catch(() => {
            if (callback) callback(null);
        });
    }

    /* ====================================================================
       更新个人比赛战绩（结算后调用）
       ==================================================================== */
    updateStats(isWin, role, bombsCount, multiplier) {
        if (!this.user || !this.userData || !this.db) return;
        const uid = this.user.uid;

        const isLandlord = (role === 'LANDLORD');
        const scoreChange = isWin ? (multiplier * 50) : -(multiplier * 30);
        const coinChange  = isWin ? (multiplier * 100) : -(multiplier * 50);

        const newTotal    = (this.userData.totalGames || 0) + 1;
        const newWins     = (this.userData.wins || 0) + (isWin ? 1 : 0);
        const newLWins    = (this.userData.landlordWins || 0) + (isWin && isLandlord ? 1 : 0);
        const newFWins    = (this.userData.farmerWins || 0) + (isWin && !isLandlord ? 1 : 0);
        const newBombs    = (this.userData.bombsPlayed || 0) + (bombsCount || 0);
        const newScore    = Math.max(100, (this.userData.score || 1000) + scoreChange);
        const newCoins    = Math.max(0, (this.userData.coins || 1000) + coinChange);

        const updatePayload = {
            totalGames: newTotal,
            wins: newWins,
            landlordWins: newLWins,
            farmerWins: newFWins,
            bombsPlayed: newBombs,
            score: newScore,
            coins: newCoins
        };

        this.db.ref('users/' + uid).update(updatePayload).then(() => {
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
            Object.keys(map).forEach(uid => {
                list.push(map[uid]);
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
