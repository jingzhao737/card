/* ==========================================================================
   游戏主逻辑引擎与大厅控制器 (Main Game Controller & Game Engine)
   ========================================================================== */

class GameEngineController {
    constructor() {
        this.gameState = {
            roomId: '',
            phase: 'LOBBY', // LOBBY, WAITING, BIDDING, PLAYING, GAMEOVER
            players: [
                { id: 0, name: '玩家 1', hand: [], isAi: false, isHost: true, role: 'FARMER' },
                { id: 1, name: '玩家 2', hand: [], isAi: false, isHost: false, role: 'FARMER' },
                { id: 2, name: '玩家 3', hand: [], isAi: false, isHost: false, role: 'FARMER' }
            ],
            currentTurn: 0,
            landlordIndex: -1,
            highestBid: 0,
            highestBidder: -1,
            bidsCount: 0,
            bottomCards: [],
            lastPlay: null, // { playerIndex: 0, cards: [] }
            multiplier: 1,
            baseScore: 150,
            winnerIndex: -1,
            readyPlayers: [false, false, false]
        };

        this.turnTimerId = null;
        this.timerSeconds = 20;
    }

    init() {
        UIRenderer.init();

        // 每次进入/刷新网页时，全自动随机分配一次全新的热梗/B站弹幕昵称
        const nickInput = document.getElementById('nicknameInput');
        if (nickInput) {
            const freshNick = this.generateUniqueNickname();
            nickInput.value = freshNick;
            localStorage.setItem('youjing_doudizhu_nickname', freshNick);
        }

        this.bindLobbyEvents();
        this.checkUrlRoomParam();

        // 监听网络层的全量状态同步与大厅同步事件
        NetworkManager.onStateUpdate = (state) => this.onReceiveStateUpdate(state);
        NetworkManager.onPlayerJoined = (slotIndex, nickname) => this.onPlayerJoined(slotIndex, nickname);
        NetworkManager.onLobbySync = (lobbyData) => this.onReceiveLobbySync(lobbyData);
        NetworkManager.onToast = (msg) => UIRenderer.showToast(msg);
    }

    /**
     * 随机生成 2026 最新爆火热梗与 B站经典弹幕纯文字昵称
     */
    generateUniqueNickname() {
        const bStationMemes = [
            // B站经典弹幕与文化梗
            '一键三连', '我要验牌', '前方高能', '破防了家人们', '下次一定',
            '满级大佬回新手村', '格局打开', '战术后仰', '要素过多', '伤害不高侮辱极强',
            '大佬请喝茶', '弹幕护体', '空降成功', '真香定律', '邪修出牌',
            '硬币都给你', '这波在第五层', '不讲武德', '优势在我', '名场面打卡',
            // 2026 现象级热梗
            '爱你老己', '低山臭水遇知音', '助我破鼎', 'DeepSeek附体', '班味退散',
            '外耗大师', '真冰凉', '活人感拉满', '赛博对账', '浪浪山小妖怪',
            '敬自己一杯', '情绪价值拉满', '建议手臂加强', '留友看', '后面有车',
            '硬核拆车', '过程基础结果不基础', '谷子人', '来财', '对三要不起',
            '绝地王炸', '顺子专业户', '底牌收割机', '王炸破鼎'
        ];
        return bStationMemes[Math.floor(Math.random() * bStationMemes.length)];
    }

    /**
     * 检查 URL 是否携带有 ?room=XXXXXX 参数，如果有则自动进入加入模式
     */
    checkUrlRoomParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdParam = urlParams.get('room');
        if (!roomIdParam) return;

        // 填充房间号输入框
        document.getElementById('joinRoomInput').value = roomIdParam;

        // 显示顶部流量标识条
        const banner = document.getElementById('quickJoinBanner');
        if (banner) {
            banner.style.display = 'block';
            document.getElementById('quickJoinRoomDisplay').textContent = roomIdParam;
        }

        // 隐藏「创建房间」和「单机 AI」按钮，防止手机用户误操作
        const createBtn = document.getElementById('btnCreateRoom');
        const aiBtn = document.getElementById('btnPlayAi');
        const divider = document.querySelector('.divider');
        if (createBtn) createBtn.style.display = 'none';
        if (aiBtn) aiBtn.style.display = 'none';
        if (divider) divider.style.display = 'none';

        // 加入按钮升點显示
        const joinBtn = document.getElementById('btnJoinRoom');
        if (joinBtn) {
            joinBtn.style.background = 'linear-gradient(135deg, #f1c40f, #f39c12)';
            joinBtn.style.color = '#000';
            joinBtn.style.fontWeight = '800';
            joinBtn.style.padding = '12px 24px';
            joinBtn.textContent = '加入房间 →';
        }

