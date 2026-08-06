/**
 * 游鲸中国象棋 核心对局引擎 (Xiangqi / Chinese Chess Engine)
 * 支持: 9x10 棋盘、车马炮相仕帅兵卒走法(含蹩马腿/塞象眼/将帅对面/炮架)、
 *       将军/应将/将死/困毙判定、启发式 AI、悔棋、联机双人对战
 */
class XiangqiEngine {
    constructor() {
        this.board = null;      // 10 行 x 9 列, 每格 null 或 { color: 'R'|'B', type: 'K'|'A'|'B'|'N'|'R'|'C'|'P' }
        this.currentTurn = 'R'; // 红方先行
        this.moveHistory = [];  // [{fr, fc, tr, tc, piece, captured, check}]
        this.isGameOver = false;
        this.winner = null;     // 'R' | 'B' | 'D'(和)
        this.winReason = null;  // 'CHECKMATE' | 'STALEMATE' | 'RESIGN' | 'TIMEOUT'
        this.lastMove = null;
        this.isAiMode = false;
        this.playerColor = 'R';
        this.inCheck = false;
        this.lastCaptureMove = 0; // 最后吃子的步数 (60 回合无吃子判和)   // 当前轮到方是否被将军
    }

    /** 棋子显示名 */
    static pieceName(color, type) {
        const names = {
            K: { R: '帅', B: '将' },
            A: { R: '仕', B: '士' },
            B: { R: '相', B: '象' },
            N: { R: '马', B: '马' },
            R: { R: '车', B: '车' },
            C: { R: '炮', B: '炮' },
            P: { R: '兵', B: '卒' }
        };
        return names[type] ? names[type][color] : type;
    }

    /** 子力价值 */
    static pieceValue(type) {
        switch (type) {
            case 'K': return 10000;
            case 'R': return 9;
            case 'N': return 4;
            case 'C': return 4.5;
            case 'B': return 2;
            case 'A': return 2;
            case 'P': return 1;
            default: return 0;
        }
    }

    /**
     * 重置并初始化标准布局
     */
    reset(isAi = false, playerColor = 'R') {
        this.board = Array(10).fill(null).map(() => Array(9).fill(null));
        this.currentTurn = 'R';
        this.moveHistory = [];
        this.isGameOver = false;
        this.winner = null;
        this.winReason = null;
        this.lastMove = null;
        this.isAiMode = isAi;
        this.playerColor = playerColor;
        this.inCheck = false;

        const backLine = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
        // 黑方 (上方, 行 0)
        backLine.forEach((type, c) => {
            this.board[0][c] = { color: 'B', type };
        });
        this.board[2][1] = { color: 'B', type: 'C' };
        this.board[2][7] = { color: 'B', type: 'C' };
        [0, 2, 4, 6, 8].forEach(c => { this.board[3][c] = { color: 'B', type: 'P' }; });
        // 红方 (下方, 行 9)
        backLine.forEach((type, c) => {
            this.board[9][c] = { color: 'R', type };
        });
        this.board[7][1] = { color: 'R', type: 'C' };
        this.board[7][7] = { color: 'R', type: 'C' };
        [0, 2, 4, 6, 8].forEach(c => { this.board[6][c] = { color: 'R', type: 'P' }; });

        return true;
    }

    /** 获取 (r,c) 位置的棋子 */
    getPiece(r, c) {
        if (r < 0 || r > 9 || c < 0 || c > 8) return null;
        return this.board[r][c];
    }

