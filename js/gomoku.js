/**
 * 游鲸五子棋 核心对局引擎 (Gomoku Core Engine)
 * 支持 15x15 标准棋盘、黑白落子、胜负判断、启发式高智能 AI 以及云端双人对战
 */
class GomokuEngine {
    constructor() {
        this.BOARD_SIZE = 15;
        this.board = []; // 15x15 二维数组: 0-空, 1-黑子(先手), 2-白子
        this.currentTurn = 1; // 1-黑子, 2-白子
        this.moveHistory = []; // 落子历史记录 [{r, c, color}]
        this.isGameOver = false;
        this.winner = null;
        this.isAiMode = false;
        this.playerColor = 1; // 单机模式玩家颜色，默认黑子先手
        this.lastMove = null;
        this.winLine = null; // 获胜 5 连子坐标
    }

    /**
     * 重置对局盘面
     */
    reset(isAi = false, playerColor = 1) {
        this.board = Array(this.BOARD_SIZE).fill(null).map(() => Array(this.BOARD_SIZE).fill(0));
        this.currentTurn = 1; // 黑子先行
        this.moveHistory = [];
        this.isGameOver = false;
        this.winner = null;
        this.isAiMode = isAi;
        this.playerColor = playerColor;
        this.lastMove = null;
        this.winLine = null;
    }

    /**
     * 在 (r, c) 位置落子
     */
    placeStone(r, c) {
        if (this.isGameOver) return false;
        if (r < 0 || r >= this.BOARD_SIZE || c < 0 || c >= this.BOARD_SIZE) return false;
        if (this.board[r][c] !== 0) return false; // 已有棋子

        const color = this.currentTurn;
        this.board[r][c] = color;
        this.lastMove = { r, c, color, moveNumber: this.moveHistory.length + 1 };
        this.moveHistory.push(this.lastMove);

        // 检查胜负
        const winResult = this.checkWin(r, c, color);
        if (winResult) {
            this.isGameOver = true;
            this.winner = color;
            this.winLine = winResult;
            return { success: true, isGameOver: true, winner: color, winLine: winResult };
        }

        // 检查平局（盘满）
        if (this.moveHistory.length >= this.BOARD_SIZE * this.BOARD_SIZE) {
            this.isGameOver = true;
            this.winner = 0; // 平局
            return { success: true, isGameOver: true, winner: 0 };
        }

        // 切换回合
        this.currentTurn = this.currentTurn === 1 ? 2 : 1;
        return { success: true, isGameOver: false, nextTurn: this.currentTurn };
    }

    /**
     * 悔棋一步（单机 AI 模式撤回玩家与 AI 双方两步）
     */
    undo() {
        if (this.moveHistory.length === 0 || this.isGameOver) return false;

        const popCount = (this.isAiMode && this.moveHistory.length >= 2) ? 2 : 1;
        for (let i = 0; i < popCount; i++) {
            if (this.moveHistory.length > 0) {
                const last = this.moveHistory.pop();
                this.board[last.r][last.c] = 0;
            }
        }

        this.lastMove = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;
        this.isGameOver = false;
        this.winner = null;
        this.winLine = null;
        this.currentTurn = this.moveHistory.length % 2 === 0 ? 1 : 2;
        return true;
    }

    /**
     * 检测 (r, c) 位置落子后是否形成 5 连子
     */
    checkWin(r, c, color) {
        const directions = [
            [[0, 1], [0, -1]],   // 水平向右/左
            [[1, 0], [-1, 0]],   // 垂直向下/上
            [[1, 1], [-1, -1]],  // 正对角线
            [[1, -1], [-1, 1]]   // 反对角线
        ];

        for (let d = 0; d < directions.length; d++) {
            const [[dr1, dc1], [dr2, dc2]] = directions[d];
            let count = 1;
            const lineNodes = [{ r, c }];

            // 正方向探索
            let nr = r + dr1;
            let nc = c + dc1;
            while (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === color) {
                count++;
                lineNodes.push({ r: nr, c: nc });
                nr += dr1;
                nc += dc1;
            }

            // 反方向探索
            nr = r + dr2;
            nc = c + dc2;
            while (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === color) {
                count++;
                lineNodes.push({ r: nr, c: nc });
                nr += dr2;
                nc += dc2;
            }

            if (count >= 5) {
                return lineNodes; // 返回 5 连子坐标数组
            }
        }
        return null;
    }

    /**
     * 智能 AI 最佳落子算法 (启发式局面评估)
     */
    getBestAiMove() {
        const aiColor = this.currentTurn;
        const humanColor = aiColor === 1 ? 2 : 1;
        let bestScore = -Infinity;
        let bestMoves = [];

        // 仅搜索已有棋子周围 2 格以内的空点（大幅提升计算效率）
        const candidates = this._getCandidateMoves();
        if (candidates.length === 0) {
            return { r: 7, c: 7 }; // 天元开局
        }

        for (const { r, c } of candidates) {
            // 评估攻防权重
            const attackScore = this._evaluatePoint(r, c, aiColor);
            const defenseScore = this._evaluatePoint(r, c, humanColor);
            const score = attackScore + defenseScore * 1.1; // 稍微偏向防守

            if (score > bestScore) {
                bestScore = score;
                bestMoves = [{ r, c }];
            } else if (score === bestScore) {
                bestMoves.push({ r, c });
            }
        }

        // 随机选择最优解之一
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    /**
     * 获取已有棋子附近的空候选点
     */
    _getCandidateMoves() {
        const candidates = new Set();
        let hasStones = false;

        for (let r = 0; r < this.BOARD_SIZE; r++) {
            for (let c = 0; c < this.BOARD_SIZE; c++) {
                if (this.board[r][c] !== 0) {
                    hasStones = true;
                    // 扫描周围 2 格
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const nr = r + dr;
                            const nc = c + dc;
                            if (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === 0) {
                                candidates.add(`${nr},${nc}`);
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

    /**
     * 启发式打分系统 (活四、冲四、活三、活二评分)
     */
    _evaluatePoint(r, c, color) {
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
        let totalScore = 0;

        for (const [dr, dc] of directions) {
            let count = 1;
            let openEnds = 0;

            // 正向
            let nr = r + dr;
            let nc = c + dc;
            while (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === color) {
                count++;
                nr += dr;
                nc += dc;
            }
            if (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === 0) {
                openEnds++;
            }

            // 反向
            nr = r - dr;
            nc = c - dc;
            while (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === color) {
                count++;
                nr -= dr;
                nc -= dc;
            }
            if (nr >= 0 && nr < this.BOARD_SIZE && nc >= 0 && nc < this.BOARD_SIZE && this.board[nr][nc] === 0) {
                openEnds++;
            }

            // 权重打分表
            if (count >= 5) totalScore += 100000;
            else if (count === 4 && openEnds === 2) totalScore += 10000; // 活四
            else if (count === 4 && openEnds === 1) totalScore += 2500;  // 冲四
            else if (count === 3 && openEnds === 2) totalScore += 3000;  // 活三
            else if (count === 3 && openEnds === 1) totalScore += 500;   // 眠三
            else if (count === 2 && openEnds === 2) totalScore += 400;   // 活二
            else if (count === 2 && openEnds === 1) totalScore += 100;
        }

        return totalScore;
    }
}

const gomokuEngine = new GomokuEngine();
window.gomokuEngine = gomokuEngine;
