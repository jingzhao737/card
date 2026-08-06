/**
 * 游鲸围棋 核心对局引擎 (Go / Weiqi Core Engine)
 * 支持 9路 / 13路 / 19路 标准棋盘、黑白交替落子、
 * 提子吃子、打劫(KO)、禁自杀、停一手(Pass)、数目结算(数子法)、启发式高智能 AI 及云端双人对战
 */
class GoEngine {
    constructor() {
        this.BOARD_SIZE = 19; // 默认 19 路 (支持 9 / 13 / 19)
        this.komi = 7.5;      // 贴目 (19路 7.5, 13路 6.5, 9路 5.5)
        this.board = [];      // BOARD_SIZE x BOARD_SIZE: 0-空, 1-黑子, 2-白子
        this.currentTurn = 1; // 1-黑子先行, 2-白子
        this.moveHistory = []; // 落子历史 [{r, c, color, pass, captured:[{r,c}], prevKey, koPoint, passesAfter}]
        this.isGameOver = false;
        this.winner = null;   // 1-黑胜, 2-白胜, 0-平局
        this.winReason = null; // 'PASS' 双停一手 / 'RESIGN' 认输 / 'TIMEOUT' 超时 / 'SCORE' 数目
        this.isAiMode = false;
        this.playerColor = 1; // 单机模式玩家颜色
        this.lastMove = null;
        this.capturesBlack = 0; // 黑方提掉的白子数
        this.capturesWhite = 0; // 白方提掉的黑子数
        this.consecutivePasses = 0;
        this.koPoint = null;    // 打劫禁止落子点 {r, c}
        this.scoreResult = null; // 数目结算结果
        this._prevBoardKey = null; // 上一手落子前的盘面指纹 (用于简单劫争判定)
    }

    /** 获取指定路数的星位坐标 */
    static getStarPoints(size) {
        if (size === 19) {
            return ['3,3','3,9','3,15','9,3','9,9','9,15','15,3','15,9','15,15'];
        }
        if (size === 13) {
            return ['3,3','3,9','9,3','9,9','6,6'];
        }
        return ['2,2','2,6','6,2','6,6','4,4']; // 9路
    }

    /** 获取指定路数的贴目 */
    static getKomi(size) {
        if (size === 19) return 7.5;
        if (size === 13) return 6.5;
        return 5.5;
    }

    /**
     * 重置对局盘面
     */
    reset(isAi = false, playerColor = 1, boardSize = 19) {
        this.BOARD_SIZE = boardSize;
        this.komi = GoEngine.getKomi(boardSize);
        this.board = Array(this.BOARD_SIZE).fill(null).map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentTurn = 1; // 黑子先行
        this.moveHistory = [];
        this.isGameOver = false;
        this.winner = null;
        this.winReason = null;
        this.isAiMode = isAi;
        this.playerColor = playerColor;
        this.lastMove = null;
        this.capturesBlack = 0;
        this.capturesWhite = 0;
        this.consecutivePasses = 0;
        this.koPoint = null;
        this.scoreResult = null;
        this._prevBoardKey = null;
    }

    /** 盘面指纹 (用于劫争判定) */
    _boardKey(board) {
        return board.map(row => row.join('')).join('/');
    }