    /** 找到某方帅/将的位置 */
    findKing(color) {
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.color === color && p.type === 'K') return { r, c };
            }
        }
        return null;
    }

    /** 某方是否被将军 (对方任意子能吃到己方帅/将) */
    isCheck(color) {
        const king = this.findKing(color);
        if (!king) return false;
        const opp = color === 'R' ? 'B' : 'R';
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.color === opp) {
                    if (this._canAttack(r, c, king.r, king.c)) return true;
                }
            }
        }
        return false;
    }

    /** 攻击判定: (fr,fc) 的棋子按走法规则能否攻击到 (tr,tc) (不含送将检查, 用于将军检测) */
    _canAttack(fr, fc, tr, tc) {
        const p = this.board[fr][fc];
        if (!p) return false;
        const dr = tr - fr;
        const dc = tc - fc;
        const adr = Math.abs(dr);
        const adc = Math.abs(dc);

        switch (p.type) {
            case 'R': // 车: 直线且路径无子
                if (dr !== 0 && dc !== 0) return false;
                return this._pathClear(fr, fc, tr, tc);
            case 'N': // 马: 日字 + 蹩马腿
                if (!((adr === 1 && adc === 2) || (adr === 2 && adc === 1))) return false;
                if (adr === 2) { // 纵跳, 马腿在 (fr + dr/2, fc)
                    if (this.board[fr + dr / 2][fc]) return false;
                } else {
                    if (this.board[fr][fc + dc / 2]) return false;
                }
                return true;
            case 'B': // 相/象: 田字 + 塞象眼 + 不过河
                if (adr !== 2 || adc !== 2) return false;
                if (this.board[fr + dr / 2][fc + dc / 2]) return false; // 塞象眼
                // 红相在下方(行5-9), 黑象在上方(行0-4)
                if (p.color === 'R' && tr < 5) return false;
                if (p.color === 'B' && tr > 4) return false;
                return true;
            case 'A': // 仕/士: 九宫斜走一格
                if (adr !== 1 || adc !== 1) return false;
                return this._inPalace(tr, tc, p.color);
            case 'K': // 帅/将: 九宫直走一格 (攻击判定不含将帅对面, 对面检查在走法层)
                if (adr + adc !== 1) return false;
                return this._inPalace(tr, tc, p.color);
            case 'C': // 炮: 直线, 吃子必须隔一个炮架
                if (dr !== 0 && dc !== 0) return false;
                const blockers = this._countBlockers(fr, fc, tr, tc);
                if (blockers === 1) return true; // 隔一子吃
                return false;
            case 'P': // 兵/卒
                if (p.color === 'R') {
                    // 红兵向上(r 减小); 未过河(行>=5)只能向前; 过河(行<=4)可横走
                    if (tr === fr - 1 && tc === fc) return true;
                    if (fr <= 4 && tr === fr && adc === 1) return true;
                    return false;
                } else {
                    if (tr === fr + 1 && tc === fc) return true;
                    if (fr >= 5 && tr === fr && adc === 1) return true;
                    return false;
                }
            default:
                return false;
        }
    }

    /** 判断 (r,c) 是否在 color 方的九宫内 */
    _inPalace(r, c, color) {
        if (c < 3 || c > 5) return false;
        if (color === 'R') return r >= 7 && r <= 9;
        return r >= 0 && r <= 2;
    }

    /** 直线路径是否无子 (不含起点终点) */
    _pathClear(fr, fc, tr, tc) {
        if (fr === tr) {
            const step = tc > fc ? 1 : -1;
            for (let c = fc + step; c !== tc; c += step) {
                if (this.board[fr][c]) return false;
            }
        } else {
            const step = tr > fr ? 1 : -1;
            for (let r = fr + step; r !== tr; r += step) {
                if (this.board[r][fc]) return false;
            }
        }
        return true;
    }

    /** 统计 (fr,fc) 到 (tr,tc) 直线间的棋子数 (不含两端) */
    _countBlockers(fr, fc, tr, tc) {
        let count = 0;
        if (fr === tr) {
            const step = tc > fc ? 1 : -1;
            for (let c = fc + step; c !== tc; c += step) {
                if (this.board[fr][c]) count++;
            }
        } else {
            const step = tr > fr ? 1 : -1;
            for (let r = fr + step; r !== tr; r += step) {
                if (this.board[r][fc]) count++;
            }
        }
        return count;
    }

    /** 将帅对面: 两帅同列且中间无子 */
    _kingsFacing(fr, fc, tr, tc, color) {
        // 走完后检查: 若走的是帅/将, 与对方帅/将同列无遮挡 -> 非法
        if (this.board[fr][fc] && this.board[fr][fc].type === 'K') {
            const opp = color === 'R' ? 'B' : 'R';
            const oppKing = this.findKing(opp);
            if (oppKing && oppKing.c === tc) {
                if (this._countBlockers(fr, fc, oppKing.r, oppKing.c) === 0) return true;
            }
        }
        return false;
    }

    /** 获取 (r,c) 棋子的全部合法走法 (含不能送将检查) */
    getLegalMoves(r, c) {
        const p = this.board[r][c];
        if (!p) return [];
        if (p.color !== this.currentTurn) return [];
        if (this.isGameOver) return [];

        const moves = [];
        const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        switch (p.type) {
            case 'R': // 车
                for (const [dr, dc] of dirs4) {
                    let nr = r + dr, nc = c + dc;
                    while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
                        const target = this.board[nr][nc];
                        if (!target) {
                            moves.push({ r: nr, c: nc });
                        } else {
                            if (target.color !== p.color) moves.push({ r: nr, c: nc });
                            break;
                        }
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            case 'N': { // 马
                const jumps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
                for (const [dr, dc] of jumps) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
                    // 蹩马腿
                    if (Math.abs(dr) === 2) {
                        if (this.board[r + dr / 2][c]) continue;
                    } else {
                        if (this.board[r][c + dc / 2]) continue;
                    }
                    const target = this.board[nr][nc];
                    if (!target || target.color !== p.color) moves.push({ r: nr, c: nc });
                }
                break;
            }
            case 'B': { // 相/象
                const jumps = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
                for (const [dr, dc] of jumps) {
                    const nr = r + dr, nc = c + dc;
                    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
                    if (this.board[r + dr / 2][c + dc / 2]) continue; // 塞象眼
                    if (p.color === 'R' && nr < 5) continue;
                    if (p.color === 'B' && nr > 4) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== p.color) moves.push({ r: nr, c: nc });
                }
                break;
            }
            case 'A': { // 仕/士
                const jumps = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
                for (const [dr, dc] of jumps) {
                    const nr = r + dr, nc = c + dc;
                    if (!this._inPalace(nr, nc, p.color)) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== p.color) moves.push({ r: nr, c: nc });
                }
                break;
            }
            case 'K': { // 帅/将
                for (const [dr, dc] of dirs4) {
                    const nr = r + dr, nc = c + dc;
                    if (!this._inPalace(nr, nc, p.color)) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== p.color) moves.push({ r: nr, c: nc });
                }
                break;
            }
            case 'C': { // 炮
                for (const [dr, dc] of dirs4) {
                    let nr = r + dr, nc = c + dc;
                    let jumped = false;
                    while (nr >= 0 && nr <= 9 && nc >= 0 && nc <= 8) {
                        const target = this.board[nr][nc];
                        if (!target) {
                            if (!jumped) moves.push({ r: nr, c: nc }); // 无炮架只可走空位
                        } else {
                            if (!jumped) {
                                jumped = true; // 遇到第一个子作为炮架, 继续找炮架后的子
                            } else {
                                if (target.color !== p.color) moves.push({ r: nr, c: nc }); // 隔一子吃
                                break;
                            }
                        }
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            }
            case 'P': { // 兵/卒
                const forward = p.color === 'R' ? -1 : 1;
                const crossable = p.color === 'R' ? (r <= 4) : (r >= 5); // 过河后可横走
                const candidates = [{ r: r + forward, c: c }];
                if (crossable) {
                    candidates.push({ r, c: c - 1 }, { r, c: c + 1 });
                }
                for (const { r: nr, c: nc } of candidates) {
                    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
                    const target = this.board[nr][nc];
                    if (!target || target.color !== p.color) moves.push({ r: nr, c: nc });
                }
                break;
            }
        }

        // 过滤: 不能送将 (走完后己方被将军) + 将帅对面
        const legal = [];
        for (const mv of moves) {
            const captured = this.board[mv.r][mv.c];
            this.board[mv.r][mv.c] = p;
            this.board[r][c] = null;
            const isSelfCheck = this.isCheck(p.color);
            const facing = this._kingsFacingAfter(r, c, mv.r, mv.c, p);
            this.board[r][c] = p;
            this.board[mv.r][mv.c] = captured;
            if (!isSelfCheck && !facing) legal.push(mv);
        }
        return legal;
    }

    /** 走子后是否形成将帅对面 */
    _kingsFacingAfter(fr, fc, tr, tc, piece) {
        if (piece.type !== 'K') return false;
        const opp = piece.color === 'R' ? 'B' : 'R';
        const oppKing = this.findKing(opp);
        // 帅已走到新位置 (tr,tc), 从新位置到对方将之间无遮挡则构成对面
        if (oppKing && oppKing.c === tc) {
            if (this._countBlockers(tr, tc, oppKing.r, oppKing.c) === 0) return true;
        }
        return false;
    }

    /**
     * 执行走子
     * @returns {object|null} { piece, captured, check, gameOver, winner, winReason }
     */
    move(fr, fc, tr, tc) {
        if (this.isGameOver) return null;
        const p = this.board[fr][fc];
        if (!p || p.color !== this.currentTurn) return null;

        // 校验走法合法性
        const legal = this.getLegalMoves(fr, fc);
        if (!legal.some(m => m.r === tr && m.c === tc)) return null;

        const captured = this.board[tr][tc];
        this.board[tr][tc] = p;
        this.board[fr][fc] = null;

        // 记录最后吃子步数 (60 回合无吃子判和)
        const moveNumber = this.moveHistory.length + 1;
        if (captured) this.lastCaptureMove = moveNumber;

        // 将军判定 (对手)
        const opp = p.color === 'R' ? 'B' : 'R';
        const check = this.isCheck(opp);

        // 将死/困毙/判和判定
        let gameOver = false;
        let winner = null;
        let winReason = null;
        if (check) {
            if (!this.hasAnyLegalMove(opp)) {
                gameOver = true;
                winner = p.color;
                winReason = 'CHECKMATE';
            }
        } else {
            if (!this.hasAnyLegalMove(opp)) {
                // 困毙 (无子可走且未被将军) - 多数规则判负
                gameOver = true;
                winner = p.color;
                winReason = 'STALEMATE';
            }
        }
        // 60 回合 (120 半回合) 无吃子判和
        if (!gameOver && moveNumber - this.lastCaptureMove >= 120) {
            gameOver = true;
            winner = 'D';
            winReason = 'DRAWN';
        }

        this.lastMove = { fr, fc, tr, tc, piece: { ...p }, captured: captured ? { ...captured } : null, check, moveNumber: this.moveHistory.length + 1 };
        this.moveHistory.push({
            fr, fc, tr, tc, piece: { ...p },
            captured: captured ? { r: tr, c: tc, piece: { ...captured } } : null,
            check,
            inCheckBefore: this.inCheck
        });

        this.inCheck = check;
        this.isGameOver = gameOver;
        this.winner = winner;
        this.winReason = winReason;
        this.currentTurn = opp;

        return { piece: p, captured, check, gameOver, winner, winReason };
    }

    /** 当前方 (或指定方) 是否有任意合法走法 */
    hasAnyLegalMove(color) {
        const col = color || this.currentTurn;
        // 临时切换回合, 确保 getLegalMoves 的回合校验与检查方一致
        const savedTurn = this.currentTurn;
        this.currentTurn = col;
        let found = false;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.color === col) {
                    if (this.getLegalMoves(r, c).length > 0) {
                        found = true;
                        break;
                    }
                }
            }
            if (found) break;
        }
        this.currentTurn = savedTurn;
        return found;
    }

    /** 悔棋一步 (AI 模式撤回双方两步) */
    undo() {
        if (this.moveHistory.length === 0 || this.isGameOver) return false;
        const popCount = (this.isAiMode && this.moveHistory.length >= 2) ? 2 : 1;
        for (let i = 0; i < popCount; i++) {
            if (this.moveHistory.length === 0) break;
            const mv = this.moveHistory.pop();
            this.board[mv.fr][mv.fc] = { ...mv.piece };
            if (mv.captured) {
                this.board[mv.captured.r][mv.captured.c] = { ...mv.captured.piece };
            } else {
                this.board[mv.tr][mv.tc] = null;
            }
        }
        this.isGameOver = false;
        this.winner = null;
        this.winReason = null;
        const last = this.moveHistory[this.moveHistory.length - 1];
        this.currentTurn = last ? (last.piece.color === 'R' ? 'B' : 'R') : 'R';
        this.lastMove = last ? { fr: last.fr, fc: last.fc, tr: last.tr, tc: last.tc, piece: { ...last.piece }, captured: last.captured ? { ...last.captured.piece } : null, check: last.check, moveNumber: this.moveHistory.length } : null;
        this.inCheck = this.isCheck(this.currentTurn);
        return true;
    }

    /** 认输 */
    resign(color) {
        if (this.isGameOver) return false;
        this.isGameOver = true;
        this.winReason = 'RESIGN';
        this.winner = color === 'R' ? 'B' : 'R';
        return true;
    }

    /** 子力 + 位置评估 (正值对红方有利) */
    evaluate() {
        let score = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (!p) continue;
                let val = XiangqiEngine.pieceValue(p.type);
                // 位置加成
                if (p.type === 'P') {
                    // 兵过河越深入越有价值
                    if (p.color === 'R') {
                        if (r <= 4) val += (5 - r) * 0.4 + 1.2;
                    } else {
                        if (r >= 5) val += (r - 4) * 0.4 + 1.2;
                    }
                    // 靠近中路(列4)略加分
                    val += (4 - Math.abs(c - 4)) * 0.05;
                } else if (p.type === 'N' || p.type === 'C') {
                    // 马/炮活动性好: 远离边角 + 接近河界
                    const centralBonus = (4 - Math.abs(c - 4)) * 0.1;
                    const riverBonus = p.color === 'R' ? (Math.abs(r - 4) * 0.08) : (Math.abs(r - 5) * 0.08);
                    val += centralBonus + riverBonus;
                }
                score += (p.color === 'R') ? val : -val;
            }
        }
        return score;
    }

    /** 生成某方所有走法 [{fr, fc, tr, tc, score}] */
    _generateAllMoves(color) {
        const moves = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const p = this.board[r][c];
                if (p && p.color === color) {
                    const legal = this.getLegalMoves(r, c);
                    legal.forEach(m => moves.push({ fr: r, fc: c, tr: m.r, tc: m.c }));
                }
            }
        }
        return moves;
    }

    /** 评估一步棋的启发分数 */
    _evaluateMove(fr, fc, tr, tc, color) {
        const piece = this.board[fr][fc];
        const target = this.board[tr][tc];
        let score = 0;

        // 吃子价值
        if (target) {
            score += XiangqiEngine.pieceValue(target.type) * 10;
            if (target.type === 'K') score += 100000; // 直接吃帅
        }

        // 暂存走子评估
        const captured = target;
        this.board[tr][tc] = piece;
        this.board[fr][fc] = null;

        // 将军加分
        const opp = color === 'R' ? 'B' : 'R';
        if (this.isCheck(opp)) {
            score += 60;
            if (!this.hasAnyLegalMove(opp)) score += 100000; // 将死
        }

        // 位置变化
        const afterVal = this._piecePositionValue(piece, tr, tc);
        const beforeVal = this._piecePositionValue(piece, fr, fc);
        score += (afterVal - beforeVal) * 0.8;

        // 被吃风险 (简单: 目标位置是否被对方攻击) - 轻惩罚
        if (!target) {
            // 简化: 不计算对方攻击, 略
        }

        this.board[fr][fc] = piece;
        this.board[tr][tc] = captured;

        return score;
    }

    /** 棋子位置价值 */
    _piecePositionValue(piece, r, c) {
        let v = 0;
        if (piece.type === 'P') {
            if (piece.color === 'R') {
                if (r <= 4) v += (5 - r) * 0.4 + 1.2;
            } else {
                if (r >= 5) v += (r - 4) * 0.4 + 1.2;
            }
            v += (4 - Math.abs(c - 4)) * 0.05;
        } else if (piece.type === 'N' || piece.type === 'C') {
            v += (4 - Math.abs(c - 4)) * 0.1;
            v += piece.color === 'R' ? Math.abs(r - 4) * 0.08 : Math.abs(r - 5) * 0.08;
        }
        return v;
    }

    /** 智能 AI 最佳走法 (启发式: 吃子 > 将军 > 位置 + 随机扰动) */
    getBestAiMove() {
        const aiColor = this.currentTurn;
        const moves = this._generateAllMoves(aiColor);
        if (moves.length === 0) return null;

        let best = null;
        let bestScore = -Infinity;
        for (const mv of moves) {
            const score = this._evaluateMove(mv.fr, mv.fc, mv.tr, mv.tc, aiColor) + Math.random() * 15;
            if (score > bestScore) {
                bestScore = score;
                best = mv;
            }
        }
        return best;
    }
}

const xiangqiEngine = new XiangqiEngine();
window.xiangqiEngine = xiangqiEngine;
