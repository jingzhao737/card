/**
 * 游鲸麻将 核心逻辑引擎 (Youjing Mahjong Game Engine)
 * 桃木翠绿主题 · 单机 AI 切磋 & 实时 P2P 双人/多人群英对战
 */
class MahjongEngine {
    constructor() {
        this.reset();
    }

    /**
     * 重置麻将对局
     */
    reset(isAiMode = true, playerPosition = 0) {
        this.isAiMode = isAiMode;
        this.playerPosition = playerPosition; // 0: 我方(南/东), 1: 对方/AI
        this.currentTurn = 0; // 0: 我方, 1: 对方
        this.isGameOver = false;
        this.winner = null;
        this.wallCount = 108; // 剩余牌墙数
        this.discards = { 0: [], 1: [] }; // 弃牌堆
        this.melds = { 0: [], 1: [] }; // 碰/杠/吃明牌

        // 生成经典 108 张麻将牌 (万/条/筒 1~9 各 4 张)
        this.wall = this.generateDeck();
        this.shuffle(this.wall);

        // 初始发牌 (每人 13 张)
        this.hands = {
            0: this.sortHand(this.wall.splice(0, 13)),
            1: this.sortHand(this.wall.splice(0, 13))
        };

        this.lastDrawnTile = null;

        // 先手庄家抓第 14 张牌
        if (this.wall.length > 0) {
            const firstTile = this.wall.pop();
            this.hands[this.currentTurn].push(firstTile);
            this.lastDrawnTile = firstTile;
        }

        this.wallCount = this.wall.length;
    }

    /**
     * 生成 108 张标准麻将牌 (1-9万, 1-9条, 1-9筒, 1-4中发白)
     */
    generateDeck() {
        const deck = [];
        const types = ['万', '条', '筒'];
        
        // 1-9 万/条/筒 各 4 张
        types.forEach(t => {
            for (let num = 1; num <= 9; num++) {
                for (let i = 0; i < 4; i++) {
                    deck.push({ type: t, num: num, id: `${t}_${num}_${i}`, name: `${num}${t}` });
                }
            }
        });

        // 🀄 经典红中/发财 各 4 张 (增强国粹韵味)
        for (let i = 0; i < 4; i++) {
            deck.push({ type: '字', num: 1, id: `字_中_${i}`, name: '红中' });
            deck.push({ type: '字', num: 2, id: `字_发_${i}`, name: '发财' });
        }

        return deck;
    }

    /**
     * 洗牌算法
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * 手牌理牌 (按万、条、筒、字顺序及点数排序)
     */
    sortHand(hand) {
        const order = { '万': 1, '条': 2, '筒': 3, '字': 4 };
        return [...hand].sort((a, b) => {
            if (order[a.type] !== order[b.type]) {
                return order[a.type] - order[b.type];
            }
            return a.num - b.num;
        });
    }

    /**
     * 玩家打牌 (Discard Tile)
     */
    discardTile(playerIdx, tileIndex) {
        if (this.isGameOver || this.currentTurn !== playerIdx) return null;

        const hand = this.hands[playerIdx];
        if (tileIndex < 0 || tileIndex >= hand.length) return null;

        const discarded = hand.splice(tileIndex, 1)[0];
        this.discards[playerIdx].push(discarded);
        this.hands[playerIdx] = this.sortHand(hand);

        // 检查对方是否可以胡/碰/杠
        const nextPlayer = (playerIdx + 1) % 2;
        const canHu = this.checkCanHu(this.hands[nextPlayer], discarded);
        const canPong = this.checkCanPong(this.hands[nextPlayer], discarded);
        const canKong = this.checkCanKong(this.hands[nextPlayer], discarded);

        // 切换回合并摸牌
        if (this.wall.length > 0) {
            this.currentTurn = nextPlayer;
            const draw = this.wall.pop();
            this.hands[nextPlayer].push(draw);
            this.lastDrawnTile = draw;
            this.wallCount = this.wall.length;
        } else {
            // 牌墙摸完 -> 流局平局
            this.isGameOver = true;
            this.winner = -1; // -1 表示流局
        }

        return {
            discarded,
            nextPlayer: this.currentTurn,
            canHu,
            canPong,
            canKong,
            isGameOver: this.isGameOver,
            winner: this.winner
        };
    }

    /**
     * 判断是否能碰牌 (手牌中有 2 张及以上同名牌)
     */
    checkCanPong(hand, tile) {
        if (!tile) return false;
        const matchCount = hand.filter(t => t.name === tile.name).length;
        return matchCount >= 2;
    }