    /** BFS 获取 (r,c) 同色棋子所在整块棋 */
    _getGroup(board, r, c, color) {
        const size = this.BOARD_SIZE;
        const group = [];
        const visited = new Set();
        const stack = [[r, c]];
        visited.add(r + ',' + c);
        while (stack.length) {
            const [cr, cc] = stack.pop();
            group.push([cr, cc]);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = cr + dr, nc = cc + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                const key = nr + ',' + nc;
                if (visited.has(key)) continue;
                if (board[nr][nc] === color) {
                    visited.add(key);
                    stack.push([nr, nc]);
                }
            }
        }
        return group;
    }

    /** 计算一块棋的气 */
    _countLiberties(board, group) {
        const size = this.BOARD_SIZE;
        const libs = new Set();
        for (const [r, c] of group) {
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                if (board[nr][nc] === 0) libs.add(nr + ',' + nc);
            }
        }
        return libs.size;
    }

    /** 移除指定颜色所有无气棋子，返回被提走的坐标数组 */
    _removeDeadGroups(board, color) {
        const size = this.BOARD_SIZE;
        const removed = [];
        const visited = new Set();
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (board[r][c] === color && !visited.has(r + ',' + c)) {
                    const group = this._getGroup(board, r, c, color);
                    group.forEach(p => visited.add(p[0] + ',' + p[1]));
                    if (this._countLiberties(board, group) === 0) {
                        group.forEach(([gr, gc]) => {
                            board[gr][gc] = 0;
                            removed.push({ r: gr, c: gc });
                        });
                    }
                }
            }
        }
        return removed;
    }

    /**
     * 在 (r, c) 位置落子 (含提子、禁自杀、打劫判定)
     */
    placeStone(r, c) {
        if (this.isGameOver) return { success: false, reason: 'GAMEOVER' };
        if (r < 0 || r >= this.BOARD_SIZE || c < 0 || c >= this.BOARD_SIZE) return { success: false, reason: 'OUT' };
        if (this.board[r][c] !== 0) return { success: false, reason: 'OCCUPIED' };
        if (this.koPoint && this.koPoint.r === r && this.koPoint.c === c) {
            return { success: false, reason: 'KO' };
        }

        const color = this.currentTurn;
        const opp = color === 1 ? 2 : 1;
        const prevKey = this._boardKey(this.board);

        // 临时落子
        this.board[r][c] = color;

        // 提掉对方无气棋块
        const captured = this._removeDeadGroups(this.board, opp);

        // 禁自杀检查：若己方新块也无气则非法
        const myGroup = this._getGroup(this.board, r, c, color);
        if (this._countLiberties(this.board, myGroup) === 0) {
            this.board[r][c] = 0;
            // 恢复被提掉的子
            captured.forEach(p => { this.board[p.r][p.c] = opp; });
            return { success: false, reason: 'SUICIDE' };
        }

        // 简单劫争：落子后盘面与上一手落子前完全一致 -> 禁止 (还原盘面)
        const newKey = this._boardKey(this.board);
        if (this._prevBoardKey !== null && newKey === this._prevBoardKey) {
            this.board[r][c] = 0;
            captured.forEach(p => { this.board[p.r][p.c] = opp; });
            return { success: false, reason: 'KO' };
        }

        // 正式提交
        if (color === 1) this.capturesBlack += captured.length;
        else this.capturesWhite += captured.length;

        this.lastMove = { r, c, color, moveNumber: this.moveHistory.length + 1, pass: false, captured };
        this.moveHistory.push({
            r, c, color, pass: false, captured,
            prevKey: prevKey,
            koPoint: this.koPoint,
            passesAfter: this.consecutivePasses
        });
        this._prevBoardKey = prevKey;
        this.koPoint = (captured.length === 1) ? captured[0] : null;
        this.consecutivePasses = 0;
        this.currentTurn = opp;

        return { success: true, captured: captured.length };
    }

    /**
     * 停一手 (Pass) — 连续两次停一手自动终局并按数子法结算
     */
    pass() {
        if (this.isGameOver) return { success: false, reason: 'GAMEOVER' };

        const color = this.currentTurn;
        this.consecutivePasses++;
        this.lastMove = { r: -1, c: -1, color, moveNumber: this.moveHistory.length + 1, pass: true, captured: [] };
        this.moveHistory.push({
            r: -1, c: -1, color, pass: true, captured: [],
            prevKey: this._prevBoardKey,
            koPoint: this.koPoint,
            passesAfter: this.consecutivePasses
        });
        this.koPoint = null;
        this._prevBoardKey = null; // 停一手后重置劫争比对基准

        let gameOver = false;
        if (this.consecutivePasses >= 2) {
            this.isGameOver = true;
            this.winReason = 'PASS';
            this.scoreResult = this.computeScore();
            this.winner = this.scoreResult.winner;
            gameOver = true;
        }

        this.currentTurn = color === 1 ? 2 : 1;
        return { success: true, gameOver, score: this.scoreResult };
    }

    /**
     * 认输
     */
    resign(color) {
        if (this.isGameOver) return false;
        this.isGameOver = true;
        this.winReason = 'RESIGN';
        this.winner = color === 1 ? 2 : 1;
        return true;
    }

    /**
     * 悔棋一步 (单机 AI 模式撤回玩家与 AI 双方两步)
     */
    undo() {
        if (this.moveHistory.length === 0 || this.isGameOver) return false;

        const popCount = (this.isAiMode && this.moveHistory.length >= 2) ? 2 : 1;
        for (let i = 0; i < popCount; i++) {
            if (this.moveHistory.length === 0) break;
            const last = this.moveHistory.pop();
            if (!last.pass) {
                // 恢复被提走的棋子
                (last.captured || []).forEach(p => {
                    this.board[p.r][p.c] = last.color === 1 ? 2 : 1;
                });
                // 撤销本手棋子
                this.board[last.r][last.c] = 0;
                if (last.color === 1) this.capturesBlack -= (last.captured || []).length;
                else this.capturesWhite -= (last.captured || []).length;
            }
        }

        const prev = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;
        this.lastMove = prev ? { r: prev.r, c: prev.c, color: prev.color, moveNumber: this.moveHistory.length, pass: prev.pass, captured: prev.captured } : null;
        this.consecutivePasses = prev ? (prev.passesAfter || 0) : 0;
        this.koPoint = prev ? (prev.koPoint || null) : null;
        this._prevBoardKey = prev ? (prev.prevKey || null) : null;
        this.isGameOver = false;
        this.winner = null;
        this.winReason = null;
        this.scoreResult = null;
        this.currentTurn = this.moveHistory.length % 2 === 0 ? 1 : 2;
        return true;
    }

    /**
     * 数目结算 (中国规则数子法: 子 + 空 + 贴目)
     * 注: 简化规则，双方死子需通过继续提子完成，结算时按盘面直接点空
     */
    computeScore() {
        const size = this.BOARD_SIZE;
        const visited = Array.from({ length: size }, () => Array(size).fill(false));
        let blackTerritory = 0, whiteTerritory = 0, neutral = 0;
        const territoryMap = {}; // "r,c" -> '1' | '2'

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (this.board[r][c] !== 0 || visited[r][c]) continue;
                // 洪水填充空区域
                const region = [];
                const stack = [[r, c]];
                visited[r][c] = true;
                let touchesBlack = false, touchesWhite = false;
                while (stack.length) {
                    const [cr, cc] = stack.pop();
                    region.push([cr, cc]);
                    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nr = cr + dr, nc = cc + dc;
                        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                        const v = this.board[nr][nc];
                        if (v === 0) {
                            if (!visited[nr][nc]) { visited[nr][nc] = true; stack.push([nr, nc]); }
                        } else if (v === 1) touchesBlack = true;
                        else touchesWhite = true;
                    }
                }
                if (touchesBlack && !touchesWhite) {
                    blackTerritory += region.length;
                    region.forEach(([cr, cc]) => { territoryMap[cr + ',' + cc] = '1'; });
                } else if (touchesWhite && !touchesBlack) {
                    whiteTerritory += region.length;
                    region.forEach(([cr, cc]) => { territoryMap[cr + ',' + cc] = '2'; });
                } else {
                    neutral += region.length;
                }
            }
        }

        let blackStones = 0, whiteStones = 0;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (this.board[r][c] === 1) blackStones++;
                else if (this.board[r][c] === 2) whiteStones++;
            }
        }

        const blackScore = blackStones + blackTerritory;
        const whiteScore = whiteStones + whiteTerritory + this.komi;
        const winner = blackScore > whiteScore ? 1 : (whiteScore > blackScore ? 2 : 0);

        this.scoreResult = {
            blackStones, whiteStones, blackTerritory, whiteTerritory,
            blackScore, whiteScore, komi: this.komi, winner, neutral, territoryMap
        };
        return this.scoreResult;
    }

    /** 获取已有棋子附近的空候选点 (距离 2 以内，大幅提升 AI 效率) */
    _getCandidateMoves() {
        const size = this.BOARD_SIZE;
        const candidates = new Set();
        let hasStones = false;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (this.board[r][c] !== 0) {
                    hasStones = true;
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < size && nc >= 0 && nc < size && this.board[nr][nc] === 0) {
                                candidates.add(nr + ',' + nc);
                            }
                        }
                    }
                }
            }
        }
        if (!hasStones) return [];
        return Array.from(candidates).map(str => {
            const [r, c] = str.split(',').map(Number);
            return { r, c };
        });
    }

    /** 智能 AI 最佳落子 (启发式: 提子 > 救棋 > 扩展 > 中央影响力 + 随机扰动) */
    getBestAiMove() {
        const aiColor = this.currentTurn;
        const humanColor = aiColor === 1 ? 2 : 1;

        // 开局：随机选择星位/天元附近落子，增加对局多样性
        if (this.moveHistory.length === 0) {
            const opens = GoEngine.getStarPoints(this.BOARD_SIZE);
            const pick = opens[Math.floor(Math.random() * opens.length)];
            const [r, c] = pick.split(',').map(Number);
            return { r, c };
        }

        // 对方刚停一手：若无明显大棋 (提子/救棋)，跟随停一手，让双停终局自然发生
        const prevMove = this.moveHistory[this.moveHistory.length - 1];
        if (prevMove && prevMove.pass) {
            const captureMove = this._findCaptureMove(aiColor);
            if (captureMove) return captureMove;
            const saveMove = this._findSaveMove(aiColor);
            if (saveMove) return saveMove;
            return { pass: true };
        }

        const candidates = this._getCandidateMoves();
        if (candidates.length === 0) return { pass: true };

        let best = null;
        let bestScore = -Infinity;
        for (const { r, c } of candidates) {
            if (this.koPoint && this.koPoint.r === r && this.koPoint.c === c) continue; // 跳过劫点
            const score = this._evaluateMove(r, c, aiColor, humanColor);
            if (score > bestScore) {
                bestScore = score;
                best = { r, c };
            }
        }
        return best || { pass: true };
    }

    /** 寻找能直接提子的落子点 */
    _findCaptureMove(aiColor) {
        const size = this.BOARD_SIZE;
        const opp = aiColor === 1 ? 2 : 1;
        const candidates = this._getCandidateMoves();
        for (const { r, c } of candidates) {
            if (this.board[r][c] !== 0) continue;
            if (this.koPoint && this.koPoint.r === r && this.koPoint.c === c) continue; // 跳过劫点
            const clone = this.board.map(row => row.slice());
            clone[r][c] = aiColor;
            const captured = this._removeDeadGroupsOn(clone, opp);
            if (captured.length > 0) {
                // 再确认己方新块有气 (非自杀式提子)
                const group = this._getGroup(clone, r, c, aiColor);
                if (this._countLiberties(clone, group) > 0) return { r, c };
            }
        }
        return null;
    }

    /** 寻找能救回被打吃己方棋块的落子点 */
    _findSaveMove(aiColor) {
        const size = this.BOARD_SIZE;
        const candidates = this._getCandidateMoves();
        for (const { r, c } of candidates) {
            if (this.board[r][c] !== 0) continue;
            if (this.koPoint && this.koPoint.r === r && this.koPoint.c === c) continue; // 跳过劫点

            // 先检查相邻己方块在原盘面上是否处于打吃状态 (仅剩 1 气)
            let inAtari = false;
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                if (this.board[nr][nc] === aiColor) {
                    const g = this._getGroup(this.board, nr, nc, aiColor);
                    if (this._countLiberties(this.board, g) === 1) { inAtari = true; break; }
                }
            }
            if (!inAtari) continue;

            // 试落子后确认己方块脱险 (≥2 气)
            const clone = this.board.map(row => row.slice());
            clone[r][c] = aiColor;
            this._removeDeadGroupsOn(clone, aiColor === 1 ? 2 : 1);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                if (clone[nr][nc] === aiColor) {
                    const g = this._getGroup(clone, nr, nc, aiColor);
                    if (this._countLiberties(clone, g) >= 2) return { r, c };
                }
            }
        }
        return null;
    }

    /** 在克隆盘面上提走无气棋块 (用于 AI 试算) */
    _removeDeadGroupsOn(board, color) {
        const size = this.BOARD_SIZE;
        const removed = [];
        const visited = new Set();
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (board[r][c] === color && !visited.has(r + ',' + c)) {
                    const group = this._getGroup(board, r, c, color);
                    group.forEach(p => visited.add(p[0] + ',' + p[1]));
                    if (this._countLiberties(board, group) === 0) {
                        group.forEach(([gr, gc]) => {
                            board[gr][gc] = 0;
                            removed.push({ r: gr, c: gc });
                        });
                    }
                }
            }
        }
        return removed;
    }

    /** AI 局面评分 (试算一手后打分) */
    _evaluateMove(r, c, aiColor, humanColor) {
        const size = this.BOARD_SIZE;
        const opp = aiColor === 1 ? 2 : 1;
        const clone = this.board.map(row => row.slice());

        // 试落子
        clone[r][c] = aiColor;
        const captured = this._removeDeadGroupsOn(clone, opp);
        const group = this._getGroup(clone, r, c, aiColor);
        const libs = this._countLiberties(clone, group);

        let score = 0;

        // 提子优先 (能提子必提)
        if (captured.length > 0) {
            score += 1500 + captured.length * 500;
        }

        // 禁自杀
        if (libs <= 0) return -1000000;

        // 自填气惩罚 (无提子且落子后只剩一口气)
        if (libs === 1 && captured.length === 0) score -= 3000;

        // 救棋: 相邻己方棋块处于被打吃状态 (1口气) -> 补气
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            if (clone[nr][nc] === aiColor) {
                const g = this._getGroup(clone, nr, nc, aiColor);
                if (this._countLiberties(clone, g) === 1) score += 1200;
            } else if (clone[nr][nc] === opp) {
                const g = this._getGroup(clone, nr, nc, opp);
                const gl = this._countLiberties(clone, g);
                if (gl === 1) score += 700;  // 紧气威胁对方 (下回合可提)
                else if (gl === 2) score += 180; // 缩小对方气
            }
        }

        // 避免填自己真眼 (除非能提子)
        if (captured.length === 0 && this._isSinglePointEye(clone, r, c, aiColor)) {
            score -= 2500;
        }

        // 中央/扩展影响力: 两格内可到达空点数量 + 中心偏向
        score += this._influence(clone, r, c, aiColor) * 6;

        // 随机扰动 (让 AI 更拟人、对局更多样)
        score += Math.random() * 80;

        return score;
    }

    /** 判断某点是否构成己方真眼 (四邻全是己方子) */
    _isSinglePointEye(board, r, c, color) {
        const size = this.BOARD_SIZE;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            if (board[nr][nc] !== color) return false;
        }
        return true;
    }

    /** 影响力评估: 曼哈顿距离 2 内可达空点 + 中心偏向 */
    _influence(board, r, c, color) {
        const size = this.BOARD_SIZE;
        const visited = new Set();
        const queue = [[r, c, 0]];
        visited.add(r + ',' + c);
        let emptyReach = 0;
        while (queue.length) {
            const [cr, cc, dist] = queue.shift();
            if (dist >= 2) continue;
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = cr + dr, nc = cc + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                const key = nr + ',' + nc;
                if (visited.has(key)) continue;
                visited.add(key);
                const v = board[nr][nc];
                if (v === 0) {
                    emptyReach++;
                    queue.push([nr, nc, dist + 1]);
                } else if (v === color) {
                    queue.push([nr, nc, dist + 1]);
                }
            }
        }
        // 中心偏向 (靠近天元更优，帮助形成大模样)
        const center = (size - 1) / 2;
        const distCenter = Math.abs(r - center) + Math.abs(c - center);
        const centerBonus = Math.max(0, (size - distCenter) / size) * 3;
        return emptyReach + centerBonus;
    }
}

const goEngine = new GoEngine();
window.goEngine = goEngine;
