/* ====================================================================
   游鲸中国象棋 对局方法 (从 main.js 拆分, 原型扩展 GameEngineController)
   拆分目标: 主页代码与各游戏对局代码解耦, 改象棋只动本文件
   注意: 本文件必须在 main.js (GameEngineController 类定义) 之后加载
   ==================================================================== */
Object.assign(GameEngineController.prototype, {

    XIANGQI_POINT_MARKS() {
        const marks = [];
        [[2, 1], [2, 7], [7, 1], [7, 7]].forEach(([r, c]) => marks.push(r + ',' + c));
        for (let c = 0; c <= 8; c += 2) {
            marks.push('3,' + c);
            marks.push('6,' + c);
        }
        return marks;
    }

    /**
     * 生成标准中国象棋棋盘 SVG (完整边框/河界断开两侧贯通/九宫斜线/炮兵位记号)
     * 坐标: viewBox 0-8 (9列) x 0-9 (10行), 交叉点在整数坐标
     */,
    /**
     * 生成标准中国象棋棋盘 SVG (完整边框/河界断开两侧贯通/九宫斜线/炮兵位记号)
     * 坐标: viewBox 0-8 (9列) x 0-9 (10行), 交叉点在整数坐标
     */
    _buildXiangqiBoardSvg(flip) {
        const L = [];
        // 横线: 每行一条, 从左边框到右边框 (y=0..9)
        for (let y = 0; y <= 9; y++) {
            L.push(`<line x1="0" y1="${y}" x2="8" y2="${y}"/>`);
        }
        // 竖线: 两侧边线整段贯通; 内部列在河界 (y=4~5) 断开为两段
        for (let x = 0; x <= 8; x++) {
            if (x === 0 || x === 8) {
                L.push(`<line x1="${x}" y1="0" x2="${x}" y2="9"/>`);
            } else {
                L.push(`<line x1="${x}" y1="0" x2="${x}" y2="4"/>`);
                L.push(`<line x1="${x}" y1="5" x2="${x}" y2="9"/>`);
            }
        }
        // 九宫斜线 (黑方视角上下翻转)
        const fy = (y) => flip ? 9 - y : y;
        const diagLines = [
            [3, 0, 5, 2], [5, 0, 3, 2],
            [3, 7, 5, 9], [5, 7, 3, 9]
        ];
        diagLines.forEach(([x1, y1, x2, y2]) => {
            L.push(`<line x1="${x1}" y1="${fy(y1)}" x2="${x2}" y2="${fy(y2)}"/>`);
        });
        // 炮位交叉记号
        [[1, 2], [7, 2], [1, 7], [7, 7]].forEach(([x, y]) => {
            const yy = fy(y);
            L.push(`<path d="M${x - 0.2} ${yy - 0.2} L${x + 0.2} ${yy + 0.2} M${x - 0.2} ${yy + 0.2} L${x + 0.2} ${yy - 0.2}"/>`);
        });
        // 兵位交叉记号
        for (let x = 0; x <= 8; x += 2) {
            [3, 6].forEach(y => {
                const yy = fy(y);
                L.push(`<path d="M${x - 0.2} ${yy - 0.2} L${x + 0.2} ${yy + 0.2} M${x - 0.2} ${yy + 0.2} L${x + 0.2} ${yy - 0.2}"/>`);
            });
        }
        return `<svg class="xq-board-svg" viewBox="-0.3 -0.3 8.6 9.6" preserveAspectRatio="none">${L.join('')}</svg>`;
    }

    /**
     * 初始化象棋棋盘 UI (9x10 网格 + 炮兵位标记 + 河界)
     */,
    /**
     * 初始化象棋棋盘 UI (9x10 网格 + 炮兵位标记 + 河界)
     */
    initXiangqiUI() {
        const boardContainer = document.getElementById('xqBoardContainer');
        if (!boardContainer) return;

        const engine = window.xiangqiEngine;
        if (!engine) return;

        this.xqUndoLeft = 3;
        this.xqSelected = null;      // { r, c }
        this.xqMoveDots = [];        // 合法走法提示 [{r, c}]
        this.xqMyRematchReady = false;

        const countEl = document.getElementById('xqUndoCount');
        if (countEl) countEl.textContent = '3';

        const btnUndo = document.getElementById('btnXqUndo');
        if (btnUndo) { btnUndo.style.display = 'flex'; btnUndo.disabled = false; btnUndo.classList.remove('disabled'); }
        const btnRematch = document.getElementById('btnXqRematch');
        if (btnRematch) {
            btnRematch.style.display = 'none';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }
        const btnResign = document.getElementById('btnXqResign');
        if (btnResign) { btnResign.style.display = 'flex'; btnResign.disabled = false; btnResign.classList.remove('disabled'); }

        boardContainer.innerHTML = '';

        // 用 SVG 精确绘制标准棋盘 (完整边框 + 河界断开两侧竖线贯通 + 九宫斜线 + 炮兵位记号)
        boardContainer.insertAdjacentHTML('beforeend', this._buildXiangqiBoardSvg(engine.playerColor === 'B'));

        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'xq-cell';
                cell.dataset.r = r;
                cell.dataset.c = c;
                boardContainer.appendChild(cell);
            }
        }

        // 事件委托: 点击棋盘任意位置(含棋子)按坐标换算交叉点, 避免棋子覆盖格子导致点击失效
        boardContainer.addEventListener('click', (e) => {
            const rect = boardContainer.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * 8.6 - 0.3;
            const y = (e.clientY - rect.top) / rect.height * 9.6 - 0.3;
            const dc = Math.round(x);
            const dr = Math.round(y);
            if (dc >= 0 && dc <= 8 && dr >= 0 && dr <= 9) {
                // 视角翻转: 显示坐标 -> 引擎坐标
                const flip = (window.xiangqiEngine && window.xiangqiEngine.playerColor === 'B');
                const r = flip ? 9 - dr : dr;
                this.handleXiangqiCellClick(r, dc);
            }
        });

        // 楚河汉界文字
        const river = document.createElement('div');
        river.className = 'xq-river';
        river.innerHTML = '<span>楚&nbsp;河</span><span>汉&nbsp;界</span>';
        boardContainer.appendChild(river);

        // 玩家头像棋子 + 角色信息统一设置 (任何模式进入都保证正确)
        const avatarLeft = document.getElementById('xqAvatarLeft');
        const avatarRight = document.getElementById('xqAvatarRight');
        const roleLeft = document.getElementById('xqRoleLeft');
        const roleRight = document.getElementById('xqRoleRight');
        const iAmRed2 = engine.playerColor === 'R';
        if (avatarLeft) avatarLeft.textContent = iAmRed2 ? '帅' : '将';
        if (avatarRight) avatarRight.textContent = iAmRed2 ? '将' : '帅';
        if (roleLeft) roleLeft.textContent = iAmRed2 ? '🔴 先手红方' : '⚫ 后手黑方';
        if (roleRight) roleRight.textContent = iAmRed2 ? '⚫ 后手黑方' : '🔴 先手红方';
    }

    /**
     * 渲染棋盘棋子 (含选中/合法走法提示/将军闪烁/最近走子)
     */,
    /**
     * 渲染棋盘棋子 (含选中/合法走法提示/将军闪烁/最近走子)
     */
    renderXiangqiBoard() {
        const engine = window.xiangqiEngine;
        if (!engine) return;

        const board = document.getElementById('xqBoardContainer');
        if (!board) return;

        // 视角翻转: 我方是黑方时棋盘上下翻转, 保证我方棋子永远在下
        const flip = (engine.playerColor === 'B');
        const viewR = (r) => flip ? 9 - r : r;

        // 清除旧棋子 (棋盘线 SVG 与 cell 热区保留)
        board.querySelectorAll('.xq-piece').forEach(el => el.remove());

        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = engine.board[r][c];
                if (!p) continue;
                const dr = viewR(r);
                const piece = document.createElement('div');
                piece.className = 'xq-piece ' + (p.color === 'R' ? 'red' : 'black');
                piece.textContent = XiangqiEngine.pieceName(p.color, p.type);
                piece.style.left = ((c + 0.3) / 8.6 * 100) + '%';
                piece.style.top = ((dr + 0.3) / 9.6 * 100) + '%';

                if (this.xqSelected && viewR(this.xqSelected.r) === dr && this.xqSelected.c === c) {
                    piece.classList.add('selected');
                }
                if (engine.lastMove && viewR(engine.lastMove.tr) === dr && engine.lastMove.tc === c) {
                    piece.classList.add('last-move');
                }
                // 将军提示: 只闪烁被将军方的帅/将 (当前轮到方即被将军方)
                if (engine.inCheck && p.type === 'K' && p.color === engine.currentTurn) {
                    piece.classList.add('in-check');
                }
                board.appendChild(piece);
            }
        }
    }

    /**
     * 处理棋盘格子点击 (选中/走子)
     */,
    /**
     * 处理棋盘格子点击 (选中/走子)
     */
    handleXiangqiCellClick(r, c) {
        const engine = window.xiangqiEngine;
        if (!engine || engine.isGameOver) return;

        // 回合校验
        if (engine.currentTurn !== engine.playerColor) {
            UIRenderer.showToast(engine.isAiMode ? '🤖 AI 思考中，请稍候...' : '⏳ 还没轮到你，请等待对方落子');
            return;
        }

        const piece = engine.board[r][c];

        // 点击己方棋子: 选中并显示走法
        if (piece && piece.color === engine.playerColor) {
            this.xqSelected = { r, c };
            this.xqMoveDots = engine.getLegalMoves(r, c);
            this.renderXiangqiBoard();
            this.playXiangqiSelectSound(); // 选子音效
            return;
        }

        // 点击合法目标: 走子
        if (this.xqSelected) {
            const isLegal = this.xqMoveDots.some(d => d.r === r && d.c === c);
            if (isLegal) {
                const res = engine.move(this.xqSelected.r, this.xqSelected.c, r, c);
                if (res) {
                    const fr = this.xqSelected.r, fc = this.xqSelected.c;
                    this.xqSelected = null;
                    this.xqMoveDots = [];
                    this.renderXiangqiBoard();
                    this.playXiangqiMoveSound(); // 落子音效

                    // 联机广播走子
                    if (!engine.isAiMode && NetworkManager.sendXiangqiMove) {
                        NetworkManager.sendXiangqiMove(fr, fc, r, c);
                    }

                    if (engine.isGameOver) {
                        this.stopXiangqiTurnTimer();
                        this.handleXiangqiEnd(engine.winner, engine.winReason);
                        return;
                    }

                    // 将军提示
                    if (res.check) {
                        this.updateXiangqiStatusUI(res.piece.color === 'R' ? '⚡ 将军！黑方被将' : '⚡ 将军！红方被将');
                        UIRenderer.showToast('⚡ 将军！');
                    } else {
                        this.updateXiangqiStatusUI(engine.currentTurn === 'R' ? '🔴 红方落子' : '⚫ 黑方落子');
                    }

                    // 单机 AI 模式: 触发 AI 走子
                    if (engine.isAiMode && !engine.isGameOver) {
                        this.stopXiangqiTurnTimer();
                        this.triggerXiangqiAiMove();
                    }
                }
                return;
            }
            // 点击非法位置: 取消选中
            this.xqSelected = null;
            this.xqMoveDots = [];
            this.renderXiangqiBoard();
        }
    }

    /**
     * AI 走子 (拟人化延迟; 开局可传 initialDelay 让玩家先意识到对局开始)
     */,
    /**
     * AI 走子 (拟人化延迟; 开局可传 initialDelay 让玩家先意识到对局开始)
     */
    triggerXiangqiAiMove(initialDelay) {
        const engine = window.xiangqiEngine;
        const aiColor = engine.currentTurn;
        this.updateXiangqiStatusUI(aiColor === 'R' ? '🤖 AI (红方) 思考中...' : '🤖 AI (黑方) 思考中...');

        // 开局 AI 先手时给 2 秒缓冲, 平时 500-1200ms
        const thinkDelay = (initialDelay && initialDelay > 0) ? initialDelay : (500 + Math.floor(Math.random() * 700));
        setTimeout(() => {
            try {
                const scr = document.getElementById('xiangqiGameScreen');
                if (!scr || scr.style.display === 'none' || engine.isGameOver) return;
                if (engine.currentTurn !== aiColor) return;

                const mv = engine.getBestAiMove();
                if (!mv) {
                    // 无走法: 将被将死/困毙 -> 判负 (兜底防宕机)
                    if (!engine.isGameOver) {
                        engine.isGameOver = true;
                        engine.winReason = 'STALEMATE';
                        engine.winner = engine.currentTurn === 'R' ? 'B' : 'R';
                    }
                    this.stopXiangqiTurnTimer();
                    this.handleXiangqiEnd(engine.winner, engine.winReason);
                    return;
                }
                const res = engine.move(mv.fr, mv.fc, mv.tr, mv.tc);
                if (!res) return;
                this.renderXiangqiBoard();
                this.playXiangqiMoveSound(); // AI 落子音效

                if (engine.isGameOver) {
                    this.stopXiangqiTurnTimer();
                    this.handleXiangqiEnd(engine.winner, engine.winReason);
                    return;
                }
                if (res.check) {
                    this.updateXiangqiStatusUI('⚡ 将军！轮到你应将');
                    UIRenderer.showToast('⚡ 将军！');
                } else {
                    this.updateXiangqiStatusUI(engine.playerColor === 'R' ? '🔴 轮到你落子 (红方)' : '⚫ 轮到你落子 (黑方)');
                }
                this.startXiangqiTurnTimer();
            } catch (err) {
                console.error('[Xiangqi] AI 走子异常:', err);
                // 异常兜底: 强制判负避免卡死
                if (!engine.isGameOver) {
                    engine.isGameOver = true;
                    engine.winReason = 'STALEMATE';
                    engine.winner = engine.currentTurn === 'R' ? 'B' : 'R';
                }
                this.stopXiangqiTurnTimer();
                this.handleXiangqiEnd(engine.winner, engine.winReason);
            }
        }, thinkDelay);
    }

    /**
     * 开启单机 AI 象棋对局 (随机红黑)
     */,
    /**
     * 开启单机 AI 象棋对局 (随机红黑)
     */
    startXiangqiAiMode() {
        // NEW 角标已读标记
        if (typeof AuthEngine !== 'undefined' && AuthEngine.markGameSeen) AuthEngine.markGameSeen('XIANGQI');
        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const xqScr = document.getElementById('xiangqiGameScreen');

        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (xqScr) { xqScr.style.display = 'flex'; xqScr.classList.add('active'); }
        this.updateHeaderVisibility();

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';

        // 随机先后手
        const iAmRed = Math.random() < 0.5;
        const myColor = iAmRed ? 'R' : 'B';

        const nameLeft = document.getElementById('xqNameLeft');
        const roleLeft = document.getElementById('xqRoleLeft');
        const avatarLeft = document.getElementById('xqAvatarLeft');
        if (nameLeft) nameLeft.textContent = nick;
        if (roleLeft) roleLeft.textContent = iAmRed ? '🔴 先手红方' : '⚫ 后手黑方';
        if (avatarLeft) avatarLeft.className = 'xq-mini-piece ' + (iAmRed ? 'red-piece' : 'black-piece');
        if (avatarLeft) avatarLeft.textContent = iAmRed ? '帅' : '将';

        const nameRight = document.getElementById('xqNameRight');
        const roleRight = document.getElementById('xqRoleRight');
        const avatarRight = document.getElementById('xqAvatarRight');
        if (nameRight) nameRight.textContent = 'AI 棋圣';
        if (roleRight) roleRight.textContent = iAmRed ? '⚫ 后手黑方' : '🔴 先手红方';
        if (avatarRight) avatarRight.className = 'xq-mini-piece ' + (iAmRed ? 'black-piece' : 'red-piece');
        if (avatarRight) avatarRight.textContent = iAmRed ? '将' : '帅';

        window.xiangqiEngine.reset(true, myColor);
        this.initXiangqiUI();
        this.renderXiangqiBoard();

        // 开局播放战鼓音效
        this.playXiangqiOpenSound();

        const banner = document.getElementById('xqCenterBanner');
        const bannerText = document.getElementById('xqCenterBannerText');
        if (banner && bannerText) {
            bannerText.textContent = iAmRed ? '你先手 · 红方' : '你后手 · 黑方';
            banner.style.display = 'flex';
            banner.style.animation = 'none';
            void banner.offsetWidth;
            banner.style.animation = '';
            setTimeout(() => { banner.style.display = 'none'; }, 1400);
        }

        if (iAmRed) {
            this.updateXiangqiStatusUI('🔴 轮到你落子 (红方先手)');
            this.startXiangqiTurnTimer();
        } else {
            this.updateXiangqiStatusUI('🤖 AI 棋圣 (红方) 思考中...');
            // AI 先手: 等 2 秒再开始下, 让玩家意识到对局已开始
            this.triggerXiangqiAiMove(2000);
        }
    }

    /**
     * 播放象棋开局战鼓音效 (sound/zhangu.mp3)
     */,
    /**
     * 播放象棋开局战鼓音效 (sound/zhangu.mp3)
     */
    playXiangqiOpenSound() {
        try {
            const audio = new Audio('sound/zhangu.mp3');
            audio.volume = 0.7;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {
            // 音频加载/播放失败不阻塞对局
        }
    }

    /**
     * 播放落子音效 (sound/mahjangclack-1.wav)
     */,
    /**
     * 播放落子音效 (sound/mahjangclack-1.wav)
     */
    playXiangqiMoveSound() {
        try {
            const audio = new Audio('sound/mahjangclack-1.wav');
            audio.volume = 0.9;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }

    /**
     * 播放选子音效 (sound/placing-a-piece.mp3)
     */,
    /**
     * 播放选子音效 (sound/placing-a-piece.mp3)
     */
    playXiangqiSelectSound() {
        try {
            const audio = new Audio('sound/placing-a-piece.mp3');
            audio.volume = 0.55;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }

    /**
     * 开启联机象棋对局 (随机红黑, 固定 9x10)
     */,
    /**
     * 开启联机象棋对局 (随机红黑, 固定 9x10)
     */
    startXiangqiOnlineGame(roomId, isHost = false, hostIsRedSynced = null) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
            AuthEngine.checkAndDeductEntryFee('XIANGQI', isPve);
        }

        this.stopDoudizhuTimers();
        this.stopMahjongGame();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const xqScr = document.getElementById('xiangqiGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (xqScr) { xqScr.style.display = 'flex'; xqScr.classList.add('active'); }
        this.updateHeaderVisibility();

        let hostIsRed;
        if (isHost) {
            hostIsRed = (hostIsRedSynced !== null && hostIsRedSynced !== undefined) ? hostIsRedSynced : (Math.random() < 0.5);
            NetworkManager.sendXiangqiStart(roomId, hostIsRed);
        } else {
            hostIsRed = (hostIsRedSynced !== null && hostIsRedSynced !== undefined) ? hostIsRedSynced : true;
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : (isHost ? 0 : 1);
        const iAmRed = (mySlot === 0 && hostIsRed) || (mySlot === 1 && !hostIsRed);
        const myColor = iAmRed ? 'R' : 'B';

        const myNick = NetworkManager.nickname || '玩家';
        const oppNick = isHost ? '对手' : '房主';

        const nameLeft = document.getElementById('xqNameLeft');
        const roleLeft = document.getElementById('xqRoleLeft');
        const avatarLeft = document.getElementById('xqAvatarLeft');
        if (nameLeft) nameLeft.textContent = myNick;
        if (roleLeft) roleLeft.textContent = iAmRed ? '🔴 先手红方' : '⚫ 后手黑方';
        if (avatarLeft) avatarLeft.className = 'xq-mini-piece ' + (iAmRed ? 'red-piece' : 'black-piece');
        if (avatarLeft) avatarLeft.textContent = iAmRed ? '帅' : '将';

        const nameRight = document.getElementById('xqNameRight');
        const roleRight = document.getElementById('xqRoleRight');
        const avatarRight = document.getElementById('xqAvatarRight');
        if (nameRight) nameRight.textContent = oppNick;
        if (roleRight) roleRight.textContent = iAmRed ? '⚫ 后手黑方' : '🔴 先手红方';
        if (avatarRight) avatarRight.className = 'xq-mini-piece ' + (iAmRed ? 'black-piece' : 'red-piece');
        if (avatarRight) avatarRight.textContent = iAmRed ? '将' : '帅';

        window.xiangqiEngine.reset(false, myColor);
        this.initXiangqiUI();
        this.renderXiangqiBoard();

        // 开局播放战鼓音效
        this.playXiangqiOpenSound();

        const isMyTurn = window.xiangqiEngine.currentTurn === myColor;
        this.updateXiangqiStatusUI(isMyTurn ? '🔴 轮到你落子 (红方)' : '⚫ 对方思考中 (黑方)...');
        UIRenderer.showToast(isMyTurn ? '🎲 随机先后手：你执红方先手！' : '🎲 随机先后手：你执黑方后手！');

        const banner = document.getElementById('xqCenterBanner');
        const bannerText = document.getElementById('xqCenterBannerText');
        if (banner && bannerText) {
            bannerText.textContent = iAmRed ? '你先手 · 红方' : '你后手 · 黑方';
            banner.style.display = 'flex';
            banner.style.animation = 'none';
            void banner.offsetWidth;
            banner.style.animation = '';
            setTimeout(() => { banner.style.display = 'none'; }, 1400);
        }

        if (isHost && isMyTurn) this.startXiangqiTurnTimer();
        else this.stopXiangqiTurnTimer();

        // 监听对方走子广播
        NetworkManager.onXiangqiMove((move) => {
            if (!move || move.senderSlot === NetworkManager.myPlayerIndex) return;
            const engine = window.xiangqiEngine;
            const res = engine.move(move.fr, move.fc, move.tr, move.tc);
            if (!res) return;
            this.renderXiangqiBoard();
            this.playXiangqiMoveSound(); // 对方落子音效
            if (engine.isGameOver) {
                this.stopXiangqiTurnTimer();
                this.handleXiangqiEnd(engine.winner, engine.winReason);
            } else {
                const nowMyTurn = engine.currentTurn === myColor;
                this.updateXiangqiStatusUI(nowMyTurn ? (myColor === 'R' ? '🔴 轮到你落子' : '⚫ 轮到你落子') : '⏳ 对方思考中...');
                if (res.check) UIRenderer.showToast('⚡ 将军！');
                if (nowMyTurn && NetworkManager.isHost) this.startXiangqiTurnTimer();
                else this.stopXiangqiTurnTimer();
            }
        });

        // 联机超时/认输广播
        NetworkManager.onXiangqiEnd((data) => {
            if (!data || !data.winnerColor) return;
            const engine = window.xiangqiEngine;
            if (!engine || engine.isGameOver) return;
            engine.isGameOver = true;
            engine.winner = data.winnerColor;
            engine.winReason = data.reason || 'RESIGN';
            this.stopXiangqiTurnTimer();
            this.handleXiangqiEnd(engine.winner, engine.winReason);
        });

        // 联机悔棋申请
        NetworkManager.onXiangqiUndoRequest((req) => {
            if (!req || req.senderSlot === NetworkManager.myPlayerIndex) return;
            const undoModal = document.getElementById('goUndoModal');
            const modalText = document.getElementById('goUndoModalText');
            if (undoModal && modalText) {
                modalText.textContent = `玩家 ${req.applicantNick || '对方'} 申请悔棋一步，是否同意？`;
                undoModal.style.display = 'flex';
            }
        });

        NetworkManager.onXiangqiUndoResponse((resp) => {
            if (!resp || resp.senderSlot === NetworkManager.myPlayerIndex) return;
            if (resp.approved) {
                if (window.xiangqiEngine) {
                    window.xiangqiEngine.undo();
                    this.renderXiangqiBoard();
                }
                if (this.xqUndoLeft > 0) {
                    this.xqUndoLeft--;
                    const countEl = document.getElementById('xqUndoCount');
                    if (countEl) countEl.textContent = this.xqUndoLeft;
                    const btnUndo = document.getElementById('btnXqUndo');
                    if (this.xqUndoLeft <= 0 && btnUndo) {
                        btnUndo.disabled = true;
                        btnUndo.classList.add('disabled');
                    }
                }
                UIRenderer.showToast(`🎉 对方同意悔棋！本局还剩 ${this.xqUndoLeft} 次`);
            } else {
                UIRenderer.showToast('❌ 对方拒绝了悔棋申请');
            }
        });

        // 联机重来投票
        NetworkManager.onXiangqiRematchVote((votes) => {
            if (!votes) return;
            const mySlot = NetworkManager.myPlayerIndex;
            const oppSlot = mySlot === 0 ? 1 : 0;
            const myVote = votes[mySlot] && votes[mySlot].ready;
            const oppVote = votes[oppSlot] && votes[oppSlot].ready;
            if (oppVote && !myVote) {
                this.updateXiangqiStatusUI('🤝 对方已点击【重来一局】，等你准备...');
                UIRenderer.showToast('🤝 对方已申请【重来一局】，请点击确认！');
            }
            if (votes[0] && votes[0].ready && votes[1] && votes[1].ready) {
                NetworkManager.clearXiangqiRematchVotes();
                this.startXiangqiOnlineGame(roomId, isHost);
            }
        });
    }

    /**
     * 更新顶部状态与回合高亮
     */,
    /**
     * 更新顶部状态与回合高亮
     */
    updateXiangqiStatusUI(msg) {
        const textEl = document.getElementById('xqTurnText');
        if (textEl) textEl.textContent = msg;

        const pillLeft = document.getElementById('xqPlayerLeft');
        const pillRight = document.getElementById('xqPlayerRight');
        const engine = window.xiangqiEngine;
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
    }

    /**
     * 象棋 60 秒回合倒计时 (超时自动走子)
     */,
    /**
     * 象棋 60 秒回合倒计时 (超时自动走子)
     */
    startXiangqiTurnTimer() {
        this.stopXiangqiTurnTimer();
        const engine = window.xiangqiEngine;
        const badge = document.getElementById('xqTimerBadge');
        const secsEl = document.getElementById('xqTimerSecs');
        if (!engine || engine.isGameOver) {
            if (badge) badge.style.display = 'none';
            return;
        }
        if (!NetworkManager.isAiMode && !NetworkManager.isHost) {
            if (badge) badge.style.display = 'none';
            return;
        }

        // 分阶段递增倒计时: 越到后期时间越多 (中残局更复杂)
        // 前30手60秒 -> 30-60手90秒 -> 60手后120秒
        const halfMoves = (window.xiangqiEngine && window.xiangqiEngine.moveHistory) ? window.xiangqiEngine.moveHistory.length : 0;
        this._xqTimerSeconds = halfMoves < 60 ? (halfMoves < 30 ? 60 : 90) : 120;
        if (badge) badge.style.display = 'inline-flex';
        if (secsEl) secsEl.textContent = String(this._xqTimerSeconds);

        this._xqTimerInterval = setInterval(() => {
            const scr = document.getElementById('xiangqiGameScreen');
            if (!scr || scr.style.display === 'none' || !window.xiangqiEngine || window.xiangqiEngine.isGameOver) {
                this.stopXiangqiTurnTimer();
                return;
            }
            this._xqTimerSeconds--;
            if (secsEl) secsEl.textContent = Math.max(0, this._xqTimerSeconds);
            if (badge) {
                if (this._xqTimerSeconds <= 10) badge.classList.add('urgent');
                else badge.classList.remove('urgent');
            }
            if (this._xqTimerSeconds <= 0) {
                this.stopXiangqiTurnTimer();
                this.handleXiangqiTimeout();
            }
        }, 1000);
    }
,
    stopXiangqiTurnTimer() {
        if (this._xqTimerInterval) {
            clearInterval(this._xqTimerInterval);
            this._xqTimerInterval = null;
        }
        const badge = document.getElementById('xqTimerBadge');
        if (badge) badge.style.display = 'none';
    }

    /**
     * 回合超时: 自动走一步合法走法 (单机); 联机由房主判负
     */,
    /**
     * 回合超时: 自动走一步合法走法 (单机); 联机由房主判负
     */
    handleXiangqiTimeout() {
        const engine = window.xiangqiEngine;
        if (!engine || engine.isGameOver) return;

        if (engine.isAiMode) {
            if (engine.currentTurn === engine.playerColor) {
                // 玩家超时: 自动走一步
                const mv = engine.getBestAiMove();
                if (mv) {
                    const res = engine.move(mv.fr, mv.fc, mv.tr, mv.tc);
                    this.renderXiangqiBoard();
                    UIRenderer.showToast('⏱ 思考超时，已自动走子！');
                    if (res && res.check) UIRenderer.showToast('⚡ 将军！');
                    if (engine.isGameOver) {
                        this.handleXiangqiEnd(engine.winner, engine.winReason);
                        return;
                    }
                    this.triggerXiangqiAiMove();
                }
            }
            return;
        }

        if (!NetworkManager.isHost) return;
        const timeoutColor = engine.currentTurn;
        const winnerColor = timeoutColor === 'R' ? 'B' : 'R';
        UIRenderer.showToast(`⏱ 玩家超时，${winnerColor === 'R' ? '红方' : '黑方'}获胜！`);
        engine.isGameOver = true;
        engine.winner = winnerColor;
        engine.winReason = 'TIMEOUT';
        this.handleXiangqiEnd(winnerColor, 'TIMEOUT');
        if (NetworkManager.sendXiangqiEnd) {
            NetworkManager.sendXiangqiEnd('TIMEOUT', winnerColor);
        }
    }

    /**
     * 胜负结算
     */,
    /**
     * 胜负结算
     */
    handleXiangqiEnd(winner, reason) {
        this.stopXiangqiTurnTimer();

        let msg = '';
        if (reason === 'CHECKMATE') {
            msg = winner === 'R' ? '🏆 红方将死黑方，红胜！' : '🏆 黑方将死红方，黑胜！';
        } else if (reason === 'STALEMATE') {
            msg = '🤝 困毙，对方无子可走！';
        } else if (reason === 'RESIGN') {
            msg = winner === 'R' ? '🏳️ 黑方认输，红方获胜！' : '🏳️ 红方认输，黑方获胜！';
        } else if (reason === 'TIMEOUT') {
            msg = winner === 'R' ? '⏱ 红方获胜！' : '⏱ 黑方获胜！';
        } else {
            msg = winner === 'R' ? '🎉 红方获胜！' : '🎉 黑方获胜！';
        }

        UIRenderer.showToast(msg);
        this.updateXiangqiStatusUI(winner === 'R' ? '🏆 红方胜 · 请点击【重来一局】' : '🏆 黑方胜 · 请点击【重来一局】');

        const myColor = window.xiangqiEngine ? window.xiangqiEngine.playerColor : 'R';
        if (typeof AuthEngine !== 'undefined' && AuthEngine.recordXiangqiMatchResult) {
            if (winner === 'D') {
                AuthEngine.recordXiangqiMatchResult(false, true); // 和棋记平局
            } else if (winner === myColor) {
                AuthEngine.recordXiangqiMatchResult(true, false);
            } else {
                AuthEngine.recordXiangqiMatchResult(false, false);
            }

            if (AuthEngine.updateCoins) {
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                const ratio = isPve ? 0.25 : 1.0;
                if (winner === myColor) {
                    const totalMoves = window.xiangqiEngine ? window.xiangqiEngine.moveHistory.length : 40;
                    const quickBonus = (totalMoves <= 20) ? 10 : 0;
                    AuthEngine.updateCoins(Math.ceil((100 + quickBonus) * ratio), isPve ? '象棋切磋胜 (PVE)' : '象棋胜 (PVP)');
                } else if (winner && winner !== 'D') {
                    AuthEngine.updateCoins(-Math.ceil(50 * ratio), isPve ? '象棋切磋负 (PVE)' : '象棋负 (PVP)');
                }
                if (AuthEngine.addExp && winner !== 'D') {
                    const isWin = (winner === myColor);
                    AuthEngine.addExp(isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50), isPve ? '象棋切磋 (PVE)' : '象棋对局 (PVP)');
                }
            }
        }

        ['btnXqUndo', 'btnXqResign'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.style.display = 'none';
        });

        const btnRematch = document.getElementById('btnXqRematch');
        if (btnRematch) {
            btnRematch.style.display = 'flex';
            btnRematch.disabled = false;
            btnRematch.classList.remove('disabled');
            btnRematch.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重来一局';
        }
    }

    /* ============================================================
       🀄 游鲸麻将 UI 控制与交互逻辑 (Mahjong UI Methods)
       ============================================================ */

    /**
     * 开启单机 AI 游鲸麻将切磋模式
     */
    /* ============================================================
       🀄 游鲸麻将 4人围桌 UI 控制与交互逻辑 (4-Player Table Mahjong UI)
       ============================================================ */

    /**
     * 开启在线多人/补齐 AI 游鲸麻将模式 (真正多人云端同步局)
     */

});
