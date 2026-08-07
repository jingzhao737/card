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
        // 多人/单人对局随机掷骰分配庄家 (0:我方/南, 1:右家/东, 2:对家/北, 3:左家/西)
        this.dealer = Math.floor(Math.random() * 4);
        this.currentTurn = this.dealer;
        this.isGameOver = false;
        this.winner = null;
        this.huDetails = null; // 胡牌番型详情
        this.wallCount = 136;
        this.discards = { 0: [], 1: [], 2: [], 3: [] }; // 4 方弃牌堆
        this.melds = { 0: [], 1: [], 2: [], 3: [] }; // 4 方吃碰杠牌堆
        this.lastDiscard = null; // { playerIdx: 0, tile: tile }
        this.pendingDraw = false; // 是否等待当前行动玩家摸牌 (出牌后=true, 摸牌/响应后=false; 庄家首牌已摸故开局为 false)

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

        // 随机庄家抓开局第 14 张牌并优先起手出牌
        if (this.wall.length > 0) {
            const firstTile = this.wall.pop();
            this.hands[this.dealer].push(firstTile);
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
        // 注意: 出牌后不立即摸牌! 真实规则为先判定各家碰/杠/胡响应(各家仍 13 张),
        // 无人响应后才由下家 drawTile 摸牌。摸牌时机由主控层控制 (drawTile 方法)。
        const nextPlayer = (playerIdx + 1) % 4;
        this.currentTurn = nextPlayer;
        this.pendingDraw = true; // 轮到下家时需要摸牌

        // 检查我方 (Seat 0) 对该出牌可响应的动作：胡、碰、杠、吃（吃仅下家/即左家打出时可吃）
        // 此时 Seat 0 尚未摸牌 (13 张), 响应判定与胡牌牌型才正确
        const canPong = playerIdx !== 0 && this.checkCanPong(this.hands[0], discarded);
        const canKong = playerIdx !== 0 && this.checkCanKong(this.hands[0], discarded);

        // 截胡判定: 一张牌多家可胡时, 出牌者下家起顺时针就近优先, 只有优先级最高的一家能胡
        const huInfo = this.evaluateHuPriority(playerIdx, discarded);
        const canHu = huInfo.canHu; // 我方是否可胡
        const huBlocked = huInfo.huBlocked; // 我方可胡但被更高优先级玩家截胡
        const huWinner = huInfo.huWinner; // 本轮胡牌优先者 (-1 表示无人可胡)

        // 我方吃牌逻辑：必须是上家（playerIdx === 3）打出的牌，且手牌能凑成顺子
        const chowOptions = (playerIdx === 3) ? this.getChowOptions(this.hands[0], discarded) : [];
        const canChow = chowOptions.length > 0;

        return {
            discarded,
            discarder: playerIdx,
            nextPlayer,
            canHu,
            huBlocked,
            huWinner,
            canPong,
            canKong,
            canChow,
            chowOptions,
            isGameOver: this.isGameOver,
            winner: this.winner
        };
    }

    /**
     * 截胡判定: 一张牌多家可胡时, 从出牌者下家起顺时针就近, 第一个可胡者优先
     * @param {number} discarderIdx 出牌者座位
     * @param {object} tile 打出的牌
     * @returns {{canHu: boolean, huBlocked: boolean, huWinner: number, candidates: number[]}}
     */
    evaluateHuPriority(discarderIdx, tile) {
        const candidates = [];
        for (let i = 0; i < 4; i++) {
            if (i === discarderIdx) continue;
            if (this.checkCanHu(this.hands[i], tile)) candidates.push(i);
        }
        let huWinner = -1;
        if (candidates.length > 0) {
            for (let step = 1; step <= 3; step++) {
                const idx = (discarderIdx + step) % 4;
                if (candidates.includes(idx)) { huWinner = idx; break; }
            }
        }
        const canHu = candidates.includes(0);
        return {
            canHu,
            huBlocked: canHu && huWinner !== 0, // 我方可胡但被更高优先级者截胡
            huWinner,
            candidates
        };
    }

    /**
     * 给指定玩家摸牌 (仅当轮到其行动且无人响应时调用; 墙空则触发流局)
     * @returns {object|null} { tile, isGameOver } 或 null (墙空流局)
     */
    drawTile(playerIdx) {
        if (this.isGameOver) return null;
        if (this.wall.length === 0) {
            // 牌墙摸完 -> 流局平局
            this.isGameOver = true;
            this.winner = -1;
            return null;
        }
        const draw = this.wall.pop();
        this.hands[playerIdx].push(draw);
        this.lastDrawnTile = draw;
        this.wallCount = this.wall.length;
        this.pendingDraw = false;
        return { tile: draw, isGameOver: false };
    }

    /**
     * 检查 AI 家对刚打出弃牌的响应 (胡/碰/杠/吃)
     * 供主控层驱动 AI 互相响应使用: 出牌后若除玩家外有 AI 可响应, 按 胡 > 碰/杠 > 吃 优先级执行
     * @param {number} discarderIdx 出牌者座位
     * @param {object} tile 打出的牌
     * @param {number} mySlot 人类玩家座位 (默认 0, 该座位由玩家自行决策, 不代打)
     * @returns {object|null} { action, playerIdx, chowPair } 或 null (无 AI 响应)
     */
    getAiResponse(discarderIdx, tile, mySlot = 0) {
        if (!tile || this.isGameOver) return null;

        // 胡: 按截胡规则 (出牌者下家起顺时针就近优先), 排除人类玩家座位
        const huInfo = this.evaluateHuPriority(discarderIdx, tile);
        if (huInfo.huWinner >= 0 && huInfo.huWinner !== mySlot) {
            return { action: 'HU', playerIdx: huInfo.huWinner };
        }

        // 碰/杠: 从出牌者下家起顺时针检查每家 (排除人类玩家座位)
        for (let step = 1; step <= 3; step++) {
            const idx = (discarderIdx + step) % 4;
            if (idx === mySlot) continue;
            const hand = this.hands[idx] || [];
            if (this.checkCanKong(hand, tile)) {
                return { action: 'KONG', playerIdx: idx };
            }
            if (this.checkCanPong(hand, tile)) {
                return { action: 'PONG', playerIdx: idx };
            }
            // 吃: 仅下家 (出牌者下一家), 且能凑顺子
            if (step === 1) {
                const chowPair = this.getChowOptions(hand, tile);
                if (chowPair.length > 0) {
                    return { action: 'CHOW', playerIdx: idx, chowPair: chowPair[0] };
                }
            }
        }
        return null;
    }


    /**
     * 消费最新弃牌 (吃/碰/杠时调用): 从弃牌堆移除被用掉的牌并清除 lastDiscard
     */
    _consumeLastDiscard(tile) {
        if (this.lastDiscard && this.lastDiscard.tile) {
            const owner = this.lastDiscard.playerIdx;
            const dArr = this.discards[owner];
            if (dArr) {
                // 优先移除弃牌堆最后一张 (即刚打出的牌); 兜底按 id/name 匹配
                const last = dArr[dArr.length - 1];
                if (last && (last.id === tile.id || last.name === tile.name)) {
                    dArr.pop();
                } else {
                    let di = dArr.findIndex(t => t.id === tile.id);
                    if (di === -1) di = dArr.findIndex(t => t.name === tile.name);
                    if (di !== -1) dArr.splice(di, 1);
                }
            }
        }
        this.lastDiscard = null; // 该弃牌已被拿走, 不再可响应
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
                            this._consumeLastDiscard(tile); // 被吃的弃牌进入明牌堆
            this.melds[playerIdx].push({ type: 'CHOW', tiles: chowTiles });
        this.hands[playerIdx] = this.sortHand(hand);
        this.currentTurn = playerIdx;
        this.pendingDraw = false; // 响应后由响应方直接出牌, 不额外摸牌 // 吃牌方获得出牌权
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
            // 被碰的弃牌进入明牌堆
            this._consumeLastDiscard(tile);
            this.melds[playerIdx].push({ type: 'PONG', tiles: [p1, p2, tile] });
            this.hands[playerIdx] = this.sortHand(hand);
            this.currentTurn = playerIdx; // 碰牌方获得出牌回合
            this.pendingDraw = false; // 响应后由响应方直接出牌, 不额外摸牌
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
                                this._consumeLastDiscard(tile); // 被杠的弃牌进入明牌堆
            this.melds[playerIdx].push({ type: 'KONG', tiles: [tile, tile, tile, tile] });

            // 杠牌补摸牌 (必须先补牌再排序赋值，否则补牌会丢失)
            if (this.wall.length > 0) {
                const suppTile = this.wall.pop();
                hand.push(suppTile);
                this.lastDrawnTile = suppTile;
                this.wallCount = this.wall.length;
            }
            this.hands[playerIdx] = this.sortHand(hand);

            this.currentTurn = playerIdx;
            this.pendingDraw = false; // 响应后由响应方直接出牌, 不额外摸牌
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

        // 杠后补牌 (必须先补牌再排序赋值，否则补牌会丢失)
        if (this.wall.length > 0) {
            const suppTile = this.wall.pop();
            hand.push(suppTile);
            this.lastDrawnTile = suppTile;
            this.wallCount = this.wall.length;
        }

        this.hands[playerIdx] = this.sortHand(hand);

        this.currentTurn = playerIdx;
        this.pendingDraw = false; // 响应后由响应方直接出牌, 不额外摸牌
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

        // 3. 检查碰碰胡 (无吃牌面子，且手牌中仅包含 1 个将牌对子，其余均为三张或四张刻子)
        const hasChowMeld = melds.some(m => m.type === 'CHOW');
        if (!hasChowMeld && fullHand.length % 3 === 2) {
            const counts = {};
            fullHand.forEach(t => { counts[t.name] = (counts[t.name] || 0) + 1; });
            const countsList = Object.values(counts);
            const pairs = countsList.filter(c => c === 2);
            const tripletsOrKongs = countsList.filter(c => c === 3 || c === 4);
            if (pairs.length === 1 && pairs.length + tripletsOrKongs.length === countsList.length) {
                totalFan += 2;
                details.push('碰碰胡 (+2番)');
            }
        }

        // 4. 检查自摸
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
     * 4 人 AI 出牌决策引擎 (保留刻子/对子/有搭子的牌，优先打孤张，牌局更真实)
     */
    getBestAiMove(playerIdx) {
        const aiHand = this.hands[playerIdx];
        if (!aiHand || aiHand.length === 0) return 0;

        const counts = {};
        aiHand.forEach(t => { counts[t.name] = (counts[t.name] || 0) + 1; });

        let bestIdx = -1;
        let bestScore = Infinity;

        for (let i = 0; i < aiHand.length; i++) {
            const tile = aiHand[i];
            let score = 0;
            const sameCount = counts[tile.name];

            if (sameCount >= 3) { score += 100; }          // 刻子保留
            else if (sameCount === 2) { score += 80; }     // 对子保留
            else if (tile.type === '字') { score += 0; }   // 孤张字牌: 最低优先打出
            else if (tile.num === 1 || tile.num === 9) {
                // 边张: 有邻居搭子才保留
                const hasNeighbor = aiHand.some(t => t.type === tile.type && Math.abs(t.num - tile.num) === 1);
                score += hasNeighbor ? 50 : 5;
            } else {
                // 中张: 计算搭子潜力 (相邻 1-2 张)
                let potential = 0;
                for (let d = -2; d <= 2; d++) {
                    if (d === 0) continue;
                    const n = tile.num + d;
                    if (n < 1 || n > 9) continue;
                    const neighborCount = aiHand.filter(t => t.type === tile.type && t.num === n).length;
                    if (neighborCount > 0) potential += 30 - Math.abs(d) * 10;
                }
                score += potential > 0 ? 40 + potential : 15;
            }
            // 随机微扰避免 AI 出牌完全可预测
            score += Math.random() * 3;
            if (score < bestScore) { bestScore = score; bestIdx = i; }
        }
        return bestIdx >= 0 ? bestIdx : aiHand.length - 1;
    }

    /**
     * 导出全量 4 人麻将数据状态 (便于多人云端网络同步)
     */
    exportState() {
        return {
            dealer: this.dealer,
            currentTurn: this.currentTurn,
            pendingDraw: !!this.pendingDraw,
            isGameOver: !!this.isGameOver,
            winner: this.winner,
            wall: this.wall || [],
            wallCount: this.wall ? this.wall.length : 0,
            hands: {
                0: this.hands[0] || [],
                1: this.hands[1] || [],
                2: this.hands[2] || [],
                3: this.hands[3] || []
            },
            discards: {
                0: this.discards[0] || [],
                1: this.discards[1] || [],
                2: this.discards[2] || [],
                3: this.discards[3] || []
            },
            melds: {
                0: this.melds[0] || [],
                1: this.melds[1] || [],
                2: this.melds[2] || [],
                3: this.melds[3] || []
            },
            lastDiscard: this.lastDiscard || null,
            lastDrawnTile: this.lastDrawnTile || null
        };
    }

    /**
     * 导入云端 4 人麻将数据状态 (强力兼容 Firebase 自动剔除空数组)
     */
    importState(stateData) {
        if (!stateData) return;
        this.dealer = stateData.dealer !== undefined ? stateData.dealer : 0;
        this.currentTurn = stateData.currentTurn !== undefined ? stateData.currentTurn : 0;
        this.pendingDraw = !!stateData.pendingDraw;
        this.isGameOver = !!stateData.isGameOver;
        this.winner = stateData.winner !== undefined ? stateData.winner : null;
        this.wall = stateData.wall || [];
        this.wallCount = stateData.wallCount !== undefined ? stateData.wallCount : this.wall.length;

        // 强力修复：Firebase 会剥离空数组，必须确保 0, 1, 2, 3 全部初始化为有效 Array
        this.hands = { 0: [], 1: [], 2: [], 3: [] };
        this.discards = { 0: [], 1: [], 2: [], 3: [] };
        this.melds = { 0: [], 1: [], 2: [], 3: [] };

        for (let i = 0; i < 4; i++) {
            if (stateData.hands && stateData.hands[i]) {
                this.hands[i] = Array.isArray(stateData.hands[i]) ? [...stateData.hands[i]] : Object.values(stateData.hands[i]);
            }
            if (stateData.discards && stateData.discards[i]) {
                this.discards[i] = Array.isArray(stateData.discards[i]) ? [...stateData.discards[i]] : Object.values(stateData.discards[i]);
            }
            if (stateData.melds && stateData.melds[i]) {
                this.melds[i] = Array.isArray(stateData.melds[i]) ? [...stateData.melds[i]] : Object.values(stateData.melds[i]);
            }
        }

        this.lastDiscard = stateData.lastDiscard || null;
        this.lastDrawnTile = stateData.lastDrawnTile || null;
    }
}

// 挂载全局对象
window.MahjongEngine = MahjongEngine;
window.mahjongEngine = new MahjongEngine();