    /**
     * 执行碰牌操作
     */
    executePong(playerIdx, tile) {
        const hand = this.hands[playerIdx];
        const matchingIndices = [];
        hand.forEach((t, idx) => {
            if (t.name === tile.name && matchingIndices.length < 2) {
                matchingIndices.push(idx);
            }
        });

        if (matchingIndices.length === 2) {
            const p1 = hand.splice(matchingIndices[1], 1)[0];
            const p2 = hand.splice(matchingIndices[0], 1)[0];
            this.melds[playerIdx].push({ type: 'PONG', tiles: [p1, p2, tile] });
            this.currentTurn = playerIdx; // 回合转给碰牌方落子
            return true;
        }
        return false;
    }

    /**
     * 判断是否能杠牌 (手牌中有 3 张及以上同名牌)
     */
    checkCanKong(hand, tile) {
        if (!tile) return false;
        const matchCount = hand.filter(t => t.name === tile.name).length;
        return matchCount >= 3;
    }

    /**
     * 执行杠牌操作 (杠牌后补摸一张牌)
     */
    executeKong(playerIdx, tile) {
        const hand = this.hands[playerIdx];
        const matchingIndices = [];
        hand.forEach((t, idx) => {
            if (t.name === tile.name && matchingIndices.length < 3) {
                matchingIndices.push(idx);
            }
        });

        if (matchingIndices.length === 3) {
            for (let i = matchingIndices.length - 1; i >= 0; i--) {
                hand.splice(matchingIndices[i], 1);
            }
            this.melds[playerIdx].push({ type: 'KONG', tiles: [tile, tile, tile, tile] });

            // 补摸一张牌
            if (this.wall.length > 0) {
                const suppTile = this.wall.pop();
                hand.push(suppTile);
                this.lastDrawnTile = suppTile;
                this.wallCount = this.wall.length;
            }

            this.currentTurn = playerIdx;
            return true;
        }
        return false;
    }

    /**
     * 判断是否胡牌 (简易胡牌判定：手牌 3n+2 组成顺子/刻子 + 将牌)
     */
    checkCanHu(hand, extraTile = null) {
        const fullHand = extraTile ? [...hand, extraTile] : [...hand];
        if (fullHand.length % 3 !== 2) return false;

        const counts = {};
        fullHand.forEach(t => {
            counts[t.name] = (counts[t.name] || 0) + 1;
        });

        // 尝试找一对作为“将牌” (眼)
        for (const name in counts) {
            if (counts[name] >= 2) {
                const tempHand = [...fullHand];
                let removed = 0;
                for (let i = tempHand.length - 1; i >= 0; i--) {
                    if (tempHand[i].name === name && removed < 2) {
                        tempHand.splice(i, 1);
                        removed++;
                    }
                }
                if (this.canFormMelds(tempHand)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 辅助判断剩余手牌能否完全拆分为刻子或顺子
     */
    canFormMelds(hand) {
        if (hand.length === 0) return true;
        const sorted = this.sortHand([...hand]);
        const first = sorted[0];

        // 1. 尝试拆分刻子 (3张相同)
        const sameCount = sorted.filter(t => t.name === first.name).length;
        if (sameCount >= 3) {
            const nextHand = [...sorted];
            nextHand.splice(0, 3);
            if (this.canFormMelds(nextHand)) return true;
        }

        // 2. 尝试拆分顺子 (仅限同属性万/条/筒)
        if (first.type !== '字' && first.num <= 7) {
            const num2Index = sorted.findIndex(t => t.type === first.type && t.num === first.num + 1);
            const num3Index = sorted.findIndex(t => t.type === first.type && t.num === first.num + 2);

            if (num2Index !== -1 && num3Index !== -1) {
                const nextHand = [...sorted];
                const indices = [0, num2Index, num3Index].sort((a, b) => b - a);
                indices.forEach(idx => nextHand.splice(idx, 1));
                if (this.canFormMelds(nextHand)) return true;
            }
        }

        return false;
    }

    /**
     * 单机 AI 智能打牌落子决策
     */
    getBestAiMove() {
        const aiHand = this.hands[1];
        if (!aiHand || aiHand.length === 0) return 0;

        // 优先打出孤张字牌
        for (let i = 0; i < aiHand.length; i++) {
            const tile = aiHand[i];
            const sameCount = aiHand.filter(t => t.name === tile.name).length;
            if (tile.type === '字' && sameCount === 1) {
                return i;
            }
        }

        return aiHand.length - 1;
    }
}

// 挂载到全局 window 对象
window.MahjongEngine = MahjongEngine;
window.mahjongEngine = new MahjongEngine();
