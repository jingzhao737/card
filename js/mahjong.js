/**
 * 🀄 游鲸麻将 4人围桌大众正宗麻将引擎 (Standard 4-Player Table Mahjong Engine)
 * 4人围桌（我方/右家/对家/左家）· 136张正宗国粹牌组 · 摸打吃碰杠胡完整规则
 * 规则：大众麻将 / 推倒胡（含吃、碰、明杠、暗杠、补杠、平胡、七对、清一色、碰碰胡）
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
        this.dealer = 0; // 庄家 0
        this.isGameOver = false;
        this.winner = null;
        this.huDetails = null; // 胡牌番型详情
        this.wallCount = 136;
        this.discards = { 0: [], 1: [], 2: [], 3: [] }; // 4 方弃牌堆
        this.melds = { 0: [], 1: [], 2: [], 3: [] }; // 4 方吃碰杠牌堆
        this.lastDiscard = null; // { playerIdx: 0, tile: tile }

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
        this.lastDiscard = { playerIdx, tile: discarded };
        this.hands[playerIdx] = this.sortHand(hand);

        // 顺时针轮换到下一家 (0 -> 1 -> 2 -> 3)
        const nextPlayer = (playerIdx + 1) % 4;

        // 检查我方 (Seat 0) 对该出牌可响应的动作：胡、碰、杠、吃（吃仅下家/即左家打出时可吃）
        const canHu = playerIdx !== 0 && this.checkCanHu(this.hands[0], discarded);
        const canPong = playerIdx !== 0 && this.checkCanPong(this.hands[0], discarded);
        const canKong = playerIdx !== 0 && this.checkCanKong(this.hands[0], discarded);
        
        // 我方吃牌逻辑：必须是上家（playerIdx === 3）打出的牌，且手牌能凑成顺子
        const chowOptions = (playerIdx === 3) ? this.getChowOptions(this.hands[0], discarded) : [];
        const canChow = chowOptions.length > 0;

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
            discarder: playerIdx,
            nextPlayer: this.currentTurn,
            canHu,
            canPong,
            canKong,
            canChow,
            chowOptions,
            isGameOver: this.isGameOver,
            winner: this.winner
        };
    }

    /**
     * 获取可用于吃牌的搭子选项
     * 例如 tile = 3万，手牌有 1,2万（可组成1-2-3）/ 2,4万（可组成2-3-4）/ 4,5万（可组成3-4-5）
     */
    getChowOptions(hand, tile) {
        if (!tile || tile.type === '字') return [];
        const options = [];
        const num = tile.num;
        const type = tile.type;

        // 1. [num-2, num-1, num] -> 需要 num-2 和 num-1
        if (num >= 3) {
            const t1 = hand.find(t => t.type === type && t.num === num - 2);
            const t2 = hand.find(t => t.type === type && t.num === num - 1);
            if (t1 && t2) options.push([t1, t2]);
        }

        // 2. [num-1, num, num+1] -> 需要 num-1 和 num+1
        if (num >= 2 && num <= 8) {
            const t1 = hand.find(t => t.type === type && t.num === num - 1);
            const t2 = hand.find(t => t.type === type && t.num === num + 1);
            if (t1 && t2) options.push([t1, t2]);
        }

        // 3. [num, num+1, num+2] -> 需要 num+1 和 num+2
        if (num <= 7) {
            const t1 = hand.find(t => t.type === type && t.num === num + 1);
            const t2 = hand.find(t => t.type === type && t.num === num + 2);
            if (t1 && t2) options.push([t1, t2]);
        }

        return options;
    }

    /**
     * 执行吃牌
     */
    executeChow(playerIdx, tile, chosenPair) {
        const hand = this.hands[playerIdx];
        const idx1 = hand.findIndex(t => t.id === chosenPair[0].id);
        if (idx1 === -1) return false;
        const p1 = hand.splice(idx1, 1)[0];

        const idx2 = hand.findIndex(t => t.id === chosenPair[1].id);
        if (idx2 === -1) {
            hand.push(p1);
            this.hands[playerIdx] = this.sortHand(hand);
            return false;
        }
        const p2 = hand.splice(idx2, 1)[0];

        const chowTiles = [p1, p2, tile].sort((a, b) => a.num - b.num);
        this.melds[playerIdx].push({ type: 'CHOW', tiles: chowTiles });
        this.hands[playerIdx] = this.sortHand(hand);
        this.currentTurn = playerIdx; // 吃牌方获得出牌权
        return true;
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
            this.hands[playerIdx] = this.sortHand(hand);
            this.currentTurn = playerIdx; // 碰牌方获得出牌回合
            return true;
        }
        return false;
    }

    /**
     * 检查能否明杠 (手牌中拥有 3 张同名牌)
     */
    checkCanKong(hand, tile) {
        if (!tile) return false;
        return hand.filter(t => t.name === tile.name).length >= 3;
    }

    /**
     * 检查自身暗杠或补杠选项 (手牌拥有4张相同，或摸到与已碰牌相同的牌)
     */
    getSelfKongOptions(playerIdx) {
        const hand = this.hands[playerIdx];
        const melds = this.melds[playerIdx];
        const options = [];

        // 1. 暗杠：手牌中有 4 张相同牌
        const counts = {};
        hand.forEach(t => { counts[t.name] = (counts[t.name] || 0) + 1; });
        for (const name in counts) {
            if (counts[name] === 4) {
                const sampleTile = hand.find(t => t.name === name);
                options.push({ type: 'ANKONG', tile: sampleTile });
            }
        }

        // 2. 补杠：摸到的牌与已碰牌(PONG)相同
        melds.forEach(m => {
            if (m.type === 'PONG') {
                const pongName = m.tiles[0].name;
                const matchInHand = hand.find(t => t.name === pongName);
                if (matchInHand) {
                    options.push({ type: 'BUKONG', tile: matchInHand });
                }
            }
        });

        return options;
    }

    /**
     * 执行明杠
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
            this.hands[playerIdx] = this.sortHand(hand);

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
     * 执行暗杠或补杠
     */
    executeSelfKong(playerIdx, kongOption) {
        const hand = this.hands[playerIdx];
        const tileName = kongOption.tile.name;

        if (kongOption.type === 'ANKONG') {
            // 暗杠：从手牌移除 4 张
            for (let i = hand.length - 1; i >= 0; i--) {
                if (hand[i].name === tileName) {
                    hand.splice(i, 1);
                }
            }
            this.melds[playerIdx].push({ type: 'ANKONG', tiles: [kongOption.tile, kongOption.tile, kongOption.tile, kongOption.tile] });
        } else if (kongOption.type === 'BUKONG') {
            // 补杠：从手牌移除 1 张，将已有的 PONG 升为 KONG
            const handIdx = hand.findIndex(t => t.name === tileName);
            if (handIdx !== -1) hand.splice(handIdx, 1);

            const meld = this.melds[playerIdx].find(m => m.type === 'PONG' && m.tiles[0].name === tileName);
            if (meld) {
                meld.type = 'KONG';
                meld.tiles.push(kongOption.tile);
            }
        }

        this.hands[playerIdx] = this.sortHand(hand);

        // 杠后补牌
        if (this.wall.length > 0) {
            const suppTile = this.wall.pop();
            hand.push(suppTile);
            this.lastDrawnTile = suppTile;
            this.wallCount = this.wall.length;
        }

        this.currentTurn = playerIdx;
        return true;
    }

    /**
     * 检查胡牌（推倒胡标准算法 3n+2 & 七对子判定）
     */
    checkCanHu(hand, extraTile = null) {
        const fullHand = extraTile ? [...hand, extraTile] : [...hand];
        if (fullHand.length % 3 !== 2) return false;

        // 1. 检查七对 (14张牌 7个对子)
        if (fullHand.length === 14 && this.checkSevenPairs(fullHand)) {
            return true;
        }

        // 2. 标准胡牌 (拆将牌 + 刻子/顺子)
        const counts = {};
        fullHand.forEach(t => { counts[t.name] = (counts[t.name] || 0) + 1; });

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
     * 七对判定算法
     */
    checkSevenPairs(fullHand) {
        if (fullHand.length !== 14) return false;
        const counts = {};
        fullHand.forEach(t => { counts[t.name] = (counts[t.name] || 0) + 1; });
        for (const name in counts) {
            if (counts[name] % 2 !== 0) return false;
        }
        return true;
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
     * 胡牌详细番型计算器
     */
    getHuDetails(playerIdx, extraTile = null, isSelfDraw = false) {
        const hand = this.hands[playerIdx];
        const melds = this.melds[playerIdx];
        const fullHand = extraTile ? [...hand, extraTile] : [...hand];

        let totalFan = 1; // 基础平胡 1 番
        const details = ['平胡 (1番)'];

        // 1. 检查清一色 / 混一色
        const allTiles = [...fullHand];
        melds.forEach(m => allTiles.push(...m.tiles));
        const nonZipTypes = new Set(allTiles.filter(t => t.type !== '字').map(t => t.type));
        const hasZip = allTiles.some(t => t.type === '字');

        if (nonZipTypes.size === 1 && !hasZip) {
            totalFan += 4;
            details.push('清一色 (+4番)');
        } else if (nonZipTypes.size === 1 && hasZip) {
            totalFan += 2;
            details.push('混一色 (+2番)');
        }

        // 2. 检查七对
        if (fullHand.length === 14 && this.checkSevenPairs(fullHand)) {
            totalFan += 2;
            details.push('七对子 (+2番)');
        }

        // 3. 检查自摸
        if (isSelfDraw) {
            totalFan += 1;
            details.push('自摸 (+1番)');
        }

        return {
            fanCount: totalFan,
            fanName: details.join(' · '),
            details: details
        };
    }

    /**
     * 4 人 AI 出牌决策与响应引擎
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

        // 次优打出边角孤张 (1或9)
        for (let i = 0; i < aiHand.length; i++) {
            const tile = aiHand[i];
            if (tile.type !== '字' && (tile.num === 1 || tile.num === 9)) {
                const sameCount = aiHand.filter(t => t.name === tile.name).length;
                const neighbor = aiHand.some(t => t.type === tile.type && Math.abs(t.num - tile.num) <= 2);
                if (sameCount === 1 && !neighbor) {
                    return i;
                }
            }
        }

        return aiHand.length - 1;
    }
}

// 挂载全局对象
window.MahjongEngine = MahjongEngine;
window.mahjongEngine = new MahjongEngine();
