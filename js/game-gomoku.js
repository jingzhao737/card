/* ====================================================================
   game-gomoku.js (从 main.js 拆分, 原型扩展 GameEngineController)
   拆分目标: 主页代码与各游戏对局代码解耦, 减少修改造成的链式影响
   注意: 本文件必须在 main.js (GameEngineController 类定义) 之后加载
   ==================================================================== */
Object.assign(GameEngineController.prototype, {

    /**
     * 初始化五子棋棋盘 UI 界面 (15x15 网格)
     */
    initGomokuUI() {
        const boardContainer = document.getElementById('gomokuBoardContainer');
        if (!boardContainer) return;

        // 重置单局 3 次悔棋计数器、预选落子与重来一局状态
        this.gomokuUndoLeft = 3;
        this.gomokuPendingMove = null;
        this.gomokuMyRematchReady = false;

        const countEl = document.getElementById('gomokuUndoCount');
        if (countEl) countEl.textContent = '3';

        const btnUndo = document.getElementById('btnGomokuUndo');
        if (btnUndo) {
            btnUndo.style.display = 'flex';
            btnUndo.disabled = false;
            btnUndo.classList.remove('disabled');
        }

        const btnRematch = document.getElementById('btnGomokuRematch');
        if (btnRematch) {
            btnRematch.style.display = 'none';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }

        boardContainer.innerHTML = '';
        const starPoints = ['3,3', '3,11', '7,7', '11,3', '11,11']; // 15x15 盘面星位与天元

        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                const cell = document.createElement('div');
                cell.className = 'gomoku-cell';

                if (r === 0)  cell.classList.add('row-top');
                if (r === 14) cell.classList.add('row-bottom');
                if (c === 0)  cell.classList.add('col-left');
                if (c === 14) cell.classList.add('col-right');

                if (starPoints.includes(`${r},${c}`)) {
                    const dot = document.createElement('div');
                    dot.className = 'star-dot';
                    cell.appendChild(dot);
                }

                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.addEventListener('click', () => this.handleGomokuCellClick(r, c));

                // 桌面端悬停预览落子 (移动端触摸不启用，避免与 2-Tap 冲突)
                if (!('ontouchstart' in window) && window.innerWidth > 768) {
                    cell.addEventListener('mouseenter', () => this.showGomokuHoverPreview(r, c, true));
                    cell.addEventListener('mouseleave', () => this.showGomokuHoverPreview(r, c, false));
                }

                boardContainer.appendChild(cell);
            }
        }
    },
    /**
     * 桌面端悬停预览落子：在合法交叉点显示半透明当前方棋子
     */
    showGomokuHoverPreview(r, c, show) {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;
        const cell = document.querySelector(`.gomoku-cell[data-r="${r}"][data-c="${c}"]`);
        if (!cell) return;

        // 该位置已有棋子 或 非我方回合时不显示预览
        if (engine.board[r][c] !== 0) return;
        if (engine.currentTurn !== engine.playerColor) return;
        // 手机端 2-Tap 预选位置优先，不覆盖
        if (this.gomokuPendingMove && this.gomokuPendingMove.r === r && this.gomokuPendingMove.c === c) return;

        let hover = cell.querySelector('.hover-preview');
        if (show) {
            if (!hover) {
                hover = document.createElement('div');
                hover.className = `gomoku-stone ${engine.currentTurn === 1 ? 'black' : 'white'} hover-preview`;
                cell.appendChild(hover);
            }
        } else {
            if (hover) hover.remove();
        }
    },
    /**
     * 播放棋盘中央开局先后手 苹果级奢华微标语 (1.4秒影院级微滑入滑出)
     */
    showGomokuCenterBanner(isMyTurnFirst) {
        const banner = document.getElementById('gomokuCenterBanner');
        const badgeEl = document.getElementById('gomokuBannerBadge');
        const textEl = document.getElementById('gomokuCenterBannerText');
        if (!banner || !textEl) return;

        if (this._bannerTimeout) clearTimeout(this._bannerTimeout);

        banner.style.display = 'none';
        banner.offsetHeight; // 触发 reflow 重置动画
        banner.style.display = 'flex';

        if (isMyTurnFirst) {
            if (badgeEl) badgeEl.className = 'stone-badge black';
            textEl.textContent = '你先手';
            textEl.className = 'black-first';
        } else {
            if (badgeEl) badgeEl.className = 'stone-badge white';
            textEl.textContent = '你后手';
            textEl.className = 'white-second';
        }

        this._bannerTimeout = setTimeout(() => {
            banner.style.display = 'none';
        }, 1400);
    },
    /**
     * 开启在线五子棋真人双人对战模式 (随机先后手，我方固定在左侧)
     */
    startGomokuOnlineGame(roomId, isHost = false, hostIsBlackSynced = null) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
            AuthEngine.checkAndDeductEntryFee('GOMOKU', isPve);
        }

        // 切换游戏前清理斗地主残留定时器与麻将所有后台定时器
        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');

        if (lobbyScr) {
            lobbyScr.style.display = 'none';
            lobbyScr.classList.remove('active');
        }
        if (waitingScr) {
            waitingScr.style.display = 'none';
            waitingScr.classList.remove('active');
        }
        if (gomokuScr) {
            gomokuScr.style.display = 'flex';
            gomokuScr.classList.add('active');
        }
        this.updateHeaderVisibility();

        // 房主随机决定先手黑棋归属并广播同步
        let hostIsBlack;
        if (isHost) {
            hostIsBlack = (hostIsBlackSynced !== null && hostIsBlackSynced !== undefined) ? hostIsBlackSynced : (Math.random() < 0.5);
            NetworkManager.clearGomokuMoves();
            NetworkManager.sendGomokuStart(roomId, hostIsBlack);
        } else {
            hostIsBlack = (hostIsBlackSynced !== null && hostIsBlackSynced !== undefined) ? hostIsBlackSynced : true;
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : (isHost ? 0 : 1);
        const myColor = (mySlot === 0 && hostIsBlack) || (mySlot === 1 && !hostIsBlack) ? 1 : 2;
        const iAmBlack = (myColor === 1);

        const hostNick = isHost ? NetworkManager.nickname : '房主';
        const guestNick = !isHost ? NetworkManager.nickname : '对手';
        const myNick = NetworkManager.nickname || '玩家';
        const oppNick = isHost ? guestNick : hostNick;

        // 左侧卡片 (固定是我方)
        const nameLeft = document.getElementById('gNameLeft');
        const roleLeft = document.getElementById('gRoleLeft');
        const avatarLeft = document.getElementById('gAvatarLeft');
        if (nameLeft) nameLeft.textContent = myNick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是对手)
        const nameRight = document.getElementById('gNameRight');
        const roleRight = document.getElementById('gRoleRight');
        const avatarRight = document.getElementById('gAvatarRight');
        if (nameRight) nameRight.textContent = oppNick;
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.gomokuEngine.reset(false, myColor); // 双人在线模式
        this.initGomokuUI();
        this.renderGomokuBoard();

        const isMyTurn = window.gomokuEngine.currentTurn === myColor;
        this.updateGomokuStatusUI(isMyTurn ? `⚫ 轮到你落子 (先手黑棋)` : `⚪ 对方思考中 (后手白棋)...`);
        UIRenderer.showToast(isMyTurn ? '🎲 随机先后手：你执先手黑棋！' : '🎲 随机先后手：你执后手白棋！');
        this.showGomokuCenterBanner(isMyTurn);

        // 联机开局：房主启动回合倒计时（自己先手立即启动，后手等对方落子后重启）
        if (isHost && isMyTurn) {
            this.startGomokuTurnTimer();
        } else {
            this.stopGomokuTurnTimer();
        }

        // 监听云端落子广播
        NetworkManager.onGomokuMove((move) => {
            if (!move || move.senderSlot === NetworkManager.myPlayerIndex) return;
            const engine = window.gomokuEngine;
            if (engine.board[move.r][move.c] === 0) {
                const res = engine.placeStone(move.r, move.c);
                this.renderGomokuBoard();
                if (res && res.isGameOver) {
                    this.stopGomokuTurnTimer();
                    this.handleGomokuWin(res.winner);
                } else {
                    const isNowMyTurn = engine.currentTurn === myColor;
                    this.updateGomokuStatusUI(isNowMyTurn ? (myColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '⏳ 对方思考中...');
                    // 对方落完轮到己方：房主重启倒计时（对方回合时停止）
                    if (isNowMyTurn) {
                        if (NetworkManager.isHost) this.startGomokuTurnTimer();
                    } else {
                        this.stopGomokuTurnTimer();
                    }
                }
            }
        });

        // 监听联机超时判负广播（房主判定超时后同步给对手）
        NetworkManager.onGomokuTimeout((data) => {
            if (!data || !data.winnerColor) return;
            const engine = window.gomokuEngine;
            if (!engine || engine.isGameOver) return;
            const winnerColor = data.winnerColor;
            engine.isGameOver = true;
            engine.winner = winnerColor;
            this.stopGomokuTurnTimer();
            this.handleGomokuWin(winnerColor);
        });

        // 监听在线悔棋申请广播
        NetworkManager.onGomokuUndoRequest((req) => {
            if (!req || req.senderSlot === NetworkManager.myPlayerIndex) return;
            const undoModal = document.getElementById('gomokuUndoModal');
            const modalText = document.getElementById('gomokuUndoModalText');
            if (undoModal && modalText) {
                modalText.textContent = `玩家 ${req.applicantNick || '对方'} 申请悔棋一步，是否同意？`;
                undoModal.style.display = 'flex';
            }
        });

        // 监听在线悔棋响应广播 (同意才扣次数，拒绝不扣次数)
        NetworkManager.onGomokuUndoResponse((resp) => {
            if (!resp || resp.senderSlot === NetworkManager.myPlayerIndex) return;
            if (resp.approved) {
                const engine = window.gomokuEngine;
                if (engine) {
                    engine.undo();
                    this.renderGomokuBoard();
                }
                if (this.gomokuUndoLeft > 0) {
                    this.gomokuUndoLeft--;
                    const countEl = document.getElementById('gomokuUndoCount');
                    if (countEl) countEl.textContent = this.gomokuUndoLeft;
                    const btnUndo = document.getElementById('btnGomokuUndo');
                    if (this.gomokuUndoLeft <= 0 && btnUndo) {
                        btnUndo.disabled = true;
                        btnUndo.classList.add('disabled');
                    }
                }
                UIRenderer.showToast(`🎉 对方同意了你的悔棋申请！本局还剩 ${this.gomokuUndoLeft} 次`);
                this.updateGomokuStatusUI(`对方同意悔棋！本局还可悔棋 ${this.gomokuUndoLeft} 次`);
            } else {
                UIRenderer.showToast(`❌ 对方拒绝了你的悔棋申请，未扣除悔棋次数 (剩余 ${this.gomokuUndoLeft} 次)`);
                this.updateGomokuStatusUI(`对方拒绝悔棋，请继续落子`);
            }
        });

        // 监听在线双人【重来一局】投票 (双方均准备后自动开启新一局)
        NetworkManager.onGomokuRematchVote((votes) => {
            if (!votes) return;
            const hostVote = votes[0] && votes[0].ready;
            const joinerVote = votes[1] && votes[1].ready;

            const mySlot = NetworkManager.myPlayerIndex;
            const oppSlot = mySlot === 0 ? 1 : 0;
            const myVote = votes[mySlot] && votes[mySlot].ready;
            const oppVote = votes[oppSlot] && votes[oppSlot].ready;

            if (oppVote && !myVote) {
                this.updateGomokuStatusUI('🤝 对方已点击【重来一局】，等你准备...');
                UIRenderer.showToast('🤝 对方已申请【重来一局】，请点击确认！');
            }

            // 双方都点击了【重来一局】！重置盘面，开启新对局！
            if (hostVote && joinerVote) {
                NetworkManager.clearGomokuRematchVotes();
                this.startGomokuOnlineGame(roomId, isHost);
            }
        });
    },
    /**
     * 开启单机 AI 五子棋切磋模式 (随机先后手，我方固定在左侧)
     */
    startGomokuAiMode() {
        // NEW 角标已读标记
        if (typeof AuthEngine !== 'undefined' && AuthEngine.markGameSeen) AuthEngine.markGameSeen('GOMOKU');
        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');

        // 切换游戏前清理斗地主残留定时器与麻将所有后台定时器
        // (防止麻将 AI 思考 setTimeout / 5s 自动过牌定时器在五子棋局中残留播放麻将音效)
        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        // 单机 AI 模式标记：斗地主/麻将 AI 模式均有设置，此处必须同步设置，
        // 否则 startGomokuTurnTimer 会因「非 AI 模式且非房主」直接跳过倒计时
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        if (lobbyScr) {
            lobbyScr.style.display = 'none';
            lobbyScr.classList.remove('active');
        }
        if (waitingScr) {
            waitingScr.style.display = 'none';
            waitingScr.classList.remove('active');
        }
        if (gomokuScr) {
            gomokuScr.style.display = 'flex';
            gomokuScr.classList.add('active');
        }
        this.updateHeaderVisibility();

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';

        // 随机决定先后手
        const iAmBlack = Math.random() < 0.5;
        const myColor = iAmBlack ? 1 : 2;

        // 左侧卡片 (固定是我方)
        const nameLeft = document.getElementById('gNameLeft');
        const roleLeft = document.getElementById('gRoleLeft');
        const avatarLeft = document.getElementById('gAvatarLeft');
        if (nameLeft) nameLeft.textContent = nick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是 AI 棋圣)
        const nameRight = document.getElementById('gNameRight');
        const roleRight = document.getElementById('gRoleRight');
        const avatarRight = document.getElementById('gAvatarRight');
        if (nameRight) nameRight.textContent = 'AI 棋圣';
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.gomokuEngine.reset(true, myColor);
        this.initGomokuUI();
        this.renderGomokuBoard();

        this.showGomokuCenterBanner(iAmBlack);

        if (iAmBlack) {
            this.updateGomokuStatusUI('⚫ 轮到你落子 (先手黑棋)');
            UIRenderer.showToast('🎲 随机分配完成：你执先手黑棋！');
            this.startGomokuTurnTimer(); // 玩家先手：启动倒计时
        } else {
            this.updateGomokuStatusUI('🤖 AI 棋圣 (先手黑棋) 思考中...');
            UIRenderer.showToast('🎲 随机分配完成：AI 棋圣执先手黑棋！');
            this.stopGomokuTurnTimer(); // AI 先手：不启动玩家倒计时
            setTimeout(() => {
                const aiMove = window.gomokuEngine.getBestAiMove();
                if (aiMove) {
                    window.gomokuEngine.placeStone(aiMove.r, aiMove.c);
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('⚪ 轮到你落子 (后手白棋)');
                    this.startGomokuTurnTimer(); // AI 落完轮到玩家：启动倒计时
                }
            }, 800);
        }
    },
    /**
     * 处理五子棋棋盘单元格点击落子 (严格校验当前回合，手机端支持 2-Tap 二次确认落子)
     */
    handleGomokuCellClick(r, c) {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;
        if (engine.board[r][c] !== 0) return; // 该位置已有棋子

        // 1. 严格回合校验：非我方回合时，禁止任何点击 (无论是第一次还是第二次)
        if (!engine.isAiMode) {
            // 双人在线对战模式
            const myColor = engine.playerColor;
            if (engine.currentTurn !== myColor) {
                UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                return;
            }
        } else {
            // 单机 AI 切磋模式
            if (engine.currentTurn !== engine.playerColor) {
                UIRenderer.showToast('⏳ 🤖 AI 棋圣思考中，请稍候...');
                return;
            }
        }

        // 2. 判断是否为移动端设备/触摸屏/小屏 (包括手机及 Chrome 模拟器)
        const isMobile = ('ontouchstart' in window) || window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

        // 📱 手机端 2-Tap 二次确认落子流程 (已在回合校验之后，确保仅轮到自己时生效)
        if (isMobile) {
            if (!this.gomokuPendingMove || this.gomokuPendingMove.r !== r || this.gomokuPendingMove.c !== c) {
                // 第一次点击：预选该位置，渲染虚影预览并提示再次点击确定
                this.gomokuPendingMove = { r, c };
                this.renderGomokuBoard();
                UIRenderer.showToast('🎯 已选定位置，再次点击确定落子');
                return;
            }
            // 第二次点击同一位置：清除预选，正式确认落子！
            this.gomokuPendingMove = null;
        } else {
            this.gomokuPendingMove = null;
        }

        // 3. 执行正式落子逻辑
        if (!engine.isAiMode) {
            const myColor = engine.playerColor;
            const res = engine.placeStone(r, c);
            if (!res || !res.success) return;

            this.renderGomokuBoard();
            NetworkManager.sendGomokuMove(r, c, myColor);

            if (res.isGameOver) {
                this.stopGomokuTurnTimer();
                this.handleGomokuWin(res.winner);
            } else {
                this.updateGomokuStatusUI('⏳ 对方思考中...');
                this.stopGomokuTurnTimer(); // 轮到对方：停止本地计时（房主主导）
            }
            return;
        }

        // 单机 AI 模式落子
        const res = engine.placeStone(r, c);
        if (!res || !res.success) return;

        this.renderGomokuBoard();

        if (res.isGameOver) {
            this.stopGomokuTurnTimer();
            this.handleGomokuWin(res.winner);
            return;
        }

        // 若为单机 AI 模式，触发 AI 落子 (模拟拟人化随机思考 600ms ~ 1400ms)
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            this.updateGomokuStatusUI('🤖 AI 棋圣思考中...');
            this.stopGomokuTurnTimer(); // AI 思考期间不显示玩家倒计时
            const randomThinkTime = Math.floor(Math.random() * 800 + 600); // 600ms - 1400ms 随机思考时长
            setTimeout(() => {
                const aiMove = engine.getBestAiMove();
                if (aiMove) {
                    const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                    this.renderGomokuBoard();
                    if (aiRes && aiRes.isGameOver) {
                        this.stopGomokuTurnTimer();
                        this.handleGomokuWin(aiRes.winner);
                    } else {
                        this.updateGomokuStatusUI('⚫ 黑方落子中 (你)');
                        this.startGomokuTurnTimer(); // AI 落完轮到玩家：重新启动倒计时
                    }
                }
            }, randomThinkTime);
        } else {
            this.updateGomokuStatusUI(engine.currentTurn === 1 ? '⚫ 黑方落子中' : '⚪ 白方落子中');
        }
    },
    /**
     * 重新渲染盘面棋子 (含落子序号标记)
     */
    renderGomokuBoard() {
        const engine = window.gomokuEngine;
        if (!engine) return;

        const winNodes = engine.winLine || [];
        const cells = document.querySelectorAll('.gomoku-cell');

        // 构建 序号查找表: `${r},${c}` -> 落子序号 (1 起步)
        const moveNumberMap = {};
        (engine.moveHistory || []).forEach(m => {
            if (m) moveNumberMap[`${m.r},${m.c}`] = m.moveNumber || 1;
        });

        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const val = engine.board[r][c];

            let stone = cell.querySelector('.gomoku-stone');

            if (val === 0) {
                // 如果格子上无正式棋子：清除所有棋子/预览残留 (含 hover 预览与旧 2-Tap 预览)
                cell.querySelectorAll('.gomoku-stone').forEach(s => s.remove());
                stone = null;

                // 如果该格被选中作为 2-Tap 预选位置，渲染半透明预览虚影棋子
                if (this.gomokuPendingMove && this.gomokuPendingMove.r === r && this.gomokuPendingMove.c === c) {
                    const currentTurn = engine.currentTurn;
                    const previewStone = document.createElement('div');
                    previewStone.className = `gomoku-stone ${currentTurn === 1 ? 'black' : 'white'} preview`;
                    cell.appendChild(previewStone);
                }
            } else {
                // 标准大众麻将固定座位风向：0=东风(房主/庄家)、1=南风、2=西风、3=北风
                const windNames = ['东', '南', '西', '北'];
                const isLastMove = engine.lastMove && engine.lastMove.r === r && engine.lastMove.c === c;
                const isWinStone = winNodes.some(n => n.r === r && n.c === c);

                // 清除可能残留的 hover 预览与 2-Tap 预览（该格已有正式棋子时）
                cell.querySelectorAll('.hover-preview, .preview').forEach(s => s.remove());

                // 重新查询正式棋子（排除预览残留，避免 stone 指向已移除元素导致棋子不显示）
                stone = cell.querySelector('.gomoku-stone:not(.hover-preview):not(.preview)');

                if (!stone) {
                    // 仅当这颗棋子是新落下的，新建 DOM 节点并播放微随机物理落子音效
                    stone = document.createElement('div');
                    stone.className = `gomoku-stone ${val === 1 ? 'black' : 'white'}`;
                    cell.appendChild(stone);

                    const soundObj = typeof SoundEngine !== 'undefined' ? SoundEngine : (typeof audioSynth !== 'undefined' ? audioSynth : null);
                    if (soundObj && soundObj.playStoneDrop) {
                        soundObj.playStoneDrop(val === 2); // 白棋音高更高脆，黑棋更沉稳，带±12%微随机音调！
                    }
                } else {
                    stone.className = `gomoku-stone ${val === 1 ? 'black' : 'white'}`;
                }

                if (isLastMove) stone.classList.add('last-move');
                else stone.classList.remove('last-move');

                if (isWinStone) stone.classList.add('win-stone');
                else stone.classList.remove('win-stone');

                // 落子序号标记：只显示最近 5 步，避免全部棋子带数字显得繁杂
                let numSpan = stone.querySelector('.stone-num');
                if (numSpan) numSpan.remove();
                const moveNum = moveNumberMap[`${r},${c}`] || 0;
                const totalMoves = (engine.moveHistory || []).length;
                const isRecent = moveNum > 0 && (totalMoves - moveNum) < 5;
                if (isRecent) {
                    numSpan = document.createElement('span');
                    numSpan.className = 'stone-num' + (val === 1 ? ' on-black' : ' on-white') + (String(moveNum).length >= 2 ? ' len-2' : '');
                    numSpan.textContent = moveNum;
                    stone.appendChild(numSpan);
                }
            }
        });

        // 胜利连线特效: 五连子发光连线
        this.renderGomokuWinLine();
    },
    /**
     * 胜利五连子发光连线 (SVG 覆盖在棋盘上)
     */
    renderGomokuWinLine() {
        const boardEl = document.getElementById('gomokuBoardContainer');
        const engine = window.gomokuEngine;
        if (!boardEl || !engine) return;

        // 移除旧连线
        const oldLine = boardEl.querySelector('.gomoku-win-line');
        if (oldLine) oldLine.remove();

        const winNodes = engine.winLine || [];
        if (winNodes.length < 2) return;

        const first = winNodes[0];
        const last = winNodes[winNodes.length - 1];

        // 计算首尾交叉点的像素位置 (棋盘 grid 每格等宽)
        const rect = boardEl.getBoundingClientRect();
        const cellW = rect.width / 15;
        const cellH = rect.height / 15;
        const x1 = (first.c + 0.5) * cellW;
        const y1 = (first.r + 0.5) * cellH;
        const x2 = (last.c + 0.5) * cellW;
        const y2 = (last.r + 0.5) * cellH;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'gomoku-win-line');
        svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.style.zIndex = '6';

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#34d399');
        line.setAttribute('stroke-width', Math.max(3, cellW * 0.09));
        line.setAttribute('stroke-linecap', 'round');
        line.style.filter = 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.9))';
        svg.appendChild(line);
        boardEl.appendChild(svg);
    },
    /**
     * 更新顶部对局状态指示与当前回合玩家高亮 (左侧固定为我方，右侧固定为对方)
     */
    updateGomokuStatusUI(msg) {
        const textEl = document.getElementById('gomokuTurnText');
        if (textEl) textEl.textContent = msg;

        const pillLeft = document.getElementById('gomokuPlayerLeft');
        const pillRight = document.getElementById('gomokuPlayerRight');
        const engine = window.gomokuEngine;

        if (pillLeft && pillRight && engine) {
            const isMyTurn = (engine.currentTurn === engine.playerColor);
            if (isMyTurn) {
                pillLeft.classList.add('turn-active');
                pillRight.classList.remove('turn-active');
            } else {
                pillRight.classList.add('turn-active');
                pillLeft.classList.remove('turn-active');
            }
        }
    },
    /**
     * 启动/重置五子棋 30 秒回合倒计时
     * - 单机 AI 模式：玩家回合超时自动落子（托管）
     * - 联机模式：仅房主主导计时，当前回合玩家超时判负并广播
     */
    startGomokuTurnTimer() {
        this.stopGomokuTurnTimer();

        const engine = window.gomokuEngine;
        const badge = document.getElementById('gomokuTimerBadge');
        const secsEl = document.getElementById('gomokuTimerSecs');
        if (!engine || engine.isGameOver) {
            if (badge) badge.style.display = 'none';
            return;
        }

        // 联机模式非房主不本地计时（以房主广播为准），但仍显示剩余秒数由房主状态同步
        if (!NetworkManager.isAiMode && !NetworkManager.isHost) {
            if (badge) badge.style.display = 'none';
            return;
        }

        this._gomokuTimerSeconds = 30;
        if (badge) badge.style.display = 'inline-flex';
        if (secsEl) secsEl.textContent = '30';

        this._gomokuTimerInterval = setInterval(() => {
            const gScr = document.getElementById('gomokuGameScreen');
            if (!gScr || gScr.style.display === 'none' || !window.gomokuEngine || window.gomokuEngine.isGameOver) {
                this.stopGomokuTurnTimer();
                return;
            }

            this._gomokuTimerSeconds--;
            if (secsEl) secsEl.textContent = Math.max(0, this._gomokuTimerSeconds);
            if (badge) {
                if (this._gomokuTimerSeconds <= 5) badge.classList.add('urgent');
                else badge.classList.remove('urgent');
            }

            if (this._gomokuTimerSeconds <= 0) {
                this.stopGomokuTurnTimer();
                this.handleGomokuTimeout();
            }
        }, 1000);
    },
    /**
     * 停止五子棋回合倒计时
     */
    stopGomokuTurnTimer() {
        if (this._gomokuTimerInterval) {
            clearInterval(this._gomokuTimerInterval);
            this._gomokuTimerInterval = null;
        }
        const badge = document.getElementById('gomokuTimerBadge');
        if (badge) badge.style.display = 'none';
    },
    /**
     * AI 回合超时兜底：重新驱动 AI 落子 (单机模式 AI 理论上自动落子，此处防竞态卡死)
     */
    triggerAiGomokuIfNeeded() {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            const aiMove = engine.getBestAiMove();
            if (aiMove) {
                const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                this.renderGomokuBoard();
                if (aiRes && aiRes.isGameOver) {
                    this.stopGomokuTurnTimer();
                    this.handleGomokuWin(aiRes.winner);
                } else {
                    this.updateGomokuStatusUI(engine.currentTurn === engine.playerColor ? '⚫ 轮到你落子' : '🤖 AI 思考中...');
                    if (engine.currentTurn === engine.playerColor) this.startGomokuTurnTimer();
                }
            }
        }
    },
    /**
     * 五子棋回合超时自动处理
     * - 单机 AI：玩家回合超时 -> 自动随机落一子（托管）
     * - 联机：房主判定当前回合玩家超时 -> 对方获胜，广播超时结果
     */
    handleGomokuTimeout() {
        const engine = window.gomokuEngine;
        if (!engine || engine.isGameOver) return;

        if (engine.isAiMode) {
            // 单机 AI 模式：若轮到玩家且超时，自动落一子（简单托管）
            if (engine.currentTurn === engine.playerColor) {
                const emptyCells = [];
                for (let r = 0; r < engine.BOARD_SIZE; r++) {
                    for (let c = 0; c < engine.BOARD_SIZE; c++) {
                        if (engine.board[r][c] === 0) emptyCells.push({ r, c });
                    }
                }
                if (emptyCells.length === 0) return;
                const pick = emptyCells[Math.floor(Math.random() * emptyCells.length)];
                const res = engine.placeStone(pick.r, pick.c);
                this.renderGomokuBoard();
                UIRenderer.showToast('⏱ 思考超时，已自动落子！');
                if (res && res.isGameOver) {
                    this.handleGomokuWin(res.winner);
                    return;
                }
                // 托管后轮到 AI，触发 AI 落子
                this.updateGomokuStatusUI('🤖 AI 棋圣思考中...');
                setTimeout(() => {
                    const aiMove = engine.getBestAiMove();
                    if (aiMove) {
                        const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                        this.renderGomokuBoard();
                        if (aiRes && aiRes.isGameOver) {
                            this.handleGomokuWin(aiRes.winner);
                        } else {
                            this.updateGomokuStatusUI(engine.currentTurn === engine.playerColor ? '⚫ 轮到你落子' : '🤖 AI 思考中...');
                            this.startGomokuTurnTimer();
                        }
                    }
                }, 700);
            } else {
                // AI 回合理论上不会超时（AI 自动落子），兜底重驱
                this.triggerAiGomokuIfNeeded();
            }
            return;
        }

        // 联机模式：房主判定当前回合玩家超时判负
        if (!NetworkManager.isHost) return;
        const timeoutColor = engine.currentTurn;
        const winnerColor = timeoutColor === 1 ? 2 : 1;
        UIRenderer.showToast(`⏱ 玩家超时未落子，${winnerColor === 1 ? '黑方' : '白方'}获胜！`);
        engine.isGameOver = true;
        engine.winner = winnerColor;
        this.handleGomokuWin(winnerColor);
        // 广播超时结果给对手（复用 gomokuMove 通道不适用，单独发超时信号）
        if (NetworkManager.sendGomokuTimeout) {
            NetworkManager.sendGomokuTimeout(winnerColor);
        }
    },
    /**
     * 处理胜负结算
     */
    handleGomokuWin(winner) {
        // 对局结束：停止回合倒计时
        this.stopGomokuTurnTimer();

        let msg = '';
        if (winner === 1) msg = '🎉 恭喜黑方获得胜利 (五子连珠)！';
        else if (winner === 2) msg = '🤖 游鲸 AI 棋圣获得胜利！';
        else msg = '🤝 盘满平局！';

        UIRenderer.showToast(msg);
        this.updateGomokuStatusUI(winner === 0 ? '平局 · 请点击【重来一局】' : (winner === 1 ? '黑方胜 · 请点击【重来一局】' : '白方胜 · 请点击【重来一局】'));

        const myColor = window.gomokuEngine ? window.gomokuEngine.playerColor : 1;
        if (typeof AuthEngine !== 'undefined' && AuthEngine.recordGomokuMatchResult) {
            if (winner === 0) {
                AuthEngine.recordGomokuMatchResult(false, true); // 平局
            } else if (winner === myColor) {
                AuthEngine.recordGomokuMatchResult(true, false); // 胜利
            } else {
                AuthEngine.recordGomokuMatchResult(false, false); // 失败
            }

            // 💰 结算五子棋【知因币】 (零分保底，PVE 25% 比例)
            if (AuthEngine.updateCoins) {
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId || NetworkManager.humanCount < 2;
                const ratio = isPve ? 0.25 : 1.0;

                if (winner === myColor) {
                    const totalMoves = window.gomokuEngine ? window.gomokuEngine.moveHistory.length : 20;
                    const quickBonus = (totalMoves <= 15) ? 10 : 0;
                    const winCoins = Math.ceil((40 + quickBonus) * ratio * AuthEngine.getWeekdayWinBonus()); // 工作日赢 +15%
                    AuthEngine.updateCoins(winCoins, isPve ? '五子棋切磋胜 (PVE)' : '五子棋胜 (PVP)');
                } else if (winner !== 0) {
                    const loseCoins = -Math.ceil(20 * ratio);
                    AuthEngine.updateCoins(loseCoins, isPve ? '五子棋切磋负 (PVE)' : '五子棋负 (PVP)');
                }

                // ⭐ 结算五子棋【经验值】
                if (AuthEngine.addExp) {
                    const isWin = (winner === myColor);
                    const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                    AuthEngine.addExp(expVal, isPve ? '五子棋切磋 (PVE)' : '五子棋对局 (PVP)');
                }
            }
        }

        // 对局结束：隐藏悔棋按键，开启【重来一局】按键
        const btnUndo = document.getElementById('btnGomokuUndo');
        if (btnUndo) btnUndo.style.display = 'none';

        const btnRematch = document.getElementById('btnGomokuRematch');
        if (btnRematch) {
            btnRematch.style.display = 'flex';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }
    }

    /* ============================================================
       ⚫⚪ 游鲸围棋 UI 控制与交互逻辑 (Go UI Methods)
       ============================================================ */


});
