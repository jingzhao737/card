/* ====================================================================
   game-go.js (从 main.js 拆分, 原型扩展 GameEngineController)
   拆分目标: 主页代码与各游戏对局代码解耦, 减少修改造成的链式影响
   注意: 本文件必须在 main.js (GameEngineController 类定义) 之后加载
   ==================================================================== */
Object.assign(GameEngineController.prototype, {

    /**
     * 初始化围棋棋盘 UI 界面 (9/13/19 路网格)
     */
    initGoUI() {
        const boardContainer = document.getElementById('goBoardContainer');
        if (!boardContainer) return;

        const engine = window.goEngine;
        if (!engine) return;
        const size = engine.BOARD_SIZE;

        // 重置单局 3 次悔棋计数器、预选落子与重来一局状态
        this.goUndoLeft = 3;
        this.goPendingMove = null;
        this.goMyRematchReady = false;

        const countEl = document.getElementById('goUndoCount');
        if (countEl) countEl.textContent = '3';

        const btnUndo = document.getElementById('btnGoUndo');
        if (btnUndo) {
            btnUndo.style.display = 'flex';
            btnUndo.disabled = false;
            btnUndo.classList.remove('disabled');
        }

        const btnRematch = document.getElementById('btnGoRematch');
        if (btnRematch) {
            btnRematch.style.display = 'none';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }

        // 对局中操作按钮恢复可用
        [['btnGoPass'], ['btnGoScore'], ['btnGoResign']].forEach(([id]) => {
            const b = document.getElementById(id);
            if (b) {
                b.style.display = 'flex';
                b.disabled = false;
                b.classList.remove('disabled');
            }
        });

        // 棋盘网格列数随路数动态调整
        boardContainer.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        boardContainer.style.gridTemplateRows = `repeat(${size}, 1fr)`;

        // 贴目显示
        const komiEl = document.getElementById('goKomiDisplay');
        if (komiEl) komiEl.textContent = engine.komi;

        // 清除提子统计
        const capB = document.getElementById('goCapturesBlack');
        const capW = document.getElementById('goCapturesWhite');
        if (capB) capB.textContent = '0';
        if (capW) capW.textContent = '0';

        boardContainer.innerHTML = '';
        const starPoints = GoEngine.getStarPoints(size);

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const cell = document.createElement('div');
                cell.className = 'go-cell';

                if (r === 0)  cell.classList.add('row-top');
                if (r === size - 1) cell.classList.add('row-bottom');
                if (c === 0)  cell.classList.add('col-left');
                if (c === size - 1) cell.classList.add('col-right');

                if (starPoints.includes(`${r},${c}`)) {
                    const dot = document.createElement('div');
                    dot.className = 'star-dot';
                    cell.appendChild(dot);
                }

                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.addEventListener('click', () => this.handleGoCellClick(r, c));

                // 桌面端悬停预览落子 (移动端触摸不启用，避免与 2-Tap 冲突)
                if (!('ontouchstart' in window) && window.innerWidth > 768) {
                    cell.addEventListener('mouseenter', () => this.showGoHoverPreview(r, c, true));
                    cell.addEventListener('mouseleave', () => this.showGoHoverPreview(r, c, false));
                }

                boardContainer.appendChild(cell);
            }
        }
    },
    /**
     * 桌面端悬停预览落子：在合法交叉点显示半透明当前方棋子
     */
    showGoHoverPreview(r, c, show) {
        const engine = window.goEngine;
        if (!engine || engine.isGameOver) return;
        const cell = document.querySelector(`.go-cell[data-r="${r}"][data-c="${c}"]`);
        if (!cell) return;

        if (engine.board[r][c] !== 0) return;
        if (engine.currentTurn !== engine.playerColor) return;
        if (this.goPendingMove && this.goPendingMove.r === r && this.goPendingMove.c === c) return;

        let hover = cell.querySelector('.hover-preview');
        if (show) {
            if (!hover) {
                hover = document.createElement('div');
                hover.className = `go-stone ${engine.currentTurn === 1 ? 'black' : 'white'} hover-preview`;
                cell.appendChild(hover);
            }
        } else {
            if (hover) hover.remove();
        }
    },
    /**
     * 播放棋盘中央开局先后手微标语 (1.4秒微滑入滑出)
     */
    showGoCenterBanner(isMyTurnFirst) {
        const banner = document.getElementById('goCenterBanner');
        const badgeEl = document.getElementById('goBannerBadge');
        const textEl = document.getElementById('goCenterBannerText');
        if (!banner || !textEl) return;

        if (this._goBannerTimeout) clearTimeout(this._goBannerTimeout);

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

        this._goBannerTimeout = setTimeout(() => {
            banner.style.display = 'none';
        }, 1400);
    },
    /**
     * 开启在线围棋真人双人对战模式 (随机先后手，我方固定在左侧，19 路)
     */
    startGoOnlineGame(roomId, isHost = false, hostIsBlackSynced = null) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
            AuthEngine.checkAndDeductEntryFee('GO', isPve);
        }

        // 切换游戏前清理斗地主残留定时器与麻将所有后台定时器
        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const goScr = document.getElementById('goGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (goScr) { goScr.style.display = 'flex'; goScr.classList.add('active'); }
        this.updateHeaderVisibility();

        // 房主随机决定先手黑棋归属并广播同步
        let hostIsBlack;
        if (isHost) {
            hostIsBlack = (hostIsBlackSynced !== null && hostIsBlackSynced !== undefined) ? hostIsBlackSynced : (Math.random() < 0.5);
            NetworkManager.clearGoMoves();
            NetworkManager.sendGoStart(roomId, hostIsBlack);
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
        const nameLeft = document.getElementById('goNameLeft');
        const roleLeft = document.getElementById('goRoleLeft');
        const avatarLeft = document.getElementById('goAvatarLeft');
        if (nameLeft) nameLeft.textContent = myNick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是对手)
        const nameRight = document.getElementById('goNameRight');
        const roleRight = document.getElementById('goRoleRight');
        const avatarRight = document.getElementById('goAvatarRight');
        if (nameRight) nameRight.textContent = oppNick;
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.goEngine.reset(false, myColor, 19); // 联机固定 19 路
        this.initGoUI();
        this.renderGoBoard();

        const isMyTurn = window.goEngine.currentTurn === myColor;
        this.updateGoStatusUI(isMyTurn ? '⚫ 轮到你落子 (先手黑棋)' : '⚪ 对方思考中 (后手白棋)...');
        UIRenderer.showToast(isMyTurn ? '🎲 随机先后手：你执先手黑棋！' : '🎲 随机先后手：你执后手白棋！');
        this.showGoCenterBanner(isMyTurn);

        // 联机开局：房主启动回合倒计时
        if (isHost && isMyTurn) {
            this.startGoTurnTimer();
        } else {
            this.stopGoTurnTimer();
        }

        // 监听云端落子广播 (含停一手)
        NetworkManager.onGoMove((move) => {
            if (!move || move.senderSlot === NetworkManager.myPlayerIndex) return;
            const engine = window.goEngine;
            let res;
            if (move.pass) {
                res = engine.pass();
            } else if (engine.board[move.r][move.c] === 0) {
                res = engine.placeStone(move.r, move.c);
            }
            this.renderGoBoard();
            if (!res) return;
            if (engine.isGameOver) {
                this.stopGoTurnTimer();
                this.handleGoEnd(engine.winner, engine.winReason || 'PASS');
            } else {
                const isNowMyTurn = engine.currentTurn === myColor;
                this.updateGoStatusUI(isNowMyTurn ? (myColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '⏳ 对方思考中...');
                if (isNowMyTurn) {
                    if (NetworkManager.isHost) this.startGoTurnTimer();
                } else {
                    this.stopGoTurnTimer();
                }
            }
        });

        // 监听联机超时/认输判负广播
        NetworkManager.onGoEnd((data) => {
            if (!data || !data.winnerColor) return;
            const engine = window.goEngine;
            if (!engine || engine.isGameOver) return;
            const winnerColor = data.winnerColor;
            engine.isGameOver = true;
            engine.winner = winnerColor;
            engine.winReason = data.reason || 'RESIGN';
            this.stopGoTurnTimer();
            this.handleGoEnd(winnerColor, engine.winReason);
        });

        // 监听在线悔棋申请广播
        NetworkManager.onGoUndoRequest((req) => {
            if (!req || req.senderSlot === NetworkManager.myPlayerIndex) return;
            const undoModal = document.getElementById('goUndoModal');
            const modalText = document.getElementById('goUndoModalText');
            if (undoModal && modalText) {
                modalText.textContent = `玩家 ${req.applicantNick || '对方'} 申请悔棋一步，是否同意？`;
                undoModal.style.display = 'flex';
            }
        });

        // 监听在线悔棋响应广播 (同意才扣次数，拒绝不扣次数)
        NetworkManager.onGoUndoResponse((resp) => {
            if (!resp || resp.senderSlot === NetworkManager.myPlayerIndex) return;
            if (resp.approved) {
                const engine = window.goEngine;
                if (engine) {
                    engine.undo();
                    this.renderGoBoard();
                }
                if (this.goUndoLeft > 0) {
                    this.goUndoLeft--;
                    const countEl = document.getElementById('goUndoCount');
                    if (countEl) countEl.textContent = this.goUndoLeft;
                    const btnUndo = document.getElementById('btnGoUndo');
                    if (this.goUndoLeft <= 0 && btnUndo) {
                        btnUndo.disabled = true;
                        btnUndo.classList.add('disabled');
                    }
                }
                UIRenderer.showToast(`🎉 对方同意了你的悔棋申请！本局还剩 ${this.goUndoLeft} 次`);
                this.updateGoStatusUI(`对方同意悔棋！本局还可悔棋 ${this.goUndoLeft} 次`);
            } else {
                UIRenderer.showToast(`❌ 对方拒绝了你的悔棋申请，未扣除悔棋次数 (剩余 ${this.goUndoLeft} 次)`);
                this.updateGoStatusUI(`对方拒绝悔棋，请继续落子`);
            }
        });

        // 监听在线双人【重来一局】投票 (双方均准备后自动开启新一局)
        NetworkManager.onGoRematchVote((votes) => {
            if (!votes) return;
            const hostVote = votes[0] && votes[0].ready;
            const joinerVote = votes[1] && votes[1].ready;

            const mySlot = NetworkManager.myPlayerIndex;
            const oppSlot = mySlot === 0 ? 1 : 0;
            const myVote = votes[mySlot] && votes[mySlot].ready;
            const oppVote = votes[oppSlot] && votes[oppSlot].ready;

            if (oppVote && !myVote) {
                this.updateGoStatusUI('🤝 对方已点击【重来一局】，等你准备...');
                UIRenderer.showToast('🤝 对方已申请【重来一局】，请点击确认！');
            }

            // 双方都点击了【重来一局】！重置盘面，开启新对局！
            if (hostVote && joinerVote) {
                NetworkManager.clearGoRematchVotes();
                this.startGoOnlineGame(roomId, isHost);
            }
        });
    },
    /**
     * 开启单机 AI 围棋切磋模式 (随机先后手，棋盘路数可选 9/13/19)
     */
    startGoAiMode() {
        // NEW 角标已读标记
        if (typeof AuthEngine !== 'undefined' && AuthEngine.markGameSeen) AuthEngine.markGameSeen('GO');
        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const goScr = document.getElementById('goGameScreen');

        // 切换游戏前清理斗地主残留定时器与麻将所有后台定时器
        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        // 单机 AI 模式标记
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (goScr) { goScr.style.display = 'flex'; goScr.classList.add('active'); }
        this.updateHeaderVisibility();

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';

        // 随机决定先后手
        const iAmBlack = Math.random() < 0.5;
        const myColor = iAmBlack ? 1 : 2;
        const boardSize = this.goBoardSize || 19;

        // 左侧卡片 (固定是我方)
        const nameLeft = document.getElementById('goNameLeft');
        const roleLeft = document.getElementById('goRoleLeft');
        const avatarLeft = document.getElementById('goAvatarLeft');
        if (nameLeft) nameLeft.textContent = nick;
        if (roleLeft) roleLeft.textContent = iAmBlack ? '⚫ 先手黑棋' : '⚪ 后手白棋';
        if (avatarLeft) avatarLeft.className = iAmBlack ? 'mini-stone-avatar black' : 'mini-stone-avatar white';

        // 右侧卡片 (固定是 AI 棋圣)
        const nameRight = document.getElementById('goNameRight');
        const roleRight = document.getElementById('goRoleRight');
        const avatarRight = document.getElementById('goAvatarRight');
        if (nameRight) nameRight.textContent = 'AI 棋圣';
        if (roleRight) roleRight.textContent = iAmBlack ? '⚪ 后手白棋' : '⚫ 先手黑棋';
        if (avatarRight) avatarRight.className = iAmBlack ? 'mini-stone-avatar white' : 'mini-stone-avatar black';

        window.goEngine.reset(true, myColor, boardSize);
        this.initGoUI();
        this.renderGoBoard();

        this.showGoCenterBanner(iAmBlack);

        if (iAmBlack) {
            this.updateGoStatusUI('⚫ 轮到你落子 (先手黑棋)');
            UIRenderer.showToast(`🎲 随机分配完成：你执先手黑棋！(${boardSize} 路)`);
            this.startGoTurnTimer();
        } else {
            this.updateGoStatusUI('🤖 AI 棋圣 (先手黑棋) 思考中...');
            UIRenderer.showToast(`🎲 随机分配完成：AI 棋圣执先手黑棋！(${boardSize} 路)`);
            this.stopGoTurnTimer();
            setTimeout(() => {
                const aiMove = window.goEngine.getBestAiMove();
                if (aiMove) {
                    if (aiMove.pass) {
                        window.goEngine.pass();
                        this.renderGoBoard();
                        this.updateGoStatusUI('⚪ 轮到你落子 (后手白棋)');
                        this.startGoTurnTimer();
                        return;
                    }
                    window.goEngine.placeStone(aiMove.r, aiMove.c);
                    this.renderGoBoard();
                    this.updateGoStatusUI('⚪ 轮到你落子 (后手白棋)');
                    this.startGoTurnTimer();
                }
            }, 800);
        }
    },
    /**
     * 处理围棋棋盘单元格点击落子 (严格校验当前回合，手机端支持 2-Tap 二次确认)
     */
    handleGoCellClick(r, c) {
        const engine = window.goEngine;
        if (!engine || engine.isGameOver) return;
        if (engine.board[r][c] !== 0) return;

        // 1. 严格回合校验
        if (!engine.isAiMode) {
            const myColor = engine.playerColor;
            if (engine.currentTurn !== myColor) {
                UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                return;
            }
        } else {
            if (engine.currentTurn !== engine.playerColor) {
                UIRenderer.showToast('⏳ 🤖 AI 棋圣思考中，请稍候...');
                return;
            }
        }

        // 2. 移动端 2-Tap 二次确认
        const isMobile = ('ontouchstart' in window) || window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

        if (isMobile) {
            if (!this.goPendingMove || this.goPendingMove.r !== r || this.goPendingMove.c !== c) {
                this.goPendingMove = { r, c };
                this.renderGoBoard();
                UIRenderer.showToast('🎯 已选定位置，再次点击确定落子');
                return;
            }
            this.goPendingMove = null;
        } else {
            this.goPendingMove = null;
        }

        // 3. 执行正式落子逻辑
        if (!engine.isAiMode) {
            const myColor = engine.playerColor;
            const res = engine.placeStone(r, c);
            if (!res || !res.success) {
                if (res && res.reason === 'KO') UIRenderer.showToast('♻️ 打劫！本手禁止立即提回 (劫争)');
                else if (res && res.reason === 'SUICIDE') UIRenderer.showToast('🚫 禁入点：落子后己方无气 (禁自杀)');
                else UIRenderer.showToast('⛔ 该位置不能落子');
                return;
            }

            this.renderGoBoard();
            NetworkManager.sendGoMove(r, c, myColor);

            if (engine.isGameOver) {
                this.stopGoTurnTimer();
                this.handleGoEnd(engine.winner, engine.winReason || 'PASS');
            } else {
                this.updateGoStatusUI('⏳ 对方思考中...');
                this.stopGoTurnTimer();
            }
            return;
        }

        // 单机 AI 模式落子
        const res = engine.placeStone(r, c);
        if (!res || !res.success) {
            if (res && res.reason === 'KO') UIRenderer.showToast('♻️ 打劫！本手禁止立即提回 (劫争)');
            else if (res && res.reason === 'SUICIDE') UIRenderer.showToast('🚫 禁入点：落子后己方无气 (禁自杀)');
            else UIRenderer.showToast('⛔ 该位置不能落子');
            return;
        }

        this.renderGoBoard();

        if (engine.isGameOver) {
            this.stopGoTurnTimer();
            this.handleGoEnd(engine.winner, engine.winReason || 'PASS');
            return;
        }

        // 触发 AI 落子 (拟人化随机思考 600ms ~ 1400ms)
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            this.updateGoStatusUI('🤖 AI 棋圣思考中...');
            this.stopGoTurnTimer();
            const randomThinkTime = Math.floor(Math.random() * 800 + 600);
            setTimeout(() => {
                const aiMove = engine.getBestAiMove();
                if (!aiMove) {
                    const aiPass = engine.pass();
                    this.renderGoBoard();
                    if (aiPass.gameOver) {
                        this.stopGoTurnTimer();
                        this.handleGoEnd(engine.winner, 'PASS');
                    } else {
                        this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                        this.startGoTurnTimer();
                    }
                    return;
                }
                if (aiMove.pass) {
                    const aiPass = engine.pass();
                    this.renderGoBoard();
                    if (aiPass.gameOver) {
                        this.stopGoTurnTimer();
                        this.handleGoEnd(engine.winner, 'PASS');
                    } else {
                        this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                        this.startGoTurnTimer();
                    }
                    return;
                }
                const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                this.renderGoBoard();
                if (aiRes && aiRes.success) {
                    if (engine.isGameOver) {
                        this.stopGoTurnTimer();
                        this.handleGoEnd(engine.winner, 'PASS');
                    } else {
                        this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                        this.startGoTurnTimer();
                    }
                }
            }, randomThinkTime);
        } else {
            this.updateGoStatusUI(engine.currentTurn === 1 ? '⚫ 黑方落子中' : '⚪ 白方落子中');
        }
    },
    /**
     * 处理停一手 (Pass) — 联机同步 / AI 模式触发 AI 回应
     */
    handleGoPass() {
        const engine = window.goEngine;
        if (!engine || engine.isGameOver) return;

        // 回合校验
        if (!engine.isAiMode) {
            if (engine.currentTurn !== engine.playerColor) {
                UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                return;
            }
        } else {
            if (engine.currentTurn !== engine.playerColor) {
                UIRenderer.showToast('⏳ 🤖 AI 棋圣思考中，请稍候...');
                return;
            }
        }

        const colorBeforePass = engine.currentTurn;
        const res = engine.pass();
        if (!res || !res.success) return;

        this.goPendingMove = null;
        this.renderGoBoard();

        if (!engine.isAiMode) {
            // 联机：广播停一手 (携带停手方颜色)
            NetworkManager.sendGoPass(colorBeforePass);
        }

        if (engine.isGameOver) {
            this.stopGoTurnTimer();
            this.handleGoEnd(engine.winner, 'PASS');
            return;
        }

        // 轮到 AI 回应
        if (engine.isAiMode && engine.currentTurn !== engine.playerColor) {
            this.updateGoStatusUI('🤖 AI 棋圣思考中...');
            this.stopGoTurnTimer();
            const randomThinkTime = Math.floor(Math.random() * 800 + 600);
            setTimeout(() => {
                const aiMove = engine.getBestAiMove();
                if (!aiMove || aiMove.pass) {
                    const aiPass = engine.pass();
                    this.renderGoBoard();
                    if (aiPass.gameOver) {
                        this.stopGoTurnTimer();
                        this.handleGoEnd(engine.winner, 'PASS');
                    } else {
                        this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                        this.startGoTurnTimer();
                    }
                    return;
                }
                const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                this.renderGoBoard();
                if (aiRes && aiRes.success) {
                    if (engine.isGameOver) {
                        this.stopGoTurnTimer();
                        this.handleGoEnd(engine.winner, 'PASS');
                    } else {
                        this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                        this.startGoTurnTimer();
                    }
                }
            }, randomThinkTime);
        } else {
            this.updateGoStatusUI(engine.currentTurn === 1 ? '⚫ 黑方落子中' : '⚪ 白方落子中');
            this.startGoTurnTimer();
        }
    },
    /**
     * 数目结算 (数子法) — 弹出结算弹窗
     */
    handleGoScore() {
        const engine = window.goEngine;
        if (!engine) return;

        const score = engine.computeScore();
        if (!score) return;

        const elBlackStones = document.getElementById('goScoreBlackStones');
        const elBlackTerritory = document.getElementById('goScoreBlackTerritory');
        const elBlackTotal = document.getElementById('goScoreBlackTotal');
        const elWhiteStones = document.getElementById('goScoreWhiteStones');
        const elWhiteTerritory = document.getElementById('goScoreWhiteTerritory');
        const elKomi = document.getElementById('goScoreKomi');
        const elWhiteTotal = document.getElementById('goScoreWhiteTotal');
        const elResult = document.getElementById('goScoreResultText');
        const modal = document.getElementById('goScoreModal');

        if (elBlackStones) elBlackStones.textContent = score.blackStones;
        if (elBlackTerritory) elBlackTerritory.textContent = score.blackTerritory;
        if (elBlackTotal) elBlackTotal.textContent = score.blackScore;
        if (elWhiteStones) elWhiteStones.textContent = score.whiteStones;
        if (elWhiteTerritory) elWhiteTerritory.textContent = score.whiteTerritory;
        if (elKomi) elKomi.textContent = score.komi;
        if (elWhiteTotal) elWhiteTotal.textContent = score.whiteScore;
        if (elResult) {
            if (score.winner === 1) elResult.textContent = `🏆 黑方胜 (${score.blackScore} vs ${score.whiteScore})`;
            else if (score.winner === 2) elResult.textContent = `🏆 白方胜 (${score.whiteScore} vs ${score.blackScore})`;
            else elResult.textContent = `🤝 平局 (${score.blackScore} vs ${score.whiteScore})`;
        }
        if (modal) modal.style.display = 'flex';

        // 终局结算 (若对局已结束) — 双停一手后自动弹出时也走这里
        if (engine.isGameOver) {
            this.stopGoTurnTimer();
            const myColor = engine.playerColor;
            if (score.winner === myColor) {
                this.updateGoStatusUI('🎉 你赢了！黑方胜 · 请点击【重来一局】');
            } else if (score.winner !== 0) {
                this.updateGoStatusUI('😔 你输了 · 请点击【重来一局】');
            } else {
                this.updateGoStatusUI('🤝 平局 · 请点击【重来一局】');
            }
        }
    },
    /**
     * 重新渲染盘面棋子 (含提子统计、最近一手标记)
     */
    renderGoBoard() {
        const engine = window.goEngine;
        if (!engine) return;

        const cells = document.querySelectorAll('.go-cell');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const val = engine.board[r][c];

            let stone = cell.querySelector('.go-stone');

            if (val === 0) {
                cell.querySelectorAll('.go-stone').forEach(s => s.remove());
                stone = null;

                // 2-Tap 预选位置渲染半透明预览
                if (this.goPendingMove && this.goPendingMove.r === r && this.goPendingMove.c === c) {
                    const currentTurn = engine.currentTurn;
                    const previewStone = document.createElement('div');
                    previewStone.className = `go-stone ${currentTurn === 1 ? 'black' : 'white'} preview`;
                    cell.appendChild(previewStone);
                }
            } else {
                const isLastMove = engine.lastMove && engine.lastMove.r === r && engine.lastMove.c === c;

                cell.querySelectorAll('.hover-preview, .preview').forEach(s => s.remove());

                stone = cell.querySelector('.go-stone:not(.hover-preview):not(.preview)');

                if (!stone) {
                    stone = document.createElement('div');
                    stone.className = `go-stone ${val === 1 ? 'black' : 'white'}`;
                    cell.appendChild(stone);

                    const soundObj = typeof SoundEngine !== 'undefined' ? SoundEngine : (typeof audioSynth !== 'undefined' ? audioSynth : null);
                    if (soundObj && soundObj.playStoneDrop) {
                        soundObj.playStoneDrop(val === 2);
                    }
                } else {
                    stone.className = `go-stone ${val === 1 ? 'black' : 'white'}`;
                }

                if (isLastMove) stone.classList.add('last-move');
                else stone.classList.remove('last-move');
            }
        });

        // 停一手标记: 最近一手是 Pass 时在棋盘中央显示虚线圈
        const passMarker = document.querySelector('.go-pass-marker');
        if (passMarker) passMarker.remove();
        const lastMove = engine.lastMove;
        if (lastMove && lastMove.pass) {
            const boardEl = document.getElementById('goBoardContainer');
            if (boardEl) {
                const marker = document.createElement('div');
                marker.className = 'go-pass-marker';
                boardEl.appendChild(marker);
            }
        }

        // 提子统计
        const capB = document.getElementById('goCapturesBlack');
        const capW = document.getElementById('goCapturesWhite');
        if (capB) capB.textContent = engine.capturesBlack;
        if (capW) capW.textContent = engine.capturesWhite;
    },
    /**
     * 更新顶部对局状态指示与当前回合玩家高亮
     */
    updateGoStatusUI(msg) {
        const textEl = document.getElementById('goTurnText');
        if (textEl) textEl.textContent = msg;

        const pillLeft = document.getElementById('goPlayerLeft');
        const pillRight = document.getElementById('goPlayerRight');
        const engine = window.goEngine;

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
     * 启动/重置围棋 60 秒回合倒计时
     */
    startGoTurnTimer() {
        this.stopGoTurnTimer();

        const engine = window.goEngine;
        const badge = document.getElementById('goTimerBadge');
        const secsEl = document.getElementById('goTimerSecs');
        if (!engine || engine.isGameOver) {
            if (badge) badge.style.display = 'none';
            return;
        }

        // 联机模式非房主不本地计时 (以房主广播为准)
        if (!NetworkManager.isAiMode && !NetworkManager.isHost) {
            if (badge) badge.style.display = 'none';
            return;
        }

        // 分阶段递增倒计时: 越到后期时间越多 (中盘战斗+收官更复杂)
        // 前30手90秒 -> 30-60手150秒 -> 60手后180秒
        const goHalfMoves = (window.goEngine && window.goEngine.moveHistory) ? window.goEngine.moveHistory.length : 0;
        this._goTimerSeconds = goHalfMoves < 60 ? (goHalfMoves < 30 ? 90 : 150) : 180;
        if (badge) badge.style.display = 'inline-flex';
        if (secsEl) secsEl.textContent = String(this._goTimerSeconds);

        this._goTimerInterval = setInterval(() => {
            const gScr = document.getElementById('goGameScreen');
            if (!gScr || gScr.style.display === 'none' || !window.goEngine || window.goEngine.isGameOver) {
                this.stopGoTurnTimer();
                return;
            }

            this._goTimerSeconds--;
            if (secsEl) secsEl.textContent = Math.max(0, this._goTimerSeconds);
            if (badge) {
                if (this._goTimerSeconds <= 10) badge.classList.add('urgent');
                else badge.classList.remove('urgent');
            }

            if (this._goTimerSeconds <= 0) {
                this.stopGoTurnTimer();
                this.handleGoTimeout();
            }
        }, 1000);
    },
    /**
     * 停止围棋回合倒计时
     */
    stopGoTurnTimer() {
        if (this._goTimerInterval) {
            clearInterval(this._goTimerInterval);
            this._goTimerInterval = null;
        }
        const badge = document.getElementById('goTimerBadge');
        if (badge) badge.style.display = 'none';
    },
    /**
     * 围棋回合超时自动处理
     * - 单机 AI：玩家回合超时 -> 自动停一手 (托管)
     * - 联机：房主判定当前回合玩家超时 -> 对方获胜，广播超时结果
     */
    handleGoTimeout() {
        const engine = window.goEngine;
        if (!engine || engine.isGameOver) return;

        if (engine.isAiMode) {
            // 单机 AI 模式：若轮到玩家且超时，自动停一手 (托管)
            if (engine.currentTurn === engine.playerColor) {
                const res = engine.pass();
                this.renderGoBoard();
                UIRenderer.showToast('⏱ 思考超时，已自动停一手！');
                if (res && res.gameOver) {
                    this.handleGoEnd(engine.winner, 'PASS');
                    return;
                }
                // 托管后轮到 AI，触发 AI 落子
                this.updateGoStatusUI('🤖 AI 棋圣思考中...');
                setTimeout(() => {
                    const aiMove = engine.getBestAiMove();
                    if (!aiMove || aiMove.pass) {
                        const aiPass = engine.pass();
                        this.renderGoBoard();
                        if (aiPass.gameOver) {
                            this.handleGoEnd(engine.winner, 'PASS');
                        } else {
                            this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                            this.startGoTurnTimer();
                        }
                    } else {
                        const aiRes = engine.placeStone(aiMove.r, aiMove.c);
                        this.renderGoBoard();
                        if (aiRes && aiRes.success) {
                            if (engine.isGameOver) {
                                this.handleGoEnd(engine.winner, 'PASS');
                            } else {
                                this.updateGoStatusUI(engine.currentTurn === engine.playerColor ? (engine.playerColor === 1 ? '⚫ 轮到你落子' : '⚪ 轮到你落子') : '🤖 AI 思考中...');
                                this.startGoTurnTimer();
                            }
                        }
                    }
                }, 700);
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
        engine.winReason = 'TIMEOUT';
        this.handleGoEnd(winnerColor, 'TIMEOUT');
        if (NetworkManager.sendGoEnd) {
            NetworkManager.sendGoEnd('TIMEOUT', winnerColor);
        }
    },
    /**
     * 处理胜负结算 (终局)
     */
    handleGoEnd(winner, reason) {
        // 对局结束：停止回合倒计时
        this.stopGoTurnTimer();

        let msg = '';
        if (reason === 'RESIGN') {
            msg = winner === 1 ? '🏳️ 白方认输，黑方获胜！' : '🏳️ 黑方认输，白方获胜！';
        } else if (reason === 'TIMEOUT') {
            msg = winner === 1 ? '⏱ 黑方获胜！' : '⏱ 白方获胜！';
        } else if (reason === 'PASS') {
            msg = '🤝 双方停一手，终局！';
        } else {
            msg = winner === 1 ? '🎉 黑方获胜！' : '🎉 白方获胜！';
        }

        UIRenderer.showToast(msg);
        this.updateGoStatusUI(winner === 0 ? '🤝 平局 · 请点击【重来一局】' : (winner === 1 ? '🏆 黑方胜 · 请点击【重来一局】' : '🏆 白方胜 · 请点击【重来一局】'));

        // 双停一手终局：自动弹出数目结算
        if (reason === 'PASS' || (window.goEngine && window.goEngine.scoreResult)) {
            this.handleGoScore();
        }

        const myColor = window.goEngine ? window.goEngine.playerColor : 1;
        if (typeof AuthEngine !== 'undefined' && AuthEngine.recordGoMatchResult) {
            if (winner === 0) {
                AuthEngine.recordGoMatchResult(false, true); // 平局
            } else if (winner === myColor) {
                AuthEngine.recordGoMatchResult(true, false); // 胜利
            } else {
                AuthEngine.recordGoMatchResult(false, false); // 失败
            }

            // 💰 结算围棋【知因币】 (零分保底，PVE 25% 比例)
            if (AuthEngine.updateCoins) {
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                const ratio = isPve ? 0.25 : 1.0;

                if (winner === myColor) {
                    const totalMoves = window.goEngine ? window.goEngine.moveHistory.length : 40;
                    const quickBonus = (totalMoves <= 20) ? 10 : 0;
                    const winCoins = Math.ceil((100 + quickBonus) * ratio);
                    AuthEngine.updateCoins(winCoins, isPve ? '围棋切磋胜 (PVE)' : '围棋胜 (PVP)');
                } else if (winner !== 0) {
                    const loseCoins = -Math.ceil(50 * ratio);
                    AuthEngine.updateCoins(loseCoins, isPve ? '围棋切磋负 (PVE)' : '围棋负 (PVP)');
                }

                // ⭐ 结算围棋【经验值】
                if (AuthEngine.addExp) {
                    const isWin = (winner === myColor);
                    const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                    AuthEngine.addExp(expVal, isPve ? '围棋切磋 (PVE)' : '围棋对局 (PVP)');
                }
            }
        }

        // 对局结束：隐藏悔棋/停一手/数目/认输，开启【重来一局】
        ['btnGoUndo', 'btnGoPass', 'btnGoScore', 'btnGoResign'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.style.display = 'none';
        });

        const btnRematch = document.getElementById('btnGoRematch');
        if (btnRematch) {
            btnRematch.style.display = 'flex';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }
    }

    /* ============================================================
       ♞ 游鲸中国象棋 UI 控制与交互逻辑 (Xiangqi UI Methods)
       ============================================================ */

    /** 象棋炮位/兵位标记坐标 */

});