        // 自动帮助好友秒级加入房间，无需手动再次点击
        setTimeout(() => {
            const joinBtn = document.getElementById('btnJoinRoom');
            if (joinBtn) joinBtn.click();
        }, 400);
    }

    /**
     * 大厅按钮事件绑定
     */
    bindLobbyEvents() {
        // 🎲 随机昵称生成按钮
        const randNickBtn = document.getElementById('btnRandomNickname');
        if (randNickBtn) {
            randNickBtn.addEventListener('click', () => {
                const newNick = this.generateUniqueNickname();
                const input = document.getElementById('nicknameInput');
                if (input) input.value = newNick;
                localStorage.setItem('youjing_doudizhu_nickname', newNick);
                UIRenderer.showToast(`🎲 已随机分配昵称：${newNick}`);
            });
        }

        // 获取或产生最终昵称并记录本地
        const getNickname = () => {
            const input = document.getElementById('nicknameInput');
            let val = input ? input.value.trim() : '';
            if (!val) val = this.generateUniqueNickname();
            localStorage.setItem('youjing_doudizhu_nickname', val);
            return val;
        };

        // 创建房间
        document.getElementById('btnCreateRoom').addEventListener('click', () => {
            const nickname = getNickname();
            NetworkManager.createRoom(nickname, (roomId) => {
                this.setupWaitingScreen(roomId);
            });
        });

        // 加入房间输入框增强 (自动转大写、回车快捷提交、卡片点击聚焦)
        const joinInput = document.getElementById('joinRoomInput');
        const joinCard = document.querySelector('.join-card');
        if (joinInput) {
            joinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('btnJoinRoom').click();
                }
            });
            joinInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            });
        }
        if (joinCard && joinInput) {
            joinCard.addEventListener('click', (e) => {
                if (e.target !== joinInput && !e.target.closest('#btnJoinRoom')) {
                    joinInput.focus();
                }
            });
        }

        document.getElementById('btnJoinRoom').addEventListener('click', () => {
            const roomId = document.getElementById('joinRoomInput').value.trim();
            const nickname = getNickname();
            if (!roomId) {
                UIRenderer.showToast('请输入有效的 6 位房间号');
                return;
            }

            NetworkManager.joinRoom(roomId, nickname, () => {
                this.enterRoomAsClient(roomId);
            }, (errMsg) => {
                UIRenderer.showToast(errMsg);
            });
        });

        // 单机练习模式 (对战机器人)
        document.getElementById('btnPlayAi').addEventListener('click', () => {
            const nickname = getNickname();
            this.startAiGame(nickname);
        });

        // 复制邀请链接
        document.getElementById('btnCopyInviteUrl').addEventListener('click', () => this.copyInviteUrl());
        document.getElementById('btnCopyLink').addEventListener('click', () => this.copyInviteUrl());

        // 补齐机器人开局
        document.getElementById('btnStartWithAi').addEventListener('click', () => {
            this.fillAiAndStart();
        });

        // 绑定胜负横幅【再来一局】、【收起/关闭】与【展开】事件
        document.addEventListener('click', (e) => {
            const restartBtn = e.target.closest('#btnRestartGame');
            if (restartBtn) {
                const myIndex = NetworkManager.myPlayerIndex;
                if (NetworkManager.isHost) {
                    this.processRestartVote(myIndex);
                } else {
                    NetworkManager.sendActionToHost('RESTART_VOTE', { playerIndex: myIndex });
                }
                return;
            }

            const closeBtn = e.target.closest('#btnCloseVictoryBanner');
            if (closeBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'true';
                    this.onReceiveStateUpdate(this.gameState);
                }
                return;
            }

            const expandBtn = e.target.closest('#btnExpandVictory');
            if (expandBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'false';
                    this.onReceiveStateUpdate(this.gameState);
                }
                return;
            }
        });

        // 绑定【理牌】按钮事件
        const btnSort = document.getElementById('btnSortCards');
        if (btnSort) {
            btnSort.addEventListener('click', () => {
                this.sortSelfHand();
            });
        }

        // 绑定仅点击【自己头像】弹出经典快捷用语菜单与短语发送
        document.addEventListener('click', (e) => {
            const avatarTarget = e.target.closest('#avatarSelf, .self-avatar');
            const menu = document.getElementById('quickPhraseMenu');
            if (avatarTarget && menu) {
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                return;
            }

            const closeBtn = e.target.closest('#btnClosePhrase');
            if (closeBtn && menu) {
                menu.style.display = 'none';
                return;
            }

            const phraseItem = e.target.closest('.phrase-item');
            if (phraseItem && menu) {
                const text = phraseItem.textContent.trim();
                menu.style.display = 'none';
                this.sendChatPhrase(text);
                return;
            }

            // 点击外部自动关闭短语弹窗
            if (menu && menu.style.display !== 'none' && !e.target.closest('#quickPhraseMenu')) {
                menu.style.display = 'none';
            }
        });

        // 绑定左上角【回到主页】与离开房间按钮
        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.addEventListener('click', () => this.resetToLobby());

        // 房主手动点击开始游戏（自动补齐空位为 AI）
        document.getElementById('btnStartGame').addEventListener('click', () => {
            this.fillAiAndStart();
        });

        // 离开/取消等待
        document.getElementById('btnCancelWaiting').addEventListener('click', () => this.resetToLobby());
        document.getElementById('btnLeaveRoom').addEventListener('click', () => this.resetToLobby());

        // 音效开关
        document.getElementById('btnToggleSound').addEventListener('click', () => {
            const isEnabled = SoundEngine.toggleSound();
            document.getElementById('soundIcon').className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
            UIRenderer.showToast(isEnabled ? '音效已开启' : '音效已静音');
        });

        // 牌型说明弹窗
        const cardHelpBtn  = document.getElementById('btnCardHelp');
        const cardTypeModal = document.getElementById('cardTypeModal');
        const closeCardType = document.getElementById('btnCloseCardType');

        if (cardHelpBtn && cardTypeModal) {
            cardHelpBtn.addEventListener('click', () => {
                cardTypeModal.style.display = 'flex';
            });
            closeCardType.addEventListener('click', () => {
                cardTypeModal.style.display = 'none';
            });
            // 点击遮罩层外部关闭
            cardTypeModal.addEventListener('click', (e) => {
                if (e.target === cardTypeModal) cardTypeModal.style.display = 'none';
            });
        }


        // 按钮组事件绑定 (抢手速叫地主/不叫/出牌/不出/提示)
        const bidLandlordBtn = document.getElementById('btnBidLandlord');
        if (bidLandlordBtn) bidLandlordBtn.addEventListener('click', () => this.handleSelfAction('BID', 'CLAIM'));

        const bidPassBtn = document.getElementById('btnBidPass');
        if (bidPassBtn) bidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        const reBid1Btn = document.getElementById('btnReBid1');
        if (reBid1Btn) reBid1Btn.addEventListener('click', () => this.handleSelfAction('BID', 'CLAIM'));

        const reBidPassBtn = document.getElementById('btnReBidPass');
        if (reBidPassBtn) reBidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        document.getElementById('btnPass').addEventListener('click', () => this.handleSelfAction('PLAY', []));
        document.getElementById('btnHint').addEventListener('click', () => this.triggerSmartHint());
        document.getElementById('btnPlayCard').addEventListener('click', () => this.triggerPlayCard());

        // 结算屏按钮
        document.getElementById('btnPlayAgain').addEventListener('click', () => {
            if (NetworkManager.isHost || NetworkManager.isAiMode) {
                this.startNewRound();
            } else {
                UIRenderer.showToast('请等待房主重新开局');
            }
        });
        document.getElementById('btnBackToLobby').addEventListener('click', () => this.resetToLobby());
    }

    /**
     * 进入等待解界面 (Host视角)
     */
    setupWaitingScreen(roomId) {
        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'flex';
        document.getElementById('waitingScreen').classList.add('active');

        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';

        // 如果在 localhost 下运行，提示换成本机 IP
        let origin = window.location.origin;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            UIRenderer.showToast('提示：同一 Wi-Fi 测试请访问局域网 IP 地址', 4000);
        }

        const shareUrl = `${origin}${window.location.pathname}?room=${roomId}`;
        document.getElementById('inviteUrlInput').value = shareUrl;
        document.getElementById('displayRoomId').textContent = roomId;
        document.getElementById('roomInfoBar').style.display = 'flex';

        // 生成二维码
        const qrContainer = document.getElementById('qrcode');
        qrContainer.innerHTML = '';
        if (window.QRCode) {
            new QRCode(qrContainer, {
                text: shareUrl,
                width: 120,
                height: 120
            });
        }

        // 初始化房主 slot0
        this.gameState.players[0].name = NetworkManager.nickname;
        this.gameState.players[0].isAi = false;
        document.getElementById('slotName0').textContent = `${NetworkManager.nickname} (房主)`;

        // 立即展示空位为 AI 机器人（真人加入时再替换）
        this._fillSlotWithAi(1);
        this._fillSlotWithAi(2);

        // 房主始终可以直接开始（空位已预填 AI）
        document.getElementById('btnStartGame').style.display = 'block';
        document.getElementById('btnStartWithAi').style.display = 'none';

        this.broadcastLobbyState();
    }

    /**
     * 将指定 slot 标记为 AI 机器人，并更新 UI
     */
    _fillSlotWithAi(slotIndex) {
        const aiName = `机器人 AI_${slotIndex}`;
        this.gameState.players[slotIndex].name = aiName;
        this.gameState.players[slotIndex].isAi = true;

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = `🤖 ${aiName}`;
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status');
            const avatarEl = slotEl.querySelector('.avatar i');
            if (statusEl) { statusEl.textContent = 'AI 候补'; statusEl.classList.add('ready'); }
            if (avatarEl) { avatarEl.className = 'fa-solid fa-robot'; }
        }
    }

    /**
     * 客户端加入房间视图更新
     */
    enterRoomAsClient(roomId) {
        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'flex';
        document.getElementById('waitingScreen').classList.add('active');
        document.getElementById('displayRoomId').textContent = roomId;
        document.getElementById('roomInfoBar').style.display = 'flex';
        document.getElementById('btnStartGame').style.display = 'none';
        document.getElementById('btnStartWithAi').style.display = 'none';

        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';
        
        // 隐藏不需要给客户端展示的二维码和分享框，保持界面干净
        const qrContainer = document.querySelector('.qr-container');
        if (qrContainer) qrContainer.style.display = 'none';
        const shareBox = document.querySelector('.share-box');
        if (shareBox) shareBox.style.display = 'none';

        UIRenderer.showToast('已进入房间，等待房主开始游戏...');
    }

    /**
     * 当有新玩家加入 (Host处理) — 替换最早的一个 AI 占位符
     */
    onPlayerJoined(slotIndex, nickname) {
        if (!NetworkManager.isHost) return;

        const name = nickname || `玩家 ${slotIndex + 1}`;
        this.gameState.players[slotIndex].name = name;
        this.gameState.players[slotIndex].isAi = false;

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = name;
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status');
            const avatarEl = slotEl.querySelector('.avatar i');
            if (statusEl) { statusEl.textContent = '已就绪'; statusEl.classList.add('ready'); }
            if (avatarEl) { avatarEl.className = 'fa-solid fa-user'; }
        }

        const humanCount = this.gameState.players.filter(p => !p.isAi).length;
        document.getElementById('connectedCount').textContent = humanCount;

        if (humanCount === 3) {
            UIRenderer.showToast('全员就位，可以开始游戏了！');
        }

        this.broadcastLobbyState();
    }

    /**
     * 房主广播组局大厅玩家状态
     */
    broadcastLobbyState() {
        if (!NetworkManager.isHost) return;
        const lobbyData = {
            players: this.gameState.players.map(p => ({
                name: p.name,
                isAi: p.isAi,
                isHost: p.isHost
            }))
        };
        NetworkManager.broadcastLobbySync(lobbyData);
    }

    /**
     * 客户端接收并渲染房间大厅玩家列表
     */
    onReceiveLobbySync(lobbyData) {
        if (!lobbyData || !lobbyData.players) return;
        const myIndex = NetworkManager.myPlayerIndex;

        let humanCount = 0;
        lobbyData.players.forEach((p, i) => {
            const slotEl = document.getElementById(`slot${i}`);
            const nameEl = document.getElementById(`slotName${i}`);
            if (!slotEl || !nameEl) return;

            const statusEl = slotEl.querySelector('.slot-status');
            const avatarEl = slotEl.querySelector('.avatar i');

            if (p.isAi) {
                nameEl.textContent = `🤖 ${p.name}`;
                if (statusEl) { statusEl.textContent = 'AI 候补'; statusEl.classList.add('ready'); }
                if (avatarEl) avatarEl.className = 'fa-solid fa-robot';
            } else if (p.name) {
                humanCount++;
                let displayName = p.name;
                if (i === 0) displayName += ' (房主)';
                if (i === myIndex) displayName += ' (你)';
                nameEl.textContent = displayName;
                if (statusEl) { statusEl.textContent = '已就绪'; statusEl.classList.add('ready'); }
                if (avatarEl) avatarEl.className = 'fa-solid fa-user';
            }
        });

        document.getElementById('connectedCount').textContent = humanCount;
    }

    /**
     * 复制分享链接
     */
    copyInviteUrl() {
        const input = document.getElementById('inviteUrlInput');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value).then(() => {
                UIRenderer.showToast('邀请链接已复制！快速发给微信/QQ好友吧！');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                UIRenderer.showToast('链接已复制到剪贴板');
            });
        }
    }

    /**
     * 补齐机器人并开始
     */
    fillAiAndStart() {
        for (let i = 1; i <= 2; i++) {
            if (!this.gameState.players[i].name || this.gameState.players[i].name.includes('等待')) {
                this.gameState.players[i].name = `机器人 AI_${i}`;
                this.gameState.players[i].isAi = true;
            }
        }
        this.startNewRound();
    }

    /**
     * 启动单机练习模式 (对战 2 个 AI 机器人)
     */
    startAiGame(nickname) {
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        this.gameState.players[0] = { id: 0, name: nickname, hand: [], isAi: false, isHost: true, role: 'FARMER', passedBid: false };
        this.gameState.players[1] = { id: 1, name: '智能机器人 1号', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };
        this.gameState.players[2] = { id: 2, name: '智能机器人 2号', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };

        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.startNewRound();
    }

    /**
     * 重新回到初始大厅
     */
    resetToLobby() {
    /**
     * 开始新一局 (洗牌、发牌、全员就位加载完毕后展开 3秒倒计时 + 动态进度条)
     */
    startNewRound() {
        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameOverModal').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        document.getElementById('btnLeaveRoom').style.display = 'inline-flex';

        // 彻底重置界面 DOM & 选牌状态 & 气泡 & 残余展示牌
        UIRenderer.resetGameTableUI();

        // 1. 生成洗牌
        const deck = DouDizhuRules.shuffle(DouDizhuRules.createDeck());

        // 2. 发牌: 3人各 17 张原始混乱手牌，留 3 张底牌 (开局手牌保持乱序，点击理牌后进行排序)
        const p0Hand = deck.slice(0, 17);
        const p1Hand = deck.slice(17, 34);
        const p2Hand = deck.slice(34, 51);
        const bottom = deck.slice(51, 54);

        // 3. 构造重置 GameState (保持玩家 ID/昵称/isAi/isHost)
        this.gameState.phase = 'BIDDING';
        this.gameState.players[0].hand = p0Hand;
        this.gameState.players[1].hand = p1Hand;
        this.gameState.players[2].hand = p2Hand;

        this.gameState.players.forEach(p => {
            p.role = 'FARMER';
            p.passedBid = false;
        });

        this.gameState.bottomCards = bottom;
        this.gameState.currentTurn = 0;
        this.gameState.landlordIndex = -1;
        this.gameState.highestBid = 0;
        this.gameState.highestBidder = -1;
        this.gameState.bidsCount = 0;
        this.gameState.lastPlay = null;
        this.gameState.recentPlays = { 0: null, 1: null, 2: null };
        this.gameState.multiplier = 1;
        this.gameState.winnerIndex = -1;
        this.gameState.readyPlayers = [false, false, false];

        this._hasPlayedSortSoundThisRound = false;

        // 先标记开局倒计时状态，再广播，确保客户端收到时能触发倒计时动画
        this.gameState.isOpeningCountdown = true;

        // 房主初始化完毕，立即同步全量状态给其他客户端，让大家切入打牌界面
        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(this.gameState);
        }

        // 触发本地 3 秒全员就位加载倒计时与动态进度条
        this.startOpeningCountdown();
    }

    /**
     * 确认人齐加载完毕后的 3 秒开局倒计时与动态进度条
     */
    startOpeningCountdown() {
        const overlay = document.getElementById('startCountdownOverlay');
        const numEl = document.getElementById('startCountdownNum');
        const lightRed = document.getElementById('trafficLightRed');
        const lightYellow = document.getElementById('trafficLightYellow');
        const lightGreen = document.getElementById('trafficLightGreen');

        if (overlay) overlay.style.display = 'flex';

        this._isCountingDownLocally = true;
        this.updateControlButtons(NetworkManager.myPlayerIndex);

        let elapsed = 0;
        const totalDuration = 3000; // 3.0 秒
        const step = 50;

        const updateLights = (sec) => {
            if (lightRed) lightRed.classList.toggle('active', sec === 3 || sec === 0);
            if (lightYellow) lightYellow.classList.toggle('active', sec === 2 || sec === 0);
            if (lightGreen) lightGreen.classList.toggle('active', sec === 1 || sec === 0);

            if (numEl) {
                if (sec === 3) {
                    numEl.textContent = '3';
                    numEl.className = 'start-number num-red';
                } else if (sec === 2) {
                    numEl.textContent = '2';
                    numEl.className = 'start-number num-yellow';
                } else if (sec === 1) {
                    numEl.textContent = '1';
                    numEl.className = 'start-number num-green';
                } else {
                    numEl.textContent = '抢！';
                    numEl.className = 'start-number num-go';
                }
            }
        };

        updateLights(3);

        clearInterval(this._startCountdownTimer);
        this._startCountdownTimer = setInterval(() => {
            elapsed += step;

            const remainingSecs = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
            updateLights(remainingSecs);

            if (elapsed >= totalDuration) {
                clearInterval(this._startCountdownTimer);
                this._isCountingDownLocally = false;
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    if (NetworkManager.isHost) {
                        this.gameState.isOpeningCountdown = false;
                        NetworkManager.broadcastState(this.gameState); // 倒计时结束，同步状态解锁大家的操作按钮
                    }
                    this.updateControlButtons(NetworkManager.myPlayerIndex);
                    UIRenderer.showToast('🔥 3秒到！手速抢地主开始！');
                    SoundEngine.playBid();

                    // 如果是单机人机模式，AI 随机模拟拉长延迟以防抢不过玩家
                    if (NetworkManager.isHost && NetworkManager.isAiMode) {
                        this.scheduleAiBids();
                    }
                }, 200);
            }
        }, step);
    }

    /**
     * AI 单机模式下的手速叫牌模拟
     */
    scheduleAiBids() {
        [1, 2].forEach(aiIdx => {
            const delay = 2200 + Math.random() * 2600; // 给玩家留出 2 秒以上的抢按时间
            setTimeout(() => {
                if (this.gameState.phase === 'BIDDING' && !this.gameState.players[aiIdx].passedBid) {
                    // AI 有 40% 几率抢叫，60% 几率放弃不叫
                    const willClaim = Math.random() < 0.4;
                    this.processBid(aiIdx, willClaim ? 'CLAIM' : 'PASS');
                    NetworkManager.broadcastState(this.gameState);
                }
            }, delay);
        });
    }

    /**
     * 收到服务端/全网同步状态时的 UI 刷新入口
     */
    onReceiveStateUpdate(state) {
        this.gameState = state;
        const myIndex = NetworkManager.myPlayerIndex;
        const rel = UIRenderer.getRelativePlayerIndices(myIndex);

        // 如果游戏已经开始（叫牌/打牌阶段），确保手机客户端也自动切入牌桌界面！
        if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
            document.getElementById('lobbyScreen').classList.remove('active');
            document.getElementById('lobbyScreen').style.display = 'none';
            document.getElementById('waitingScreen').style.display = 'none';
            document.getElementById('gameOverModal').style.display = 'none';
            document.getElementById('gameTable').style.display = 'grid';
            document.getElementById('btnLeaveRoom').style.display = 'inline-flex';
            const btnGoHomeTop = document.getElementById('btnGoHomeTop');
            if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';
        }

        // 客户端如果收到开局倒计时状态且本地未在倒数，则触发本地视觉倒计时
        if (this.gameState.isOpeningCountdown && !this._isCountingDownLocally) {
            this.startOpeningCountdown();
        }

        // 1. 顶部底牌与倍数
        const isBottomRevealed = this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER';
        UIRenderer.renderBottomCards(this.gameState.bottomCards, isBottomRevealed);
        const multEl = document.getElementById('gameMultiplier');
        if (multEl) multEl.textContent = `x${this.gameState.multiplier}`;

        // 2. 玩家面板信息 (头像/名字/剩余手牌)
        document.getElementById('nameSelf').textContent = this.gameState.players[rel.self].name;
        document.getElementById('nameLeft').textContent = this.gameState.players[rel.left].name;
        document.getElementById('nameRight').textContent = this.gameState.players[rel.right].name;

        document.getElementById('cardCountLeft').querySelector('.count').textContent = this.gameState.players[rel.left].hand.length;
        document.getElementById('cardCountRight').querySelector('.count').textContent = this.gameState.players[rel.right].hand.length;

        // 3. 身份徽章标识 (抢地主结束后，在每个人ID左侧高亮放置【👑 地主】或【🌾 农民】徽章)
        const isBiddingDone = (this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER');
        const landlordIdx = this.gameState.landlordIndex;

        const updateRoleBadge = (badgeId, playerIdx) => {
            const el = document.getElementById(badgeId);
            if (!el) return;
            if (isBiddingDone && landlordIdx !== -1) {
                el.style.display = 'inline-flex';
                const isLandlord = (playerIdx === landlordIdx);
                el.className = `role-identity-badge ${isLandlord ? 'landlord' : 'farmer'}`;
                el.textContent = isLandlord ? '👑 地主' : '🌾 农民';
            } else {
                el.style.display = 'none';
            }
        };

        updateRoleBadge('roleBadgeSelf', rel.self);
        updateRoleBadge('roleBadgeLeft', rel.left);
        updateRoleBadge('roleBadgeRight', rel.right);

        // 玩家编号：地主=1，顺时针下家=2，下下家=3
        const updatePlayerNums = () => {
            const badges = {
                self:  document.getElementById('numBadgeSelf'),
                left:  document.getElementById('numBadgeLeft'),
                right: document.getElementById('numBadgeRight'),
            };
            if (!isBiddingDone || landlordIdx === -1) {
                // 叫牌阶段隐藏编号
                Object.values(badges).forEach(b => { if (b) b.style.display = 'none'; });
                return;
            }
            // 以地主为 1，顺时针方向依次 2、3
            // players 数组顺序：0=self(底部)，1=left，2=right（顺时针）
            // rel.self/left/right 是当前视角的绝对索引
            const order = [rel.self, rel.left, rel.right]; // 顺时针顺序（桌面视角）
            const landlordVisPos = order.indexOf(landlordIdx); // 0/1/2
            const nums = {};
            order.forEach((absIdx, visPos) => {
                const numInRound = ((visPos - landlordVisPos + 3) % 3) + 1;
                nums[absIdx] = numInRound;
            });

            const setNum = (badgeId, absIdx) => {
                const el = document.getElementById(badgeId);
                if (!el) return;
                el.textContent = nums[absIdx];
                el.style.display = 'inline-flex';
            };
            setNum('numBadgeSelf',  rel.self);
            setNum('numBadgeLeft',  rel.left);
            setNum('numBadgeRight', rel.right);
        };
        updatePlayerNums();

        // 4. 叫完地主进入打牌阶段时，自动触发全员理牌与理牌音效
        if (this.gameState.phase === 'PLAYING' && !this._hasPlayedSortSoundThisRound) {
            this._hasPlayedSortSoundThisRound = true;
            SoundEngine.playCardSort();
        }

        const myHand = this.gameState.players[myIndex].hand || [];
        UIRenderer.renderSelfHand(myHand);

        const btnSort = document.getElementById('btnSortCards');
        if (btnSort) {
            const isHandSorted = myHand.length > 0 && myHand.every((c, i) => i === 0 || c.rank <= myHand[i - 1].rank);
            if (isHandSorted || this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER') {
                btnSort.style.display = 'none';
            } else {
                btnSort.style.display = 'inline-flex';
            }
        }

        // 5. 渲染桌面打出的牌 / 结算明牌展示
        if (this.gameState.phase === 'GAMEOVER') {
            const bWrap = document.getElementById('bottomCardsWrapper');
            if (bWrap) bWrap.style.display = 'none';

            if (this.turnTimerInterval) {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
            }

            // 房主主导：确保 AI 机器人自动标记就绪
            if (NetworkManager.isHost) {
                if (!this.gameState.readyPlayers) this.gameState.readyPlayers = [false, false, false];
                this.gameState.players.forEach((p, idx) => {
                    if (p.isAi) this.gameState.readyPlayers[idx] = true;
                });
            }

            const victoryBox = document.getElementById('victoryBannerBox');
            if (victoryBox) {
                victoryBox.style.display = 'flex';
                const winner = this.gameState.players[this.gameState.winnerIndex];
                const isLandlordWin = (winner && winner.role === 'LANDLORD');

                let titleText = isLandlordWin ? '👑 地主胜利！' : '🌾 农民胜利！';
                let winnerDesc = '';
                if (isLandlordWin) {
                    winnerDesc = `地主【${winner.name}】独占鳌头`;
                } else {
                    const farmers = this.gameState.players.filter(p => p.role === 'FARMER').map(p => p.name).join(' & ');
                    winnerDesc = `农民【${farmers}】联手获胜`;
                }

                const readyPlayers = this.gameState.readyPlayers || [false, false, false];
                const readyCount = readyPlayers.filter(Boolean).length;
                const hasSelfVoted = !!readyPlayers[myIndex];
                const isMinimized = victoryBox.dataset.minimized === 'true';

                if (isMinimized) {
                    victoryBox.innerHTML = `
                        <div class="victory-mini-badge" id="btnExpandVictory">
                            <span>🏆 胜负 (已就绪 ${readyCount}/3)</span>
                            <i class="fa-solid fa-expand"></i>
                        </div>
                    `;
                } else {
                    victoryBox.innerHTML = `
                        <div class="victory-content-wrap">
                            <button class="victory-close-btn" id="btnCloseVictoryBanner" title="收起胜负榜 (方便看牌)">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                            <div class="victory-main-title">${titleText}</div>
                            <div class="victory-sub-desc">${winnerDesc}</div>
                            
                            <div class="restart-vote-box">
                                <div class="restart-vote-count">准备开局 <span class="vote-num ${readyCount > 0 ? 'active' : ''}">${readyCount}/3</span></div>
                                <button class="btn-action primary btn-restart-round ${hasSelfVoted ? 'voted' : ''}" id="btnRestartGame" ${hasSelfVoted ? 'disabled' : ''}>
                                    <i class="fa-solid ${hasSelfVoted ? 'fa-check' : 'fa-rotate-right'}"></i> ${hasSelfVoted ? '已就绪' : '再来一局'}
                                </button>
                            </div>
                        </div>
                    `;
                }
            }

            // 结算时明牌公开展示全场剩余手牌 (自动折到第二排、第三排)
            UIRenderer.renderOpenHand('playedSelf', this.gameState.players[rel.self].hand || []);
            UIRenderer.renderOpenHand('playedLeft', this.gameState.players[rel.left].hand || []);
            UIRenderer.renderOpenHand('playedRight', this.gameState.players[rel.right].hand || []);
        } else {
            const bWrap = document.getElementById('bottomCardsWrapper');
            if (bWrap) bWrap.style.display = 'flex';
            const vBox = document.getElementById('victoryBannerBox');
            if (vBox) {
                vBox.style.display = 'none';
                delete vBox.dataset.minimized;
            }

            const recent = this.gameState.recentPlays || {};
            const selfPlay = recent[rel.self];
            const leftPlay = recent[rel.left];
            const rightPlay = recent[rel.right];

            UIRenderer.renderPlayedCards('playedSelf', selfPlay ? selfPlay.cards : [], selfPlay ? selfPlay.isLatest : false);
            UIRenderer.renderPlayedCards('playedLeft', leftPlay ? leftPlay.cards : [], leftPlay ? leftPlay.isLatest : false);
            UIRenderer.renderPlayedCards('playedRight', rightPlay ? rightPlay.cards : [], rightPlay ? rightPlay.isLatest : false);
        }

        // 6. 思考出牌/叫地主文本提示与头像高亮
        const currentTurnIdx = this.gameState.currentTurn;
        const currentTurnPlayer = this.gameState.players[currentTurnIdx];
        const promptContainer = document.getElementById('thinkingStatusPrompt');
        const promptTextEl = document.getElementById('thinkingStatusText');

        if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
            if (promptContainer && promptTextEl && currentTurnPlayer) {
                promptContainer.style.display = 'inline-flex';
                const pName = (currentTurnIdx === myIndex) ? '你' : currentTurnPlayer.name;
                const actionDesc = (this.gameState.phase === 'BIDDING') ? '叫地主中...' : '思考出牌中...';
                promptTextEl.textContent = `轮到 【${pName}】 ${actionDesc}`;
            }
        } else {
            if (promptContainer) promptContainer.style.display = 'none';
        }

        // 7. 交互控制按钮面板
        this.updateControlButtons(myIndex);

        // 7. 倒计时指示 (对局结束时隐藏倒计时)
        if (this.gameState.phase === 'GAMEOVER') {
            UIRenderer.updateTurnIndicator(-1, myIndex);
        } else {
            UIRenderer.updateTurnIndicator(this.gameState.currentTurn, myIndex, this.timerSeconds);
        }


        // 8. 处理 AI 或当前回合的自动触发 (如果是房主)
        if (NetworkManager.isHost && this.gameState.phase !== 'GAMEOVER') {
            this.checkAiTurn();
        }

        // 9. 结算处理
        if (this.gameState.phase === 'GAMEOVER') {
            this.showGameOverModal();
        }
    }

    /**
     * 更新操作按钮显示 (抢手速叫地主/不叫/出牌)
     */
    updateControlButtons(myIndex) {
        const controlsBar = document.getElementById('controlsBar');
        const biddingControls = document.getElementById('biddingControls');
        const reBidControls = document.getElementById('reBidControls');
        const playControls = document.getElementById('playControls');

        if (this.gameState.phase === 'GAMEOVER' || this.gameState.phase === 'WAITING') {
            controlsBar.style.display = 'none';
            return;
        }

        controlsBar.style.display = 'block';

        if (this.gameState.phase === 'BIDDING') {
            biddingControls.style.display = 'flex';
            reBidControls.style.display = 'none';
            playControls.style.display = 'none';

            const myPlayer = this.gameState.players[myIndex];
            const isOpeningCountdown = !!this.gameState.isOpeningCountdown;
            const hasPassed = myPlayer && myPlayer.passedBid;

            const passBtn = document.getElementById('btnBidPass');
            const landlordBtn = document.getElementById('btnBidLandlord');

            if (isOpeningCountdown || hasPassed) {
                // 3秒倒计时中，或者已经放弃的玩家，置灰按钮
                if (passBtn) { passBtn.disabled = true; passBtn.classList.add('disabled'); }
                if (landlordBtn) { landlordBtn.disabled = true; landlordBtn.classList.add('disabled'); }
            } else {
                // 倒计时结束，全员拼手速！
                if (passBtn) { passBtn.disabled = false; passBtn.classList.remove('disabled'); }
                if (landlordBtn) { landlordBtn.disabled = false; landlordBtn.classList.remove('disabled'); }
            }
        } else if (this.gameState.phase === 'PLAYING') {
            biddingControls.style.display = 'none';
            reBidControls.style.display = 'none';
            playControls.style.display = 'flex';

            const isAiMode = NetworkManager.isAiMode;
            const hintBtn = document.getElementById('btnHint');
            if (hintBtn) hintBtn.style.display = isAiMode ? 'inline-flex' : 'none';

            const isFreePlay = !this.gameState.lastPlay || this.gameState.lastPlay.playerIndex === myIndex;
            const passBtn = document.getElementById('btnPass');
            passBtn.style.display = isFreePlay ? 'none' : 'inline-block';

            const playBtn = document.getElementById('btnPlayCard');
            const isMyTurn = (this.gameState.currentTurn === myIndex);

            if (!isMyTurn) {
                // 不在自己回合，出牌阶段按钮全盘置灰
                passBtn.disabled = true;
                passBtn.classList.add('disabled');
                playBtn.disabled = true;
                playBtn.classList.add('disabled');
                if (hintBtn) {
                    hintBtn.disabled = true;
                    hintBtn.classList.add('disabled');
                }
            } else {
                // 轮到自己回合
                passBtn.disabled = false;
                passBtn.classList.remove('disabled');
                if (hintBtn) {
                    hintBtn.disabled = false;
                    hintBtn.classList.remove('disabled');
                }
                UIRenderer.updatePlayButtonState();
            }
        }
    }

    /**
     * 响应玩家（自己或远程客户端）的点击动作
     */
    handleSelfAction(actionType, payload) {
        NetworkManager.sendActionToHost(actionType, payload);
    }

    /**
     * 房主引擎处理动作分发
     */
    handlePlayerAction(playerIndex, actionType, payload) {
        if (!NetworkManager.isHost) return;

        if (actionType === 'BID') {
            this.processBid(playerIndex, payload);
        } else if (actionType === 'PLAY') {
            this.processPlay(playerIndex, payload);
        } else if (actionType === 'CHAT_PHRASE') {
            this.processChatPhrase(playerIndex, payload.text);
            NetworkManager.broadcastChatPhrase(playerIndex, payload.text);
        } else if (actionType === 'RESTART_VOTE') {
            this.processRestartVote(playerIndex);
        }
    }

    /**
     * 处理【再来一局】准备就绪投票
     */
    processRestartVote(playerIndex) {
        if (this.gameState.phase !== 'GAMEOVER') return;
        if (!this.gameState.readyPlayers) {
            this.gameState.readyPlayers = [false, false, false];
        }

        this.gameState.readyPlayers[playerIndex] = true;

        // 房主处理时，确保 AI 机器人自动设为准备就绪
        this.gameState.players.forEach((p, idx) => {
            if (p.isAi) this.gameState.readyPlayers[idx] = true;
        });

        const readyCount = this.gameState.readyPlayers.filter(Boolean).length;
        NetworkManager.broadcastState(this.gameState);

        // 当 3 位玩家（包含 AI）全员就位 (3/3)，自动重新发牌开局！
        if (readyCount >= 3) {
            setTimeout(() => {
                this.startNewRound();
            }, 300);
        }
    }

    /**
     * 处理抢手速叫地主逻辑
     */
    processBid(playerIndex, action) {
        if (this.gameState.phase !== 'BIDDING') return;

        // 如果处于 3 秒开局倒计时中，拒绝任何叫牌操作
        if (this.gameState.isOpeningCountdown) return;

        const player = this.gameState.players[playerIndex];
        if (!player || player.passedBid) return; // 已经不叫退出的玩家不能再叫

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        if (action === 'CLAIM' || action === 1 || action === 2 || action === 3) {
            // 谁先点击到了【叫地主】，谁就瞬间成为地主！
            SoundEngine.playBid();
            UIRenderer.showBubble(bubbleTarget, '👑 叫地主！');
            UIRenderer.showToast(`👑 ${player.name} 手速拔得头筹，成功抢到地主！`);
            this.finalizeLandlord(playerIndex);
            return;
        } else if (action === 'PASS' || action === 0) {
            // 玩家点击【不叫】，退出叫地主
            player.passedBid = true;
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '不叫');
            UIRenderer.showToast(`${player.name} 放弃叫地主`);

            // 统计剩下没有退出的玩家
            const activeBidders = this.gameState.players.filter(p => !p.passedBid);

            if (activeBidders.length === 1) {
                // 其他人都退出了，剩下的唯一一个人自动变成地主！
                const lastPlayer = activeBidders[0];
                SoundEngine.playBid();
                UIRenderer.showToast(`🌾 其他玩家均已退出，${lastPlayer.name} 自动获封地主！`);
                setTimeout(() => {
                    this.finalizeLandlord(lastPlayer.id);
                }, 1000);
                return;
            } else if (activeBidders.length === 0) {
                // 3 个玩家全都退出了 -> 重新发牌
                UIRenderer.showToast('全员放弃叫地主，重新发牌！');
                setTimeout(() => this.startNewRound(), 1500);
                return;
            }
        }
    }

    /**
     * 确定地主身份并把底牌分发给地主
     */
    finalizeLandlord(landlordIdx) {
        // 防重机制：防止网络延迟或定时器导致重复触发领底牌产生 5张Q/重复卡牌 bug！
        if (this.gameState.phase === 'PLAYING') return;

        this.gameState.landlordIndex = landlordIdx;
        this.gameState.phase = 'PLAYING';
        this.gameState.currentTurn = landlordIdx;
        this.gameState.multiplier = Math.max(1, this.gameState.highestBid);

        // 赋予角色并自动为全场玩家整理手牌
        this.gameState.players.forEach((p, idx) => {
            p.role = idx === landlordIdx ? 'LANDLORD' : 'FARMER';
            p.hand = DouDizhuRules.sortCards(p.hand);
        });

        // 3 张底牌给地主 (严格过滤已有 card.id 保证防重)
        const currentHandIds = new Set(this.gameState.players[landlordIdx].hand.map(c => c.id));
        const newBottomCards = (this.gameState.bottomCards || []).filter(c => !currentHandIds.has(c.id));
        const landlordHand = [...this.gameState.players[landlordIdx].hand, ...newBottomCards];
        this.gameState.players[landlordIdx].hand = DouDizhuRules.sortCards(landlordHand);

        UIRenderer.showToast(`${this.gameState.players[landlordIdx].name} 成为地主！得 3 张底牌`);
        SoundEngine.playCardSort();
        this.startTurnTimer();
    }

    /**
     * 处理出牌逻辑
     */
    processPlay(playerIndex, cards) {
        if (this.gameState.phase !== 'PLAYING') return;

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === playerIndex;

        if (!cards || cards.length === 0) {
            // 选择过 / 不出
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '要不起');
        } else {
            // 校验是否符合斗地主出牌规则 (传入 playerIndex 确保赢牌后属于自由首出)
            const canPlay = DouDizhuRules.canBeat(cards, this.gameState.lastPlay, playerIndex);
            if (!canPlay) {
                if (playerIndex === NetworkManager.myPlayerIndex) {
                    UIRenderer.showToast('不符合出牌规则或压不住桌上的牌！');
                }
                return;
            }

            // 如果是自由首出（开启新一轮叫/打牌），清空上一轮大家打出的残牌！
            if (isFreePlay) {
                this.gameState.recentPlays = { 0: null, 1: null, 2: null };
            }

            // 规则合规！从玩家手牌中扣除
            const playedIds = new Set(cards.map(c => c.id));
            this.gameState.players[playerIndex].hand = this.gameState.players[playerIndex].hand.filter(c => !playedIds.has(c.id));

            this.gameState.lastPlay = { playerIndex, cards };

            if (!this.gameState.recentPlays) {
                this.gameState.recentPlays = { 0: null, 1: null, 2: null };
            }

            // 取消之前玩家出牌的 isLatest 金光高亮标记
            for (let i = 0; i < 3; i++) {
                if (this.gameState.recentPlays[i]) {
                    this.gameState.recentPlays[i].isLatest = false;
                }
            }

            // 记录当前玩家打出的牌
            this.gameState.recentPlays[playerIndex] = {
                cards: cards,
                isLatest: true
            };

            // 检查炸弹 / 火箭翻倍
            const analysis = DouDizhuRules.analyzeCards(cards);
            if (analysis.type === CardType.BOMB || analysis.type === CardType.ROCKET) {
                this.gameState.multiplier *= 2;
                SoundEngine.playBomb();
                UIRenderer.showToast(analysis.type === CardType.ROCKET ? '🚀 王炸！倍数 x2' : '💣 炸弹！倍数 x2');
            } else {
                SoundEngine.playCardPlay();
            }

            // 检查胜利条件！
            if (this.gameState.players[playerIndex].hand.length === 0) {
                this.gameState.phase = 'GAMEOVER';
                this.gameState.winnerIndex = playerIndex;
                NetworkManager.broadcastState(this.gameState);
                return;
            }
        }

        // 轮到下一位
        this.gameState.currentTurn = (playerIndex + 1) % 3;
        this.startTurnTimer();
    }

    /**
     * 启动/刷新真实 1 秒级实时倒计时 (Host节点主导)
     */
    startTurnTimer() {
        if (!NetworkManager.isHost) return;

        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }

        this.gameState.timerSeconds = 20;
        NetworkManager.broadcastState(this.gameState);

        this.turnTimerInterval = setInterval(() => {
            if (this.gameState.phase !== 'BIDDING' && this.gameState.phase !== 'PLAYING') {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                return;
            }

            this.gameState.timerSeconds--;

            if (this.gameState.timerSeconds <= 0) {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                this.handleTurnTimeout();
            }
        }, 1000);
    }

    /**
     * 倒计时超时自动处理逻辑 (根据斗地主标准规则)
     */
    handleTurnTimeout() {
        if (!NetworkManager.isHost) return;
        const turn = this.gameState.currentTurn;

        if (this.gameState.phase === 'BIDDING') {
            // 叫地主阶段超时：默认【不叫 / 不抢】
            UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认不叫`);
            this.processBid(turn, 0);
        } else if (this.gameState.phase === 'PLAYING') {
            const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === turn;

            if (isFreePlay) {
                // 出牌阶段 - 自由首出超时：默认打出手牌中【最小的单张】
                const hand = this.gameState.players[turn].hand;
                if (hand && hand.length > 0) {
                    const smallestCard = hand[hand.length - 1]; // sortCards 降序，最后一张即最小
                    UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，自动出最小单牌`);
                    this.processPlay(turn, [smallestCard]);
                } else {
                    this.processPlay(turn, []);
                }
            } else {
                // 出牌阶段 - 跟牌压牌超时：默认【要不起 / 过 (PASS)】
                UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认选择过`);
                this.processPlay(turn, []);
            }
        }
    }

    /**
     * 手牌整理排序并播放理牌音效
     */
    sortSelfHand() {
        const myIndex = NetworkManager.myPlayerIndex;
        if (this.gameState.players[myIndex]) {
            this.gameState.players[myIndex].hand = DouDizhuRules.sortCards(this.gameState.players[myIndex].hand);
            UIRenderer.renderSelfHand(this.gameState.players[myIndex].hand);
            SoundEngine.playCardSort();
            const btnSort = document.getElementById('btnSortCards');
            if (btnSort) btnSort.style.display = 'none';
        }
    }

    /**
     * 主动发送经典快捷短语 (全网 P2P 气泡同步)
     */
    sendChatPhrase(text) {
        const myIndex = NetworkManager.myPlayerIndex;
        // 本地立即展示气泡
        this.processChatPhrase(myIndex, text);

        // 网络同步给其他所有联机玩家
        if (NetworkManager.isHost) {
            NetworkManager.broadcastChatPhrase(myIndex, text);
        } else {
            NetworkManager.sendActionToHost('CHAT_PHRASE', { text: text });
        }
    }

    /**
     * 在指定玩家头像上方展示对话气泡
     */
    processChatPhrase(senderIndex, text) {
        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (senderIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (senderIndex === rel.right) bubbleTarget = 'bubbleRight';

        UIRenderer.showBubble(bubbleTarget, text, 3800);
        SoundEngine.playCardSelect();
    }

    /**
     * 智能提示按钮点击
     */
    triggerSmartHint() {
        const myIndex = NetworkManager.myPlayerIndex;
        const myHand = this.gameState.players[myIndex].hand;
        const lastPlay = (this.gameState.lastPlay && this.gameState.lastPlay.playerIndex !== myIndex) ? this.gameState.lastPlay : null;

        const hintCards = DouDizhuRules.findSmartHint(myHand, lastPlay);
        if (hintCards.length > 0) {
            UIRenderer.setSelectedCards(hintCards);
        } else {
            UIRenderer.showToast('没有能压过上家的牌');
        }
    }

    /**
     * 主动点击出牌按钮
     */
    triggerPlayCard() {
        const myIndex = NetworkManager.myPlayerIndex;
        const selected = UIRenderer.getSelectedCards(this.gameState.players[myIndex].hand);
        if (selected.length === 0) {
            UIRenderer.showToast('请先选择要出的牌');
            return;
        }

        this.handleSelfAction('PLAY', selected);
    }

    /**
     * 检查当前回合是否为机器人，是则自动出牌
     */
    checkAiTurn() {
        const turnIdx = this.gameState.currentTurn;
        const currentPlayer = this.gameState.players[turnIdx];
        if (!currentPlayer || !currentPlayer.isAi) return;

        // 延迟 1.2 秒模拟思考
        setTimeout(() => {
            if (this.gameState.phase === 'BIDDING') {
                // 机器人自动叫牌逻辑
                const bid = Math.floor(Math.random() * 2) === 1 ? 3 : 0;
                this.processBid(turnIdx, bid);
            } else if (this.gameState.phase === 'PLAYING') {
                // 机器人出牌逻辑
                const lastPlay = (this.gameState.lastPlay && this.gameState.lastPlay.playerIndex !== turnIdx) ? this.gameState.lastPlay : null;
                const hintCards = DouDizhuRules.findSmartHint(currentPlayer.hand, lastPlay);

                this.processPlay(turnIdx, hintCards);
            }
        }, 1200);
    }

    /**
     * 展示结算弹窗
     */
    showGameOverModal() {
        // 去除重型弹窗遮罩，直接在主桌面上进行优雅总结
        const modal = document.getElementById('gameOverModal');
        if (modal) modal.style.display = 'none';

        const winner = this.gameState.players[this.gameState.winnerIndex];
        const isLandlordWin = (winner && winner.role === 'LANDLORD');

        const myIndex = NetworkManager.myPlayerIndex;
        const myRole = this.gameState.players[myIndex].role;
        const iWon = (isLandlordWin && myRole === 'LANDLORD') || (!isLandlordWin && myRole === 'FARMER');

        if (iWon) SoundEngine.playWin();
    }
}

// 挂载引擎单例
window.GameEngine = new GameEngineController();
document.addEventListener('DOMContentLoaded', () => {
    window.GameEngine.init();
});
