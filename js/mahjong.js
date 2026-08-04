/**
 * 🀄 游鲸麻将 4人围桌正宗麻将引擎 (Real 4-Player Table Mahjong Engine)
 * 4人围桌（我方/右家/对家/左家）· 136张正宗国粹牌组 · 摸打碰杠胡完整规则
 */
class MahjongEngine {
    constructor() {
        this.reset();
    }

    /**
     * 重置 4 人麻将对局
     */
    reset(isAiMode = true, playerPosition = 0) {
        this.isAiMode = isAiMode;
        this.playerPosition = playerPosition; // 我方固定座位 (0: 我方/南)
        this.currentTurn = 0; // 0:我方(南), 1:右家(东), 2:对家(北), 3:左家(西)
        this.isGameOver = false;
        this.winner = null;
        this.wallCount = 136;
        this.discards = { 0: [], 1: [], 2: [], 3: [] }; // 4 方弃牌堆
        this.melds = { 0: [], 1: [], 2: [], 3: [] }; // 4 方吃碰杠牌堆

        // 生成正宗 136 张麻将牌
        this.wall = this.generateDeck();
        this.shuffle(this.wall);

        // 4 玩家初始发牌 (每人 13 张)
        this.hands = {
            0: this.sortHand(this.wall.splice(0, 13)),
            1: this.sortHand(this.wall.splice(0, 13)),
            2: this.sortHand(this.wall.splice(0, 13)),
            3: this.sortHand(this.wall.splice(0, 13))
        };

        this.lastDrawnTile = null;

        // 庄家 (Seat 0) 抓开局第 14 张牌
        if (this.wall.length > 0) {
            const firstTile = this.wall.pop();
            this.hands[this.currentTurn].push(firstTile);
            this.lastDrawnTile = firstTile;
        }

        this.wallCount = this.wall.length;
    }

    /**
     * 生成 136 张标准麻将牌组 (1-9万, 1-9条, 1-9筒, 东南西北, 中发白)
     */
    generateDeck() {
        const deck = [];
        const types = ['万', '条', '筒'];

        // 1-9 万/条/筒 各 4 张 (108 张)
        types.forEach(t => {
            for (let num = 1; num <= 9; num++) {
                for (let i = 0; i < 4; i++) {
                    deck.push({ type: t, num: num, id: `${t}_${num}_${i}`, name: `${num}${t}` });
                }
            }
        });

        // 风牌：东南西北 各 4 张 (16 张)
        const winds = ['东', '南', '西', '北'];
        winds.forEach((w, idx) => {
            for (let i = 0; i < 4; i++) {
                deck.push({ type: '字', num: idx + 1, id: `风_${w}_${i}`, name: `${w}风` });
            }
        });

        // 箭牌：中发白 各 4 张 (12 张)
        const dragons = [{ name: '红中', num: 5 }, { name: '发财', num: 6 }, { name: '白板', num: 7 }];
        dragons.forEach(d => {
            for (let i = 0; i < 4; i++) {
                deck.push({ type: '字', num: d.num, id: `箭_${d.name}_${i}`, name: d.name });
            }
        });

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
     * 手牌自动排序 (万 -> 条 -> 筒 -> 字)
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

        // 顺时针轮换到下一家 (0 -> 1 -> 2 -> 3)
        const nextPlayer = (playerIdx + 1) % 4;

        // 检查我方 (Seat 0) 是否对该出牌可进行 碰/杠/胡 响应
        const canHu = playerIdx !== 0 && this.checkCanHu(this.hands[0], discarded);
        const canPong = playerIdx !== 0 && this.checkCanPong(this.hands[0], discarded);
        const canKong = playerIdx !== 0 && this.checkCanKong(this.hands[0], discarded);

        // 轮换回合并摸牌
        if (this.wall.length > 0) {
            this.currentTurn = nextPlayer;
            const draw = this.wall.pop();
            this.hands[nextPlayer].push(draw);
            this.lastDrawnTile = draw;
            this.wallCount = this.wall.length;
        } else {
            // 牌墙摸完 -> 流局平局
            this.isGameOver = true;
            this.winner = -1;
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
     * 检查能否碰牌 (手牌中拥有 2 张及以上同名牌)
     */
    checkCanPong(hand, tile) {
        if (!tile) return false;
        return hand.filter(t => t.name === tile.name).length >= 2;
    }

    /**
     * 执行碰牌
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
            this.currentTurn = playerIdx; // 碰牌方获得出牌回合
            return true;
        }
        return false;
    }

    /**
     * 检查能否杠牌 (手牌中拥有 3 张及以上同名牌)
     */
    checkCanKong(hand, tile) {
        if (!tile) return false;
        return hand.filter(t => t.name === tile.name).length >= 3;
    }

    /**
     * 执行杠牌 (杠牌后补摸一张牌)
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

            // 杠牌补摸牌
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
     * 检查胡牌 (标准胡牌算法 3n+2)
     */
    checkCanHu(hand, extraTile = null) {
        const fullHand = extraTile ? [...hand, extraTile] : [...hand];
        if (fullHand.length % 3 !== 2) return false;

        const counts = {};
        fullHand.forEach(t => {
            counts[t.name] = (counts[t.name] || 0) + 1;
        });

        // 尝试找一对作为将牌
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
     * 拆分刻子/顺子
     */
    canFormMelds(hand) {
        if (hand.length === 0) return true;
        const sorted = this.sortHand([...hand]);
        const first = sorted[0];

        // 1. 刻子 (3张相同)
        const sameCount = sorted.filter(t => t.name === first.name).length;
        if (sameCount >= 3) {
            const nextHand = [...sorted];
            nextHand.splice(0, 3);
            if (this.canFormMelds(nextHand)) return true;
        }

        // 2. 顺子 (同类型万/条/筒)
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
     * 4 人 AI 出牌决策引擎
     */
    getBestAiMove(playerIdx) {
        const aiHand = this.hands[playerIdx];
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

// 挂载全局对象
window.MahjongEngine = MahjongEngine;
window.mahjongEngine = new MahjongEngine();
