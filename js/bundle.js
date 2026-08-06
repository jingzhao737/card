/* ===== js/rules.js ===== */
/* ==========================================================================
   斗地主规则引擎 (Rules Engine v2 - 权威规则优化版)
   ========================================================================== */

const CardType = {
    INVALID: 0,
    SINGLE: 1,               // 单张
    PAIR: 2,                 // 对子
    TRIPLE: 3,               // 三张 (不带)
    TRIPLE_ONE: 4,           // 三带一
    TRIPLE_TWO: 5,           // 三带二 (带对子)
    STRAIGHT: 6,             // 单顺 (5+ 张)
    CONSECUTIVE_PAIRS: 7,    // 双顺/连对 (3+ 对)
    CONSECUTIVE_TRIPLES: 8,  // 三顺/纯飞机
    PLANE_WITH_SINGLES: 9,   // 飞机带单张
    PLANE_WITH_PAIRS: 10,    // 飞机带对子
    QUAD_TWO_SINGLES: 11,    // 四带二单
    QUAD_TWO_PAIRS: 12,      // 四带两对
    BOMB: 13,                // 炸弹 (4张同点数)
    ROCKET: 14               // 火箭 (双王)
};

const DouDizhuRules = {
    // 花色定义
    SUITS: [
        { key: 'spade', symbol: '♠', isRed: false },
        { key: 'heart', symbol: '♥', isRed: true },
        { key: 'club', symbol: '♣', isRed: false },
        { key: 'diamond', symbol: '♦', isRed: true }
    ],

    // 点数映射名
    RANK_NAMES: {
        3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
        11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'
    },

    /**
     * 生成一副标准的 54 张扑克牌
     */
    createDeck(roundIndex = 1) {
        const deck = [];
        const baseId = ((roundIndex || 1) % 900 + 1) * 1000;
        let id = 1;

        // 3 到 2 (Rank: 3..15)
        for (let rank = 3; rank <= 15; rank++) {
            for (const suit of this.SUITS) {
                deck.push({
                    id: baseId + (id++),
                    rank: rank,
                    suit: suit.key,
                    suitSymbol: suit.symbol,
                    isRed: suit.isRed,
                    name: this.RANK_NAMES[rank]
                });
            }
        }

        // 小王 (16) 与 大王 (17)
        deck.push({
            id: baseId + (id++),
            rank: 16,
            suit: 'joker',
            suitSymbol: '🃏',
            isRed: false,
            name: '小王',
            isJoker: true
        });
        deck.push({
            id: baseId + (id++),
            rank: 17,
            suit: 'joker',
            suitSymbol: '👑',
            isRed: true,
            name: '大王',
            isJoker: true
        });

        return deck;
    },

    /**
     * 洗牌算法 (Fisher-Yates)
     */
    shuffle(deck) {
        const result = [...deck];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    },

    /**
     * 排序手牌（默认按 Rank 从大到小：大王 > 小王 > 2 > A > K ... > 3）
     */
    sortCards(cards, asc = false) {
        return [...cards].sort((a, b) => {
            if (a.rank !== b.rank) {
                return asc ? a.rank - b.rank : b.rank - a.rank;
            }
            return a.id - b.id;
        });
    },

    /**
     * 按点数分组统计
     */
    groupCardsByRank(cards) {
        const map = new Map();
        for (const card of cards) {
            if (!map.has(card.rank)) {
                map.set(card.rank, []);
            }
            map.get(card.rank).push(card);
        }
        return map;
    },

    /**
     * 权威分析牌型算法
     * @returns { type: CardType, mainRank: number, length: number }
     */
    analyzeCards(cards) {
        if (!cards || cards.length === 0) {
            return { type: CardType.INVALID, mainRank: 0, length: 0 };
        }

        const sorted = this.sortCards(cards, true); // 从小到大排序
        const len = sorted.length;
        const groupMap = this.groupCardsByRank(sorted);

        // 1. 火箭 (双王)
        if (len === 2 && sorted[0].rank === 16 && sorted[1].rank === 17) {
            return { type: CardType.ROCKET, mainRank: 17, length: 2 };
        }

        // 2. 炸弹 (4张同点数)
        if (len === 4 && groupMap.size === 1) {
            return { type: CardType.BOMB, mainRank: sorted[0].rank, length: 4 };
        }

        // 3. 单张
        if (len === 1) {
            return { type: CardType.SINGLE, mainRank: sorted[0].rank, length: 1 };
        }

        // 4. 对子
        if (len === 2 && groupMap.size === 1) {
            return { type: CardType.PAIR, mainRank: sorted[0].rank, length: 2 };
        }

        // 5. 三张 (不带)
        if (len === 3 && groupMap.size === 1) {
            return { type: CardType.TRIPLE, mainRank: sorted[0].rank, length: 3 };
        }

        // 6. 三带一 (4张：3张同点数 + 1张任意牌)
        if (len === 4) {
            for (const [rank, list] of groupMap.entries()) {
                if (list.length === 3) {
                    return { type: CardType.TRIPLE_ONE, mainRank: rank, length: 4 };
                }
            }
        }

        // 7. 三带二 (5张：3张同点数 + 2张同点数对子)
        if (len === 5 && groupMap.size === 2) {
            let tripleRank = 0;
            let hasPair = false;
            groupMap.forEach((list, rank) => {
                if (list.length === 3) tripleRank = rank;
                if (list.length === 2) hasPair = true;
            });
            if (tripleRank > 0 && hasPair) {
                return { type: CardType.TRIPLE_TWO, mainRank: tripleRank, length: 5 };
            }
        }

        // 8. 单顺子 (5张及以上连续单张，不能包含 2 或 王，最大到 A)
        if (len >= 5 && groupMap.size === len && sorted[len - 1].rank <= 14) {
            let isConsecutive = true;
            for (let i = 0; i < len - 1; i++) {
                if (sorted[i + 1].rank - sorted[i].rank !== 1) {
                    isConsecutive = false;
                    break;
                }
            }
            if (isConsecutive) {
                return { type: CardType.STRAIGHT, mainRank: sorted[len - 1].rank, length: len };
            }
        }

        // 9. 双顺/连对 (3对及以上连续对子，不能包含 2 或 王，最大到 A)
        if (len >= 6 && len % 2 === 0 && sorted[len - 1].rank <= 14) {
            const pairCount = len / 2;
            if (groupMap.size === pairCount) {
                let isAllPairs = true;
                const ranks = Array.from(groupMap.keys()).sort((a, b) => a - b);
                for (let i = 0; i < ranks.length; i++) {
                    if (groupMap.get(ranks[i]).length !== 2) {
                        isAllPairs = false;
                        break;
                    }
                    if (i < ranks.length - 1 && ranks[i + 1] - ranks[i] !== 1) {
                        isAllPairs = false;
                        break;
                    }
                }
                if (isAllPairs) {
                    return { type: CardType.CONSECUTIVE_PAIRS, mainRank: ranks[ranks.length - 1], length: len };
                }
            }
        }

        // 10. 三顺 / 飞机 (纯飞机、飞机带单张、飞机带对子)
        // 收集所有张数 >= 3 的点数
        const tripleRanks = [];
        groupMap.forEach((list, rank) => {
            // 必须是正好 3 张（不能是炸弹），且不能包含 2 或王
            if (list.length === 3 && rank <= 14) {
                tripleRanks.push(rank);
            }
        });
        tripleRanks.sort((a, b) => a - b);

        if (tripleRanks.length >= 2) {
            // 从最长连续 3张 开始尝试匹配
            for (let k = tripleRanks.length; k >= 2; k--) {
                for (let i = 0; i <= tripleRanks.length - k; i++) {
                    const subRanks = tripleRanks.slice(i, i + k);
                    let isConsecutive = true;
                    for (let j = 0; j < subRanks.length - 1; j++) {
                        if (subRanks[j + 1] - subRanks[j] !== 1) {
                            isConsecutive = false;
                            break;
                        }
                    }

                    if (isConsecutive) {
                        const mainRank = subRanks[subRanks.length - 1];
                        const tripleCardCount = k * 3;

                        // 纯飞机 (不带翅膀)
                        if (len === tripleCardCount) {
                            return { type: CardType.CONSECUTIVE_TRIPLES, mainRank, length: len };
                        }
                        // 飞机带单张 (总张数 = k * 4)
                        if (len === tripleCardCount + k) {
                            return { type: CardType.PLANE_WITH_SINGLES, mainRank, length: len };
                        }
                        // 飞机带对子 (总张数 = k * 5，剩下的 k*2 张牌必须刚好组成 k 个对子)
                        if (len === tripleCardCount + k * 2) {
                            // 校验扣除飞机主牌后剩余的牌是否全是对子
                            const wingMap = new Map(groupMap);
                            subRanks.forEach(r => wingMap.delete(r));
                            let isAllPairs = true;
                            wingMap.forEach((list) => {
                                if (list.length % 2 !== 0) isAllPairs = false;
                            });
                            if (isAllPairs) {
                                return { type: CardType.PLANE_WITH_PAIRS, mainRank, length: len };
                            }
                        }
                    }
                }
            }
        }

        // 11. 四带二 (单张或对子)
        const quadRanks = [];
        groupMap.forEach((list, rank) => {
            if (list.length === 4) quadRanks.push(rank);
        });

        if (quadRanks.length === 1) {
            const quadRank = quadRanks[0];
            // 四带二单 (6张：4张同点数 + 2张任意单牌)
            if (len === 6) {
                return { type: CardType.QUAD_TWO_SINGLES, mainRank: quadRank, length: 6 };
            }
            // 四带两对 (8张：4张同点数 + 2个对子)
            if (len === 8) {
                const wingMap = new Map(groupMap);
                wingMap.delete(quadRank);
                let isPairs = true;
                wingMap.forEach(list => {
                    if (list.length % 2 !== 0) isPairs = false;
                });
                if (isPairs) {
                    return { type: CardType.QUAD_TWO_PAIRS, mainRank: quadRank, length: 8 };
                }
            }
        }

        return { type: CardType.INVALID, mainRank: 0, length: 0 };
    },

    /**
     * 判断待出牌是否能管住桌上的上家牌
     */
    canBeat(playCards, lastPlay, currentTurnIndex) {
        // 如果没有上家牌，或者上家牌就是自己出的（其他所有人选择过/要不起），则属于自由出牌！
        const isFreePlay = !lastPlay || !lastPlay.cards || lastPlay.cards.length === 0 || (currentTurnIndex !== undefined && lastPlay.playerIndex === currentTurnIndex);

        if (isFreePlay) {
            // 自由出牌，只要牌型合法即可
            const analysis = this.analyzeCards(playCards);
            return analysis.type !== CardType.INVALID;
        }

        const target = this.analyzeCards(playCards);
        if (target.type === CardType.INVALID) return false;

        const prev = this.analyzeCards(lastPlay.cards);

        // 1. 火箭 (双王) 压一切
        if (target.type === CardType.ROCKET) return true;

        // 2. 对方是火箭，压不住
        if (prev.type === CardType.ROCKET) return false;

        // 3. 炸弹压非炸弹
        if (target.type === CardType.BOMB && prev.type !== CardType.BOMB) return true;

        // 4. 炸弹 PK 炸弹：点数大的胜
        if (target.type === CardType.BOMB && prev.type === CardType.BOMB) {
            return target.mainRank > prev.mainRank;
        }

        // 5. 普通牌型：牌型必须相同、张数必须相同，且主牌点数更大
        if (target.type === prev.type && target.length === prev.length) {
            return target.mainRank > prev.mainRank;
        }

        return false;
    },

    /**
     * 智能提示算法 (寻找手牌中能压过上家牌的最小合法组合)
     */
    findSmartHint(handCards, lastPlay) {
        if (!handCards || handCards.length === 0) return [];
        const sortedHand = this.sortCards(handCards, true); // 从小到大排序

        if (!lastPlay || !lastPlay.cards || lastPlay.cards.length === 0) {
            // 自由出牌，默认提示最小的单张
            return [sortedHand[0]];
        }

        const prev = this.analyzeCards(lastPlay.cards);
        const groupMap = this.groupCardsByRank(sortedHand);

        // 同牌型匹配
        if (prev.type === CardType.SINGLE) {
            for (const card of sortedHand) {
                if (card.rank > prev.mainRank) return [card];
            }
        } else if (prev.type === CardType.PAIR) {
            for (const [rank, list] of groupMap.entries()) {
                if (rank > prev.mainRank && list.length >= 2) {
                    return list.slice(0, 2);
                }
            }
        } else if (prev.type === CardType.TRIPLE) {
            for (const [rank, list] of groupMap.entries()) {
                if (rank > prev.mainRank && list.length >= 3) {
                    return list.slice(0, 3);
                }
            }
        } else if (prev.type === CardType.TRIPLE_ONE) {
            for (const [rank, list] of groupMap.entries()) {
                if (rank > prev.mainRank && list.length >= 3) {
                    // 找一个最小单张作为带牌
                    for (const card of sortedHand) {
                        if (card.rank !== rank) return [...list.slice(0, 3), card];
                    }
                }
            }
        } else if (prev.type === CardType.TRIPLE_TWO) {
            for (const [rank, list] of groupMap.entries()) {
                if (rank > prev.mainRank && list.length >= 3) {
                    for (const [pRank, pList] of groupMap.entries()) {
                        if (pRank !== rank && pList.length >= 2) {
                            return [...list.slice(0, 3), ...pList.slice(0, 2)];
                        }
                    }
                }
            }
        } else if (prev.type === CardType.STRAIGHT) {
            // 寻找同长度、更高的顺子
            const needed = prev.length;
            for (let startRank = 3; startRank <= 14 - needed + 1; startRank++) {
                const straight = [];
                for (let r = startRank; r < startRank + needed; r++) {
                    const g = groupMap.get(r);
                    if (g && g.length >= 1) straight.push(g[0]);
                    else break;
                }
                if (straight.length === needed && straight[needed - 1].rank > prev.mainRank) {
                    return straight;
                }
            }
        } else if (prev.type === CardType.CONSECUTIVE_PAIRS) {
            // 寻找同对数、更高的连对
            const pairCount = prev.length / 2;
            for (let startRank = 3; startRank <= 14 - pairCount + 1; startRank++) {
                const pairs = [];
                for (let r = startRank; r < startRank + pairCount; r++) {
                    const g = groupMap.get(r);
                    if (g && g.length >= 2) pairs.push(...g.slice(0, 2));
                    else break;
                }
                if (pairs.length === prev.length && pairs[pairs.length - 1].rank > prev.mainRank) {
                    return pairs;
                }
            }
        } else if (prev.type === CardType.BOMB) {
            for (const [rank, list] of groupMap.entries()) {
                if (rank > prev.mainRank && list.length === 4) {
                    return list;
                }
            }
        }

        // 尝试炸弹管非炸弹
        if (prev.type !== CardType.BOMB && prev.type !== CardType.ROCKET) {
            for (const [rank, list] of groupMap.entries()) {
                if (list.length === 4) return list;
            }
        }

        // 尝试火箭
        const jokers = sortedHand.filter(c => c.rank >= 16);
        if (jokers.length === 2) return jokers;

        return [];
    }
};


/* ===== js/audio.js ===== */
/* ==========================================================================
   高保真自然柔和物理音效合成器 (Organic Acoustic Card Sound Engine)
   ========================================================================== */

class AudioSynth {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.cardFlipBuffer = null;
        this.isBufferLoading = false;
        this.stoneDropBuffer = null;
        this.isStoneBufferLoading = false;
        this.mahjongTileBuffer = null;
        this.isMahjongBufferLoading = false;
        this.mahjongShuffleBuffer = null;
        this.isMahjongShuffleBufferLoading = false;
        this.mahjongChowBuffer = null;
        this.isMahjongChowBufferLoading = false;
        this.mahjongPongBuffer = null;
        this.isMahjongPongBufferLoading = false;
        this.mahjongKongBuffer = null;
        this.isMahjongKongBufferLoading = false;
        this.mobileAudioUnlocked = false;
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        if (this.ctx) {
            if (!this.cardFlipBuffer && !this.isBufferLoading) {
                this.loadCardFlipBuffer();
            }
            if (!this.stoneDropBuffer && !this.isStoneBufferLoading) {
                this.loadStoneDropBuffer();
            }
            if (!this.mahjongTileBuffer && !this.isMahjongBufferLoading) {
                this.loadMahjongTileBuffer();
            }
            if (!this.mahjongShuffleBuffer && !this.isMahjongShuffleBufferLoading) {
                this.loadMahjongShuffleBuffer();
            }
            if (!this.mahjongChowBuffer && !this.isMahjongChowBufferLoading) {
                this.loadMahjongChowBuffer();
            }
            if (!this.mahjongPongBuffer && !this.isMahjongPongBufferLoading) {
                this.loadMahjongPongBuffer();
            }
            if (!this.mahjongKongBuffer && !this.isMahjongKongBufferLoading) {
                this.loadMahjongKongBuffer();
            }
        }
    }

    /**
     * 移动端 (iOS Safari / Android Chrome / 微信) 首次触摸极速无声解封音频引擎
     */
    unlockMobileAudio() {
        if (this.mobileAudioUnlocked) return;
        this.init();
        if (this.ctx) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            try {
                // 播放 1 帧无声 Web Audio 节点，纯净无痕解封 Web Audio 引擎
                const buffer = this.ctx.createBuffer(1, 1, 22050);
                const source = this.ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(this.ctx.destination);
                source.start(0);
            } catch (e) {}
        }
        this.mobileAudioUnlocked = true;
    }

    async loadCardFlipBuffer() {
        if (this.cardFlipBuffer || this.isBufferLoading) return;
        this.isBufferLoading = true;
        try {
            const response = await fetch('sound/card-flip.wav');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.cardFlipBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isBufferLoading = 'failed';
            }
        } catch (e) {
            this.isBufferLoading = 'failed';
        }
    }

    async loadStoneDropBuffer() {
        if (this.stoneDropBuffer || this.isStoneBufferLoading) return;
        this.isStoneBufferLoading = true;
        try {
            const response = await fetch('sound/placing-a-piece.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.stoneDropBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isStoneBufferLoading = 'failed';
            }
        } catch (e) {
            this.isStoneBufferLoading = 'failed';
        }
    }

    async loadMahjongTileBuffer() {
        if (this.mahjongTileBuffer || this.isMahjongBufferLoading) return;
        this.isMahjongBufferLoading = true;
        try {
            const response = await fetch('sound/mahjangclack-1.wav');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongTileBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongBufferLoading = 'failed';
        }
    }

    async loadMahjongShuffleBuffer() {
        if (this.mahjongShuffleBuffer || this.isMahjongShuffleBufferLoading) return;
        this.isMahjongShuffleBufferLoading = true;
        try {
            const response = await fetch('sound/mahjong-shuffle.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongShuffleBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongShuffleBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongShuffleBufferLoading = 'failed';
        }
    }

    async loadMahjongChowBuffer() {
        if (this.mahjongChowBuffer || this.isMahjongChowBufferLoading) return;
        this.isMahjongChowBufferLoading = true;
        try {
            const response = await fetch('sound/chi.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongChowBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongChowBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongChowBufferLoading = 'failed';
        }
    }

    async loadMahjongPongBuffer() {
        if (this.mahjongPongBuffer || this.isMahjongPongBufferLoading) return;
        this.isMahjongPongBufferLoading = true;
        try {
            const response = await fetch('sound/peng.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongPongBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongPongBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongPongBufferLoading = 'failed';
        }
    }

    async loadMahjongKongBuffer() {
        if (this.mahjongKongBuffer || this.isMahjongKongBufferLoading) return;
        this.isMahjongKongBufferLoading = true;
        try {
            const response = await fetch('sound/gang.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.ctx) {
                    this.mahjongKongBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                }
            } else {
                this.isMahjongKongBufferLoading = 'failed';
            }
        } catch (e) {
            this.isMahjongKongBufferLoading = 'failed';
        }
    }

    toggleSound() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * 五子棋落子音效：放大大音量，并为每次落子加入极度丰富的声音与速度动态变化
     * @param {boolean} isWhite - 是否为白棋
     */
    playStoneDrop(isWhite = false) {
        if (!this.enabled) return;
        this.init();

        // 1. 优先使用 Web Audio API 解码的真实音频 Buffer 播放
        if (this.ctx && this.stoneDropBuffer) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            try {
                const source = this.ctx.createBufferSource();
                const gain = this.ctx.createGain();
                source.buffer = this.stoneDropBuffer;

                // 速度与音高丰富随机抖动 (速度范围 0.88x - 1.22x, 每颗子绝不重样)
                const speedVar = 0.88 + Math.random() * 0.34; // 速度 0.88 ~ 1.22 随机变化
                const colorTone = isWhite ? 1.06 : 0.95;       // 白棋清脆、黑棋沉稳
                source.playbackRate.value = colorTone * speedVar;

                // 音量加大 (提升至 1.75 强劲音量，带 ±0.25 动态力度震荡)
                const dynamicVolume = 1.75 + (Math.random() * 0.5 - 0.25);
                gain.gain.value = dynamicVolume;

                source.connect(gain);
                gain.connect(this.ctx.destination);
                source.start(0);
                return;
            } catch (e) {
                // 回退下述方案
            }
        }

        // 2. 次选：HTML5 Audio 标签 DOM 播放 (最大音量 1.0)
        const htmlAudio = document.getElementById('audioStoneDrop');
        if (htmlAudio) {
            try {
                htmlAudio.currentTime = 0;
                htmlAudio.volume = 1.0;
                htmlAudio.playbackRate = 0.9 + Math.random() * 0.25;
                htmlAudio.play().catch(() => {});
                return;
            } catch (e) {}
        }

        // 3. 兜底：合成器物理清脆碰撞声 (同步增大音量与速度变化)
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const speedVar = 0.88 + Math.random() * 0.34;
        const pitchMod = (isWhite ? 1.1 : 0.9) * speedVar;
        const startFreq = 850 * pitchMod;
        const endFreq = 180 * pitchMod;
        const duration = (0.045 + Math.random() * 0.02) / speedVar;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = isWhite ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.65, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.01);
    }

    /**
     * 选牌音效：柔和自然弹纸声 (Soft Organic Card Pop)
     */
    playCardSelect() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 主音调：柔和正弦波渐变 (520Hz -> 720Hz)，带有 3ms 柔和 Attack 避免生硬
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(720, now + 0.035);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.14, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        // 辅音：低通滤波纸张碰撞微响 (Lowpass Friction)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.02);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(1600, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.08, now + 0.003);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        noise.connect(lowpass);
        lowpass.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        osc.start(now);
        noise.start(now);
        osc.stop(now + 0.035);
    }

    /**
     * 取消选牌音效：温和落手声 (Soft Organic Deselect Tok)
     */
    playCardDeselect() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 主音调：平滑降音 (580Hz -> 360Hz)，带 3ms 柔和缓冲
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(360, now + 0.035);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.035);
    }

    /**
     * 理牌音效：快速滑牌/洗牌纸擦刷音 (Fast Card Riffle / Sort Sound)
     */
    playCardSort() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const pitches = [480, 600, 720, 850];

        pitches.forEach((freq, i) => {
            const startTime = now + i * 0.025; // 每 25ms 弹响一次

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            osc.frequency.exponentialRampToValueAtTime(freq + 120, startTime + 0.02);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.12, startTime + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.02);

            const bufferSize = Math.floor(this.ctx.sampleRate * 0.015);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let k = 0; k < bufferSize; k++) {
                data[k] = (Math.random() * 2 - 1) * Math.exp(-k / (bufferSize * 0.3));
            }

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(2200 + i * 300, startTime);
            filter.Q.setValueAtTime(2, startTime);

            const noiseGain = this.ctx.createGain();
            noiseGain.gain.setValueAtTime(0.001, startTime);
            noiseGain.gain.linearRampToValueAtTime(0.1, startTime + 0.002);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.015);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(this.ctx.destination);

            noise.start(startTime);
        });
    }

    /**
     * 出牌音效：沉稳绒布桌面触牌声 (Warm Felt Table Slap)
     */
    playCardPlay() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 沉稳牌桌触击低音 (Table Thud)
        const thudOsc = this.ctx.createOscillator();
        const thudGain = this.ctx.createGain();
        thudOsc.type = 'sine';
        thudOsc.frequency.setValueAtTime(140, now);
        thudOsc.frequency.exponentialRampToValueAtTime(45, now + 0.07);

        thudGain.gain.setValueAtTime(0.001, now);
        thudGain.gain.linearRampToValueAtTime(0.28, now + 0.005);
        thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        thudOsc.connect(thudGain);
        thudGain.connect(this.ctx.destination);

        // 2. 柔和牌面擦落声 (Soft Friction)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.04);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(300, now + 0.04);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.004);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        thudOsc.start(now);
        noise.start(now);
        thudOsc.stop(now + 0.07);
    }

    /**
     * 不出/过 音效：轻柔木块扣击 (Gentle Muted Tap)
     */
    playPass() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.11, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
    }

    /**
     * 抢地主/叫分音效：暖色三和弦风铃 (Warm Chime)
     */
    playBid() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99];

        freqs.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.06);

            const startTime = now + i * 0.06;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.12, startTime + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.25);
        });
    }

    /**
     * 炸弹音效：沉稳低音轰鸣 (Deep Warm Bomb)
     */
    playBomb() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 低音震感 drop
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(100, now);
        sub.frequency.exponentialRampToValueAtTime(30, now + 0.4);

        subGain.gain.setValueAtTime(0.001, now);
        subGain.gain.linearRampToValueAtTime(0.45, now + 0.01);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        sub.connect(subGain);
        subGain.connect(this.ctx.destination);

        // 2. 温暖炸弹轰鸣 (Warm Lowpass Noise)
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.4);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(35, now + 0.4);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.35, now + 0.01);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        sub.start(now);
        noise.start(now);
        sub.stop(now + 0.4);
    }

    /**
     * 胜利音效：圆润舒缓五音和弦 (Smooth Victory Fanfare)
     */
    playWin() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];

        notes.forEach((freq, index) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + index * 0.08);

            const startTime = now + index * 0.08;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.15, startTime + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.35);
        });
    }

    /**
     * 倒计时嘀声
     */
    playCountdownTick() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(784, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
    }

    /**
     * 3秒开局倒计时嘀声 (Beep for 3, 2, 1)
     */
    playCountdownBeep(sec) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const freq = sec === 3 ? 440 : sec === 2 ? 554 : 659;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.12);
    }

    /**
     * 开局倒计时冲刺/抢！提示音 (High pitch chord flourish for GO!)
     */
    playCountdownGo() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        [880, 1108, 1320].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.035);

            gain.gain.setValueAtTime(0.001, now + idx * 0.035);
            gain.gain.linearRampToValueAtTime(0.22, now + idx * 0.035 + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.035 + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.035);
            osc.stop(now + idx * 0.035 + 0.25);
        });
    }

    /**
     * 解闷气球按压挤压音效 (使用单例 SoundEngine.ctx，永不上限卡死)
     */
    playToySqueeze(stage) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        const startFreq = 240 + stage * 40;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(startFreq + 80, now + 0.07);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
    }

    /**
     * 解闷气球啪！爆炸音效 (使用单例 SoundEngine.ctx，永不上限卡死)
     */
    playToyPop() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // 1. 爆裂噪点
        const bufferSize = Math.floor(this.ctx.sampleRate * 0.09);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.12));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + 0.09);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start(now);

        // 2. 低音冲击
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.07);

        oscGain.gain.setValueAtTime(0.7, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
    }

    /**
     * 播放真实卡牌翻转音效 (sound/card-flip.wav) - 1.4倍速
     * 支持 Web Audio API 解码 Buffer + HTML5 Audio 预加载节点 (100% 兼容 GitHub Pages & 移动端)
     */
    playCardFlipSound() {
        if (!this.enabled) return;
        this.init();

        // 优先使用 Web Audio API 解码 Buffer (0延迟、100%免疫跨域/阻断，支持 1.4x 变速)
        if (this.ctx && this.cardFlipBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.cardFlipBuffer;
                source.playbackRate.value = 1.4;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 0.85;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {
                // 回退
            }
        }

        // 备用方案 1: 使用 index.html 预加载的 HTML5 Audio DOM 节点
        const el = document.getElementById('audioCardFlip');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.85;
                clone.playbackRate = 1.4;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {
                        if (typeof this.playCardPlace === 'function') this.playCardPlace();
                    });
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/card-flip.wav');
            audio.volume = 0.85;
            audio.playbackRate = 1.4;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    if (typeof this.playCardPlace === 'function') {
                        this.playCardPlace();
                    }
                });
            }
        } catch (e) {
            if (typeof this.playCardPlace === 'function') {
                this.playCardPlace();
            }
        }
    }

    /**
     * 播放真实国粹麻将牌落牌碰撞音效 (sound/mahjangclack-1.wav)
     * 优先使用 Web Audio API 解码 Buffer (0延迟、100%免疫阻断)，备用使用 HTML5 Audio 节点与合成器
     */
    playMahjongTile() {
        if (!this.enabled) return;
        try {
            this.init();
        } catch (e) {
            // 音频初始化失败(如浏览器策略限制)绝不影响游戏流程
        }

        // 优先使用 Web Audio API 解码 Buffer (0 延迟、100% 免疫阻断)
        if (this.ctx && this.mahjongTileBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongTileBuffer;
                // 自然微随机变调 0.98~1.04 (模仿真实物理麻将碰撞声差异)
                source.playbackRate.value = 0.98 + Math.random() * 0.06;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 1.0;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {
                // 回退
            }
        }

        // 备用方案 1: HTML5 Audio DOM 节点
        const el = document.getElementById('audioMahjongTile');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.95;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {});
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/mahjangclack-1.wav');
            audio.volume = 0.95;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        } catch (e) {}
    }

    /**
     * 播放开局麻将洗牌/搓牌音效 (sound/mahjong-shuffle.wav)
     */
    playMahjongShuffle() {
        if (!this.enabled) return;
        try {
            this.init();
        } catch (e) {}

        // 优先使用 Web Audio API 解码 Buffer
        if (this.ctx && this.mahjongShuffleBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongShuffleBuffer;
                source.playbackRate.value = 1.0;

                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 0.95;

                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                source.start(0);
                return;
            } catch (e) {}
        }

        // 备用方案 1: HTML5 Audio DOM 节点
        const el = document.getElementById('audioMahjongShuffle');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 0.95;
                const p = clone.play();
                if (p !== undefined) {
                    p.then(() => {}).catch(() => {});
                }
                return;
            } catch (e) {}
        }

        // 备用方案 2: 动态 Audio 实例
        try {
            const audio = new Audio('sound/mahjong-shuffle.mp3');
            audio.volume = 0.95;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        } catch (e) {}
    }

    /**
     * 播放吃牌配音 (sound/chi.mp3 - 1.2倍速)
     */
    playMahjongChow() {
        if (!this.enabled) return;
        this.init();

        if (this.ctx && this.mahjongChowBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongChowBuffer;
                source.playbackRate.value = 1.2;
                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 1.0;
                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);
                source.start(0);
                return;
            } catch (e) {}
        }

        const el = document.getElementById('audioMahjongChow');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 1.0;
                clone.playbackRate = 1.2;
                const p = clone.play();
                if (p !== undefined) p.then(() => {}).catch(() => {});
                return;
            } catch (e) {}
        }

        try {
            const audio = new Audio('sound/chi.mp3');
            audio.volume = 1.0;
            audio.playbackRate = 1.2;
            const p = audio.play();
            if (p !== undefined) p.catch(() => {});
        } catch (e) {}
    }

    /**
     * 播放碰牌配音 (sound/peng.mp3 - 1.2倍速)
     */
    playMahjongPong() {
        if (!this.enabled) return;
        this.init();

        if (this.ctx && this.mahjongPongBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongPongBuffer;
                source.playbackRate.value = 1.2;
                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 1.0;
                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);
                source.start(0);
                return;
            } catch (e) {}
        }

        const el = document.getElementById('audioMahjongPong');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 1.0;
                clone.playbackRate = 1.2;
                const p = clone.play();
                if (p !== undefined) p.then(() => {}).catch(() => {});
                return;
            } catch (e) {}
        }

        try {
            const audio = new Audio('sound/peng.mp3');
            audio.volume = 1.0;
            audio.playbackRate = 1.2;
            const p = audio.play();
            if (p !== undefined) p.catch(() => {});
        } catch (e) {}
    }

    /**
     * 播放杠牌配音 (sound/gang.mp3 - 1.2倍速)
     */
    playMahjongKong() {
        if (!this.enabled) return;
        this.init();

        if (this.ctx && this.mahjongKongBuffer) {
            try {
                const source = this.ctx.createBufferSource();
                source.buffer = this.mahjongKongBuffer;
                source.playbackRate.value = 1.2;
                const gainNode = this.ctx.createGain();
                gainNode.gain.value = 1.0;
                source.connect(gainNode);
                gainNode.connect(this.ctx.destination);
                source.start(0);
                return;
            } catch (e) {}
        }

        const el = document.getElementById('audioMahjongKong');
        if (el) {
            try {
                const clone = el.cloneNode(true);
                clone.volume = 1.0;
                clone.playbackRate = 1.2;
                const p = clone.play();
                if (p !== undefined) p.then(() => {}).catch(() => {});
                return;
            } catch (e) {}
        }

        try {
            const audio = new Audio('sound/gang.mp3');
            audio.volume = 1.0;
            audio.playbackRate = 1.2;
            const p = audio.play();
            if (p !== undefined) p.catch(() => {});
        } catch (e) {}
    }
}

const SoundEngine = new AudioSynth();
window.SoundEngine = SoundEngine;
window.audioSynth  = SoundEngine;

// 全局绑定移动端 (iOS Safari / Android / 微信) 触摸极速无声解封音频引擎
const _unlockAudioOnTouch = () => {
    if (window.SoundEngine) {
        window.SoundEngine.unlockMobileAudio();
        window.removeEventListener('touchstart', _unlockAudioOnTouch, { capture: true });
        window.removeEventListener('touchend', _unlockAudioOnTouch, { capture: true });
        window.removeEventListener('click', _unlockAudioOnTouch, { capture: true });
    }
};
window.addEventListener('touchstart', _unlockAudioOnTouch, { passive: true, capture: true });
window.addEventListener('touchend', _unlockAudioOnTouch, { passive: true, capture: true });
window.addEventListener('click', _unlockAudioOnTouch, { capture: true });

/* ===== js/p2p.js ===== */
/* ==========================================================================
   云端实时同步与房间网络引擎 (Firebase Realtime Database Cloud Engine)
   ========================================================================== */

const firebaseConfig = {
    apiKey: "AIzaSyAMWg7S6RD2HTBfqWVSEmlTAsTc7-qRWI",
    authDomain: "yjcard.firebaseapp.com",
    databaseURL: "https://yjcard-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "yjcard",
    storageBucket: "yjcard.firebasestorage.app",
    messagingSenderId: "179385847942",
    appId: "1:179385847942:web:1b4b36b4749d7cf806c107",
    measurementId: "G-1WKXG1DLBJ"
};

// 初始化 Firebase 改为异步动态加载: 不在 <head> 同步阻塞
// SDK 从 gstatic CDN 加载 (昨版本验证该 CDN 在用户网络下稳定), 避免全部资源集中到 Cloudflare 下载
const FIREBASE_SDK_URLS = [
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-database-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js'
];

let _firebaseReady = false;
let _firebaseFailed = false;
let _firebaseLoading = false;
const _firebaseWaiters = [];

/**
 * 异步加载 Firebase SDK (按序注入, 完成后 initializeApp)
 * @param {Function} callback  (ok: boolean)
 */
function loadFirebaseSDK(callback) {
    if (_firebaseReady) { if (callback) callback(true); return; }

    // 全局已就绪 (例如后续加载完成后再次调用)
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        _firebaseReady = true;
        _firebaseFailed = false;
        if (callback) callback(true);
        return;
    }

    if (_firebaseFailed) { if (callback) callback(false); return; }
    if (callback) _firebaseWaiters.push(callback);
    if (_firebaseLoading) return;
    _firebaseLoading = true;

    let idx = 0;
    const loadNext = () => {
        if (idx >= FIREBASE_SDK_URLS.length) {
            // 全部加载完成: 初始化 App (auth.js 的 400ms 重试会自动接入)
            try {
                if (typeof firebase !== 'undefined' && !firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
            } catch (e) {
                console.error('[Firebase] initializeApp 失败:', e);
            }
            _firebaseReady = true;
            _firebaseFailed = false;
            _firebaseLoading = false;
            const waiters = _firebaseWaiters.splice(0);
            waiters.forEach(w => { if (w) w(true); });
            return;
        }
        const s = document.createElement('script');
        s.src = FIREBASE_SDK_URLS[idx];
        s.async = true;
        s.onload = () => { idx++; loadNext(); };
        s.onerror = () => { idx++; loadNext(); }; // 单个失败继续尝试下一个
        document.head.appendChild(s);
    };
    loadNext();

    // 25 秒超时兜底: 网络极差时不再无限等待, 通知等待方失败 (游戏本体不受影响)
    setTimeout(() => {
        if (!_firebaseReady) {
            _firebaseFailed = true;
            _firebaseLoading = false;
            const waiters = _firebaseWaiters.splice(0);
            waiters.forEach(w => { if (w) w(false); });
        }
    }, 25000);
}

const SESSION_KEY       = 'ddz_session';     // localStorage key
const GAMESTATE_KEY     = 'ddz_gamestate';   // localStorage key
const SESSION_MAX_AGE   = 30 * 60 * 1000;   // 30 分钟内的会话可恢复
const MAX_INACTIVE_TIME = 3 * 60 * 1000;    // 3 分钟（180,000ms）无真人操作自动销毁房间

class P2PManager {
    constructor() {
        this.db            = null; // Firebase SDK 就绪后自动赋值
        this.roomRef       = null;
        this.isHost        = false;
        this.myPlayerIndex = 0;
        this.roomId        = null;
        this.nickname      = '一键三连';
        this.isAiMode      = false;
        this.sessionId     = this._getOrCreateSessionId();

        // 渲染与网络事件回调
        this.onStateUpdate  = null;
        this.onPlayerJoined = null;
        this.onLobbySync    = null;
        this.onToast        = null;

        this._lastProcessedActionId = null;
        this._lastProcessedChatId   = null;
        this._listeners = [];

        this._bindVisibilityChange();
        this._initDbAsync();
    }

    /**
     * 异步初始化 Firebase 数据库连接 (SDK 可能仍在后台加载)
     */
    _initDbAsync() {
        const tryInit = () => {
            if (typeof firebase !== 'undefined' && firebase.database) {
                try {
                    this.db = firebase.database();
                } catch (e) {
                    this.db = null;
                }
            }
            return !!this.db;
        };

        if (tryInit()) return;

        loadFirebaseSDK(ok => {
            if (ok) {
                tryInit();
                // 通知就绪 (排行榜/大厅可立即拉取)
                if (typeof window.__onFirebaseReady === 'function') {
                    try { window.__onFirebaseReady(); } catch (e) {}
                }
            } else {
                console.warn('[CloudEngine] Firebase SDK 加载超时/失败, 云端房间/排行榜暂不可用, 单机游戏不受影响');
                if (this.onToast) this.onToast('☁️ 云端连接较慢，排行榜可能暂不可用（单机游戏不受影响）', 4000);
            }
        });
    }

    /* ====================================================================
       微信 Webview 兼容支持：Cookie + localStorage 双重设备唯一标识
       ==================================================================== */
    _getOrCreateSessionId() {
        let sid = localStorage.getItem('ddz_client_sid');
        if (!sid) {
            // Cookie 备选恢复 (专门解决微信内置浏览器关闭 Webview 清空 localStorage 的问题)
            const match = document.cookie.match(/(?:^|; )ddz_client_sid=([^;]*)/);
            if (match && match[1]) sid = match[1];
        }
        if (!sid) {
            sid = 'sid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        // 写入 localStorage + Cookie (有效期 30 天)
        try { localStorage.setItem('ddz_client_sid', sid); } catch (e) {}
        try { document.cookie = `ddz_client_sid=${sid}; max-age=${30 * 24 * 3600}; path=/`; } catch (e) {}

        return sid;
    }

    generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /* ====================================================================
       会话持久化 (localStorage + Cookie 双重保护)
       ==================================================================== */
    saveSession(gameState) {
        try {
            const session = {
                roomId:      this.roomId,
                playerIndex: this.myPlayerIndex,
                nickname:    this.nickname,
                isHost:      this.isHost,
                phase:       gameState ? gameState.phase : 'WAITING',
                ts:          Date.now()
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));

            if (gameState && gameState.phase !== 'GAMEOVER') {
                localStorage.setItem(GAMESTATE_KEY, JSON.stringify(gameState));
            }
        } catch (e) {
            console.warn('[Session] 保存会话失败:', e);
        }
    }

    loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (!session || !session.roomId) return null;
            if (Date.now() - session.ts > SESSION_MAX_AGE) {
                localStorage.removeItem(SESSION_KEY);
                return null;
            }
            return session;
        } catch (e) { return null; }
    }

    loadSavedGameState() {
        try {
            const raw = localStorage.getItem(GAMESTATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    clearSession() {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(GAMESTATE_KEY);
    }

    /* ====================================================================
       规则 1 实施：单设备单房间（创建/加入新房间前自动清除旧房间/旧槽位，带1.5秒超时保护）
       ==================================================================== */
    _leavePreviousRooms(targetRoomId, callback) {
        if (!this.db || !this.sessionId) {
            if (callback) callback();
            return;
        }

        let done = false;
        const safeCallback = () => {
            if (!done) {
                done = true;
                if (callback) callback();
            }
        };

        // 1.5 秒超时保护，防止云端网络慢时房间创建卡住挂起
        const timer = setTimeout(safeCallback, 1500);

        this.db.ref('rooms').limitToLast(15).once('value').then(snapshot => {
            clearTimeout(timer);
            const roomsMap = snapshot.val() || {};
            const updatePromises = [];

            Object.keys(roomsMap).forEach(rId => {
                if (rId === targetRoomId) return; // 忽略目标房间
                const room = roomsMap[rId];
                if (!room) return;

                const rawPlayers = (room.lobbyData && room.lobbyData.players) ? room.lobbyData.players : [];
                const players = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
                const remainingHumans = players.filter(p => p && !p.isAi && p.sid !== this.sessionId && p.name);

                // 规则：只要该房间内没有其他真人玩家了（无论是房主还是客户端退出），立即彻底销毁删除该房间！
                if (room.hostSid === this.sessionId || remainingHumans.length === 0) {
                    console.log('[CleanRoom] 房间内无其他真人玩家，自动销毁云端房间:', rId);
                    updatePromises.push(this.db.ref('rooms/' + rId).remove());
                } else {
                    // 有其他真人玩家：仅将本设备槽位重置为 AI
                    let modified = false;
                    for (let i = 1; i < players.length; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            console.log(`[CleanRoom] 自动重置旧房间 ${rId} 的槽位 ${i} 为 AI`);
                            players[i] = { name: `🤖 机器人 AI_${i}`, avatar: '🤖', isAi: true, isHost: false };
                            modified = true;
                        }
                    }
                    if (modified) {
                        updatePromises.push(this.db.ref(`rooms/${rId}/lobbyData/players`).set(players));
                    }
                }
            });

            Promise.all(updatePromises).then(safeCallback).catch(safeCallback);
        }).catch(safeCallback);
    }

    /* ====================================================================
       规则 3 实施：在线玩家 ID / 昵称去重处理（排除玩家自身槽位）
       ==================================================================== */
    _ensureUniqueNickname(requestedNick, existingPlayers, ignoreSlotIndex) {
        let unique = (requestedNick || '').trim();
        if (typeof window.sanitizeNickname === 'function') {
            unique = window.sanitizeNickname(unique);
        }
        if (!unique) unique = '玩家';

        if (ignoreSlotIndex !== undefined && ignoreSlotIndex >= 0 && existingPlayers && existingPlayers[ignoreSlotIndex]) {
            if (existingPlayers[ignoreSlotIndex].name === unique) {
                return unique;
            }
        }

        let isDuplicate = false;
        if (existingPlayers && Array.isArray(existingPlayers)) {
            existingPlayers.forEach((p, idx) => {
                if (idx !== ignoreSlotIndex && p && p.name === unique) {
                    isDuplicate = true;
                }
            });
        }

        if (isDuplicate) {
            let suffix = Math.floor(Math.random() * 900 + 100);
            if (typeof AuthEngine !== 'undefined' && AuthEngine.userData && AuthEngine.userData.uid) {
                suffix = String(AuthEngine.userData.uid).slice(-3);
            }
            const newUnique = `${unique}_${suffix}`;
            if (this.onToast) {
                this.onToast(`💡 房间内已有同名玩家，昵称已自动调整为：${newUnique}`, 3500);
            }
            unique = newUnique;
        }

        this.nickname = unique;
        try { localStorage.setItem('youjing_doudizhu_nickname', unique); } catch(e) {}
        const input = document.getElementById('nicknameInput');
        if (input) input.value = unique;

        return unique;
    }

    /* ====================================================================
       拉取云端公共房间列表 (自动清理 >3分钟 无真人操作的过期房间)
       ==================================================================== */
    fetchPublicRooms(callback, gameTypeFilter = 'DOUDIZHU') {
        if (!this.db) {
            if (callback) callback([]);
            return;
        }

        this.db.ref('rooms').limitToLast(30).once('value').then(snapshot => {
            const roomsMap = snapshot.val() || {};
            const activeRooms = [];
            const now = Date.now();

            Object.keys(roomsMap).forEach(roomId => {
                const room = roomsMap[roomId];
                if (room && room.lobbyData) {
                    room.roomId = roomId;
                    const rawPlayers = room.lobbyData.players;
                    const players = Array.isArray(rawPlayers) ? rawPlayers : (rawPlayers ? Object.values(rawPlayers) : []);
                    room.lobbyData.players = players; // 确保标准化为 Array

                    const lastHuman = (typeof room.lastHumanActivity === 'number' && room.lastHumanActivity > 0)
                        ? room.lastHumanActivity
                        : ((typeof room.created === 'number' && room.created > 0) ? room.created : now);
                    const inactiveDuration = now - lastHuman;

                    // 超过 3 分钟无真人操作 -> 自动从云端数据库清除销毁！
                    if (inactiveDuration > MAX_INACTIVE_TIME) {
                        console.log(`[AutoClean] 房间 ${roomId} 超过 3 分钟无真人操作，自动销毁`);
                        this.db.ref('rooms/' + roomId).remove().catch(() => {});
                    } else {
                        const roomGameType = room.gameType || 'DOUDIZHU';
                        const targetFilter = gameTypeFilter || 'DOUDIZHU';

                        if (roomGameType === targetFilter) {
                            activeRooms.push(room);
                        }
                    }
                }
            });

            activeRooms.reverse(); // 最新创建在前
            if (callback) callback(activeRooms);
        }).catch(err => {
            console.error('[CloudEngine] 拉取公开房间列表失败:', err);
            if (callback) callback([]);
        });
    }

    _bindVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            // 当用户切回网页时，重新强行拉取最新云端状态，解决切后台挂起问题！
            if (this.roomRef && !this.isAiMode) {
                this.roomRef.once('value').then(snapshot => {
                    const roomData = snapshot.val();
                    if (!roomData) {
                        // 房间已被销毁（如超过 3 分钟超时）
                        if (this.onToast) this.onToast('⌛ 该房间超过 3 分钟无真人操作已被销毁关闭');
                        this.clearSession();
                        window.location.href = window.location.pathname;
                        return;
                    }

                    const state = roomData.gameState;
                    if (state && this.onStateUpdate) {
                        console.log('[CloudSync] 页面恢复，同步云端最新状态');
                        this.onStateUpdate(state);
                    }
                });
            }
        });
    }

    _removeAllListeners() {
        if (this.roomRef) {
            this.roomRef.off();
            this.roomRef.child('gameState').off();
            this.roomRef.child('lobbyData').off();
            this.roomRef.child('action').off();
            this.roomRef.child('chat').off();
            this.roomRef.child('players').off();
        }
    }

    /* ====================================================================
       创建房间 (作为 Host) - Firebase 云端版 (带连接异常捕获与超时保护)
       ==================================================================== */
    createRoom(nickname, onReady, param3, param4) {
        let roomIdOverride = null;
        let onError = null;
        let gameType = 'DOUDIZHU';

        if (typeof param3 === 'string') {
            roomIdOverride = param3;
            if (typeof param4 === 'string') gameType = param4;
        } else if (typeof param3 === 'function') {
            onError = param3;
            if (typeof param4 === 'string') gameType = param4;
        } else if (typeof param4 === 'string') {
            gameType = param4;
        }

        this.roomId = (typeof roomIdOverride === 'string' && roomIdOverride) ? roomIdOverride : this.generateRoomId();
        this.isHost = true;
        this.myPlayerIndex = 0;
        this.isAiMode = false;
        this.gameType = gameType;

        if (!this.db) {
            if (this.onToast) this.onToast('❌ 云端服务未连接，请检查网络或刷新页面', 4000);
            if (onError) onError('云端服务未连接');
            return;
        }

        // 实施规则 1：创建前先清除同设备的旧房间 (带 1.5 秒超时保护)
        this._leavePreviousRooms(this.roomId, () => {
            this._removeAllListeners();
            this.roomRef = this.db.ref('rooms/' + this.roomId);

            if (this.onToast) this.onToast('☁️ 正在创建云端数据房间...', 2500);

            // 实施规则 3：昵称去重
            const finalNick = this._ensureUniqueNickname(nickname, [], 0);
            const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';

            const isGomoku = gameType === 'GOMOKU';
            const isGo = gameType === 'GO';
            const isXiangqi = gameType === 'XIANGQI';
            const isTwoPlayer = isGomoku || isGo || isXiangqi;
            const initialLobby = {
                players: isTwoPlayer ? [
                    { name: finalNick, avatar: currentAvatar, isAi: false, isHost: true, sid: this.sessionId },
                    { name: 'AI 棋圣', avatar: '🤖', isAi: true, isHost: false }
                ] : [
                    { name: finalNick, avatar: currentAvatar, isAi: false, isHost: true, sid: this.sessionId },
                    { name: 'AI-1', avatar: '🤖', isAi: true, isHost: false },
                    { name: 'AI-2', avatar: '🤖', isAi: true, isHost: false }
                ]
            };

            const now = Date.now();
            const roomPayload = {
                roomId: this.roomId,
                gameType: gameType,
                created: firebase.database.ServerValue.TIMESTAMP,
                lastHumanActivity: now, // 规则 2：记录真人初始活动时间
                hostSid: this.sessionId,
                lobbyData: initialLobby,
                gameState: null,
                action: null,
                chat: null
            };

            this.roomRef.set(roomPayload).then(() => {
                console.log('[CloudEngine] 房主创建云端房间成功 ID:', this.roomId);
                if (onReady) onReady(this.roomId);

                // 监听玩家加入
                this.roomRef.child('lobbyData/players').on('value', snapshot => {
                    const players = snapshot.val();
                    if (!players) return;

                    players.forEach((p, idx) => {
                        if (idx > 0 && !p.isAi && p.name) {
                            if (this.onPlayerJoined) {
                                this.onPlayerJoined(idx, p.name, p.avatar);
                            }
                        }
                    });
                });

                // 房主监听客户端发来的操作指令
                this.roomRef.child('action').on('value', snapshot => {
                    const act = snapshot.val();
                    if (act && act.id && act.id !== this._lastProcessedActionId) {
                        this._lastProcessedActionId = act.id;
                        // 规则 2：接收到真人操作指令，刷新真人活动时间
                        this.roomRef.child('lastHumanActivity').set(Date.now());
                        if (window.GameEngine) {
                            window.GameEngine.handlePlayerAction(act.playerIndex, act.action, act.payload);
                        }
                    }
                });

                // 房主监听快捷聊天
                this.roomRef.child('chat').on('value', snapshot => {
                    const chat = snapshot.val();
                    if (chat && chat.id && chat.id !== this._lastProcessedChatId) {
                        this._lastProcessedChatId = chat.id;
                        this.roomRef.child('lastHumanActivity').set(Date.now());
                        if (window.GameEngine) {
                            window.GameEngine.processChatPhrase(chat.senderIndex, chat.text);
                        }
                    }
                });

            }).catch(err => {
                console.error('[CloudEngine] 创建房间失败:', err);
                const isPermission = err.code === 'PERMISSION_DENIED' || (err.message || '').includes('PERMISSION_DENIED');
                const msg = isPermission
                    ? '❌ 数据库权限被拒绝，请在 Firebase Console → Realtime Database → 规则 中将读写权限改为 true'
                    : `创建云端房间失败: ${err.message}`;
                if (this.onToast) this.onToast(msg, 6000);
            });
        });
    }

    /* ====================================================================
       加入房间 (作为 Client) - Firebase 云端版
       ==================================================================== */
    joinRoom(roomId, nickname, onSuccess, onError) {
        this.roomId   = roomId;
        this.isAiMode = false;

        // 实施规则 1：加入前先清除同设备的旧房间/旧槽位
        this._leavePreviousRooms(roomId, () => {
            this._removeAllListeners();
            this.roomRef = this.db.ref('rooms/' + roomId);

            if (this.onToast) this.onToast('☁️ 正在连接云端服务器...', 4000);

            this.roomRef.once('value').then(snapshot => {
                const roomData = snapshot.val();
                if (!roomData) {
                    if (onError) onError('房间不存在，或超时无真人操作已被销毁');
                    return;
                }
                this.gameType = roomData.gameType || 'DOUDIZHU';

                // 规则 2：检查该房间是否已超 3 分钟无真人操作
                const lastHuman = roomData.lastHumanActivity || roomData.created || 0;
                if (Date.now() - lastHuman > MAX_INACTIVE_TIME) {
                    this.db.ref('rooms/' + roomId).remove();
                    if (onError) onError('该房间超过 3 分钟无真人操作已自动销毁');
                    return;
                }

                const gameType = roomData.gameType || 'DOUDIZHU';
                this.gameType = gameType;
                if (window.GameEngine) {
                    window.GameEngine.activeGameType = gameType;
                }

                const lobby = roomData.lobbyData || { players: [] };
                const players = lobby.players || [];
                const maxSlotIndex = gameType === 'MAHJONG' ? 3 : ((gameType === 'GOMOKU' || gameType === 'GO' || gameType === 'XIANGQI') ? 1 : 2);

                // 查找属于当前玩家的槽位 (0=房主, 1=玩家2, 2=玩家3, 3=玩家4)
                let assignedSlot = -1;

                // 1. 检查是否是房主 (槽位 0) 重连/加入
                // 注意：只有 sid 匹配才认定房主重连；单纯同名不应覆盖房主槽位，
                // 防止不同设备用相同昵称加入时误抢房主身份
                const isHostSidMatch = roomData.hostSid && roomData.hostSid === this.sessionId;
                const isSlot0SidMatch = players[0] && players[0].sid && players[0].sid === this.sessionId;
                if (isHostSidMatch || isSlot0SidMatch) {
                    assignedSlot = 0;
                    this.isHost = true;
                } else {
                    this.isHost = false;

                    // 2. 客户端重连：优先匹配相同 sid
                    for (let i = 1; i <= maxSlotIndex; i++) {
                        if (players[i] && players[i].sid === this.sessionId) {
                            assignedSlot = i;
                            break;
                        }
                    }

                    // 3. 客户端重连：退而求其次匹配相同 nickname (非 AI)
                    if (assignedSlot === -1) {
                        for (let i = 1; i <= maxSlotIndex; i++) {
                            if (players[i] && !players[i].isAi && players[i].name === nickname) {
                                assignedSlot = i;
                                break;
                            }
                        }
                    }

                    // 4. 新玩家加入：查找第一个 AI 候补槽位
                    if (assignedSlot === -1) {
                        for (let i = 1; i <= maxSlotIndex; i++) {
                            if (!players[i] || players[i].isAi) {
                                assignedSlot = i;
                                break;
                            }
                        }
                    }
                }

                if (assignedSlot === -1) {
                    if (onError) onError('房间人数已满！');
                    return;
                }

                // 实施规则 3：昵称去重（传入 assignedSlot 排除玩家自身槽位，避免重连被误判重名加 _2 后缀）
                const finalNick = this._ensureUniqueNickname(nickname, players, assignedSlot);

                this.myPlayerIndex = assignedSlot;
                console.log(`[CloudEngine] 加入房间成功，分配槽位 ${assignedSlot} (${this.isHost ? '房主' : '玩家'})`);

                const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';

                // 更新云端该槽位的玩家信息 + 刷新真人活动时间
                players[assignedSlot] = {
                    name: finalNick,
                    avatar: currentAvatar,
                    isAi: false,
                    isHost: this.isHost,
                    sid: this.sessionId
                };

                this.roomRef.child('lastHumanActivity').set(Date.now());

                return this.roomRef.child('lobbyData/players').set(players).then(() => {
                    // 如果是房主重连，挂载房主监听
                    if (this.isHost) {
                        this.roomRef.child('action').on('value', snap => {
                            const act = snap.val();
                            if (act && act.id && act.id !== this._lastProcessedActionId) {
                                this._lastProcessedActionId = act.id;
                                this.roomRef.child('lastHumanActivity').set(Date.now());
                                if (window.GameEngine) {
                                    window.GameEngine.handlePlayerAction(act.playerIndex, act.action, act.payload);
                                }
                            }
                        });
                    }

                    // 监听全局状态更新
                    this.roomRef.child('gameState').on('value', snap => {
                        const state = snap.val();
                        if (!state && roomData.gameState) {
                            // 房间被物理移除
                            if (this.onToast) this.onToast('⌛ 房间超时关闭');
                            this.clearSession();
                            window.location.href = window.location.pathname;
                            return;
                        }
                        if (state && this.onStateUpdate) {
                            this.onStateUpdate(state);
                        }
                    });

                    // 监听大厅玩家列表同步
                    this.roomRef.child('lobbyData').on('value', snap => {
                        const lData = snap.val();
                        if (lData && this.onLobbySync) {
                            this.onLobbySync(lData);
                        }
                    });

                    // 监听快捷聊天
                    this.roomRef.child('chat').on('value', snap => {
                        const chat = snap.val();
                        if (chat && chat.id && chat.id !== this._lastProcessedChatId) {
                            this._lastProcessedChatId = chat.id;
                            this.roomRef.child('lastHumanActivity').set(Date.now());
                            if (window.GameEngine) {
                                window.GameEngine.processChatPhrase(chat.senderIndex, chat.text);
                            }
                        }
                    });

                    if (onSuccess) onSuccess();
                });

            }).catch(err => {
                console.error('[CloudEngine] 加入房间异常:', err);
                if (onError) onError(`连接异常: ${err.message}`);
            });
        });
    }

    /* ====================================================================
       广播全量游戏状态（写入云端）
       ==================================================================== */
    broadcastState(gameState) {
        if (!this.isHost && !this.isAiMode) return;

        this.saveSession(gameState);

        if (this.onStateUpdate) {
            this.onStateUpdate(gameState);
        }

        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('gameState').set(gameState).catch(err => {
                console.warn('[CloudSync] 写入云端失败:', err);
            });
        }
    }

    /* ====================================================================
       客户端发送指令（写入云端 action 节点，刷新真人活动时间）
       ==================================================================== */
    sendActionToHost(action, payload) {
        if (this.isHost || this.isAiMode) {
            if (window.GameEngine) {
                // 规则 2：真人房主点击按键，刷新真人活动时间
                if (this.roomRef && !this.isAiMode) {
                    this.roomRef.child('lastHumanActivity').set(Date.now());
                }
                window.GameEngine.handlePlayerAction(this.myPlayerIndex, action, payload);
            }
        } else if (this.roomRef) {
            // 规则 2：真人客户端发送动作，刷新真人活动时间
            this.roomRef.child('lastHumanActivity').set(Date.now());

            const actionPayload = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                playerIndex: this.myPlayerIndex,
                action: action,
                payload: payload
            };
            this.roomRef.child('action').set(actionPayload);
        }
    }

    /* ====================================================================
       广播大厅就绪列表（写入云端）
       ==================================================================== */
    broadcastLobbySync(lobbyData) {
        if (!this.isHost && !this.isAiMode) return;
        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('lobbyData').set(lobbyData);
        }
    }

    /* ====================================================================
       广播快捷聊天短语（写入云端）
       ==================================================================== */
    broadcastChatPhrase(senderIndex, text) {
        if (this.roomRef && !this.isAiMode) {
            this.roomRef.child('lastHumanActivity').set(Date.now());
            const chatPayload = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                senderIndex: senderIndex,
                text: text
            };
            this.roomRef.child('chat').set(chatPayload);
        } else if (window.GameEngine) {
            window.GameEngine.processChatPhrase(senderIndex, text);
        }
    }

    /**
     * 主动退出房间 (只要房间内没有其他真人玩家了，无论人机还是对局，立即在 Firebase 销毁移除房间)
     */
    leaveRoom(callback) {
        const finish = () => {
            this.clearSession();
            this._removeAllListeners();
            this.roomId = null;
            if (callback) callback();
        };

        if (!this.db || !this.roomId) {
            finish();
            return;
        }

        const currentRoomId = this.roomId;
        const currentSid = this.sessionId;

        this.db.ref('rooms/' + currentRoomId).once('value').then(snapshot => {
            const roomData = snapshot.val();
            if (!roomData) {
                finish();
                return;
            }

            const players = (roomData.lobbyData && roomData.lobbyData.players) ? roomData.lobbyData.players : [];
            const remainingHumans = players.filter(p => p && !p.isAi && p.sid !== currentSid && p.name);

            if (this.isHost || remainingHumans.length === 0) {
                // 房主退出，或者房间内已无其他真人玩家 -> 瞬间彻底关掉删除房间！
                console.log(`[LeaveRoom] 房间 ${currentRoomId} 内无其他真人玩家，立即彻底关掉销毁`);
                this.db.ref('rooms/' + currentRoomId).remove().then(finish).catch(finish);
            } else {
                // 还有其他真人玩家：仅将本设备槽位重置为 AI
                const updatedPlayers = players.map(p => {
                    if (p && p.sid === currentSid) {
                        return { name: '🤖 机器人 AI', avatar: '🤖', isAi: true, isHost: false };
                    }
                    return p;
                });
                this.db.ref(`rooms/${currentRoomId}/lobbyData/players`).set(updatedPlayers).then(finish).catch(finish);
            }
        }).catch(finish);
    }

    /* ====================================================================
       清除所有 Firebase 云端监听器（退出房间时调用）
       ==================================================================== */
    _removeAllListeners() {
        try {
            if (this.roomRef) {
                this.roomRef.off();
                this.roomRef = null;
            }
        } catch (e) {}
    }
    sendGomokuMove(r, c, color) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').set({
            r,
            c,
            color,
            ts: Date.now()
        });
    }

    sendGomokuTimeout(winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuTimeout').set({
            winnerColor,
            ts: Date.now()
        });
    }

    onGomokuTimeout(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuTimeout').off();
        this.roomRef.child('gomokuTimeout').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    onGomokuMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').off();
        this.roomRef.child('gomokuMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGomokuUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoReq').off();
        this.roomRef.child('gomokuUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGomokuUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuUndoResp').off();
        this.roomRef.child('gomokuUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGomokuRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`gomokuRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onGomokuRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuRematchVotes').off();
        this.roomRef.child('gomokuRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearGomokuRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuRematchVotes').remove();
    }

    sendGomokuClaimBlack(claimedSlot) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').set({
            claimedSlot,
            ts: Date.now()
        });
    }

    onGomokuClaimBlack(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').off();
        this.roomRef.child('gomokuClaimBlack').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearGomokuClaimBlack() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuClaimBlack').remove();
    }

    sendMahjongMove(senderSlot, tileIndex, discardedTile, stateData, actionType = 'DISCARD') {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongLastMove').set({
            senderSlot,
            tileIndex,
            discardedTile,
            stateData,
            actionType,
            ts: Date.now()
        });
    }

    onMahjongMove(callback) {
        if (!this.roomRef) return;
        // 先解除旧监听，避免重开一局时监听器累积/旧闭包误判座位
        this.roomRef.child('mahjongLastMove').off();
        this.roomRef.child('mahjongLastMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearMahjongMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongLastMove').remove();
    }

    clearGomokuMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuMove').remove();
    }

    sendGomokuStart(roomId, hostIsBlack = true) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsBlack
        });
    }

    onGomokuStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('gomokuStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    /* ============================================================
       ⚫⚪ 围棋 (GO) 云端通信方法
       ============================================================ */
    sendGoMove(r, c, color, pass = false) {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').set({
            r, c, color, pass,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    sendGoPass(color) {
        this.sendGoMove(-1, -1, color, true);
    }

    onGoMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').off();
        this.roomRef.child('goMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearGoMoves() {
        if (!this.roomRef) return;
        this.roomRef.child('goMove').remove();
    }

    sendGoStart(roomId, hostIsBlack = true) {
        if (!this.roomRef) return;
        this.roomRef.child('goStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsBlack
        });
    }

    onGoStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoEnd(reason, winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('goEnd').set({
            reason,
            winnerColor,
            ts: Date.now()
        });
    }

    onGoEnd(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goEnd').off();
        this.roomRef.child('goEnd').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGoUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoReq').off();
        this.roomRef.child('goUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onGoUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goUndoResp').off();
        this.roomRef.child('goUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendGoRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`goRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onGoRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('goRematchVotes').off();
        this.roomRef.child('goRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearGoRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('goRematchVotes').remove();
    }

    /* ============================================================
       ♞ 中国象棋 (XIANGQI) 云端通信方法
       ============================================================ */
    sendXiangqiMove(fr, fc, tr, tc) {
        if (!this.roomRef) return;
        this.roomRef.child('xqMove').set({
            fr, fc, tr, tc,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiMove(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqMove').off();
        this.roomRef.child('xqMove').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiStart(roomId, hostIsRed = true) {
        if (!this.roomRef) return;
        this.roomRef.child('xqStart').set({
            ts: Date.now(),
            hostNick: this.nickname,
            hostIsRed
        });
    }

    onXiangqiStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiEnd(reason, winnerColor) {
        if (!this.roomRef) return;
        this.roomRef.child('xqEnd').set({
            reason,
            winnerColor,
            ts: Date.now()
        });
    }

    onXiangqiEnd(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqEnd').off();
        this.roomRef.child('xqEnd').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiUndoRequest(applicantNick) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoReq').set({
            applicantNick,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiUndoRequest(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoReq').off();
        this.roomRef.child('xqUndoReq').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiUndoResponse(approved) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoResp').set({
            approved,
            senderSlot: this.myPlayerIndex,
            ts: Date.now()
        });
    }

    onXiangqiUndoResponse(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqUndoResp').off();
        this.roomRef.child('xqUndoResp').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendXiangqiRematchVote(ready) {
        if (!this.roomRef || this.myPlayerIndex === null) return;
        this.roomRef.child(`xqRematchVotes/${this.myPlayerIndex}`).set({
            ready,
            ts: Date.now()
        });
    }

    onXiangqiRematchVote(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('xqRematchVotes').off();
        this.roomRef.child('xqRematchVotes').on('value', snap => {
            const val = snap.val();
            if (callback) callback(val || {});
        });
    }

    clearXiangqiRematchVotes() {
        if (!this.roomRef) return;
        this.roomRef.child('xqRematchVotes').remove();
    }

    sendMahjongStart(roomId) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongStart').set({
            ts: Date.now(),
            hostNick: this.nickname
        });
    }

    onMahjongStart(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongStart').off();
        this.roomRef.child('mahjongStart').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendMahjongInitState(stateData) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongInitData').set(stateData);
    }

    onMahjongInitState(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongInitData').off();
        this.roomRef.child('mahjongInitData').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    sendMahjongRematchStatus(status) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').set(status);
    }

    onMahjongRematchStatus(callback) {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').off();
        this.roomRef.child('mahjongRematchStatus').on('value', snap => {
            const val = snap.val();
            if (val && callback) callback(val);
        });
    }

    clearMahjongRematchStatus() {
        if (!this.roomRef) return;
        this.roomRef.child('mahjongRematchStatus').remove();
    }
}

const NetworkManager = new P2PManager();

/* ===== js/auth.js ===== */
/* ==========================================================================
   用户认证与个人战绩管理系统 (Firebase Realtime Database Direct Engine)
   因币资产 (Yin Coins) + 每日登录活跃自动静默发放 100 因币 (0点刷新)
   ========================================================================== */

/**
 * 敏感字符过滤与昵称安全化函数
 * 自动强行剔除：乃、奶、坚、cnj（不区分大小写）、nj（不区分大小写）
 */
window.sanitizeNickname = function(nick) {
    if (!nick) return '';
    let clean = String(nick).replace(/乃|奶|坚|cnj|nj/gi, '').trim();
    if (!clean) {
        clean = '玩家_' + Math.floor(100 + Math.random() * 900);
    }
    return clean;
};

class AuthManager {
    constructor() {
        this.db = null;
        this.user = null;
        this.userData = null;
        this.onAuthChanged = null;

        this._initDB();
    }

    _initDB() {
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                this.db = firebase.database();
            } catch (e) {
                this.db = null;
            }
            if (this.db) {
                this.checkAutoLogin();
                this._onDbReady();
                return;
            }
        }
        setTimeout(() => this._initDB(), 400);
    }

    /**
     * 云端数据库就绪回调: 刷新顶部排行榜 (SDK 异步加载完成后自动触发)
     */
    _onDbReady() {
        if (typeof window.GameEngine !== 'undefined' && window.GameEngine) {
            try {
                if (typeof window.GameEngine.renderMiniLeaderboard === 'function') {
                    window.GameEngine.renderMiniLeaderboard();
                }
            } catch (e) {}
        }
    }

    /* 获取当天日期字符串 (YYYY-MM-DD，每天0点刷新) */
    getTodayDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /* 账号 Key 安全转义 (去除 Firebase 禁止字符) */
    _encodeKey(str) {
        return (str || '').trim().toLowerCase().replace(/[\.\$\#\[\]\/]/g, '_');
    }

    /* ====================================================================
       自动补全与追溯历史账号的数字 UID (从 10001 开始按注册时间递增)
       ==================================================================== */
    _assignUidsToExistingUsers(callback) {
        if (!this.db) {
            if (callback) callback(0);
            return;
        }

        this.db.ref('users').once('value').then(snap => {
            const usersMap = snap.val() || {};
            const usersList = Object.keys(usersMap).map(k => usersMap[k]);

            // 按注册创建时间升序排序 (未带 created 的按 0 处理)
            usersList.sort((a, b) => (a.created || 0) - (b.created || 0));

            const updatePromises = [];
            usersList.forEach((user, idx) => {
                const assignedUid = 10001 + idx;
                if (!user.uid || user.uid !== assignedUid) {
                    user.uid = assignedUid;
                    if (user.accountKey) {
                        updatePromises.push(this.db.ref('users/' + user.accountKey + '/uid').set(assignedUid));
                    }
                }
            });

            Promise.all(updatePromises).then(() => {
                if (callback) callback(usersList.length);
            }).catch(() => {
                if (callback) callback(usersList.length);
            });
        }).catch(() => {
            if (callback) callback(0);
        });
    }

    /* ====================================================================
       自动静默领取每日 100 因币 (像 B站 一样：检测到账号今天活跃直接发放)
       ==================================================================== */
    checkAndAutoClaimDailyReward() {
        if (!this.userData || !this.db || !this.userData.accountKey) return;

        const today = this.getTodayDateString();

        // 已经领过今天的福利，无需重复发放
        if (this.userData.lastClaimDate === today) return;

        const accountKey = this.userData.accountKey;
        const newYinCoins = (this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000) + 200;

        // 记录发放状态
        this.userData.lastClaimDate = today;
        this.userData.yinCoins = newYinCoins;

        this.db.ref('users/' + accountKey).update({
            yinCoins: newYinCoins,
            lastClaimDate: today
        }).then(() => {
            this.updateUserHeaderUI();
            if (typeof UIRenderer !== 'undefined') {
                UIRenderer.showToast(`🎁 检测到今日活跃，已自动发放今日福利：+200 知因币！(累计: ${newYinCoins})`, 4000);
            }
        }).catch(() => {});
    }

    /* ====================================================================
       自动登录恢复 (从 localStorage 恢复已登录账号)
       ==================================================================== */
    checkAutoLogin() {
        const savedAccountKey = localStorage.getItem('youjing_doudizhu_account_key');
        if (savedAccountKey && this.db) {
            this.db.ref('users/' + savedAccountKey).once('value').then(snap => {
                const data = snap.val();
                if (data) {
                    // 数据兼容：如果旧数据只有 coins/score，自动迁移到 yinCoins
                    if (data.yinCoins === undefined) {
                        data.yinCoins = data.coins || 1000;
                    }
                    // 补全旧账号缺失的 UID
                    if (!data.uid) {
                        this._assignUidsToExistingUsers(() => {
                            this.db.ref('users/' + savedAccountKey).once('value').then(s2 => {
                                this.userData = s2.val() || data;
                                this.checkAndAutoClaimDailyReward();
                                this.updateUserHeaderUI();
                            });
                        });
                    }
                    // 检查并清洗已存在账号的敏感字符 (乃, 坚, cnj, nj)
                    if (data.nickname) {
                        const cleanNick = window.sanitizeNickname(data.nickname);
                        if (cleanNick !== data.nickname) {
                            console.log('[Sanitize] 已屏蔽敏感词，自动更新旧昵称:', data.nickname, '->', cleanNick);
                            data.nickname = cleanNick;
                            this.db.ref('users/' + savedAccountKey + '/nickname').set(cleanNick);
                        }
                    }
                    this.userData = data;
                    this.user = { uid: savedAccountKey };
                    localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
                    const input = document.getElementById('nicknameInput');
                    if (input) input.value = data.nickname;
                    if (this.onAuthChanged) this.onAuthChanged(this.user, data);
                    
                    // 自动发放今日活跃 100 因币
                    this.checkAndAutoClaimDailyReward();
                    this.updateUserHeaderUI();
                }
            }).catch(() => {});
        } else {
            this.updateUserHeaderUI();
        }
    }

    /* 格式化 QQ 邮箱 / 普通账号 */
    _formatEmail(inputStr) {
        let trimmed = (inputStr || '').trim();
        if (/^\d+$/.test(trimmed)) return `${trimmed}@qq.com`;
        if (!trimmed.includes('@')) return `${trimmed}@qq.com`;
        return trimmed;
    }

    /* ====================================================================
       专用测试账号 09966 / 09966 特殊快速登录与自动创建逻辑
       ==================================================================== */
    _handleTestAccountLogin(onSuccess, onError) {
        const testAccountKey = '09966_qq_com';
        const today = this.getTodayDateString();
        const testData = {
            uid: 9966,
            accountKey: testAccountKey,
            email: '09966@qq.com',
            password: '09966',
            nickname: '测试账号 09966',
            avatar: '⚡',
            yinCoins: 99999,
            lastClaimDate: today,
            totalGames: 99,
            wins: 66,
            landlordWins: 33,
            farmerWins: 33,
            bombsPlayed: 88,
            created: Date.now()
        };

        const completeLogin = (data) => {
            this.userData = data;
            this.user = { uid: testAccountKey };
            localStorage.setItem('youjing_doudizhu_account_key', testAccountKey);
            localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = data.nickname;

            this.checkAndAutoClaimDailyReward();
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(data);
        };

        if (!this.db) {
            completeLogin(testData);
            return;
        }

        this.db.ref('users/' + testAccountKey).once('value').then(snap => {
            if (snap.exists()) {
                const data = snap.val();
                completeLogin(data);
            } else {
                this.db.ref('users/' + testAccountKey).set(testData).then(() => {
                    completeLogin(testData);
                }).catch(() => {
                    completeLogin(testData);
                });
            }
        }).catch(() => {
            completeLogin(testData);
        });
    }

    /* ====================================================================
       账号密码注册 (自动计算递增 UID，初始赠送 1000 因币)
       ==================================================================== */
    registerWithEmail(inputAccount, password, nickname, onSuccess, onError) {
        const cleanInput = (inputAccount || '').trim();
        if ((cleanInput === '09966' || cleanInput === '09966@qq.com') && password === '09966') {
            this._handleTestAccountLogin(onSuccess, onError);
            return;
        }

        if (!this.db) {
            if (onError) onError('云端服务未连接，请刷新页面重试');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const accountKey = this._encodeKey(email);
        let nick = window.sanitizeNickname(nickname || '斗地主高手');

        if (!password || password.length < 6) {
            if (onError) onError('密码长度至少需要 6 位');
            return;
        }

        // 检查账号是否已被注册
        this.db.ref('users/' + accountKey).once('value').then(snap => {
            if (snap.exists()) {
                if (onError) onError('该 QQ 邮箱/账号已被注册！');
                return;
            }

            // 计算全局累积玩家数量，自动生成按时间递增的 UID
            this._assignUidsToExistingUsers((totalUsersCount) => {
                const assignedUid = 10001 + totalUsersCount;
                const nowTs = Date.now();
                const today = this.getTodayDateString();

                const initialData = {
                    uid: assignedUid,        // 专属递增数字 UID
                    accountKey: accountKey,
                    email: email,
                    password: password,
                    nickname: nick,
                    avatar: '🤠',
                    yinCoins: 1000,          // 默认新注册就赠送 1000 因币
                    lastClaimDate: today,    // 注册当天标记为已自动获得今日因币
                    totalGames: 0,
                    wins: 0,
                    landlordWins: 0,
                    farmerWins: 0,
                    bombsPlayed: 0,
                    created: nowTs           // 记录精准注册时间戳
                };

                return this.db.ref('users/' + accountKey).set(initialData).then(() => {
                    this.userData = initialData;
                    this.user = { uid: accountKey };
                    localStorage.setItem('youjing_doudizhu_account_key', accountKey);
                    localStorage.setItem('youjing_doudizhu_nickname', nick);
                    const input = document.getElementById('nicknameInput');
                    if (input) input.value = nick;
                    this.updateUserHeaderUI();
                    if (onSuccess) onSuccess(initialData);
                });
            });
        }).catch(err => {
            console.error('[Auth] 注册失败:', err);
            if (onError) onError('注册失败: ' + err.message);
        });
    }

    /* ====================================================================
       账号密码登录
       ==================================================================== */
    loginWithEmail(inputAccount, password, onSuccess, onError) {
        const cleanInput = (inputAccount || '').trim();
        if ((cleanInput === '09966' || cleanInput === '09966@qq.com') && password === '09966') {
            this._handleTestAccountLogin(onSuccess, onError);
            return;
        }

        if (!this.db) {
            if (onError) onError('云端服务未连接，请刷新页面重试');
            return;
        }

        const email = this._formatEmail(inputAccount);
        const accountKey = this._encodeKey(email);

        this.db.ref('users/' + accountKey).once('value').then(snap => {
            const data = snap.val();
            if (!data) {
                if (onError) onError('账号不存在，请先注册');
                return;
            }

            if (data.password !== password) {
                if (onError) onError('密码错误，请检查后再试');
                return;
            }

            if (data.yinCoins === undefined) {
                data.yinCoins = data.coins || 1000;
            }

            // 检查并清洗已存在账号的敏感字符 (乃, 坚, cnj, nj)
            if (data.nickname) {
                const cleanNick = window.sanitizeNickname(data.nickname);
                if (cleanNick !== data.nickname) {
                    console.log('[Sanitize] 已屏蔽敏感词，自动更新旧昵称:', data.nickname, '->', cleanNick);
                    data.nickname = cleanNick;
                    this.db.ref('users/' + accountKey + '/nickname').set(cleanNick);
                }
            }

            this.userData = data;
            this.user = { uid: accountKey };
            localStorage.setItem('youjing_doudizhu_account_key', accountKey);
            localStorage.setItem('youjing_doudizhu_nickname', data.nickname);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = data.nickname;

            // 登录成功，自动检查发放今日 100 因币
            this.checkAndAutoClaimDailyReward();

            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(data);
        }).catch(err => {
            console.error('[Auth] 登录失败:', err);
            if (onError) onError('登录失败: ' + err.message);
        });
    }

    /* ====================================================================
       退出登录
       ==================================================================== */
    logout(onSuccess) {
        this.userData = null;
        this.user = null;
        localStorage.removeItem('youjing_doudizhu_account_key');
        this.updateUserHeaderUI();
        if (onSuccess) onSuccess();
    }

    /* 检查今天是否可以修改昵称 (每天限改1次) */
    canRenameToday() {
        if (!this.userData) return false;
        const today = this.getTodayDateString();
        return this.userData.lastRenameDate !== today;
    }

    /* 修改玩家昵称 (每天限1次) */
    changeNickname(newNickname, onSuccess, onError) {
        if (!this.userData || !this.db || !this.userData.accountKey) {
            if (onError) onError('请先登录账号后再修改昵称');
            return;
        }

        if (!this.canRenameToday()) {
            if (onError) onError('每天只能修改一次昵称，明天0点后可再次修改');
            return;
        }

        let nick = window.sanitizeNickname(newNickname);
        if (!nick || nick.length > 10) {
            if (onError) onError('改名后有效字符不能为空且不能超过 10 个字符');
            return;
        }

        const today = this.getTodayDateString();
        const accountKey = this.userData.accountKey;

        this.db.ref('users/' + accountKey).update({
            nickname: nick,
            lastRenameDate: today
        }).then(() => {
            this.userData.nickname = nick;
            this.userData.lastRenameDate = today;
            localStorage.setItem('youjing_doudizhu_nickname', nick);
            const input = document.getElementById('nicknameInput');
            if (input) input.value = nick;
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(nick);
        }).catch(err => {
            if (onError) onError('修改昵称失败：' + err.message);
        });
    }

    /* 更换玩家头像 */
    changeAvatar(newAvatar, onSuccess, onError) {
        if (!this.userData || !this.db || !this.userData.accountKey) {
            if (onError) onError('请先登录账号后再更换头像');
            return;
        }

        const avatar = (newAvatar || '🤠').trim();
        const accountKey = this.userData.accountKey;

        this.db.ref('users/' + accountKey).update({
            avatar: avatar
        }).then(() => {
            this.userData.avatar = avatar;
            this.updateUserHeaderUI();
            if (onSuccess) onSuccess(avatar);
        }).catch(err => {
            if (onError) onError('更换头像失败：' + err.message);
        });
    }

    /* ====================================================================
       更新比赛战绩（只记录对局输赢，暂不扣除/加因币）
       ==================================================================== */
    updateStats(isWin, role, bombsCount, multiplier) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const isLandlord  = (role === 'LANDLORD');
        const newTotal = (this.userData.totalGames || 0) + 1;
        const newWins  = (this.userData.wins || 0) + (isWin ? 1 : 0);
        const newLWins = (this.userData.landlordWins || 0) + (isWin && isLandlord ? 1 : 0);
        const newFWins = (this.userData.farmerWins || 0) + (isWin && !isLandlord ? 1 : 0);
        const newBombs = (this.userData.bombsPlayed || 0) + (bombsCount || 0);

        const historyItem = {
            id: Date.now(),
            isWin: isWin,
            role: isLandlord ? '资本家' : '牛马',
            multiplier: multiplier || 1,
            bombs: bombsCount || 0,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        const currentHistory = Array.isArray(this.userData.matchHistory) ? this.userData.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const updatePayload = {
            totalGames: newTotal,
            wins: newWins,
            landlordWins: newLWins,
            farmerWins: newFWins,
            bombsPlayed: newBombs,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey).update(updatePayload).then(() => {
            Object.assign(this.userData, updatePayload);
            this.updateUserHeaderUI();
        });
    }

    /**
     * 独立记录五子棋战绩 (胜、负、平，与斗地主战绩隔离)
     */
    recordGomokuMatchResult(isWin, isDraw = false) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const currentGomoku = this.userData.gomokuStats || {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchHistory: []
        };

        const newTotal = (currentGomoku.totalGames || 0) + 1;
        const newWins = (currentGomoku.wins || 0) + (isWin ? 1 : 0);
        const newDraws = (currentGomoku.draws || 0) + (isDraw ? 1 : 0);
        const newLosses = (currentGomoku.losses || 0) + (!isWin && !isDraw ? 1 : 0);

        let roleText = isWin ? '五子连珠' : (isDraw ? '盘满平局' : '败局');
        const historyItem = {
            id: Date.now(),
            gameType: 'GOMOKU',
            isWin: isWin,
            isDraw: isDraw,
            role: roleText,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };

        const currentHistory = Array.isArray(currentGomoku.matchHistory) ? currentGomoku.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const newGomokuStats = {
            totalGames: newTotal,
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey + '/gomokuStats').set(newGomokuStats).then(() => {
            if (!this.userData.gomokuStats) this.userData.gomokuStats = {};
            Object.assign(this.userData.gomokuStats, newGomokuStats);
        }).catch(() => {});
    }

    /**
     * 独立记录围棋战绩 (胜、负、平，与斗地主/五子棋战绩隔离)
     */
    recordGoMatchResult(isWin, isDraw = false) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const currentGo = this.userData.goStats || {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchHistory: []
        };

        const newTotal = (currentGo.totalGames || 0) + 1;
        const newWins = (currentGo.wins || 0) + (isWin ? 1 : 0);
        const newDraws = (currentGo.draws || 0) + (isDraw ? 1 : 0);
        const newLosses = (currentGo.losses || 0) + (!isWin && !isDraw ? 1 : 0);

        let roleText = isWin ? '黑白纵横' : (isDraw ? '平局' : '败局');
        const historyItem = {
            id: Date.now(),
            gameType: 'GO',
            isWin: isWin,
            isDraw: isDraw,
            role: roleText,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };

        const currentHistory = Array.isArray(currentGo.matchHistory) ? currentGo.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const newGoStats = {
            totalGames: newTotal,
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey + '/goStats').set(newGoStats).then(() => {
            if (!this.userData.goStats) this.userData.goStats = {};
            Object.assign(this.userData.goStats, newGoStats);
        }).catch(() => {});
    }

    /**
     * 独立记录象棋战绩
     */
    recordXiangqiMatchResult(isWin, isDraw = false) {
        if (!this.userData || !this.db || !this.userData.accountKey) return;
        const accountKey = this.userData.accountKey;

        const currentXq = this.userData.xqStats || {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchHistory: []
        };

        const newTotal = (currentXq.totalGames || 0) + 1;
        const newWins = (currentXq.wins || 0) + (isWin ? 1 : 0);
        const newDraws = (currentXq.draws || 0) + (isDraw ? 1 : 0);
        const newLosses = (currentXq.losses || 0) + (!isWin && !isDraw ? 1 : 0);

        const roleText = isWin ? '楚河汉界' : (isDraw ? '平局' : '败局');
        const historyItem = {
            id: Date.now(),
            gameType: 'XIANGQI',
            isWin: isWin,
            isDraw: isDraw,
            role: roleText,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };

        const currentHistory = Array.isArray(currentXq.matchHistory) ? currentXq.matchHistory : [];
        const newHistory = [historyItem, ...currentHistory].slice(0, 10);

        const newXqStats = {
            totalGames: newTotal,
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            matchHistory: newHistory
        };

        this.db.ref('users/' + accountKey + '/xqStats').set(newXqStats).then(() => {
            if (!this.userData.xqStats) this.userData.xqStats = {};
            Object.assign(this.userData.xqStats, newXqStats);
        }).catch(() => {});
    }

    /* ====================================================================
       获取全网因币资产排行榜 Top 10
       ==================================================================== */
    fetchLeaderboard(callback) {
        const CACHE_KEY = 'yj_lb_cache_v1';
        const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存, 避免每次全量下载 /users

        const readCache = () => {
            try {
                const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
                if (c && c.ts && Date.now() - c.ts < CACHE_TTL && Array.isArray(c.list)) {
                    return c.list;
                }
            } catch (e) {}
            return null;
        };

        // 云端未就绪: 先给缓存 (如有), 否则回调 null 表示加载中
        if (!this.db) {
            const cached = readCache();
            if (cached) {
                if (callback) callback(cached);
            } else if (callback) {
                callback(null);
            }
            return;
        }

        // 有新鲜缓存先秒出, 后台静默刷新 (不再二次回调避免走马灯闪烁)
        let servedCache = false;
        const cached = readCache();
        if (cached) {
            servedCache = true;
            if (callback) callback(cached);
        }

        // 8 秒超时兜底: 云端查询极慢/挂起时不再无限"加载中", 降级为提示 (游戏不受影响)
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            console.warn('[Auth] 排行榜查询超时(8s), 降级处理');
            if (callback && !servedCache) callback(null);
        }, 8000);

        this.db.ref('users').orderByChild('yinCoins').limitToLast(15).once('value').then(snap => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            const map = snap.val() || {};
            const list = [];
            Object.keys(map).forEach(key => {
                const u = map[key];
                if (u && u.accountKey !== '09966_qq_com' && u.uid !== 9966 && u.email !== '09966@qq.com') {
                    list.push(u);
                }
            });
            list.sort((a, b) => (b.yinCoins || 0) - (a.yinCoins || 0));
            const top10 = list.slice(0, 10);
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list: top10 }));
            } catch (e) {}
            if (callback && !servedCache) callback(top10);
        }).catch(err => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            console.error('[Auth] 排行榜加载失败:', err);
            if (callback && !servedCache) callback([]);
        });
    }

    /**
     * 计算当前等级升级所需经验 (满级 60 级，渐进指数曲线：前20级升阶轻松，后续越升越难)
     */
    getReqExp(level) {
        if (level >= 60) return Infinity;
        return Math.floor(100 * Math.pow(level, 1.45));
    }

    /**
     * 获取等级专属尊号徽章
     */
    getLevelTitle(level) {
        if (level >= 60) return '👑 终极雀皇';
        if (level >= 50) return '⚡ 绝世传说';
        if (level >= 40) return '🌟 棋牌宗师';
        if (level >= 30) return '👑 胜率大师';
        if (level >= 20) return '🔥 牌场高手';
        if (level >= 10) return '🗡️ 竞技客';
        return '🌱 牌坛新手';
    }

    /**
     * 增加经验值并处理升级逻辑 (支持自动连续升级与升级知因币大礼包)
     */
    addExp(expGain, reason = '') {
        if (!this.userData) return;
        const currentLevel = this.userData.level || 1;
        const currentExp = this.userData.exp || 0;
        if (currentLevel >= 60) return;

        let newExp = currentExp + expGain;
        let newLevel = currentLevel;
        let totalCoinBonus = 0;
        let didLevelUp = false;

        while (newLevel < 60) {
            const req = this.getReqExp(newLevel);
            if (newExp >= req) {
                newExp -= req;
                newLevel++;
                didLevelUp = true;
                totalCoinBonus += (newLevel * 30);
            } else {
                break;
            }
        }

        if (newLevel >= 60) {
            newLevel = 60;
            newExp = 0;
        }

        this.userData.level = newLevel;
        this.userData.exp = newExp;

        if (this.db && this.userData.accountKey) {
            this.db.ref('users/' + this.userData.accountKey).update({
                level: newLevel,
                exp: newExp
            });
        }

        this.updateUserHeaderUI();

        if (reason && typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast(`⭐ 经验 +${expGain}`);
        }

        if (didLevelUp) {
            this.updateCoins(totalCoinBonus, `升级 Lv.${newLevel} 福利`);
            this.queuePendingLevelUpNotice(currentLevel, newLevel, totalCoinBonus);
        }
    }

    /**
     * 缓存升级提醒 (延迟到玩家回到大厅主页时展示，不在房间内弹窗)
     */
    queuePendingLevelUpNotice(oldLv, newLv, coinBonus) {
        const title = this.getLevelTitle(newLv);
        this._pendingLevelUpNotice = { oldLv, newLv, coinBonus, title };
    }

    /**
     * 玩家回到主页大厅时触发精简版升级提示 (免手动点击确认)
     */
    checkAndShowPendingLevelUp() {
        if (!this._pendingLevelUpNotice) return;
        const notice = this._pendingLevelUpNotice;
        this._pendingLevelUpNotice = null;

        if (typeof SoundEngine !== 'undefined' && SoundEngine.playWin) SoundEngine.playWin();

        if (typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast(`🎉 恭喜升级到 Lv.${notice.newLv} (${notice.title})！已获赠 +${notice.coinBonus} 知因币！`, 5000);
        }
    }

    /**
     * 更新/结算玩家【知因币】资产 (支持增加正值、扣除负值，强制带零分保底保值)
     */
    updateCoins(deltaCoins, reason = '') {
        if (!this.userData) return 0;

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        let newCoins = currentCoins + deltaCoins;

        // 🛡️ 零分保底法则：绝不产生负数积分
        if (newCoins < 0) newCoins = 0;

        this.userData.yinCoins = newCoins;

        if (this.db && this.userData.accountKey) {
            this.db.ref('users/' + this.userData.accountKey + '/yinCoins').set(newCoins);
        }

        this.updateUserHeaderUI();

        if (reason && typeof UIRenderer !== 'undefined') {
            const sign = deltaCoins >= 0 ? '+' : '';
            if (deltaCoins >= 0) {
                UIRenderer.showToast(`🪙 获得 +${deltaCoins} 知因币`);
            } else {
                UIRenderer.showToast(`🪙 消耗 ${deltaCoins} 知因币`);
            }
        }

        return newCoins;
    }

    /**
     * 校验并扣除游戏开局【对局入场费】
     * 五子棋: 10 币 (PVE 3 币)
     * 斗地主: 20 币 (PVE 5 币)
     * 麻将:   30 币 (PVE 8 币)
     */
    checkAndDeductEntryFee(gameType = 'DOUDIZHU', isPve = false) {
        if (!this.userData) return true;
        const now = Date.now();
        if (this._lastDeductTs && (now - this._lastDeductTs < 4000) && this._lastDeductGameType === gameType) {
            return true;
        }

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        let fee = 20;
        if (isPve) {
            fee = 1; // 人机局切磋统一固定仅收 1 知因币！
        } else if (gameType === 'GOMOKU') {
            fee = 10;
        } else if (gameType === 'GO') {
            fee = 10;
        } else if (gameType === 'XIANGQI') {
            fee = 10;
        } else if (gameType === 'MAHJONG') {
            fee = 30;
        } else {
            fee = 20;
        }

        if (currentCoins < fee) {
            if (typeof UIRenderer !== 'undefined') {
                UIRenderer.showToast(`⚠️ 知因币不足！开启对局需缴发入场费 ${fee} 币 (当前余额: ${currentCoins})`, 4000);
            }
            if (currentCoins < 50) {
                this.claimBankruptcyAid();
            }
            return false;
        }

        this._lastDeductTs = now;
        this._lastDeductGameType = gameType;
        this.updateCoins(-fee, `对局入场费 (-${fee}币)`);
        return true;
    }

    /**
     * 领取破产救济金 (+100 知因币，每天限 3 次)
     */
    claimBankruptcyAid() {
        if (!this.userData) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('⚠️ 请先登录账号再领取破产补助！');
            return false;
        }

        const currentCoins = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
        if (currentCoins >= 50) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('💡 知因币余额仍充足 (≥50)，暂无需领取破产补助');
            return false;
        }

        const today = this.getTodayDateString();
        const countKey = 'bankruptcyCount_' + today;

        let claimCount = (this.userData[countKey] || 0);
        if (claimCount >= 3) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('🛑 今日 3 次破产补助额度已用完，明天 0点 自动恢复！');
            return false;
        }

        claimCount += 1;
        this.userData[countKey] = claimCount;
        this.updateCoins(150, `破产补助 ${claimCount}/3`);

        if (this.db && this.userData.accountKey) {
            this.db.ref('users/' + this.userData.accountKey + '/' + countKey).set(claimCount);
        }
        return true;
    }

    /* ====================================================================
       刷新顶部栏与大厅用户信息组件
       ==================================================================== */
    updateUserHeaderUI() {
        const badge = document.getElementById('userHeaderBadge');
        const lAuthAvatar = document.getElementById('lobbyAuthAvatar');
        const lUserNick = document.getElementById('lobbyUserNick');
        const lUserSub  = document.getElementById('lobbyUserSub');
        const lBtnAuth  = document.getElementById('btnLobbyAuth');
        const gAuthAvatar = document.getElementById('gomokuAuthAvatar');
        const gUserNick = document.getElementById('gomokuUserNick');
        const gUserSub  = document.getElementById('gomokuUserSub');
        const gBtnAuth  = document.getElementById('btnGomokuAuth');
        const goAuthAvatar = document.getElementById('goAuthAvatar');
        const goUserNick = document.getElementById('goUserNick');
        const goUserSub  = document.getElementById('goUserSub');
        const goBtnAuth  = document.getElementById('btnGoAuth');
        const xqAuthAvatar = document.getElementById('xqAuthAvatar');
        const xqUserNick = document.getElementById('xqUserNick');
        const xqUserSub  = document.getElementById('xqUserSub');
        const xqBtnAuth  = document.getElementById('btnXqAuth');
        const mAuthAvatar = document.getElementById('mahjongAuthAvatar');
        const mUserNick = document.getElementById('mahjongUserNick');
        const mUserSub  = document.getElementById('mahjongUserSub');
        const mBtnAuth  = document.getElementById('btnMahjongAuth');
        const nickSec   = document.querySelector('.nickname-section');

        if (this.userData) {
            const currentYin = this.userData.yinCoins !== undefined ? this.userData.yinCoins : 1000;
            const level = this.userData.level || 1;
            const title = this.getLevelTitle(level);

            const setAvatarWithLevel = (el, emojiStr) => {
                if (!el) return;
                el.style.position = 'relative';
                el.innerHTML = `<span>${emojiStr}</span><div class="avatar-level-tag">${level}</div>`;
            };

            if (badge) {
                badge.innerHTML = `
                    <div style="position:relative;display:inline-flex;align-items:center;justify-content:center;">
                        <span class="user-avatar-text">${this.userData.avatar || '🤠'}</span>
                        <div class="avatar-level-tag">${level}</div>
                    </div>
                    <div class="user-header-info">
                        <span class="user-header-nick">${this.userData.nickname}</span>
                        <span class="user-header-score">🪙 ${currentYin} 知因币</span>
                    </div>
                `;
            }
            setAvatarWithLevel(lAuthAvatar, this.userData.avatar || '🤠');
            if (lUserNick)   lUserNick.textContent   = this.userData.nickname;
            if (lUserSub)    lUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (lBtnAuth)    lBtnAuth.textContent    = '个人信息';

            setAvatarWithLevel(gAuthAvatar, this.userData.avatar || '🤠');
            if (gUserNick)   gUserNick.textContent   = this.userData.nickname;
            if (gUserSub)    gUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (gBtnAuth)    gBtnAuth.textContent    = '个人信息';

            setAvatarWithLevel(goAuthAvatar, this.userData.avatar || '🤠');
            if (goUserNick)  goUserNick.textContent  = this.userData.nickname;
            if (goUserSub)   goUserSub.textContent   = `🪙 知因币: ${currentYin}`;
            if (goBtnAuth)   goBtnAuth.textContent   = '个人信息';

            setAvatarWithLevel(xqAuthAvatar, this.userData.avatar || '🤠');
            if (xqUserNick)  xqUserNick.textContent  = this.userData.nickname;
            if (xqUserSub)   xqUserSub.textContent   = `🪙 知因币: ${currentYin}`;
            if (xqBtnAuth)   xqBtnAuth.textContent   = '个人信息';

            setAvatarWithLevel(mAuthAvatar, this.userData.avatar || '🤠');
            if (mUserNick)   mUserNick.textContent   = this.userData.nickname;
            if (mUserSub)    mUserSub.textContent    = `🪙 知因币: ${currentYin}`;
            if (mBtnAuth)    mBtnAuth.textContent    = '个人信息';

            // 登录后隐去随机昵称区块，避免误导
            if (nickSec) nickSec.style.display   = 'none';

            // 保持 nicknameInput 与账号昵称严格同步
            const input = document.getElementById('nicknameInput');
            if (input) input.value = this.userData.nickname;
        } else {
            if (badge) {
                badge.innerHTML = `
                    <i class="fa-solid fa-circle-user" style="font-size:1.2rem;color:#ffd700;"></i>
                    <span style="font-size:0.8rem;font-weight:700;color:#fff;">登录 / 注册</span>
                `;
            }
            if (lAuthAvatar) lAuthAvatar.textContent = '👤';
            if (lUserNick)   lUserNick.textContent   = '未登录 (游客)';
            if (lUserSub)    lUserSub.textContent    = '🪙 知因币: 0';
            if (lBtnAuth)    lBtnAuth.textContent    = '登录 / 注册';

            if (gAuthAvatar) gAuthAvatar.textContent = '👤';
            if (gUserNick)   gUserNick.textContent   = '未登录 (游客)';
            if (gUserSub)    gUserSub.textContent    = '🪙 知因币: 0';
            if (gBtnAuth)    gBtnAuth.textContent    = '登录 / 注册';

            if (goAuthAvatar) goAuthAvatar.textContent = '👤';
            if (goUserNick)  goUserNick.textContent   = '未登录 (游客)';
            if (goUserSub)   goUserSub.textContent    = '🪙 知因币: 0';
            if (goBtnAuth)   goBtnAuth.textContent    = '登录 / 注册';

            if (xqAuthAvatar) xqAuthAvatar.textContent = '👤';
            if (xqUserNick)  xqUserNick.textContent   = '未登录 (游客)';
            if (xqUserSub)   xqUserSub.textContent    = '🪙 知因币: 0';
            if (xqBtnAuth)   xqBtnAuth.textContent    = '登录 / 注册';

            if (mAuthAvatar) mAuthAvatar.textContent = '👤';
            if (mUserNick)   mUserNick.textContent   = '未登录 (游客)';
            if (mUserSub)    mUserSub.textContent    = '🪙 知因币: 0';
            if (mBtnAuth)    mBtnAuth.textContent    = '登录 / 注册';

            // 游客模式显示随机昵称区块
            if (nickSec) nickSec.style.display   = 'block';
        }
    }
}

const AuthEngine = new AuthManager();

/* ====================================================================
   系统邮件与公告中心管理器 (MailEngine)
   ==================================================================== */
class MailManager {
    constructor() {
        this.systemMails = [
            {
                id: 'mail_v26_level_system',
                title: '⭐ 全服 60 级等级成长与荣誉徽章上线！',
                sender: '游鲸官方运营组',
                date: '2026-08-05',
                content: '亲爱的牌友：全服全新【60级等级成长系统】与【头像右下角等级圆徽章】已上线！每局对局无论胜负皆可斩获经验升阶！附赠全新版本上线问候礼包，祝您牌运昌隆！',
                rewardCoins: 300
            },
            {
                id: 'mail_welcome_gift',
                title: '🎁 游鲸游戏全家桶到场欢迎礼',
                sender: '游鲸大厅客服处',
                date: '2026-08-01',
                content: '欢迎来到游鲸斗地主·五子棋·麻将三合一大厅！开局即赠 500 知因币金币包，祝您对对大胜、连珠成线、喜胡牌局！',
                rewardCoins: 500
            },
            {
                id: 'mail_pve_zero_fee',
                title: '🤖 单机人机切磋低门槛通告',
                sender: '系统开发组',
                date: '2026-08-04',
                content: '大厅单机人机切磋模式统一调整为【固定 1 知因币】超低入场费！随时随地与高智能 AI 轻松切磋提升牌技！',
                rewardCoins: 0
            }
        ];
        this.readMailIds = new Set();
        this.claimedMailIds = new Set();
        this.loadStatus();
    }

    loadStatus() {
        try {
            const rawRead = localStorage.getItem('youjing_read_mails');
            if (rawRead) JSON.parse(rawRead).forEach(id => this.readMailIds.add(id));

            const rawClaimed = localStorage.getItem('youjing_claimed_mails');
            if (rawClaimed) JSON.parse(rawClaimed).forEach(id => this.claimedMailIds.add(id));
        } catch (e) {
            console.error('MailManager load error', e);
        }
    }

    saveStatus() {
        try {
            localStorage.setItem('youjing_read_mails', JSON.stringify([...this.readMailIds]));
            localStorage.setItem('youjing_claimed_mails', JSON.stringify([...this.claimedMailIds]));
        } catch (e) {
            console.error('MailManager save error', e);
        }
    }

    getUnreadCount() {
        let count = 0;
        this.systemMails.forEach(mail => {
            if (!this.readMailIds.has(mail.id) || (mail.rewardCoins > 0 && !this.claimedMailIds.has(mail.id))) {
                count++;
            }
        });
        return count;
    }

    updateMailUI() {
        const btnTrigger = document.getElementById('btnOpenMailbox');
        const dotEl = document.getElementById('mailUnreadDot');
        const unreadCount = this.getUnreadCount();

        if (dotEl) dotEl.style.display = unreadCount > 0 ? 'block' : 'none';
        if (btnTrigger) {
            if (unreadCount > 0) {
                btnTrigger.classList.add('has-unread');
            } else {
                btnTrigger.classList.remove('has-unread');
            }
        }

        const noticeText = document.getElementById('topNoticePreviewText');
        if (noticeText && this.systemMails.length > 0) {
            const latestMail = this.systemMails[0];
            noticeText.textContent = `${latestMail.title}`;
        }
    }

    openMailboxModal() {
        const modal = document.getElementById('mailboxModal');
        const listContainer = document.getElementById('mailboxListContainer');
        const countEl = document.getElementById('mailTotalCount');

        if (countEl) countEl.textContent = this.systemMails.length;

        if (listContainer) {
            listContainer.innerHTML = this.systemMails.map(mail => {
                const isRead = this.readMailIds.has(mail.id);
                const isClaimed = this.claimedMailIds.has(mail.id);
                const hasReward = mail.rewardCoins > 0;

                return `
                    <div class="mail-item-card ${(!isRead || (hasReward && !isClaimed)) ? 'unread' : ''}">
                        <div class="mail-item-header">
                            <span class="mail-item-title">
                                ${(!isRead || (hasReward && !isClaimed)) ? '<i class="fa-solid fa-circle" style="font-size:0.35rem;color:#fbbf24;margin-right:6px;"></i>' : ''}
                                <span>${mail.title}</span>
                            </span>
                            <span class="mail-item-date">${mail.date}</span>
                        </div>
                        <div class="mail-item-body">${mail.content}</div>
                        ${hasReward ? `
                            <div class="mail-reward-box">
                                <span style="font-size:0.75rem;font-weight:500;color:#d4d4d8;">
                                    +${mail.rewardCoins} 知因币
                                </span>
                                ${isClaimed ? `
                                    <span style="font-size:0.7rem;color:#52525b;"><i class="fa-solid fa-check"></i> 已领取</span>
                                ` : `
                                    <button class="btn-claim-single-mail" onclick="MailEngine.claimMailReward('${mail.id}')" style="background:transparent; border:1px solid rgba(255,215,0,0.3); color:#fbbf24; border-radius:4px; padding:2px 8px; font-size:0.7rem; font-weight:500; cursor:pointer; transition:all 0.2s;">
                                        领取
                                    </button>
                                `}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        }

        // 标记所有已展示邮件为已读
        this.systemMails.forEach(mail => this.readMailIds.add(mail.id));
        this.saveStatus();
        this.updateMailUI();

        if (modal) modal.style.display = 'flex';
    }

    claimMailReward(mailId) {
        const mail = this.systemMails.find(m => m.id === mailId);
        if (!mail || mail.rewardCoins <= 0) return;
        if (this.claimedMailIds.has(mailId)) {
            if (typeof UIRenderer !== 'undefined') UIRenderer.showToast('⚠️ 该邮件奖励已领取过！');
            return;
        }

        this.claimedMailIds.add(mailId);
        this.saveStatus();

        if (typeof AuthEngine !== 'undefined' && AuthEngine.updateCoins) {
            AuthEngine.updateCoins(mail.rewardCoins, `邮件奖励 (${mail.title})`);
        }

        if (typeof SoundEngine !== 'undefined' && SoundEngine.playWin) SoundEngine.playWin();

        this.openMailboxModal();
    }

    claimAllMails() {
        let totalClaimedCoins = 0;
        let count = 0;

        this.systemMails.forEach(mail => {
            this.readMailIds.add(mail.id);
            if (mail.rewardCoins > 0 && !this.claimedMailIds.has(mail.id)) {
                this.claimedMailIds.add(mail.id);
                totalClaimedCoins += mail.rewardCoins;
                count++;
            }
        });

        this.saveStatus();

        if (totalClaimedCoins > 0 && typeof AuthEngine !== 'undefined' && AuthEngine.updateCoins) {
            AuthEngine.updateCoins(totalClaimedCoins, `一键领取 ${count} 封邮件福利`);
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playWin) SoundEngine.playWin();
        } else if (typeof UIRenderer !== 'undefined') {
            UIRenderer.showToast('✅ 所有邮件已全部标为已读！');
        }

        this.openMailboxModal();
    }
}

const MailEngine = new MailManager();

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        MailEngine.updateMailUI();
    }, 500);

    const btnOpen = document.getElementById('btnOpenMailbox');
    const btnClose = document.getElementById('btnCloseMailboxModal');
    const btnClaimAll = document.getElementById('btnClaimAllMails');

    if (btnOpen) btnOpen.addEventListener('click', () => MailEngine.openMailboxModal());
    if (btnClose) btnClose.addEventListener('click', () => {
        const modal = document.getElementById('mailboxModal');
        if (modal) modal.style.display = 'none';
    });
    if (btnClaimAll) btnClaimAll.addEventListener('click', () => MailEngine.claimAllMails());
});

/* ===== js/ui.js ===== */
/* ==========================================================================
   UI 视图渲染器与 DOM 交互控制器 (UI Renderer & DOM Events)
   ========================================================================== */

const UIRenderer = {
    selectedCards: new Set(),
    isDragging: false,
    dragTargetState: true,
    draggedIds: new Set(),

    init() {
        this.bindEvents();
        this.bindDragSelectEvents();
    },

    bindEvents() {
        // 理牌按钮
        const btnSort = document.getElementById('btnSortCards');
        if (btnSort) {
            btnSort.addEventListener('click', () => {
                if (window.GameEngine) {
                    window.GameEngine.sortSelfHand();
                }
            });
        }

        // 我方 ID 右侧打发时间解闷气球按钮
        this.bindBoredomToy();

        // 窗口尺寸/屏幕翻转时重置手牌缓存，强制以最新分辨率与列堆叠规则渲染手牌
        window.addEventListener('resize', () => {
            this._lastHandCardIdsStr = null;
            if (window.GameEngine && window.GameEngine.gameState) {
                const myIndex = NetworkManager.myPlayerIndex;
                const hand = window.GameEngine.gameState.players[myIndex] ? window.GameEngine.gameState.players[myIndex].hand : [];
                this.renderSelfHand(hand || []);
            }
        });
    },

    /**
     * 绑定电脑鼠标拖拽 & 手机手指划选扑克牌事件 (Drag / Swipe to select cards)
     */
    bindDragSelectEvents() {
        const container = document.getElementById('selfHandCards');
        if (!container) return;

        const onPointerDown = (e) => {
            if (e.type === 'touchstart') {
                this._lastTouchTime = Date.now();
            } else if (e.type === 'mousedown') {
                // 如果 400ms 内触发过 touchstart，说明这是移动端触屏合成的重复 mouse 事件，直接过滤！
                if (this._lastTouchTime && (Date.now() - this._lastTouchTime < 400)) {
                    return;
                }
            }

            const cardEl = e.target.closest('#selfHandCards .card');
            if (!cardEl || !cardEl.dataset.id) return;

            this.isDragging = true;
            this.draggedIds.clear();

            const cardId = parseInt(cardEl.dataset.id, 10);
            const isCurrentlySelected = this.selectedCards.has(cardId);
            
            // 如果点中的第一张牌未被选中，后续划过的牌全部变为【选中】；若已被选中，后续划过全部【取消选中】
            this.dragTargetState = !isCurrentlySelected;

            this.setCardSelectState(cardId, cardEl, this.dragTargetState);
            this.draggedIds.add(cardId);
        };

        const onPointerMove = (e) => {
            if (!this.isDragging) return;

            // 移动端划牌选牌时防止页面滚动拉扯
            if (e.type === 'touchmove' && e.cancelable) {
                e.preventDefault();
            }

            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            // 获取手指/鼠标当前划过的 DOM 元素
            const targetEl = document.elementFromPoint(clientX, clientY);
            if (!targetEl) return;

            const cardEl = targetEl.closest('#selfHandCards .card');
            if (cardEl && cardEl.dataset.id) {
                const cardId = parseInt(cardEl.dataset.id, 10);
                if (!this.draggedIds.has(cardId)) {
                    this.draggedIds.add(cardId);
                    this.setCardSelectState(cardId, cardEl, this.dragTargetState);
                }
            }
        };

        const onPointerUp = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.draggedIds.clear();
                this.updatePlayButtonState();
            }
        };

        // 绑定鼠标与触摸事件
        container.addEventListener('mousedown', onPointerDown);
        container.addEventListener('touchstart', onPointerDown, { passive: false });

        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('touchmove', onPointerMove, { passive: false });

        document.addEventListener('mouseup', onPointerUp);
        document.addEventListener('touchend', onPointerUp);
        document.addEventListener('touchcancel', onPointerUp);
    },

    /**
     * 我方 ID 右侧打发时间解闷气球逻辑 (越按越大越红，3D立体质感，啪的爆裂重置)
     */
    bindBoredomToy() {
        const toyBtn = document.getElementById('btnBoredomToy');
        if (!toyBtn) return;

        this._toyClicks = 0;
        this._toyIdleTimer = null;
        const maxClicks = 8; // 第 8 次点击触发 POP 爆裂

        const resetToyToDefault = () => {
            clearTimeout(this._toyIdleTimer);
            this._toyClicks = 0;
            toyBtn.textContent = '';
            toyBtn.style.transform = 'translateY(-50%) scale(1)';
            toyBtn.style.background = '';
            toyBtn.style.boxShadow = '';
            toyBtn.style.filter = '';
        };

        toyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(this._toyIdleTimer);
            this._toyClicks++;

            if (this._toyClicks >= maxClicks) {
                // 💥 触发啪的一声爆炸
                if (typeof SoundEngine !== 'undefined') {
                    SoundEngine.playToyPop();
                }

                toyBtn.textContent = '💥'; // 炸的时候展示爆裂图标 💥
                toyBtn.style.transform = 'translateY(-50%) scale(3.2)';
                toyBtn.style.filter = 'brightness(1.8)';

                setTimeout(() => {
                    resetToyToDefault();
                }, 450);

            } else {
                // 按压挤压音效
                if (typeof SoundEngine !== 'undefined') {
                    SoundEngine.playToySqueeze(this._toyClicks);
                }

                toyBtn.textContent = '';

                if (this._toyClicks === 1) {
                    // 第 1 次点击：直接变成 24px (2.4x 10px) 3D 珍珠纯白球
                    toyBtn.style.transform = 'translateY(-50%) scale(2.4)';
                    toyBtn.style.background = 'radial-gradient(circle at 35% 35%, #ffffff 0%, #f1f5f9 55%, #cbd5e1 100%)';
                    toyBtn.style.boxShadow = 'inset -1.5px -1.5px 3px rgba(0,0,0,0.25), inset 1.5px 1.5px 3px rgba(255,255,255,0.9), 0 2px 8px rgba(255,255,255,0.3)';
                } else {
                    // 第 2~7 次点击：逐级变大 (2.4x -> 4.8x) 且逐级从白变深深红
                    const clickFactor = (this._toyClicks - 1) / 6; // 0.16 ~ 1.0
                    const scale = 2.4 + (clickFactor * 2.4); // 2.4x (24px) -> 4.8x (48px)
                    const gbVal = Math.max(10, Math.floor(245 - clickFactor * 235));
                    const glowRadius = this._toyClicks * 3.5;

                    toyBtn.style.transform = `translateY(-50%) scale(${scale})`;
                    toyBtn.style.background = `radial-gradient(circle at 35% 35%, rgb(255, ${Math.min(255, gbVal + 30)}, ${Math.min(255, gbVal + 30)}) 0%, rgb(239, ${gbVal}, ${gbVal}) 55%, rgb(${Math.max(10, gbVal - 40)}, 0, 0) 100%)`;
                    toyBtn.style.boxShadow = `0 0 ${glowRadius}px rgba(239, 68, 68, ${0.35 + this._toyClicks * 0.08}), inset -1.5px -1.5px 3px rgba(0,0,0,0.5), inset 1.5px 1.5px 3px rgba(255,255,255,0.7)`;
                }

                // 3 秒无后续操作，自动泄气回归到 10px 黑灰色阶段
                this._toyIdleTimer = setTimeout(() => {
                    resetToyToDefault();
                }, 3000);
            }
        });
    },

    /**
     * 设置单张卡牌的选中状态
     */
    setCardSelectState(cardId, el, shouldSelect) {
        if (shouldSelect) {
            if (!this.selectedCards.has(cardId)) {
                this.selectedCards.add(cardId);
                if (el) el.classList.add('selected');
                SoundEngine.playCardSelect();
            }
        } else {
            if (this.selectedCards.has(cardId)) {
                this.selectedCards.delete(cardId);
                if (el) el.classList.remove('selected');
                SoundEngine.playCardDeselect();
            }
        }
        this.updatePlayButtonState();
    },

    /**
     * 弹出临时 Toast 消息
     */
    showToast(msg, duration = 2500) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerHTML = msg;
        toast.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    },

    /**
     * 创建一个包含点数和花色的扑克牌 DOM 节点
     */
    createCardElement(card, isSelectable = false) {
        const div = document.createElement('div');
        div.className = `card ${card.isRed ? 'red' : 'black'} ${card.isJoker ? 'is-joker' : ''}`;
        div.dataset.id = card.id;

        if (card.isJoker) {
            const isBigJoker = (card.rank === 17 || card.name === '大王' || card.isRed);
            const gradId = isBigJoker ? 'redJokerGrad_' + card.id : 'blackJokerGrad_' + card.id;
            const strokeColor = isBigJoker ? '#b91c1c' : '#0f172a';
            const dotColor = isBigJoker ? '#ffd700' : '#cbd5e1';
            const stopColor1 = isBigJoker ? '#ef4444' : '#475569';
            const stopColor2 = isBigJoker ? '#991b1b' : '#0f172a';

            div.innerHTML = `
                <div class="joker-vertical-label ${isBigJoker ? 'red' : 'black'}">
                    <span>J</span><span>O</span><span>K</span><span>E</span><span>R</span>
                </div>
                <div class="joker-bottom-graphic">
                    <svg class="joker-svg" viewBox="1 1 13 13">
                        <path d="M12 2L15 8L21 5L18 12L22 17L15 16L12 22L9 16L2 17L6 12L3 5L9 8L12 2Z" fill="url(#${gradId})" stroke="${strokeColor}" stroke-width="0.5"/>
                        <circle cx="12" cy="2" r="1.5" fill="${dotColor}"/>
                        <circle cx="21" cy="5" r="1.5" fill="${dotColor}"/>
                        <circle cx="3" cy="5" r="1.5" fill="${dotColor}"/>
                        <defs>
                            <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="${stopColor1}"/>
                                <stop offset="100%" stop-color="${stopColor2}"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="card-top-left">
                    <span class="card-value">${card.name}</span>
                    <span class="card-suit">${card.suitSymbol}</span>
                </div>
                <div class="card-center-symbol">${card.suitSymbol}</div>
            `;
        }

        return div;
    },

    /**
     * 动态更新「出牌」按钮的可点击/置灰状态
     */
    updatePlayButtonState() {
        const playBtn = document.getElementById('btnPlayCard');
        if (!playBtn) return;

        if (!window.GameEngine || !window.GameEngine.gameState) {
            playBtn.disabled = true;
            playBtn.classList.add('disabled');
            return;
        }

        const state = window.GameEngine.gameState;
        const myIndex = NetworkManager.myPlayerIndex;

        // 如果不在打牌阶段或不是自己的回合，置灰出牌按钮
        if (state.phase !== 'PLAYING' || state.currentTurn !== myIndex) {
            playBtn.disabled = true;
            playBtn.classList.add('disabled');
            return;
        }

        const myHand = state.players[myIndex] ? state.players[myIndex].hand : [];
        const selected = this.getSelectedCards(myHand);

        // 如果未选牌，置灰按钮
        if (selected.length === 0) {
            playBtn.disabled = true;
            playBtn.classList.add('disabled');
            return;
        }

        // 校验选中的牌是否符合规则且能管住桌上的牌
        const canPlay = DouDizhuRules.canBeat(selected, state.lastPlay, myIndex);
        if (canPlay) {
            playBtn.disabled = false;
            playBtn.classList.remove('disabled');
        } else {
            playBtn.disabled = true;
            playBtn.classList.add('disabled');
        }
    },

    /**
     * 切换卡牌选中状态
     */
    toggleCardSelect(card, el) {
        if (this.selectedCards.has(card.id)) {
            this.selectedCards.delete(card.id);
            el.classList.remove('selected');
            SoundEngine.playCardDeselect();
        } else {
            this.selectedCards.add(card.id);
            el.classList.add('selected');
            SoundEngine.playCardSelect();
        }
        this.updatePlayButtonState();
    },

    /**
     * 清空已选中的卡牌
     */
    clearSelectedCards() {
        if (this.selectedCards.size > 0) {
            SoundEngine.playCardDeselect();
        }
        this.selectedCards.clear();
        const container = document.getElementById('selfHandCards');
        if (container) {
            container.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
        }
        this.updatePlayButtonState();
    },

    /**
     * 获取当前选中的卡牌数据数组
     */
    getSelectedCards(handCards) {
        return handCards.filter(c => this.selectedCards.has(c.id));
    },

    /**
     * 自动高亮符合提示的卡牌
     */
    setSelectedCards(cardsToSelect) {
        this.selectedCards.clear();
        const container = document.getElementById('selfHandCards');
        if (!container) return;

        const targetIds = new Set(cardsToSelect.map(c => c.id));
        container.querySelectorAll('.card').forEach(el => {
            const cardId = parseInt(el.dataset.id, 10);
            if (targetIds.has(cardId)) {
                this.selectedCards.add(cardId);
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
        if (cardsToSelect.length > 0) SoundEngine.playCardSelect();
        this.updatePlayButtonState();
    },

    /**
     * 渲染玩家自己（底部）的手牌 (权威同列垂直出头堆叠，带缓存防卡牌抖动)
     */
    renderSelfHand(handCards) {
        const cardIdsStr = handCards.map(c => c.id).join(',');
        // 如果手牌未发生增减变化，避免重复摧毁/重建 DOM 节点导致卡牌闪烁抖动！
        if (this._lastHandCardIdsStr === cardIdsStr) {
            return;
        }
        this._lastHandCardIdsStr = cardIdsStr;

        const container = document.getElementById('selfHandCards');
        container.innerHTML = '';

        const count = handCards.length;
        if (count === 0) return;

        const isMobile = window.innerWidth <= 768;
        const cardWidth = isMobile ? 52 : 86;

        // 1. 判断手牌是否已经理牌排序 (按点数降序排列)
        const isHandSorted = handCards.every((c, i) => i === 0 || c.rank <= handCards[i - 1].rank);

        // 2. 按点数分组收集列 (仅理牌后生效，乱序时单牌平铺)
        const rankGroups = [];
        if (isHandSorted) {
            let currentGroup = null;
            handCards.forEach(card => {
                if (!currentGroup || currentGroup.rank !== card.rank) {
                    currentGroup = { rank: card.rank, cards: [] };
                    rankGroups.push(currentGroup);
                }
                currentGroup.cards.push(card);
            });
        } else {
            // 乱序状态：每张牌独立成列
            handCards.forEach(card => {
                rankGroups.push({ rank: card.rank, cards: [card] });
            });
        }

        // 3. 计算不同【列】之间的间距
        const groupCount = rankGroups.length;
        const containerWidth = Math.min(window.innerWidth - 12, container.clientWidth || (isMobile ? window.innerWidth - 16 : 800));
        
        let columnOverlap = isMobile ? -26 : -50;
        if (groupCount > 1) {
            const calcOverlap = -Math.floor((cardWidth * groupCount - containerWidth) / (groupCount - 1));
            if (calcOverlap < columnOverlap) {
                columnOverlap = Math.max(calcOverlap, isMobile ? -36 : -68);
            }
        }

        // 4. 渲染卡牌节点
        rankGroups.forEach((group, gIdx) => {
            const groupCards = group.cards;
            const gLen = groupCards.length;

            groupCards.forEach((card, stackIdx) => {
                const el = this.createCardElement(card, true);

                // 向上出头偏移量 (同点数垂直向上露头堆叠)
                const stackOffsetY = stackIdx * (isMobile ? -26 : -38);
                el.style.setProperty('--stack-y', `${stackOffsetY}px`);
                
                // Z轴层级：第1张在最下在前 (z-index 30)，后面张在后 (依次递减 z-index) 向上出头
                el.style.zIndex = 30 - stackIdx;

                // 乱序状态：赋予微弱物理随机微倾斜 (-4deg ~ +4deg) 与微弱错位 (-4px ~ +4px)，产生随意堆叠感
                if (!isHandSorted) {
                    const rot = ((card.id * 13) % 9) - 4;
                    const yShift = ((card.id * 7) % 7) - 3;
                    el.style.setProperty('--jitter-rot', `${rot}deg`);
                    el.style.setProperty('--jitter-y', `${yShift}px`);
                    el.classList.add('messy-card');
                }

                // 同点数完全重合在同一 X 坐标列 (margin-right: -cardWidth)
                if (stackIdx < gLen - 1) {
                    el.style.marginRight = `-${cardWidth}px`;
                } else {
                    // 该点数列的最后一张牌，与下一个点数列之间保持列间距
                    if (gIdx < groupCount - 1) {
                        el.style.marginRight = `${columnOverlap}px`;
                    } else {
                        el.style.marginRight = '0px';
                    }
                }

                if (this.selectedCards.has(card.id)) {
                    el.classList.add('selected');
                }

                container.appendChild(el);
            });
        });
    },

    /**
     * 渲染底牌展示区
     */
    renderBottomCards(bottomCards, isRevealed) {
        const container = document.getElementById('bottomCardsContainer');
        container.innerHTML = '';

        if (!isRevealed || !bottomCards || bottomCards.length === 0) {
            for (let i = 0; i < 3; i++) {
                const back = document.createElement('div');
                back.className = 'card poker-back';
                container.appendChild(back);
            }
        } else {
            bottomCards.forEach(card => {
                const el = this.createCardElement(card, false);
                container.appendChild(el);
            });
        }
    },

    /**
     * 渲染某个玩家出的牌 (全手牌外围包裹金色外框线条，仅最新一手高亮)
     */
    renderPlayedCards(targetAreaId, cards, isLatest = false) {
        const container = document.getElementById(targetAreaId);
        if (!container) return;

        // 强力恢复容器显示，防止上一局胜者被 renderOpenHand 的 display:none 误伤隐藏
        container.style.display = 'flex';

        // 强力解除上一局结算阶段留下的明牌展开 DOM 样式
        container.classList.remove('open-hand-container');

        // 仅最新打出的一手牌显示金色画框，非最新出牌区域自动移除金色画框与牌型标注
        if (isLatest && cards && cards.length > 0) {
            container.classList.add('latest-play-container');
        } else {
            container.classList.remove('latest-play-container');
            const oldLabel = container.querySelector('.card-type-label');
            if (oldLabel) oldLabel.remove();
        }

        const cardIdsStr = (cards || []).map(c => c.id !== undefined ? c.id : `${c.rank}_${c.suit}`).join(',');
        const renderKey = `${cardIdsStr}_${isLatest}`;
        if (container._renderedStateKey === renderKey) {
            return;
        }
        container._renderedStateKey = renderKey;

        container.innerHTML = '';
        if (!cards || cards.length === 0) return;

        // 根据出牌方位与张数，动态计算张数过多（如长顺子）时的紧凑叠牌 margin-right，防止撑大画面结构
        const isMobile = window.innerWidth <= 768;
        const winW = window.innerWidth || document.documentElement.clientWidth || 375;
        const count = cards.length;

        let cardW = 86;
        let defaultStep = 54; // 86 - 32
        let maxContainerW = 360;

        if (targetAreaId === 'playedSelf') {
            cardW = isMobile ? 40 : 86;
            defaultStep = isMobile ? 22 : 54;
            maxContainerW = isMobile ? Math.max(150, winW - 120) : 380;
        } else {
            cardW = isMobile ? 34 : 48;
            defaultStep = isMobile ? 18 : 24;
            maxContainerW = isMobile ? Math.max(90, Math.floor((winW - 140) / 2)) : 200;
        }

        let actualStep = defaultStep;
        if (count > 1) {
            const needW = cardW + (count - 1) * defaultStep;
            if (needW > maxContainerW) {
                actualStep = Math.max(isMobile ? 8 : 12, Math.floor((maxContainerW - cardW) / (count - 1)));
            }
        }
        const calculatedMarginRight = `-${cardW - actualStep}px`;

        // 根据出牌方位判定飞牌轨道方向
        let animClass = '';
        if (targetAreaId === 'playedSelf') animClass = 'anim-fly-self';
        else if (targetAreaId === 'playedLeft') animClass = 'anim-fly-left';
        else if (targetAreaId === 'playedRight') animClass = 'anim-fly-right';

        cards.forEach((card, idx) => {
            const el = this.createCardElement(card, false);
            if (idx < count - 1) {
                el.style.marginRight = calculatedMarginRight;
            } else {
                el.style.marginRight = '0px';
            }

            if (isLatest && animClass) {
                el.style.animationDelay = `${idx * 0.02}s`;
                el.classList.add(animClass);
            }
            container.appendChild(el);
        });

        // ===== 牌型标注标签（仅最新出牌时显示）=====
        if (isLatest && cards.length > 0) {
            const label = this._buildCardTypeLabel(cards);
            if (label) container.appendChild(label);
        }
    },

    /**
     * 游戏结束：明牌显示所有玩家剩余手牌 (自动换行排列，第一排满 5/6 张自动折到第二排、第三排)
     */
    renderOpenHand(targetAreaId, cards) {
        const container = document.getElementById(targetAreaId);
        if (!container) return;

        container.classList.remove('latest-play-container');
        container.classList.add('open-hand-container');
        container._renderedCardIdsStr = null;
        container._renderedStateKey = null;
        container.innerHTML = '';

        if (!cards || cards.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';

        // 像正常手牌一样按点数从大到小降序排列，并带层级叠压
        const sortedCards = [...cards].sort((a, b) => b.rank - a.rank);

        sortedCards.forEach((card, idx) => {
            const el = this.createCardElement(card, false);
            el.classList.add('open-hand-card');
            el.style.zIndex = idx + 1;
            container.appendChild(el);
        });
    },

    /**
     * 新一局开始时彻底重置界面 (清空桌面残牌、气泡、弹窗，恢复底牌容器)
     */
    resetGameTableUI() {
        this.selectedCards.clear();
        this._lastHandCardIdsStr = null;

        // 清空三大出牌展示区，并强力恢复 display: flex 解决上局胜者 display:none 显影 bug
        ['playedSelf', 'playedLeft', 'playedRight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '';
                el.className = 'played-cards-area';
                el.style.display = 'flex';
                el.classList.remove('open-hand-container');
                el.classList.remove('latest-play-container');
                el._renderedCardIdsStr = null;
                el._renderedStateKey = null;
            }
        });

        // 隐藏气泡
        ['bubbleSelf', 'bubbleLeft', 'bubbleRight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // 重置胜负横幅与底牌
        const vBox = document.getElementById('victoryBannerBox');
        if (vBox) {
            vBox.style.display = 'none';
            delete vBox.dataset.minimized;
        }

        const bWrap = document.getElementById('bottomCardsWrapper');
        if (bWrap) bWrap.style.display = 'flex';
    },

    /**
     * 显示对话气泡 (叫分/过/文字状态)
     */

    showBubble(bubbleId, text, duration = 3000) {
        const el = document.getElementById(bubbleId);
        if (!el) return;

        el.textContent = text;
        el.style.display = 'block';

        if (this[`_timer_${bubbleId}`]) clearTimeout(this[`_timer_${bubbleId}`]);
        this[`_timer_${bubbleId}`] = setTimeout(() => {
            el.style.display = 'none';
        }, duration);
    },

    /**
     * 更新倒计时与轮到谁出牌的 UI 样式 (带流畅本地 1 秒倒计时与头像回合金光高亮)
     */
    updateTurnIndicator(currentTurnIndex, myPlayerIndex, seconds, turnStartTime) {
        const timerEl = document.getElementById('turnTimer');
        const timerSecs = document.getElementById('timerSeconds');

        if (currentTurnIndex === -1) {
            timerEl.style.display = 'none';
            this.stopLocalTimer();
            this.updateAvatarTurnHighlight(-1, myPlayerIndex);
            return;
        }

        timerEl.style.display = 'flex';

        // 基于绝对时间戳计算真实剩余秒数，保证 3 人联机零时差完美同步
        let calcRemaining = seconds !== undefined ? seconds : 25;
        if (turnStartTime) {
            const elapsed = Math.floor((Date.now() - turnStartTime) / 1000);
            calcRemaining = Math.max(0, 25 - elapsed);
        }

        const turnChanged = this._currentTurnIndex !== currentTurnIndex;
        const startTimeChanged = this._lastTurnStartTime !== turnStartTime;

        if (turnChanged || startTimeChanged || calcRemaining === 25) {
            this._currentTurnIndex = currentTurnIndex;
            this._lastTurnStartTime = turnStartTime;
            this.startLocalTimer(calcRemaining);
        }

        // 高亮轮到思考/出牌的玩家头像
        this.updateAvatarTurnHighlight(currentTurnIndex, myPlayerIndex);
    },

    /**
     * 轮到出牌的玩家头像大框金光高亮
     */
    updateAvatarTurnHighlight(currentTurnIndex, myPlayerIndex) {
        const rel = this.getRelativePlayerIndices(myPlayerIndex);

        const avatarSelf = document.getElementById('avatarSelf');
        const avatarLeft = document.getElementById('avatarLeft');
        const avatarRight = document.getElementById('avatarRight');

        if (avatarSelf) avatarSelf.classList.toggle('turn-active', currentTurnIndex === rel.self);
        if (avatarLeft) avatarLeft.classList.toggle('turn-active', currentTurnIndex === rel.left);
        if (avatarRight) avatarRight.classList.toggle('turn-active', currentTurnIndex === rel.right);
    },

    /**
     * 启动客户端本地流畅秒级倒计时
     */
    startLocalTimer(initialSecs) {
        this.stopLocalTimer();
        this.localSecs = initialSecs;

        const timerSecs = document.getElementById('timerSeconds');
        const timerEl = document.getElementById('turnTimer');

        if (timerSecs) timerSecs.textContent = this.localSecs;
        this.updateTimerColorClass(timerEl, this.localSecs);

        this._localTimerInterval = setInterval(() => {
            this.localSecs--;
            if (this.localSecs < 0) {
                this.localSecs = 0;
                this.stopLocalTimer();
            }

            if (timerSecs) timerSecs.textContent = this.localSecs;
            this.updateTimerColorClass(timerEl, this.localSecs);
        }, 1000);
    },

    /**
     * 根据剩余秒数动态更新倒计时框的颜色 (绿 ➔ 黄 ➔ 红 ➔ 闪烁)
     */
    updateTimerColorClass(timerEl, secs) {
        if (!timerEl) return;
        timerEl.classList.remove('timer-green', 'timer-yellow', 'timer-red', 'urgent');

        if (secs > 15) {
            timerEl.classList.add('timer-green');
        } else if (secs > 8) {
            timerEl.classList.add('timer-yellow');
        } else if (secs > 4) {
            timerEl.classList.add('timer-red');
        } else {
            timerEl.classList.add('timer-red', 'urgent');
        }
    },

    /**
     * 停止本地倒计时
     */
    stopLocalTimer() {
        if (this._localTimerInterval) {
            clearInterval(this._localTimerInterval);
            this._localTimerInterval = null;
        }
    },

    /**
     * 根据牌型生成标注标签 DOM 节点
     */
    _buildCardTypeLabel(cards) {
        if (!cards || cards.length === 0) return null;
        if (typeof DouDizhuRules === 'undefined') return null;

        const analysis = DouDizhuRules.analyzeCards(cards);
        const type = analysis.type;

        // 牌型 → { 文字, emoji, CSS class }
        const typeMap = {
            [CardType.SINGLE]:              { text: '单张',   icon: '',   cls: 'label-normal' },
            [CardType.PAIR]:                { text: '对子',   icon: '✌️', cls: 'label-pair'   },
            [CardType.TRIPLE]:              { text: '三条',   icon: '🔱', cls: 'label-pair'   },
            [CardType.TRIPLE_ONE]:          { text: '三带一', icon: '🔱', cls: 'label-pair'   },
            [CardType.TRIPLE_TWO]:          { text: '三带二', icon: '🔱', cls: 'label-pair'   },
            [CardType.STRAIGHT]:            { text: '顺子',   icon: '📈', cls: 'label-combo'  },
            [CardType.CONSECUTIVE_PAIRS]:   { text: '连对',   icon: '💫', cls: 'label-combo'  },
            [CardType.CONSECUTIVE_TRIPLES]: { text: '飞机',   icon: '✈️', cls: 'label-combo'  },
            [CardType.PLANE_WITH_SINGLES]:  { text: '飞机带单', icon: '✈️', cls: 'label-combo' },
            [CardType.PLANE_WITH_PAIRS]:    { text: '飞机带对', icon: '✈️', cls: 'label-combo' },
            [CardType.QUAD_TWO_SINGLES]:    { text: '四带二', icon: '💥', cls: 'label-bomb'   },
            [CardType.QUAD_TWO_PAIRS]:      { text: '四带两对', icon: '💥', cls: 'label-bomb' },
            [CardType.BOMB]:                { text: '炸弹',   icon: '💣', cls: 'label-bomb'   },
            [CardType.ROCKET]:              { text: '王炸',   icon: '🚀', cls: 'label-rocket'  },
        };

        // 单张不显示标签（太频繁，干扰视线）
        if (type === CardType.SINGLE || type === CardType.INVALID) return null;

        const info = typeMap[type];
        if (!info) return null;

        const el = document.createElement('div');
        el.className = `card-type-label ${info.cls}`;
        el.innerHTML = info.icon
            ? `<span>${info.icon}</span><span>${info.text}</span>`
            : `<span>${info.text}</span>`;
        return el;
    },

    /**
     * 根据当前视角索引计算 左/右 玩家对应全局的哪个 slot index
     */
    getRelativePlayerIndices(myIndex) {
        // 3 人局：顺时针：myIndex -> (myIndex+1)%3 (右家/下家) -> (myIndex+2)%3 (左家/上家)
        return {
            self: myIndex,
            right: (myIndex + 1) % 3,
            left: (myIndex + 2) % 3
        };
    }
};

/* ===== js/gomoku.js ===== */
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

/* ===== js/go.js ===== */
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

/* ===== js/mahjong.js ===== */
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

/* ===== js/xiangqi.js ===== */
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

/* ===== js/main.js ===== */
/* 全局禁止双指手势缩放 (Pinch zoom prevention while preserving fast clicks) */
(function disablePinchZoom() {
    // 禁止 iOS 捏合手势缩放 (Pinch gesture prevention)
    document.addEventListener('gesturestart', function (e) {
        e.preventDefault();
    }, { passive: false });

    // 禁止双指触控拖拽缩放
    document.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
})();

class GameEngineController {
    constructor() {
        this.gameState = {
            roomId: '',
            phase: 'LOBBY', // LOBBY, WAITING, BIDDING, PLAYING, GAMEOVER
            players: [
                { id: 0, name: '玩家 1', hand: [], isAi: false, isHost: true, role: 'FARMER' },
                { id: 1, name: '玩家 2', hand: [], isAi: false, isHost: false, role: 'FARMER' },
                { id: 2, name: '玩家 3', hand: [], isAi: false, isHost: false, role: 'FARMER' }
            ],
            currentTurn: 0,
            landlordIndex: -1,
            highestBid: 0,
            highestBidder: -1,
            bidsCount: 0,
            bottomCards: [],
            lastPlay: null, // { playerIndex: 0, cards: [] }
            multiplier: 1,
            baseScore: 150,
            winnerIndex: -1,
            readyPlayers: [false, false, false]
        };

        this.turnTimerId = null;
        this.timerSeconds = 20;

        // 五子棋回合倒计时 (30 秒超时托管/判负)
        this._gomokuTimerInterval = null;
        this._gomokuTimerSeconds = 30;

        // 围棋回合倒计时 (60 秒超时托管/判负)
        this._goTimerInterval = null;
        this._goTimerSeconds = 60;
        this.goBoardSize = 19; // 围棋 AI 模式棋盘路数 (9/13/19), 联机固定 19 路
        this.goUndoLeft = 3;
        this.goPendingMove = null;
        this.goMyRematchReady = false;
    }

    init() {
        UIRenderer.init();
        this.updateHeaderVisibility();

        // 优先使用上次保存的昵称，没有再随机生成
        const nickInput = document.getElementById('nicknameInput');
        if (nickInput) {
            const savedNick = localStorage.getItem('youjing_doudizhu_nickname');
            const nick = savedNick || this.generateUniqueNickname();
            nickInput.value = nick;
            localStorage.setItem('youjing_doudizhu_nickname', nick);
        }

        this.bindLobbyEvents();
        this.renderMiniLeaderboard();

        // 默认落在第一个导航游戏 (斗地主) 大厅
        if (this.switchGameLobby) {
            this.switchGameLobby('DOUDIZHU');
            this.updateHeaderVisibility();
        }

        // 监听网络层的全量状态同步与大厅同步事件
        NetworkManager.onStateUpdate = (state) => this.onReceiveStateUpdate(state);
        NetworkManager.onPlayerJoined = (slotIndex, nickname, avatarEmoji) => this.onPlayerJoined(slotIndex, nickname, avatarEmoji);
        NetworkManager.onLobbySync   = (lobbyData) => this.onReceiveLobbySync(lobbyData);
        NetworkManager.onToast       = (msg) => UIRenderer.showToast(msg);

        // 先检查是否有上次未完成的会话（断线/切 App 后回来）
        // 如果有，优先恢复；否则再走正常邀请链接流程
        const restored = this.checkSavedSession();
        if (!restored) {
            this.checkUrlRoomParam();
        }
    }

    /* ====================================================================
       会话恢复：检测 sessionStorage 中的旧会话并尝试重连
       ==================================================================== */
    checkSavedSession() {
        const session = NetworkManager.loadSession();
        // 只在游戏进行中的会话才恢复（BIDDING/PLAYING）
        if (!session || !['BIDDING', 'PLAYING'].includes(session.phase)) return false;

        console.log('[Session] 检测到旧会话:', session);

        // 显示重连横幅
        this._showRejoinBanner(session);
        return true;
    }

    _showRejoinBanner(session) {
        // 复用 quickJoinBanner 或动态创建一个重连横幅
        let banner = document.getElementById('rejoinBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'rejoinBanner';
            banner.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
                'background:linear-gradient(135deg,#1a1a2e,#16213e)',
                'border-bottom:2px solid rgba(201,146,42,0.6)',
                'color:#fff', 'padding:14px 20px',
                'display:flex', 'align-items:center', 'justify-content:space-between',
                'gap:12px', 'font-size:0.9rem', 'box-shadow:0 4px 20px rgba(0,0,0,0.5)'
            ].join(';');
            document.body.appendChild(banner);
        }

        const roleText = session.isHost ? '房主' : '玩家';
        banner.innerHTML = `
            <span>🔄 检测到上次的游戏（房间 <b>${session.roomId}</b>，你是<b>${roleText}</b>）</span>
            <div style="display:flex;gap:8px;flex-shrink:0">
                <button id="btnRejoinConfirm" style="background:#c9921a;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:700">重新加入</button>
                <button id="btnRejoinCancel" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer">不了</button>
            </div>
        `;

        document.getElementById('btnRejoinConfirm').addEventListener('click', () => {
            banner.remove();
            if (session.isHost) {
                this._rejoinAsHost(session);
            } else {
                this._rejoinAsClient(session);
            }
        });

        document.getElementById('btnRejoinCancel').addEventListener('click', () => {
            NetworkManager.clearSession();
            banner.remove();
            // 清除会话后再走正常邀请链接流程
            this.checkUrlRoomParam();
        });

        // 5秒内没操作，自动尝试重连
        this._rejoinTimer = setTimeout(() => {
            if (document.getElementById('rejoinBanner')) {
                banner.remove();
                if (session.isHost) {
                    this._rejoinAsHost(session);
                } else {
                    this._rejoinAsClient(session);
                }
            }
        }, 5000);
    }

    _rejoinAsHost(session) {
        const nickname = session.nickname || localStorage.getItem('youjing_doudizhu_nickname') || '房主';
        UIRenderer.showToast('正在恢复房间，请稍候...', 4000);

        NetworkManager.createRoom(nickname, (roomId) => {
            this.setupWaitingScreen(roomId);

            // 恢复上次保存的游戏状态（如果有且游戏已开始）
            const savedState = NetworkManager.loadSavedGameState();
            if (savedState && savedState.phase === 'PLAYING') {
                UIRenderer.showToast('✅ 房间已恢复！等待玩家重新加入...', 4000);
                // 稍等玩家重连后恢复状态广播
                setTimeout(() => {
                    this.gameState = savedState;
                    // 保留房主玩家信息
                    this.gameState.players[0].name = nickname;
                    NetworkManager.broadcastState(this.gameState);
                }, 2000);
            } else {
                UIRenderer.showToast('✅ 房间已恢复！', 3000);
            }
        }, session.roomId);
    }

    _rejoinAsClient(session) {
        const nickname = session.nickname || localStorage.getItem('youjing_doudizhu_nickname') || '玩家';
        UIRenderer.showToast('正在重新加入房间...', 4000);

        // 填充房间号并触发加入流程
        const joinInput = document.getElementById('joinRoomInput');
        if (joinInput) joinInput.value = session.roomId;

        NetworkManager.myPlayerIndex = session.playerIndex;
        NetworkManager.joinRoom(session.roomId, nickname, () => {
            this.enterRoomAsClient(session.roomId);
            UIRenderer.showToast('✅ 已重新加入房间！', 3000);
        }, (err) => {
            UIRenderer.showToast(`重连失败：${err}，请手动加入房间`, 4000);
            NetworkManager.clearSession();
            // 降级：自动填写房间号让用户手动点击
            if (joinInput) joinInput.value = session.roomId;
        });
    }

    /**
     * 随机生成 2026 最新爆火热梗与 B站经典弹幕纯文字昵称
     */
    generateUniqueNickname() {
        const bStationMemes = [
            // B站经典弹幕与文化梗
            '一键三连', '我要验牌', '前方高能', '破防了家人们', '下次一定',
            '满级大佬回新手村', '格局打开', '战术后仰', '要素过多', '伤害不高侮辱极强',
            '大佬请喝茶', '弹幕护体', '空降成功', '真香定律', '邪修出牌',
            '硬币都给你', '这波在第五层', '不讲武德', '优势在我', '名场面打卡',
            // 2026 现象级热梗
            '爱你老己', '低山臭水遇知音', '助我破鼎', 'DeepSeek附体', '班味退散',
            '外耗大师', '真冰凉', '活人感拉满', '赛博对账', '浪浪山小妖怪',
            '敬自己一杯', '情绪价值拉满', '建议手臂加强', '留友看', '后面有车',
            '硬核拆车', '过程基础结果不基础', '谷子人', '来财', '对三要不起',
            '绝地王炸', '顺子专业户', '底牌收割机', '王炸破鼎'
        ];
        return bStationMemes[Math.floor(Math.random() * bStationMemes.length)];
    }

    /**
     * 检查 URL 是否携带有 ?room=XXXXXX 参数，如果有则自动进入加入模式
     */
    checkUrlRoomParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdParam = urlParams.get('room');
        if (!roomIdParam) return;

        // 填充房间号输入框
        document.getElementById('joinRoomInput').value = roomIdParam;

        // 显示顶部流量标识条
        const banner = document.getElementById('quickJoinBanner');
        if (banner) {
            banner.style.display = 'block';
            document.getElementById('quickJoinRoomDisplay').textContent = roomIdParam;
        }

        // 隐藏「创建房间」和「单机 AI」按钮，防止手机用户误操作
        const createBtn = document.getElementById('btnCreateRoom');
        const aiBtn = document.getElementById('btnPlayAi');
        const divider = document.querySelector('.divider');
        if (createBtn) createBtn.style.display = 'none';
        if (aiBtn) aiBtn.style.display = 'none';
        if (divider) divider.style.display = 'none';

        // 加入按钮升點显示
        const joinBtn = document.getElementById('btnJoinRoom');
        if (joinBtn) {
            joinBtn.style.background = 'linear-gradient(135deg, #f1c40f, #f39c12)';
            joinBtn.style.color = '#000';
            joinBtn.style.fontWeight = '800';
            joinBtn.style.padding = '12px 24px';
            joinBtn.textContent = '加入房间 →';
        }

        // 自动帮助好友秒级加入房间，无需手动再次点击
        setTimeout(() => {
            const joinBtn = document.getElementById('btnJoinRoom');
            if (joinBtn) joinBtn.click();
        }, 400);
    }

    /**
     * 大厅按钮事件绑定
     */
    bindLobbyEvents() {
        // 🎲 随机昵称生成按钮
        const randNickBtn = document.getElementById('btnRandomNickname');
        if (randNickBtn) {
            randNickBtn.addEventListener('click', () => {
                const newNick = this.generateUniqueNickname();
                const input = document.getElementById('nicknameInput');
                if (input) input.value = newNick;
                localStorage.setItem('youjing_doudizhu_nickname', newNick);
                UIRenderer.showToast(`🎲 已随机分配昵称：${newNick}`);
            });
        }

        // 获取或产生最终昵称并记录本地 (实时自动清洗 乃, 坚, cnj, nj 敏感词)
        const getNickname = () => {
            const input = document.getElementById('nicknameInput');
            let val = input ? input.value.trim() : '';
            if (typeof window.sanitizeNickname === 'function') {
                val = window.sanitizeNickname(val);
            }
            if (!val) val = this.generateUniqueNickname();
            if (input) input.value = val;
            localStorage.setItem('youjing_doudizhu_nickname', val);
            return val;
        };

        // 创建房间 (null-safe)
        const _btnCreateRoom = document.getElementById('btnCreateRoom');
        if (_btnCreateRoom) _btnCreateRoom.addEventListener('click', () => {
            const nickname = getNickname();
            this.activeGameType = 'DOUDIZHU';
            NetworkManager.gameType = 'DOUDIZHU';
            NetworkManager.createRoom(nickname, (roomId) => {
                this.setupWaitingScreen(roomId);
            }, null, 'DOUDIZHU');
        });

        // 加入房间输入框增强 (自动转大写、回车快捷提交、卡片点击聚焦)
        const joinInput = document.getElementById('joinRoomInput');
        const joinCard = document.querySelector('.join-card');
        if (joinInput) {
            joinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('btnJoinRoom').click();
                }
            });
            joinInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            });
        }
        if (joinCard && joinInput) {
            joinCard.addEventListener('click', (e) => {
                if (e.target !== joinInput && !e.target.closest('#btnJoinRoom')) {
                    joinInput.focus();
                }
            });
        }

        // 加入房间 (null-safe)
        const _btnJoinRoom = document.getElementById('btnJoinRoom');
        if (_btnJoinRoom) _btnJoinRoom.addEventListener('click', () => {
            const roomId = (document.getElementById('joinRoomInput') || {}).value?.trim() || '';
            const nickname = getNickname();
            if (!roomId) {
                UIRenderer.showToast('请输入有效的 6 位房间号');
                return;
            }
            NetworkManager.joinRoom(roomId, nickname, () => {
                this.enterRoomAsClient(roomId);
            }, (errMsg) => {
                UIRenderer.showToast(errMsg);
            });
        });

        // 单机练习模式 (null-safe)
        const _btnPlayAi = document.getElementById('btnPlayAi');
        if (_btnPlayAi) _btnPlayAi.addEventListener('click', () => {
            const nickname = getNickname();
            this.startAiGame(nickname);
        });

        // 在线公共房间大厅 (斗地主 & 五子棋 & 游鲸麻将)
        const btnPublicRooms        = document.getElementById('btnPublicRooms');
        const btnPublicGomokuRooms  = document.getElementById('btnPublicGomokuRooms');
        const btnPublicMahjongRooms = document.getElementById('btnPublicMahjongRooms');
        const publicModal           = document.getElementById('publicRoomsModal');
        const closePublic           = document.getElementById('btnClosePublicRooms');
        const refreshPublic         = document.getElementById('btnRefreshPublicRooms');

        let currentPublicGameType = 'DOUDIZHU';

        if (btnPublicRooms && publicModal) {
            btnPublicRooms.addEventListener('click', () => {
                currentPublicGameType = 'DOUDIZHU';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('DOUDIZHU');
            });
        }
        if (btnPublicGomokuRooms && publicModal) {
            btnPublicGomokuRooms.addEventListener('click', () => {
                currentPublicGameType = 'GOMOKU';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('GOMOKU');
            });
        }
        if (btnPublicMahjongRooms && publicModal) {
            btnPublicMahjongRooms.addEventListener('click', () => {
                currentPublicGameType = 'MAHJONG';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('MAHJONG');
            });
        }
        if (publicModal) {
            if (closePublic) {
                closePublic.addEventListener('click', () => publicModal.style.display = 'none');
            }
            if (refreshPublic) {
                refreshPublic.addEventListener('click', () => this.refreshPublicRoomsList(currentPublicGameType));
            }
            publicModal.addEventListener('click', (e) => {
                if (e.target === publicModal) publicModal.style.display = 'none';
            });
        }

        // 多游戏大厅切换 (斗地主 <-> 五子棋 <-> 游鲸麻将)
        const btnNavGo       = document.getElementById('btnNavGo');
        const btnNavDoudizhu = document.getElementById('btnNavDoudizhu');
        const btnNavGomoku   = document.getElementById('btnNavGomoku');
        const btnNavMahjong  = document.getElementById('btnNavMahjong');
        const btnNavXiangqi  = document.getElementById('btnNavXiangqi');
        const cardGo         = document.getElementById('goLobbyCard');
        const cardDoudizhu   = document.getElementById('doudizhuLobbyCard');
        const cardGomoku     = document.getElementById('gomokuLobbyCard');
        const cardMahjong    = document.getElementById('mahjongLobbyCard');
        const cardXiangqi    = document.getElementById('xiangqiLobbyCard');

        const switchGameLobby = (gameType, direction) => {
            document.body.classList.remove('theme-go', 'theme-gomoku', 'theme-mahjong', 'theme-xiangqi');
            this.activeGameType = gameType;
            NetworkManager.gameType = gameType;

            // 主题切换
            if (gameType === 'GO') document.body.classList.add('theme-go');
            else if (gameType === 'MAHJONG') document.body.classList.add('theme-mahjong');
            else if (gameType === 'GOMOKU') document.body.classList.add('theme-gomoku');
            else if (gameType === 'XIANGQI') document.body.classList.add('theme-xiangqi');

            // 导航激活状态
            const navBtns = { GO: btnNavGo, DOUDIZHU: btnNavDoudizhu, GOMOKU: btnNavGomoku, MAHJONG: btnNavMahjong, XIANGQI: btnNavXiangqi };
            Object.keys(navBtns).forEach(k => { if (navBtns[k]) navBtns[k].classList.toggle('active', k === gameType); });

            // 卡片滑动切换动画: 方向跟随手势 (direction=1 下一个/左滑, direction=-1 上一个/右滑)
            const cardMap = { GO: cardGo, DOUDIZHU: cardDoudizhu, GOMOKU: cardGomoku, MAHJONG: cardMahjong, XIANGQI: cardXiangqi };
            const newCard = cardMap[gameType];
            if (!newCard) return;

            const cardsAll = [cardGo, cardDoudizhu, cardGomoku, cardMahjong, cardXiangqi];
            let oldCard = null;
            Object.keys(cardMap).forEach(k => {
                const c = cardMap[k];
                if (c && c !== newCard && c.style.display !== 'none') oldCard = c;
            });

            // 清理可能残留的滑出动画类
            cardsAll.forEach(c => { if (c) c.classList.remove('lobby-card-out', 'lobby-card-out-right'); });

            // direction 缺省时按导航顺序推断 (向前)
            const gameOrder = ['DOUDIZHU', 'GO', 'GOMOKU', 'MAHJONG', 'XIANGQI'];
            if (direction === undefined) {
                const fromIdx = gameOrder.indexOf(this._lastLobbyGame || 'DOUDIZHU');
                const toIdx = gameOrder.indexOf(gameType);
                direction = (toIdx >= fromIdx) ? 1 : -1;
            }
            this._lastLobbyGame = gameType;

            // 动画类: 前向(下一个)旧卡左出/新卡右进; 后向(上一个)旧卡右出/新卡左进
            const outCls = direction > 0 ? 'lobby-card-out' : 'lobby-card-out-right';
            const inCls = direction > 0 ? 'lobby-card-in' : 'lobby-card-in-left';

            // 切换后刷新头部品牌标题 (游鲸围棋/五子棋/斗地主/麻将/象棋)
            if (typeof this.updateHeaderVisibility === 'function') {
                this.updateHeaderVisibility();
            }

            // ========== 切换执行 (防竞态) ==========
            // 1. 清理上一次动画的 pending 回调与残留类, 避免快速连续切换时卡片状态错乱 (区域/页面消失 bug)
            if (this._lobbySwitchTimer) { clearTimeout(this._lobbySwitchTimer); this._lobbySwitchTimer = null; }
            if (this._lobbySwitchTimer2) { clearTimeout(this._lobbySwitchTimer2); this._lobbySwitchTimer2 = null; }
            this._lobbySwitchBusy = false;
            cardsAll.forEach(c => { if (c) c.classList.remove('lobby-card-out', 'lobby-card-out-right', 'lobby-card-in', 'lobby-card-in-left'); });

            // 2. 硬切: 只显示目标卡 (旧卡立即隐藏, 新卡滑入动画)
            cardsAll.forEach(c => { if (c) c.style.display = (c === newCard) ? 'block' : 'none'; });
            const lobbyScr = document.getElementById('lobbyScreen');
            if (lobbyScr) lobbyScr.scrollTop = 0;

            // 3. 新卡按方向滑入 (前向从右滑入, 后向从左滑入)
            void newCard.offsetWidth; // 强制 reflow 触发动画
            newCard.classList.add(inCls);
            this._lobbySwitchTimer2 = setTimeout(() => {
                newCard.classList.remove(inCls);
                this._lobbySwitchTimer2 = null;
            }, 350);

            // 4. 导航自动滚动到当前游戏按钮 (横向居中, 保持顺序一目了然)
            const navFollowEl = document.querySelector('.game-switch-nav');
            const activeNavBtn = navBtns[gameType];
            if (navFollowEl && activeNavBtn && navFollowEl.scrollWidth > navFollowEl.clientWidth) {
                const navRect = navFollowEl.getBoundingClientRect();
                const btnRect = activeNavBtn.getBoundingClientRect();
                const btnLeftInNav = btnRect.left - navRect.left + navFollowEl.scrollLeft;
                const targetScroll = btnLeftInNav - (navFollowEl.clientWidth - btnRect.width) / 2;
                navFollowEl.scrollLeft = Math.max(0, targetScroll);
            }
        };
        this.switchGameLobby = switchGameLobby;

        if (btnNavGo)       btnNavGo.addEventListener('click', () => switchGameLobby('GO'));
        if (btnNavDoudizhu) btnNavDoudizhu.addEventListener('click', () => switchGameLobby('DOUDIZHU'));
        if (btnNavGomoku)   btnNavGomoku.addEventListener('click', () => switchGameLobby('GOMOKU'));
        if (btnNavMahjong)  btnNavMahjong.addEventListener('click', () => switchGameLobby('MAHJONG'));
        if (btnNavXiangqi)  btnNavXiangqi.addEventListener('click', () => switchGameLobby('XIANGQI'));

        // 导航区鼠标拖拽滚动 (桌面端, 与手机端触摸滚动体验一致)
        const navEl = document.querySelector('.game-switch-nav');
        if (navEl) {
            let navDragging = false;
            let navStartX = 0;
            let navStartScroll = 0;
            let navDragged = false;

            navEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                navDragging = true;
                navDragged = false;
                navStartX = e.clientX;
                navStartScroll = navEl.scrollLeft;
                navEl.classList.add('nav-dragging');
            });

            window.addEventListener('mousemove', (e) => {
                if (!navDragging) return;
                const dx = e.clientX - navStartX;
                if (Math.abs(dx) > 5) navDragged = true;
                navEl.scrollLeft = navStartScroll - dx;
            });

            window.addEventListener('mouseup', () => {
                if (!navDragging) return;
                navDragging = false;
                navEl.classList.remove('nav-dragging');
                // 拖拽后短暂抑制按钮点击, 避免误触发游戏切换
                if (navDragged) {
                    navEl.dataset.suppressClick = '1';
                    setTimeout(() => { navEl.dataset.suppressClick = ''; }, 200);
                }
            });

            // 捕获阶段拦截拖拽后的误点击
            navEl.addEventListener('click', (e) => {
                if (navEl.dataset.suppressClick === '1') {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, true);
        }

        // 绑定麻将模式按键
        const btnMahjongAuth = document.getElementById('btnMahjongAuth');
        if (btnMahjongAuth) {
            btnMahjongAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        const btnCreateMahjongRoom = document.getElementById('btnCreateMahjongRoom');
        if (btnCreateMahjongRoom) {
            btnCreateMahjongRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'MAHJONG';
                NetworkManager.gameType = 'MAHJONG';
                NetworkManager.createRoom(nickname, (roomId) => {
                    UIRenderer.showToast(`✅ 游鲸麻将在线房间创建成功：#${roomId}`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建麻将房间失败');
                }, 'MAHJONG');
            });
        }

        const btnJoinMahjong = document.getElementById('btnJoinMahjong');
        const joinMahjongInput = document.getElementById('joinMahjongInput');
        if (btnJoinMahjong && joinMahjongInput) {
            btnJoinMahjong.addEventListener('click', () => {
                const roomId = joinMahjongInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位麻将房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入麻将房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入麻将房间失败');
                });
            });
        }

        const btnPlayMahjongAi = document.getElementById('btnPlayMahjongAi');
        if (btnPlayMahjongAi) {
            btnPlayMahjongAi.addEventListener('click', () => this.startMahjongAiMode());
        }

        // 绑定五子棋个人信息按钮点击
        const btnGomokuAuth = document.getElementById('btnGomokuAuth');
        if (btnGomokuAuth) {
            btnGomokuAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 手势左滑 / 右滑切换游戏大厅
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartInNav = false;
        const lobbyScr = document.getElementById('lobbyScreen');
        if (lobbyScr) {
            lobbyScr.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                // 记录滑动起点是否在导航区 (导航区滑动只滚动导航, 不触发大厅切换)
                touchStartInNav = !!(e.target && e.target.closest && e.target.closest('.game-switch-nav'));
            }, { passive: true });

            // 横向滑动意图明显时阻止纵向滚动 (避免左右滑时页面上下跳动); 导航区自身滚动不受影响
            lobbyScr.addEventListener('touchmove', (e) => {
                const inNav = e.target && e.target.closest && e.target.closest('.game-switch-nav');
                if (inNav) return; // 导航区横向滚动交给浏览器自身处理
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });

            lobbyScr.addEventListener('touchend', (e) => {
                // 从导航区开始的手势: 只滚动导航, 不触发大厅切换
                if (touchStartInNav) return;

                const diffX = e.changedTouches[0].clientX - touchStartX;
                const diffY = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                    // 按导航顺序循环: 斗地主 -> 围棋 -> 五子棋 -> 麻将 -> 象棋
                    const gameOrder = ['DOUDIZHU', 'GO', 'GOMOKU', 'MAHJONG', 'XIANGQI'];
                    const curIdx = gameOrder.indexOf(this.activeGameType || 'DOUDIZHU');
                    if (diffX < 0) {
                        // 左滑切换下一个游戏 (动画向左滑出/从右滑入)
                        switchGameLobby(gameOrder[(curIdx + 1) % gameOrder.length], 1);
                    } else {
                        // 右滑切换上一个游戏 (动画向右滑出/从左滑入)
                        switchGameLobby(gameOrder[(curIdx + 3) % gameOrder.length], -1);
                    }
                }
            }, { passive: true });
        }

        // 创建五子棋在线对局
        const btnCreateGomokuRoom = document.getElementById('btnCreateGomokuRoom');
        if (btnCreateGomokuRoom) {
            btnCreateGomokuRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'GOMOKU';
                NetworkManager.gameType = 'GOMOKU';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 五子棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建五子棋房间失败');
                }, 'GOMOKU');
            });
        }

        // 输入 6 位房间号加入五子棋对局
        const btnJoinGomoku = document.getElementById('btnJoinGomoku');
        const joinGomokuInput = document.getElementById('joinGomokuInput');
        if (btnJoinGomoku && joinGomokuInput) {
            btnJoinGomoku.addEventListener('click', () => {
                const roomId = joinGomokuInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位五子棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入五子棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入五子棋房间失败');
                });
            });
        }

        // 五子棋单机 AI 按钮绑定
        const btnPlayGomokuAi = document.getElementById('btnPlayGomokuAi');
        if (btnPlayGomokuAi) {
            btnPlayGomokuAi.addEventListener('click', () => this.startGomokuAiMode());
        }

        // 五子棋对局控制按钮 (单局限悔棋 3 次，需对方确认)
        const btnGomokuUndo = document.getElementById('btnGomokuUndo');
        if (btnGomokuUndo) {
            btnGomokuUndo.addEventListener('click', () => {
                const engine = window.gomokuEngine;
                if (!engine) return;
                if (this.gomokuUndoLeft === undefined) this.gomokuUndoLeft = 3;

                if (this.gomokuUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }

                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 盘面上暂无棋子可撤回');
                    return;
                }

                // 如果是单机 AI 模式，AI 自动同意悔棋，直接撤回并扣除次数
                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.gomokuUndoLeft--;
                        const countEl = document.getElementById('gomokuUndoCount');
                        if (countEl) countEl.textContent = this.gomokuUndoLeft;

                        if (this.gomokuUndoLeft <= 0) {
                            btnGomokuUndo.disabled = true;
                            btnGomokuUndo.classList.add('disabled');
                        }

                        this.renderGomokuBoard();
                        this.updateGomokuStatusUI(`已撤回，本局还可悔棋 ${this.gomokuUndoLeft} 次`);
                        UIRenderer.showToast(`↺ 悔棋成功！单局剩余 ${this.gomokuUndoLeft} 次`);
                        // 悔棋后回到玩家回合：重启倒计时
                        if (engine.currentTurn === engine.playerColor) this.startGomokuTurnTimer();
                        else this.stopGomokuTurnTimer();
                    }
                    return;
                }

                // 在线双人模式：向对方发送悔棋申请
                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendGomokuUndoRequest(NetworkManager.nickname);
            });
        }

        // 绑定五子棋悔棋申请弹窗按钮
        const btnAgreeGomokuUndo = document.getElementById('btnAgreeGomokuUndo');
        const btnRejectGomokuUndo = document.getElementById('btnRejectGomokuUndo');
        const undoModal = document.getElementById('gomokuUndoModal');

        if (btnAgreeGomokuUndo) {
            btnAgreeGomokuUndo.addEventListener('click', () => {
                if (undoModal) undoModal.style.display = 'none';
                if (window.gomokuEngine) {
                    window.gomokuEngine.undo();
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('已同意悔棋，局面已更新');
                }
                NetworkManager.sendGomokuUndoResponse(true);
                UIRenderer.showToast('✅ 你已同意对方悔棋');
            });
        }

        if (btnRejectGomokuUndo) {
            btnRejectGomokuUndo.addEventListener('click', () => {
                if (undoModal) undoModal.style.display = 'none';
                NetworkManager.sendGomokuUndoResponse(false);
                UIRenderer.showToast('❌ 你拒绝了对方的悔棋申请');
            });
        }

        // 绑定五子棋对局结束【重来一局】按钮
        const btnGomokuRematch = document.getElementById('btnGomokuRematch');
        if (btnGomokuRematch) {
            btnGomokuRematch.addEventListener('click', () => {
                const engine = window.gomokuEngine;
                if (!engine) return;

                // 单机 AI 模式：直接重置开始新局
                if (engine.isAiMode) {
                    engine.reset(true, 1);
                    this.initGomokuUI();
                    this.renderGomokuBoard();
                    this.updateGomokuStatusUI('黑方落子中 (你)');
                    UIRenderer.showToast('🟢 重新开始！你是先手黑棋');
                    this.startGomokuTurnTimer(); // 重新开局：玩家先手启动倒计时
                    return;
                }

                // 在线双人模式：向云端发送准备重来一局信号
                this.gomokuMyRematchReady = true;
                btnGomokuRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnGomokuRematch.disabled = true;
                btnGomokuRematch.classList.add('disabled');

                NetworkManager.sendGomokuRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // ============================================================
        // ⚫⚪ 游鲸围棋 大厅按钮绑定 (创建/加入/在线大厅/AI/路数选择/对局控制)
        // ============================================================

        // 围棋个人信息按钮
        const btnGoAuth = document.getElementById('btnGoAuth');
        if (btnGoAuth) {
            btnGoAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 在线围棋房间大厅
        const btnPublicGoRooms = document.getElementById('btnPublicGoRooms');
        if (btnPublicGoRooms && publicModal) {
            btnPublicGoRooms.addEventListener('click', () => {
                currentPublicGameType = 'GO';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('GO');
            });
        }

        // 创建围棋在线对局
        const btnCreateGoRoom = document.getElementById('btnCreateGoRoom');
        if (btnCreateGoRoom) {
            btnCreateGoRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'GO';
                NetworkManager.gameType = 'GO';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 围棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建围棋房间失败');
                }, 'GO');
            });
        }

        // 输入 6 位房间号加入围棋对局
        const btnJoinGo = document.getElementById('btnJoinGo');
        const joinGoInput = document.getElementById('joinGoInput');
        if (btnJoinGo && joinGoInput) {
            btnJoinGo.addEventListener('click', () => {
                const roomId = joinGoInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位围棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入围棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入围棋房间失败');
                });
            });
        }

        // 围棋单机 AI 按钮
        const btnPlayGoAi = document.getElementById('btnPlayGoAi');
        if (btnPlayGoAi) {
            btnPlayGoAi.addEventListener('click', () => this.startGoAiMode());
        }

        // 围棋 AI 棋盘路数选择 (9 / 13 / 19)
        const sizeButtons = [
            { btn: document.getElementById('btnGoSize9'), size: 9 },
            { btn: document.getElementById('btnGoSize13'), size: 13 },
            { btn: document.getElementById('btnGoSize19'), size: 19 }
        ];
        sizeButtons.forEach(({ btn, size }) => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                this.goBoardSize = size;
                sizeButtons.forEach(({ btn: b }) => { if (b) b.classList.remove('active'); });
                btn.classList.add('active');
                UIRenderer.showToast(`🎯 人机围棋棋盘已切换为 ${size} 路`);
            });
        });

        // 围棋停一手 (Pass)
        const btnGoPass = document.getElementById('btnGoPass');
        if (btnGoPass) {
            btnGoPass.addEventListener('click', () => this.handleGoPass());
        }

        // 围棋数目结算
        const btnGoScore = document.getElementById('btnGoScore');
        if (btnGoScore) {
            btnGoScore.addEventListener('click', () => this.handleGoScore());
        }

        // 围棋认输
        const btnGoResign = document.getElementById('btnGoResign');
        if (btnGoResign) {
            btnGoResign.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine || engine.isGameOver) return;
                const myColor = engine.playerColor;
                if (!engine.isAiMode && NetworkManager.isHost !== undefined && !NetworkManager.isHost && engine.currentTurn !== myColor) {
                    UIRenderer.showToast('⏳ 还没轮到你，请等待对方落子');
                    return;
                }
                engine.resign(myColor);
                this.stopGoTurnTimer();
                const winner = myColor === 1 ? 2 : 1;
                this.handleGoEnd(winner, 'RESIGN');
                // 联机广播认输结果
                if (!engine.isAiMode && NetworkManager.sendGoEnd) {
                    NetworkManager.sendGoEnd('RESIGN', winner);
                }
            });
        }

        // 围棋悔棋 (单局限 3 次，需对方确认)
        const btnGoUndo = document.getElementById('btnGoUndo');
        if (btnGoUndo) {
            btnGoUndo.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine) return;
                if (this.goUndoLeft === undefined) this.goUndoLeft = 3;

                if (this.goUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }

                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 盘面上暂无落子可撤回');
                    return;
                }

                // 单机 AI 模式：AI 自动同意悔棋，直接撤回并扣除次数
                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.goUndoLeft--;
                        const countEl = document.getElementById('goUndoCount');
                        if (countEl) countEl.textContent = this.goUndoLeft;

                        if (this.goUndoLeft <= 0) {
                            btnGoUndo.disabled = true;
                            btnGoUndo.classList.add('disabled');
                        }

                        this.renderGoBoard();
                        this.updateGoStatusUI(`已撤回，本局还可悔棋 ${this.goUndoLeft} 次`);
                        UIRenderer.showToast(`↺ 悔棋成功！单局剩余 ${this.goUndoLeft} 次`);
                        // 悔棋后回到玩家回合：重启倒计时
                        if (engine.currentTurn === engine.playerColor) this.startGoTurnTimer();
                        else this.stopGoTurnTimer();
                    }
                    return;
                }

                // 在线双人模式：向对方发送悔棋申请
                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendGoUndoRequest(NetworkManager.nickname);
            });
        }

        // 围棋悔棋申请弹窗按钮
        const btnAgreeGoUndo = document.getElementById('btnAgreeGoUndo');
        const btnRejectGoUndo = document.getElementById('btnRejectGoUndo');
        const goUndoModal = document.getElementById('goUndoModal');

        if (btnAgreeGoUndo) {
            btnAgreeGoUndo.addEventListener('click', () => {
                if (goUndoModal) goUndoModal.style.display = 'none';
                if (window.goEngine) {
                    window.goEngine.undo();
                    this.renderGoBoard();
                    this.updateGoStatusUI('已同意悔棋，局面已更新');
                }
                NetworkManager.sendGoUndoResponse(true);
                UIRenderer.showToast('✅ 你已同意对方悔棋');
            });
        }

        if (btnRejectGoUndo) {
            btnRejectGoUndo.addEventListener('click', () => {
                if (goUndoModal) goUndoModal.style.display = 'none';
                NetworkManager.sendGoUndoResponse(false);
                UIRenderer.showToast('❌ 你拒绝了对方的悔棋申请');
            });
        }

        // 围棋数目结算弹窗关闭
        const btnCloseGoScore = document.getElementById('btnCloseGoScore');
        const goScoreModal = document.getElementById('goScoreModal');
        if (btnCloseGoScore) {
            btnCloseGoScore.addEventListener('click', () => {
                if (goScoreModal) goScoreModal.style.display = 'none';
            });
        }
        if (goScoreModal) {
            goScoreModal.addEventListener('click', (e) => {
                if (e.target === goScoreModal) goScoreModal.style.display = 'none';
            });
        }

        // 围棋对局结束【重来一局】按钮
        const btnGoRematch = document.getElementById('btnGoRematch');
        if (btnGoRematch) {
            btnGoRematch.addEventListener('click', () => {
                const engine = window.goEngine;
                if (!engine) return;

                // 单机 AI 模式：直接重置开始新局
                if (engine.isAiMode) {
                    engine.reset(true, 1, this.goBoardSize || 19);
                    this.initGoUI();
                    this.renderGoBoard();
                    this.updateGoStatusUI('⚫ 黑方落子中 (你)');
                    UIRenderer.showToast('🟢 重新开始！你是先手黑棋');
                    this.startGoTurnTimer();
                    return;
                }

                // 在线双人模式：向云端发送准备重来一局信号
                this.goMyRematchReady = true;
                btnGoRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnGoRematch.disabled = true;
                btnGoRematch.classList.add('disabled');

                NetworkManager.sendGoRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // ============================================================
        // ♞ 游鲸中国象棋 大厅按钮绑定
        // ============================================================

        // 象棋个人信息
        const btnXqAuth = document.getElementById('btnXqAuth');
        if (btnXqAuth) {
            btnXqAuth.addEventListener('click', () => {
                if (AuthEngine.user && AuthEngine.userData) {
                    this.openStatsModal('MY_STATS');
                } else {
                    const authModal = document.getElementById('authModal');
                    if (authModal) authModal.style.display = 'flex';
                }
            });
        }

        // 创建象棋在线对局
        const btnCreateXiangqiRoom = document.getElementById('btnCreateXiangqiRoom');
        if (btnCreateXiangqiRoom) {
            btnCreateXiangqiRoom.addEventListener('click', () => {
                const nickname = getNickname();
                this.activeGameType = 'XIANGQI';
                NetworkManager.gameType = 'XIANGQI';
                NetworkManager.createRoom(nickname, (roomId) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(roomId);
                    }
                    UIRenderer.showToast(`✅ 象棋在线房间创建成功：#${roomId} (房间号已复制)`);
                    this.setupWaitingScreen(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '创建象棋房间失败');
                }, 'XIANGQI');
            });
        }

        // 输入房间号加入象棋
        const btnJoinXiangqi = document.getElementById('btnJoinXiangqi');
        const joinXiangqiInput = document.getElementById('joinXiangqiInput');
        if (btnJoinXiangqi && joinXiangqiInput) {
            btnJoinXiangqi.addEventListener('click', () => {
                const roomId = joinXiangqiInput.value.trim();
                if (!roomId || roomId.length !== 6) {
                    UIRenderer.showToast('⚠️ 请输入正确的 6 位象棋房间号');
                    return;
                }
                const nickname = getNickname();
                NetworkManager.joinRoom(roomId, nickname, () => {
                    UIRenderer.showToast(`✅ 成功进入象棋房间 #${roomId}`);
                    this.enterRoomAsClient(roomId);
                }, (err) => {
                    UIRenderer.showToast(err || '加入象棋房间失败');
                });
            });
        }

        // 在线象棋房间大厅
        const btnPublicXiangqiRooms = document.getElementById('btnPublicXiangqiRooms');
        if (btnPublicXiangqiRooms && publicModal) {
            btnPublicXiangqiRooms.addEventListener('click', () => {
                currentPublicGameType = 'XIANGQI';
                publicModal.style.display = 'flex';
                this.refreshPublicRoomsList('XIANGQI');
            });
        }

        // 象棋单机 AI
        const btnPlayXiangqiAi = document.getElementById('btnPlayXiangqiAi');
        if (btnPlayXiangqiAi) {
            btnPlayXiangqiAi.addEventListener('click', () => this.startXiangqiAiMode());
        }

        // 象棋悔棋 (AI 模式直接撤回, 联机发申请)
        const btnXqUndo = document.getElementById('btnXqUndo');
        if (btnXqUndo) {
            btnXqUndo.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine) return;
                if (this.xqUndoLeft === undefined) this.xqUndoLeft = 3;
                if (this.xqUndoLeft <= 0) {
                    UIRenderer.showToast('⚠️ 单局最多只能悔棋 3 次哦！');
                    return;
                }
                if (engine.moveHistory.length === 0) {
                    UIRenderer.showToast('⚠️ 棋盘上暂无走子可撤回');
                    return;
                }

                if (engine.isAiMode) {
                    const success = engine.undo();
                    if (success) {
                        this.xqUndoLeft--;
                        const countEl = document.getElementById('xqUndoCount');
                        if (countEl) countEl.textContent = this.xqUndoLeft;
                        if (this.xqUndoLeft <= 0) {
                            btnXqUndo.disabled = true;
                            btnXqUndo.classList.add('disabled');
                        }
                        this.xqSelected = null;
                        this.xqMoveDots = [];
                        this.renderXiangqiBoard();
                        this.updateXiangqiStatusUI(`↺ 已撤回，本局还可悔棋 ${this.xqUndoLeft} 次`);
                        if (engine.currentTurn === engine.playerColor) this.startXiangqiTurnTimer();
                        else { this.stopXiangqiTurnTimer(); this.triggerXiangqiAiMove(); }
                    }
                    return;
                }

                UIRenderer.showToast('📩 已向对方发送悔棋申请，请等待回应...');
                NetworkManager.sendXiangqiUndoRequest(NetworkManager.nickname);
            });
        }

        // 象棋认输
        const btnXqResign = document.getElementById('btnXqResign');
        if (btnXqResign) {
            btnXqResign.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine || engine.isGameOver) return;
                const myColor = engine.playerColor;
                if (!engine.isAiMode && NetworkManager.isHost !== undefined && !NetworkManager.isHost && engine.currentTurn !== myColor) {
                    UIRenderer.showToast('⏳ 还没轮到你，请等待对方走子');
                    return;
                }
                engine.resign(myColor);
                this.stopXiangqiTurnTimer();
                const winner = myColor === 'R' ? 'B' : 'R';
                this.handleXiangqiEnd(winner, 'RESIGN');
                if (!engine.isAiMode && NetworkManager.sendXiangqiEnd) {
                    NetworkManager.sendXiangqiEnd('RESIGN', winner);
                }
            });
        }

        // 象棋重来一局
        const btnXqRematch = document.getElementById('btnXqRematch');
        if (btnXqRematch) {
            btnXqRematch.addEventListener('click', () => {
                const engine = window.xiangqiEngine;
                if (!engine) return;
                if (engine.isAiMode) {
                    engine.reset(true, 1, 0);
                    // AI 模式重开: 重新随机先后手
                    window.xiangqiEngine.reset(true, Math.random() < 0.5 ? 'R' : 'B');
                    this.initXiangqiUI();
                    this.renderXiangqiBoard();
                    const myColor = window.xiangqiEngine.playerColor;
                    this.updateXiangqiStatusUI(myColor === 'R' ? '🔴 轮到你落子 (红方先手)' : '🤖 AI 棋圣 (红方) 思考中...');
                    UIRenderer.showToast(myColor === 'R' ? '🟢 重新开始！你是红方先手' : '🟢 重新开始！你是黑方后手');
                    if (myColor === 'R') this.startXiangqiTurnTimer();
                    else this.triggerXiangqiAiMove();
                    return;
                }
                this.xqMyRematchReady = true;
                btnXqRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 已准备 (等待对方...)';
                btnXqRematch.disabled = true;
                btnXqRematch.classList.add('disabled');
                NetworkManager.sendXiangqiRematchVote(true);
                UIRenderer.showToast('⌛ 已提交【重来一局】，等待对方回应...');
            });
        }

        // 代理列表项中的"一键加入/替换AI"按钮点击
        const listContainer = document.getElementById('publicRoomsListContainer');
        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const joinBtn = e.target.closest('[data-join-room-id]');
                if (!joinBtn) return;
                const roomId = joinBtn.dataset.joinRoomId;
                if (!roomId) return;

                publicModal.style.display = 'none';
                const nickname = getNickname();
                const joinInput = document.getElementById('joinRoomInput');
                if (joinInput) joinInput.value = roomId;

                NetworkManager.joinRoom(roomId, nickname, () => {
                    this.enterRoomAsClient(roomId);
                    UIRenderer.showToast(`✅ 已进入房间 ${roomId}`);
                }, (err) => {
                    UIRenderer.showToast(err);
                });
            });
        }

        // 复制邀请链接 & 复制房间号 (null-safe)
        const _copyInvite1  = document.getElementById('btnCopyInviteUrl');
        const _copyLink     = document.getElementById('btnCopyLink');
        const _btnCopyRoomId= document.getElementById('btnCopyRoomId');
        if (_copyInvite1)  _copyInvite1.addEventListener('click', () => this.copyInviteUrl());
        if (_copyLink)     _copyLink.addEventListener('click', () => this.copyInviteUrl());
        if (_btnCopyRoomId)_btnCopyRoomId.addEventListener('click', () => this.copyRoomId());

        // ====== 账号认证 & 全网排行榜事件绑定 ======
        const userHeaderBadge  = document.getElementById('userHeaderBadge');
        const btnLeaderboard   = document.getElementById('btnOpenLeaderboard');
        const authModal        = document.getElementById('authModal');
        const statsModal       = document.getElementById('statsModal');
        const btnCloseAuth     = document.getElementById('btnCloseAuthModal');
        const btnCloseStats    = document.getElementById('btnCloseStatsModal');

        // 打开登录/战绩弹窗
        const handleOpenAuthOrStats = () => {
            if (AuthEngine.user && AuthEngine.userData) {
                this.openStatsModal('MY_STATS');
            } else {
                if (authModal) authModal.style.display = 'flex';
            }
        };

        if (userHeaderBadge) userHeaderBadge.addEventListener('click', handleOpenAuthOrStats);
        const btnLobbyAuth = document.getElementById('btnLobbyAuth');
        const lobbyAuthBanner = document.getElementById('lobbyAuthBanner');
        if (btnLobbyAuth) btnLobbyAuth.addEventListener('click', handleOpenAuthOrStats);
        if (lobbyAuthBanner) lobbyAuthBanner.addEventListener('click', (e) => {
            if (e.target !== btnLobbyAuth) handleOpenAuthOrStats();
        });

        if (btnLeaderboard) {
            btnLeaderboard.addEventListener('click', () => {
                this.openStatsModal('LEADERBOARD');
            });
        }

        // ====== 顶部统一功能下拉菜单 ======
        const btnNavMenu       = document.getElementById('btnNavMenu');
        const navMenuDropdown  = document.getElementById('navMenuDropdown');
        const menuBtnStats     = document.getElementById('menuBtnStats');
        const menuBtnLb        = document.getElementById('menuBtnLeaderboard');
        const menuBtnHelp      = document.getElementById('menuBtnCardHelp');
        const menuBtnSound     = document.getElementById('menuBtnToggleSound');
        const menuBtnLeave     = document.getElementById('menuBtnLeaveRoom');

        if (btnNavMenu && navMenuDropdown) {
            btnNavMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                navMenuDropdown.style.display = navMenuDropdown.style.display === 'none' ? 'flex' : 'none';
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.nav-menu-container')) {
                    navMenuDropdown.style.display = 'none';
                }
            });
        }

        if (menuBtnStats) {
            menuBtnStats.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                handleOpenAuthOrStats();
            });
        }
        if (menuBtnLb) {
            menuBtnLb.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                const lbModal = document.getElementById('leaderboardModal');
                if (lbModal) lbModal.style.display = 'flex';
                this.renderLeaderboard();
            });
        }
        if (menuBtnHelp) {
            menuBtnHelp.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                this.openRulesModal();
            });
        }
        if (menuBtnSound) {
            menuBtnSound.addEventListener('click', () => {
                const isEnabled = SoundEngine.toggleSound();
                const soundIcon = document.getElementById('soundIcon');
                const menuSoundIcon = document.getElementById('menuSoundIcon');
                const menuSoundText = document.getElementById('menuSoundText');

                if (soundIcon) soundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                if (menuSoundIcon) menuSoundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                if (menuSoundText) menuSoundText.textContent = isEnabled ? '音效已开启' : '音效已静音';

                UIRenderer.showToast(isEnabled ? '音效已开启' : '音效已静音');
            });
        }
        if (menuBtnLeave) {
            menuBtnLeave.addEventListener('click', () => {
                if (navMenuDropdown) navMenuDropdown.style.display = 'none';
                this.resetToLobby();
            });
        }

        if (btnCloseAuth && authModal) btnCloseAuth.addEventListener('click', () => authModal.style.display = 'none');
        if (btnCloseStats && statsModal) btnCloseStats.addEventListener('click', () => statsModal.style.display = 'none');

        // Auth 弹窗选项卡
        const tabLogin    = document.getElementById('tabLogin');
        const tabRegister = document.getElementById('tabRegister');
        const formLogin   = document.getElementById('formLogin');
        const formRegister= document.getElementById('formRegister');

        if (tabLogin && tabRegister) {
            tabLogin.addEventListener('click', () => {
                tabLogin.classList.add('active');
                tabRegister.classList.remove('active');
                if (formLogin) formLogin.style.display = 'block';
                if (formRegister) formRegister.style.display = 'none';
            });
            tabRegister.addEventListener('click', () => {
                tabRegister.classList.add('active');
                tabLogin.classList.remove('active');
                if (formRegister) formRegister.style.display = 'block';
                if (formLogin) formLogin.style.display = 'none';
            });
        }

        // 登录提交
        if (formLogin) {
            formLogin.addEventListener('submit', (e) => {
                e.preventDefault();
                const acc = document.getElementById('loginAccount').value;
                const pwd = document.getElementById('loginPassword').value;
                AuthEngine.loginWithEmail(acc, pwd, (data) => {
                    if (authModal) authModal.style.display = 'none';
                    UIRenderer.showToast(`🎉 欢迎回来，${data.nickname}！`);
                }, (errMsg) => {
                    UIRenderer.showToast(`❌ ${errMsg}`);
                });
            });
        }

        // 注册提交
        if (formRegister) {
            formRegister.addEventListener('submit', (e) => {
                e.preventDefault();
                const acc  = document.getElementById('regAccount').value;
                const pwd  = document.getElementById('regPassword').value;
                const nick = document.getElementById('regNickname').value;
                AuthEngine.registerWithEmail(acc, pwd, nick, (data) => {
                    if (authModal) authModal.style.display = 'none';
                    UIRenderer.showToast(`🎉 注册成功！欢迎入住游鲸斗地主，${data.nickname}！`);
                }, (errMsg) => {
                    UIRenderer.showToast(`❌ ${errMsg}`);
                });
            });
        }

        // 微信登录暂未接入，按鈕保留但不操作 (防止调用不存在的方法)

        // 退出登录
        const btnLogout = document.getElementById('btnLogout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                AuthEngine.logout(() => {
                    if (statsModal) statsModal.style.display = 'none';
                    UIRenderer.showToast('已退出登录');
                });
            });
        }

        // 更换外观与皮肤工坊 Modal 绑定
        const appearanceModal = document.getElementById('appearanceModal');
        const btnLobbyAppearance = document.getElementById('btnLobbyAppearance');
        const btnStatsAppearance = document.getElementById('btnStatsAppearance');
        const btnCloseAppearanceModal = document.getElementById('btnCloseAppearanceModal');

        const openAppearance = () => {
            if (appearanceModal) appearanceModal.style.display = 'flex';
        };

        if (btnLobbyAppearance) btnLobbyAppearance.addEventListener('click', openAppearance);
        if (btnStatsAppearance) btnStatsAppearance.addEventListener('click', openAppearance);
        if (btnCloseAppearanceModal) {
            btnCloseAppearanceModal.addEventListener('click', () => {
                if (appearanceModal) appearanceModal.style.display = 'none';
            });
        }

        // 皮肤 Tabs 切换
        const tabSkinTheme = document.getElementById('tabSkinTheme');
        const tabSkinAvatar = document.getElementById('tabSkinAvatar');
        const tabSkinGlow = document.getElementById('tabSkinGlow');
        const viewSkinTheme = document.getElementById('viewSkinTheme');
        const viewSkinAvatar = document.getElementById('viewSkinAvatar');
        const viewSkinGlow = document.getElementById('viewSkinGlow');

        const switchSkinTab = (activeTab, activeView) => {
            [tabSkinTheme, tabSkinAvatar, tabSkinGlow].forEach(t => { if (t) t.classList.remove('active'); });
            [viewSkinTheme, viewSkinAvatar, viewSkinGlow].forEach(v => { if (v) v.style.display = 'none'; });
            if (activeTab) activeTab.classList.add('active');
            if (activeView) activeView.style.display = 'grid';
        };

        if (tabSkinTheme)  tabSkinTheme.addEventListener('click', () => switchSkinTab(tabSkinTheme, viewSkinTheme));
        if (tabSkinAvatar) tabSkinAvatar.addEventListener('click', () => switchSkinTab(tabSkinAvatar, viewSkinAvatar));
        if (tabSkinGlow)   tabSkinGlow.addEventListener('click', () => switchSkinTab(tabSkinGlow, viewSkinGlow));

        // 独立全网高手榜 Modal 绑定
        const leaderboardModal = document.getElementById('leaderboardModal');
        const lobbyMiniLb = document.getElementById('lobbyMiniLeaderboard');
        const menuBtnLeaderboard = document.getElementById('menuBtnLeaderboard');
        const btnCloseLbModal = document.getElementById('btnCloseLeaderboardModal');

        const openLeaderboardModal = () => {
            if (leaderboardModal) leaderboardModal.style.display = 'flex';
            this.renderLeaderboard();
        };

        if (lobbyMiniLb) lobbyMiniLb.addEventListener('click', openLeaderboardModal);
        if (menuBtnLeaderboard) menuBtnLeaderboard.addEventListener('click', openLeaderboardModal);
        if (btnCloseLbModal) {
            btnCloseLbModal.addEventListener('click', () => {
                if (leaderboardModal) leaderboardModal.style.display = 'none';
            });
        }

        // 个人信息 与 个人战绩 左上方延伸 Bar 页签切换绑定
        const tabBarInfo = document.getElementById('tabBarInfo');
        const tabBarStats = document.getElementById('tabBarStats');
        const viewMyStats = document.getElementById('viewMyStats');
        const viewDetailedStats = document.getElementById('viewDetailedStats');

        const switchProtrudingTab = (isInfo) => {
            if (isInfo) {
                if (tabBarInfo) tabBarInfo.classList.add('active');
                if (tabBarStats) tabBarStats.classList.remove('active');
                if (viewMyStats) viewMyStats.style.display = 'flex';
                if (viewDetailedStats) viewDetailedStats.style.display = 'none';
            } else {
                if (tabBarStats) tabBarStats.classList.add('active');
                if (tabBarInfo) tabBarInfo.classList.remove('active');
                if (viewDetailedStats) viewDetailedStats.style.display = 'flex';
                if (viewMyStats) viewMyStats.style.display = 'none';
                this.renderDetailedStatsView();
            }
        };

        if (tabBarInfo) tabBarInfo.addEventListener('click', () => switchProtrudingTab(true));
        if (tabBarStats) tabBarStats.addEventListener('click', () => switchProtrudingTab(false));

        // 房主点击开局按钮 (按游戏类型 DOUDIZHU vs GOMOKU vs MAHJONG 分流广播)
        const _btnStartGame = document.getElementById('btnStartGame');
        if (_btnStartGame) {
            _btnStartGame.addEventListener('click', () => {
                const isMahjong = (NetworkManager.gameType === 'MAHJONG') || (this.activeGameType === 'MAHJONG');
                const isGomoku = (NetworkManager.gameType === 'GOMOKU') || (this.activeGameType === 'GOMOKU');
                const isGo = (NetworkManager.gameType === 'GO') || (this.activeGameType === 'GO');
                const isXiangqi = (NetworkManager.gameType === 'XIANGQI') || (this.activeGameType === 'XIANGQI');
                if (isMahjong) {
                    this.startMahjongOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                } else if (isXiangqi) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendXiangqiStart(NetworkManager.roomId);
                        this.startXiangqiOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startXiangqiAiMode();
                    }
                } else if (isGo) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendGoStart(NetworkManager.roomId);
                        this.startGoOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startGoAiMode();
                    }
                } else if (isGomoku) {
                    const hasSecondPlayer = this.gameState.players[1] && !this.gameState.players[1].isAi && this.gameState.players[1].name;
                    if (hasSecondPlayer) {
                        NetworkManager.sendGomokuStart(NetworkManager.roomId);
                        this.startGomokuOnlineGame(NetworkManager.roomId, NetworkManager.isHost);
                    } else {
                        // 如果没有其他真人，自动补齐 AI 棋圣开局
                        this.startGomokuAiMode();
                    }
                } else {
                    this.fillAiAndStart();
                }
            });
        }

        // 补齐机器人开局 (null-safe)
        const _btnStartWithAi = document.getElementById('btnStartWithAi');
        if (_btnStartWithAi) {
            _btnStartWithAi.addEventListener('click', () => {
                const isMahjong = (NetworkManager.gameType === 'MAHJONG') || (this.activeGameType === 'MAHJONG');
                const isGomoku = (NetworkManager.gameType === 'GOMOKU') || (this.activeGameType === 'GOMOKU');
                const isGo = (NetworkManager.gameType === 'GO') || (this.activeGameType === 'GO');
                const isXiangqi = (NetworkManager.gameType === 'XIANGQI') || (this.activeGameType === 'XIANGQI');

                if (isMahjong) {
                    this.startMahjongAiMode();
                } else if (isXiangqi) {
                    this.startXiangqiAiMode();
                } else if (isGo) {
                    this.startGoAiMode();
                } else if (isGomoku) {
                    this.startGomokuAiMode();
                } else {
                    this.fillAiAndStart();
                }
            });
        }

        // 绑定胜负横幅【再来一局】、【收起/关闭】与【展开】事件
        document.addEventListener('click', (e) => {
            const restartBtn = e.target.closest('#btnRestartGame');
            if (restartBtn) {
                const myIndex = NetworkManager.myPlayerIndex;
                if (NetworkManager.isHost) {
                    this.processRestartVote(myIndex);
                } else {
                    NetworkManager.sendActionToHost('RESTART_VOTE', { playerIndex: myIndex });
                }
                return;
            }

            const closeBtn = e.target.closest('#btnCloseVictoryBanner');
            if (closeBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'true';
                    this.onReceiveStateUpdate(this.gameState);
                }
                return;
            }

            const expandBtn = e.target.closest('#btnExpandVictory');
            if (expandBtn) {
                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.dataset.minimized = 'false';
                    this.onReceiveStateUpdate(this.gameState);
                }
                return;
            }
        });

        // 绑定【理牌】按钮事件
        const btnSort = document.getElementById('btnSortCards');
        if (btnSort) {
            btnSort.addEventListener('click', () => {
                this.sortSelfHand();
            });
        }

        // 绑定仅点击【自己头像】弹出经典快捷用语菜单与短语发送
        document.addEventListener('click', (e) => {
            const avatarTarget = e.target.closest('#avatarSelf, .self-avatar');
            const menu = document.getElementById('quickPhraseMenu');
            if (avatarTarget && menu) {
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                return;
            }

            const closeBtn = e.target.closest('#btnClosePhrase');
            if (closeBtn && menu) {
                menu.style.display = 'none';
                return;
            }

            const phraseItem = e.target.closest('.phrase-item');
            if (phraseItem && menu) {
                const text = phraseItem.textContent.trim();
                menu.style.display = 'none';
                this.sendChatPhrase(text);
                return;
            }

            // 点击外部自动关闭短语弹窗
            if (menu && menu.style.display !== 'none' && !e.target.closest('#quickPhraseMenu')) {
                menu.style.display = 'none';
            }
        });

        // 绑定左上角【回到主页】与离开房间按钮
        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.addEventListener('click', () => this.resetToLobby());

        // 游鲸五子棋 Header 艺术黑白双棋子点击互动弹跳缩放 + 击石双落音效
        const gomokuStonesDeco = document.querySelector('.gomoku-stones-decoration');
        if (gomokuStonesDeco) {
            gomokuStonesDeco.addEventListener('click', () => {
                gomokuStonesDeco.classList.remove('animate');
                void gomokuStonesDeco.offsetWidth; // 强制重发 Keyframe
                gomokuStonesDeco.classList.add('animate');
                if (window.SoundEngine && window.SoundEngine.playStoneDrop) {
                    window.SoundEngine.playStoneDrop(false);
                    setTimeout(() => window.SoundEngine.playStoneDrop(true), 90);
                }
            });
        }

        // 游鲸斗地主 Header 艺术大小王王炸卡牌点击/触摸互动弹跳缩放 + 翻牌音效 (sound/card-flip.wav)
        const doudizhuCardsDeco = document.querySelector('.doudizhu-cards-decoration');
        if (doudizhuCardsDeco) {
            const triggerJokerAction = () => {
                if (window.SoundEngine) {
                    window.SoundEngine.unlockMobileAudio();
                }
                doudizhuCardsDeco.classList.remove('animate');
                void doudizhuCardsDeco.offsetWidth; // 强制重发 Keyframe
                doudizhuCardsDeco.classList.add('animate');
                if (window.SoundEngine) {
                    if (typeof window.SoundEngine.playCardFlipSound === 'function') {
                        window.SoundEngine.playCardFlipSound();
                    } else if (typeof window.SoundEngine.playCardPlace === 'function') {
                        window.SoundEngine.playCardPlace();
                    }
                }
            };
            doudizhuCardsDeco.addEventListener('touchstart', () => {
                doudizhuCardsDeco._touchHandled = true;
                triggerJokerAction();
            }, { passive: true });

            doudizhuCardsDeco.addEventListener('click', () => {
                if (doudizhuCardsDeco._touchHandled) {
                    doudizhuCardsDeco._touchHandled = false;
                    return;
                }
                triggerJokerAction();
            });
        }

        // 离开/取消等待/返回大厅 (null-safe, 无重复绑定)
        const btnCancelWaiting = document.getElementById('btnCancelWaiting');
        const btnLeaveRoom     = document.getElementById('btnLeaveRoom');
        const btnBackToLobby   = document.getElementById('btnBackToLobby');
        if (btnCancelWaiting) btnCancelWaiting.addEventListener('click', () => this.resetToLobby());
        if (btnLeaveRoom)     btnLeaveRoom.addEventListener('click', () => this.resetToLobby());
        if (btnBackToLobby)   btnBackToLobby.addEventListener('click', () => this.resetToLobby());

        // 音效开关 (null-safe)
        const _btnSound = document.getElementById('btnToggleSound');
        if (_btnSound) _btnSound.addEventListener('click', () => {
            const isEnabled = SoundEngine.toggleSound();
            const soundIcon = document.getElementById('soundIcon');
            if (soundIcon) soundIcon.className = isEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
            UIRenderer.showToast(isEnabled ? '音效已开启' : '音效已静音');
        });

        // 牌型说明弹窗
        const cardHelpBtn  = document.getElementById('btnCardHelp');
        const cardTypeModal = document.getElementById('cardTypeModal');
        const closeCardType = document.getElementById('btnCloseCardType');

        if (cardHelpBtn && cardTypeModal) {
            cardHelpBtn.addEventListener('click', () => {
                this.openRulesModal();
            });
            closeCardType.addEventListener('click', () => {
                cardTypeModal.style.display = 'none';
            });
            // 点击遮罩层外部关闭
            cardTypeModal.addEventListener('click', (e) => {
                if (e.target === cardTypeModal) cardTypeModal.style.display = 'none';
            });
        }


        // 按钮组事件绑定 (叫地主 1分/2分/3分/不叫/出牌/不出/提示)
        const bid1Btn = document.getElementById('btnBid1');
        if (bid1Btn) bid1Btn.addEventListener('click', () => this.handleSelfAction('BID', 1));

        const bid2Btn = document.getElementById('btnBid2');
        if (bid2Btn) bid2Btn.addEventListener('click', () => this.handleSelfAction('BID', 2));

        const bid3Btn = document.getElementById('btnBid3');
        if (bid3Btn) bid3Btn.addEventListener('click', () => this.handleSelfAction('BID', 3));

        const bidLandlordBtn = document.getElementById('btnBidLandlord');
        if (bidLandlordBtn) bidLandlordBtn.addEventListener('click', () => this.handleSelfAction('BID', 3));

        const bidPassBtn = document.getElementById('btnBidPass');
        if (bidPassBtn) bidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        const reBid1Btn = document.getElementById('btnReBid1');
        if (reBid1Btn) reBid1Btn.addEventListener('click', () => this.handleSelfAction('BID', 'CLAIM'));

        const reBidPassBtn = document.getElementById('btnReBidPass');
        if (reBidPassBtn) reBidPassBtn.addEventListener('click', () => this.handleSelfAction('BID', 'PASS'));

        const _btnPass        = document.getElementById('btnPass');
        const _btnHint        = document.getElementById('btnHint');
        const _btnPlayCard    = document.getElementById('btnPlayCard');
        const _btnPlayAgain   = document.getElementById('btnPlayAgain');
        const _btnBackToLobby2= document.getElementById('btnBackToLobby');
        if (_btnPass)      _btnPass.addEventListener('click', () => this.handleSelfAction('PLAY', []));
        if (_btnHint)      _btnHint.addEventListener('click', () => this.triggerSmartHint());
        if (_btnPlayCard)  _btnPlayCard.addEventListener('click', () => this.triggerPlayCard());

        // 结算屏按钮 (null-safe)
        if (_btnPlayAgain) _btnPlayAgain.addEventListener('click', () => {
            if (NetworkManager.isHost || NetworkManager.isAiMode) {
                this.startNewRound();
            } else {
                UIRenderer.showToast('请等待房主重新开局');
            }
        });
        if (_btnBackToLobby2) _btnBackToLobby2.addEventListener('click', () => this.resetToLobby());
    }

    /**
     * 彻底终止斗地主的回合倒计时与 AI 叫牌定时器
     * (切换麻将/五子棋/返回大厅时必须调用，否则残留 timer 会在其他游戏中触发 handleTurnTimeout)
     */
    stopDoudizhuTimers() {
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }
        if (this.turnTimerId) {
            clearInterval(this.turnTimerId);
            this.turnTimerId = null;
        }
        if (this._aiBidTimer) {
            clearTimeout(this._aiBidTimer);
            this._aiBidTimer = null;
        }
        if (this._gomokuTimerInterval) {
            clearInterval(this._gomokuTimerInterval);
            this._gomokuTimerInterval = null;
        }
        const gBadge = document.getElementById('gomokuTimerBadge');
        if (gBadge) gBadge.style.display = 'none';
        this.gameState.phase = 'LOBBY';
    }

    /**
     * 彻底终止麻将对局中的所有定时器、看门狗与 AI 轮转 loop
     */
    stopMahjongGame() {
        if (window.mahjongEngine) {
            window.mahjongEngine.isGameOver = true;
        }
        if (this._mahjongWatchdogId) {
            clearInterval(this._mahjongWatchdogId);
            this._mahjongWatchdogId = null;
        }
        if (this._mahjongTimerInterval) {
            clearInterval(this._mahjongTimerInterval);
            this._mahjongTimerInterval = null;
        }
        if (this._mahjongResponseTimer) {
            clearTimeout(this._mahjongResponseTimer);
            this._mahjongResponseTimer = null;
        }
        this._mahjongAiBusy = false;
        this.pendingDiscardRes = null;

        const timerEl = document.getElementById('mahjongTimer');
        if (timerEl) {
            timerEl.textContent = '25';
            timerEl.classList.remove('urgent');
        }
    }

    /**
     * 重置界面并退出当前房间 (无论是人机还是玩家对局，只要无真人玩家立即删除云端房间)
     */
    resetToLobby() {
        // 彻底清空麻将与斗地主所有定时器，防止离开大厅后后台 AI 继续走牌并播音效！
        this.stopMahjongGame();
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }
        if (this.turnTimerId) {
            clearInterval(this.turnTimerId);
            this.turnTimerId = null;
        }
        this.gameState.phase = 'LOBBY';

        const doResetUI = () => {
            const lobbyScr = document.getElementById('lobbyScreen');
            const waitingScr = document.getElementById('waitingScreen');
            const doudizhuScr = document.getElementById('gameScreen');
            const gomokuScr = document.getElementById('gomokuGameScreen');
            const mahjongScr = document.getElementById('mahjongGameScreen');

            if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
            if (doudizhuScr) { doudizhuScr.style.display = 'none'; doudizhuScr.classList.remove('active'); }
            if (gomokuScr) { gomokuScr.style.display = 'none'; gomokuScr.classList.remove('active'); }
            if (mahjongScr) { mahjongScr.style.display = 'none'; mahjongScr.classList.remove('active'); }

            if (lobbyScr) { lobbyScr.style.display = 'flex'; lobbyScr.classList.add('active'); }

            this.updateHeaderVisibility();
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardSort) SoundEngine.playCardSort();
        };

        if (typeof NetworkManager !== 'undefined' && NetworkManager.leaveRoom) {
            NetworkManager.leaveRoom(() => {
                doResetUI();
            });
        } else {
            doResetUI();
        }
    }

    /**
     * 打开个人战绩名片与排行榜弹窗 (支持每日改名一次 + 更换头像)
     */
    openStatsModal(activeTab) {
        const statsModal = document.getElementById('statsModal');
        if (!statsModal) return;
        statsModal.style.display = 'flex';

        // 默认重置回 个人信息 延伸页签
        const tabBarInfo = document.getElementById('tabBarInfo');
        const tabBarStats = document.getElementById('tabBarStats');
        const viewMyStats = document.getElementById('viewMyStats');
        const viewDetailedStats = document.getElementById('viewDetailedStats');

        if (tabBarInfo) tabBarInfo.classList.add('active');
        if (tabBarStats) tabBarStats.classList.remove('active');
        if (viewMyStats) viewMyStats.style.display = 'flex';
        if (viewDetailedStats) viewDetailedStats.style.display = 'none';

        const data = AuthEngine.userData || {
            nickname: localStorage.getItem('youjing_doudizhu_nickname') || '游客玩家',
            email: '游客账号（未绑定）',
            avatar: '🤠',
            yinCoins: 1000,
            totalGames: 0,
            wins: 0
        };

        const total    = data.totalGames || 0;
        const wins     = data.wins || 0;
        const winRate  = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0%';
        const currentYin = data.yinCoins !== undefined ? data.yinCoins : 1000;
        const canRename = AuthEngine.canRenameToday();

        const avatarList = ['🤠', '👑', '🦁', '🦊', '🐱', '🐶', '🐼', '🐯', '🦄', '🚀', '🤖', '💎', '🔥', '⚡', '🎃', '👽'];

        const createdTs = data.created || Date.now();
        const dateObj = new Date(createdTs);
        const regDateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        const uidStr = data.uid ? `UID: ${data.uid}` : 'UID: 10001';

        const level = data.level || 1;
        const exp = data.exp || 0;
        const reqExp = AuthEngine.getReqExp(level);
        const title = AuthEngine.getLevelTitle(level);
        const expPct = (level >= 60) ? 100 : Math.min(100, Math.floor((exp / reqExp) * 100));
        const expDisplay = (level >= 60) ? '已达到 60 级巅峰满级' : `${exp} / ${reqExp} EXP (${expPct}%)`;

        const hero = document.getElementById('userProfileHero');
        if (hero) {
            hero.innerHTML = `
                <div class="profile-top" style="padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div class="profile-avatar-big" id="btnChangeAvatar" title="点击更换头像" style="cursor:pointer;position:relative;">
                        <span>${data.avatar || '🤠'}</span>
                        <div class="avatar-level-tag" style="bottom:-2px;right:-2px;width:18px;height:18px;font-size:0.65rem;border-width:2px;">${level}</div>
                    </div>
                    <div class="profile-names">
                        <div class="profile-nick" style="display:flex;align-items:center;gap:8px;">
                            <span>${data.nickname}</span>
                            ${canRename ? `
                                <button id="btnEditNick" style="background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.3);color:#ffd700;border-radius:3px;padding:2px 6px;font-size:0.72rem;cursor:pointer;font-weight:700;">
                                    <i class="fa-solid fa-pen-to-square"></i> 改名
                                </button>
                            ` : `
                                <span style="font-size:0.7rem;color:#94a3b8;">(今日已改名)</span>
                            `}
                        </div>
                        <div style="font-size:0.75rem;color:#94a3b8;margin-top:4px;display:flex;align-items:center;gap:10px;">
                            <span>${data.email || '游客账号'}</span>
                            <span style="color:#ffd700;font-weight:700;">${uidStr}</span>
                        </div>
                    </div>
                </div>

                <!-- 等级与经验条 -->
                <div style="margin-top:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,215,0,0.18);border-radius:6px;padding:8px 10px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;font-weight:700;margin-bottom:4px;">
                        <span style="color:#ffd700;display:flex;align-items:center;gap:6px;">
                            <i class="fa-solid fa-crown"></i> <span>${title}</span>
                        </span>
                        <span style="color:#94a3b8;font-size:0.72rem;">${expDisplay}</span>
                    </div>
                    <div style="width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                        <div style="width:${expPct}%;height:100%;background:linear-gradient(90deg,#f1c40f,#f39c12);border-radius:3px;transition:width 0.4s ease;"></div>
                    </div>
                </div>

                <!-- 头像选择框 (点击头像展开/关闭) -->

                <!-- 头像选择框 (点击头像展开/关闭) -->
                <div id="avatarPickerBox" style="display:none;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:8px;margin:8px 0 4px;">
                    <div style="font-size:0.75rem;color:#ffd700;margin-bottom:6px;font-weight:700;">点击更换头像：</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                        ${avatarList.map(a => `<span class="avatar-opt" data-avatar="${a}" style="font-size:1.5rem;cursor:pointer;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);">${a}</span>`).join('')}
                    </div>
                </div>

                <div class="profile-grid" style="margin-top:10px;">
                    <div class="profile-stat-box" style="cursor:pointer;" id="btnClaimBankruptcyInModal" title="点击领取破产救济 (+100 知因币)">
                        <div class="stat-val" style="color:#ffd700;">🪙 ${currentYin}</div>
                        <div class="stat-lbl">${currentYin < 50 ? '🆘 领破产补助(+100)' : '知因币'}</div>
                    </div>
                    <div class="profile-stat-box">
                        <div class="stat-val">${winRate}</div>
                        <div class="stat-lbl">胜率 (${wins}/${total})</div>
                    </div>
                    <div class="profile-stat-box">
                        <div class="stat-val">${wins} 胜</div>
                        <div class="stat-lbl">胜场</div>
                    </div>
                </div>
            `;

            // 点击领取破产救济金
            const btnClaimBank = document.getElementById('btnClaimBankruptcyInModal');
            if (btnClaimBank) {
                btnClaimBank.addEventListener('click', () => {
                    if (AuthEngine.claimBankruptcyAid()) {
                        this.openStatsModal('MY_STATS');
                    }
                });
            }

            // 头像点击展开/收起选择面板
            const avatarBtn = document.getElementById('btnChangeAvatar');
            const pickerBox = document.getElementById('avatarPickerBox');
            if (avatarBtn && pickerBox) {
                avatarBtn.addEventListener('click', () => {
                    pickerBox.style.display = pickerBox.style.display === 'none' ? 'block' : 'none';
                });
            }

            // 选择新头像
            const avatarOpts = hero.querySelectorAll('.avatar-opt');
            avatarOpts.forEach(opt => {
                opt.addEventListener('click', () => {
                    const newAvatar = opt.dataset.avatar;
                    AuthEngine.changeAvatar(newAvatar, (a) => {
                        UIRenderer.showToast(`✨ 头像已更换为 ${a}`);
                        this.openStatsModal('MY_STATS');
                    }, (err) => UIRenderer.showToast(`❌ ${err}`));
                });
            });

            // 点击【改名】按钮
            const editNickBtn = document.getElementById('btnEditNick');
            if (editNickBtn) {
                editNickBtn.addEventListener('click', () => {
                    const newNick = prompt('请输入新游戏昵称 (1-10个字符，每天仅可修改1次)：', data.nickname);
                    if (newNick !== null) {
                        AuthEngine.changeNickname(newNick, (nick) => {
                            UIRenderer.showToast(`🎉 昵称已成功修改为：${nick}`);
                            this.openStatsModal('MY_STATS');
                        }, (err) => {
                            UIRenderer.showToast(`❌ ${err}`);
                        });
                    }
                });
            }
        }

        const tabStats = document.getElementById('tabMyStats');
        const tabLb    = document.getElementById('tabLeaderboard');
        if (activeTab === 'LEADERBOARD' && tabLb) {
            tabLb.click();
        } else if (tabStats) {
            tabStats.click();
        }
    }

    /**
     * 渲染个人详细战绩 (隔离区分斗地主战绩与五子棋独立战绩)
     */
    renderDetailedStatsView(selectedGameType = null) {
        const container = document.getElementById('userDetailedStatsHero');
        if (!container) return;

        // 如果未指定，根据当前大厅 Tab 或界面自动决定初始视图
        const currentMode = selectedGameType || (this.activeGameType === 'GOMOKU' ? 'GOMOKU' : 'DOUDIZHU');

        const data = AuthEngine.userData || {
            totalGames: 0,
            wins: 0,
            landlordWins: 0,
            farmerWins: 0,
            matchHistory: [],
            gomokuStats: { totalGames: 0, wins: 0, losses: 0, draws: 0, matchHistory: [] }
        };

        const isGomoku = currentMode === 'GOMOKU';

        // 战绩选择切换按钮 Bar
        const selectorHtml = `
            <div style="display:flex;gap:8px;margin-bottom:12px;width:100%;">
                <button id="btnStatsTabDoudizhu" style="flex:1;padding:7px 10px;border-radius:8px;font-size:0.78rem;font-weight:800;cursor:pointer;transition:all 0.2s;border:1px solid ${!isGomoku ? '#e2a820' : 'rgba(255,255,255,0.1)'};background:${!isGomoku ? 'rgba(226,168,32,0.2)' : 'rgba(0,0,0,0.3)'};color:${!isGomoku ? '#ffd700' : '#94a3b8'};">
                    <i class="fa-solid fa-layer-group"></i> 斗地主战绩
                </button>
                <button id="btnStatsTabGomoku" style="flex:1;padding:7px 10px;border-radius:8px;font-size:0.78rem;font-weight:800;cursor:pointer;transition:all 0.2s;border:1px solid ${isGomoku ? '#34d399' : 'rgba(255,255,255,0.1)'};background:${isGomoku ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)'};color:${isGomoku ? '#34d399' : '#94a3b8'};">
                    <i class="fa-solid fa-chess-board"></i> 五子棋战绩
                </button>
            </div>
        `;

        let contentHtml = '';

        if (!isGomoku) {
            // 🃏 斗地主战绩渲染
            const total = data.totalGames || 0;
            const wins = data.wins || 0;
            const losses = Math.max(0, total - wins);
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0.0%';
            const landlordWins = data.landlordWins || 0;
            const farmerWins = data.farmerWins || 0;

            let historyList = Array.isArray(data.matchHistory) ? data.matchHistory : [];
            const historyHtml = historyList.length > 0 ? historyList.slice(0, 10).map((m) => {
                const isWin = m.isWin;
                const resStyle = isWin ? 'color:#00e676;background:rgba(0,230,118,0.12);border-color:rgba(0,230,118,0.3);' : 'color:#ff2a2a;background:rgba(255,42,42,0.12);border-color:rgba(255,42,42,0.3);';
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;font-size:0.78rem;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-weight:800;padding:1px 6px;border-radius:3px;border:1px solid;${resStyle}">
                                ${isWin ? '胜利' : '失败'}
                            </span>
                            <span style="color:#e2e8f0;font-weight:700;">${m.role || '斗地主'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;color:#94a3b8;font-size:0.74rem;">
                            <span>${m.multiplier || 2}倍局</span>
                            <span>${m.time || '12:00'}</span>
                        </div>
                    </div>
                `;
            }).join('') : `<div style="text-align:center;color:#94a3b8;padding:24px 10px;font-size:0.78rem;">暂无斗地主对局记录</div>`;

            contentHtml = `
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${winRate}</div><div class="stat-lbl">斗地主胜率</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#00e676;">${wins} 胜</div><div class="stat-lbl">胜场次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ff2a2a;">${losses} 败</div><div class="stat-lbl">败场次数</div></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${total}</div><div class="stat-lbl">总对局数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${landlordWins}</div><div class="stat-lbl">资本家胜场</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${farmerWins}</div><div class="stat-lbl">牛马胜场</div></div>
                </div>
                <div style="margin-top:10px;">
                    <div style="font-size:0.78rem;font-weight:800;color:#ffd700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                        <i class="fa-solid fa-clock-rotate-left"></i> 最近 10 场斗地主战报
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;padding-right:2px;">
                        ${historyHtml}
                    </div>
                </div>
            `;
        } else {
            // 🟢 五子棋战绩渲染
            const gStats = data.gomokuStats || { totalGames: 0, wins: 0, losses: 0, draws: 0, matchHistory: [] };
            const total = gStats.totalGames || 0;
            const wins = gStats.wins || 0;
            const losses = gStats.losses || 0;
            const draws = gStats.draws || 0;
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0.0%';

            let historyList = Array.isArray(gStats.matchHistory) ? gStats.matchHistory : [];
            const historyHtml = historyList.length > 0 ? historyList.slice(0, 10).map((m) => {
                const isWin = m.isWin;
                const isDraw = m.isDraw;
                let resStyle = 'color:#00e676;background:rgba(0,230,118,0.12);border-color:rgba(0,230,118,0.3);';
                let tagText = '胜利';
                if (isDraw) {
                    resStyle = 'color:#fbbf24;background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);';
                    tagText = '平局';
                } else if (!isWin) {
                    resStyle = 'color:#ff2a2a;background:rgba(255,42,42,0.12);border-color:rgba(255,42,42,0.3);';
                    tagText = '失败';
                }
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:4px;font-size:0.78rem;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-weight:800;padding:1px 6px;border-radius:3px;border:1px solid;${resStyle}">
                                ${tagText}
                            </span>
                            <span style="color:#e2e8f0;font-weight:700;">${m.role || '五子棋'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;color:#94a3b8;font-size:0.74rem;">
                            <span>${m.time || '12:00'}</span>
                        </div>
                    </div>
                `;
            }).join('') : `<div style="text-align:center;color:#34d399;padding:24px 10px;font-size:0.78rem;">暂无五子棋对局记录，快去棋盘切磋一局吧！</div>`;

            contentHtml = `
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#34d399;">${winRate}</div><div class="stat-lbl">五子棋胜率</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#00e676;">${wins} 胜</div><div class="stat-lbl">胜场次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ff2a2a;">${losses} 败</div><div class="stat-lbl">败场次数</div></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
                    <div class="profile-stat-box"><div class="stat-val" style="color:#ffffff;">${total}</div><div class="stat-lbl">总对局数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#fbbf24;">${draws} 平</div><div class="stat-lbl">平局次数</div></div>
                    <div class="profile-stat-box"><div class="stat-val" style="color:#34d399;">${wins}</div><div class="stat-lbl">五子连珠</div></div>
                </div>
                <div style="margin-top:10px;">
                    <div style="font-size:0.78rem;font-weight:800;color:#34d399;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                        <i class="fa-solid fa-clock-rotate-left"></i> 最近 10 场五子棋战报
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;padding-right:2px;">
                        ${historyHtml}
                    </div>
                </div>
            `;
        }

        container.innerHTML = selectorHtml + contentHtml;

        // 绑定战绩类型 Tab 切换
        const btnDoudizhu = document.getElementById('btnStatsTabDoudizhu');
        const btnGomoku   = document.getElementById('btnStatsTabGomoku');
        if (btnDoudizhu) btnDoudizhu.addEventListener('click', () => this.renderDetailedStatsView('DOUDIZHU'));
        if (btnGomoku)   btnGomoku.addEventListener('click', () => this.renderDetailedStatsView('GOMOKU'));
    }

    /**
     * 渲染主页顶部简略排行榜 (展示 Top 10，前三名加大间隔与奖牌，平滑无缝走马灯)
     */
    renderMiniLeaderboard() {
        const ticker = document.getElementById('miniLeaderboardTicker');
        if (!ticker) return;

        AuthEngine.fetchLeaderboard(list => {
            if (!list) {
                // 云端 SDK 尚未就绪或查询超时: 明确提示, 不再无限"加载中"
                ticker.innerHTML = '<span style="color:#94a3b8"><i class="fa-solid fa-cloud-arrow-down"></i> 排行榜暂不可用 · 游戏不受影响</span>';
                return;
            }
            if (list.length === 0) {
                ticker.innerHTML = '<span style="color:#94a3b8">暂无上榜玩家，注册开局即可登顶！</span>';
                return;
            }

            // 轮播总共展示前十名
            const top10 = list.slice(0, 10);

            const buildItemsHtml = (items) => {
                return items.map((u, i) => {
                    const rank = i + 1;
                    let medal = `<span style="font-weight:700;color:#94a3b8;font-size:0.68rem;">No.${rank}</span>`;
                    if (rank === 1) medal = '🥇';
                    if (rank === 2) medal = '🥈';
                    if (rank === 3) medal = '🥉';
                    const isTop3 = rank <= 3 ? 'is-top3' : '';
                    const cleanNick = typeof window.sanitizeNickname === 'function' ? window.sanitizeNickname(u.nickname) : u.nickname;
                    return `<span class="lb-top-item ${isTop3}"><span>${medal}</span><span class="lb-top-name">${cleanNick}</span><span class="lb-top-score">(${u.yinCoins !== undefined ? u.yinCoins : 1000}知因币)</span></span>`;
                }).join('<span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>');
            };

            const groupHtml = buildItemsHtml(top10);

            // 复制两两无缝衔接，实现 360° 无卡顿平滑循环走马灯
            ticker.innerHTML = `
                <div class="mini-lb-track">
                    ${groupHtml}
                    <span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>
                    ${groupHtml}
                    <span style="color:rgba(255,255,255,0.18);margin-right:14px;">•</span>
                </div>
            `;
        });
    }

    /**
     * 渲染全网知因币资产排行榜 Top 10
     */
    renderLeaderboard() {
        const container = document.getElementById('leaderboardListContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 加载知因币资产榜...</div>';

        AuthEngine.fetchLeaderboard(list => {
            container.innerHTML = '';
            if (!list) {
                // 云端 SDK 尚未就绪或查询超时
                container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;"><i class="fa-solid fa-cloud-arrow-down"></i> 排行榜暂不可用，游戏不受影响</div>';
                return;
            }
            if (list.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:25px;font-size:0.85rem;">暂无上榜玩家，注册即送 1000 因币！</div>';
                return;
            }

            list.forEach((user, idx) => {
                const rank = idx + 1;
                let rankClass = '';
                if (rank === 1) rankClass = 'top1';
                if (rank === 2) rankClass = 'top2';
                if (rank === 3) rankClass = 'top3';

                const cleanNick = typeof window.sanitizeNickname === 'function' ? window.sanitizeNickname(user.nickname) : user.nickname;
                const item = document.createElement('div');
                item.className = 'lb-item';
                item.innerHTML = `
                    <div class="lb-rank ${rankClass}">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
                    <div class="lb-nick">${user.avatar || '🤠'} ${cleanNick}</div>
                    <div class="lb-score">🪙 ${user.yinCoins !== undefined ? user.yinCoins : 1000} 知因币</div>
                `;
                container.appendChild(item);
            });
        });
    }

    /* ============================================================
       🟢 游鲸五子棋 UI 控制组件 (Gomoku UI Methods)
       ============================================================ */

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
    }

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
    }

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
    }

    /**
     * 开启在线五子棋真人双人对战模式 (随机先后手，我方固定在左侧)
     */
    startGomokuOnlineGame(roomId, isHost = false, hostIsBlackSynced = null) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
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
    }

    /**
     * 开启单机 AI 五子棋切磋模式 (随机先后手，我方固定在左侧)
     */
    startGomokuAiMode() {
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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                const ratio = isPve ? 0.25 : 1.0;

                if (winner === myColor) {
                    const totalMoves = window.gomokuEngine ? window.gomokuEngine.moveHistory.length : 20;
                    const quickBonus = (totalMoves <= 15) ? 10 : 0;
                    const winCoins = Math.ceil((30 + quickBonus) * ratio);
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
    }

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
    }

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
    }

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
    }

    /**
     * 开启单机 AI 围棋切磋模式 (随机先后手，棋盘路数可选 9/13/19)
     */
    startGoAiMode() {
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
    }

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
    }

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
    }

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
    }

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
    }

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
    }

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

        this._goTimerSeconds = 60;
        if (badge) badge.style.display = 'inline-flex';
        if (secsEl) secsEl.textContent = '60';

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
    }

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
    }

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
    }

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
                    const winCoins = Math.ceil((30 + quickBonus) * ratio);
                    AuthEngine.updateCoins(winCoins, isPve ? '围棋切磋胜 (PVE)' : '围棋胜 (PVP)');
                } else if (winner !== 0) {
                    const loseCoins = -Math.ceil(20 * ratio);
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

        // 玩家头像棋子
        const avatarLeft = document.getElementById('xqAvatarLeft');
        const avatarRight = document.getElementById('xqAvatarRight');
        if (avatarLeft) avatarLeft.textContent = engine.playerColor === 'R' ? '帅' : '将';
        if (avatarRight) avatarRight.textContent = engine.playerColor === 'R' ? '将' : '帅';
    }

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
     */
    startXiangqiAiMode() {
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
     * 播放落子音效 (sound/placing-a-piece.mp3)
     */
    playXiangqiMoveSound() {
        try {
            const audio = new Audio('sound/placing-a-piece.mp3');
            audio.volume = 0.9;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }

    /**
     * 播放选子音效 (sound/mahjangclack-1.wav 清脆咔嗒)
     */
    playXiangqiSelectSound() {
        try {
            const audio = new Audio('sound/mahjangclack-1.wav');
            audio.volume = 0.55;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }

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

        this._xqTimerSeconds = 60;
        if (badge) badge.style.display = 'inline-flex';
        if (secsEl) secsEl.textContent = '60';

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
            if (winner === myColor) AuthEngine.recordXiangqiMatchResult(true, false);
            else AuthEngine.recordXiangqiMatchResult(false, false);

            if (AuthEngine.updateCoins) {
                const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                const ratio = isPve ? 0.25 : 1.0;
                if (winner === myColor) {
                    const totalMoves = window.xiangqiEngine ? window.xiangqiEngine.moveHistory.length : 40;
                    const quickBonus = (totalMoves <= 20) ? 10 : 0;
                    AuthEngine.updateCoins(Math.ceil((30 + quickBonus) * ratio), isPve ? '象棋切磋胜 (PVE)' : '象棋胜 (PVP)');
                } else if (winner) {
                    AuthEngine.updateCoins(-Math.ceil(20 * ratio), isPve ? '象棋切磋负 (PVE)' : '象棋负 (PVP)');
                }
                if (AuthEngine.addExp) {
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
    startMahjongOnlineGame(roomId, isHost = false) {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
            AuthEngine.checkAndDeductEntryFee('MAHJONG', isPve);
        }

        // 切换游戏前清理斗地主残留定时器
        this.stopDoudizhuTimers();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (mahjongScr) { mahjongScr.style.display = 'flex'; mahjongScr.classList.add('active'); }
        this.updateHeaderVisibility();

        const settlementModal = document.getElementById('mahjongSettlementModal');
        if (settlementModal) settlementModal.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';

        this.selectedMahjongTileIndex = -1;
        // 每次开局都重置初始化标记，避免重开一局时客户端跳过新的初始牌组
        this._mahjongOnlineInitDone = false;
        this.mahjongReadyPlayers = [false, false, false, false];

        const btnSettle = document.getElementById('btnMahjongSettleRematch');
        if (btnSettle) {
            btnSettle.disabled = false;
            btnSettle.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 再来一局';
        }

        if (isHost) {
            NetworkManager.clearMahjongRematchStatus();
            // 房主初始化麻将引擎并导出全量牌组与庄家状态
            window.mahjongEngine.reset(false, 0);
            const initData = window.mahjongEngine.exportState();
            NetworkManager.sendMahjongInitState(initData);
            // 清掉上一局残留的出牌动作，防止重开时客户端误导入旧状态
            NetworkManager.clearMahjongMoves();
            NetworkManager.sendMahjongStart(roomId);
            // 房主启动 AI 回合看门狗：任何异常/竞态导致 AI 回合卡住都会自动恢复
            if (this._mahjongWatchdogId) clearInterval(this._mahjongWatchdogId);
            this._mahjongWatchdogId = setInterval(() => {
                this._checkMahjongAiWatchdog();
            }, 4000);
        } else {
            // 客户端拉取房主生成的初始牌组状态
            NetworkManager.onMahjongInitState((initData) => {
                if (initData && !this._mahjongOnlineInitDone) {
                    this._mahjongOnlineInitDone = true;
                    window.mahjongEngine.importState(initData);
                    this.renderMahjongHandTiles();
                    this.renderMahjongDiscards();
                    this.renderMahjongMelds();
                }
            });
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : (isHost ? 0 : 1);
        const players = this.latestLobbyPlayers || this.gameState.players || [];
        for (let i = 0; i < 4; i++) {
            if (!players[i]) {
                players[i] = { id: i, name: `AI-${i}`, isAi: (i !== 0), isHost: (i === 0) };
            }
        }
        // 引擎固定座位风向：0=南(我方/房主)、1=东(右家)、2=北(对家)、3=西(左家)
        const windNames = ['东', '南', '西', '北'];

        const mNameBottom = document.getElementById('mNameBottom');
        const mNameRight  = document.getElementById('mNameRight');
        const mNameTop    = document.getElementById('mNameTop');
        const mNameLeft   = document.getElementById('mNameLeft');
        const mAvatarBottom = document.getElementById('mAvatarBottom');
        const mAvatarRight  = document.getElementById('mAvatarRight');
        const mAvatarTop    = document.getElementById('mAvatarTop');
        const mAvatarLeft   = document.getElementById('mAvatarLeft');
        const mWindBottom = document.getElementById('mWindBottom');
        const mWindRight  = document.getElementById('mWindRight');
        const mWindTop    = document.getElementById('mWindTop');
        const mWindLeft   = document.getElementById('mWindLeft');

        // 座位名称渲染：纯名字（AI 前缀与风向独立展示，避免重复冗余）
        const getPlayerNameAtRelativePos = (offset) => {
            const absIdx = (mySlot + offset) % 4;
            const p = players[absIdx];
            return p ? p.name : `AI-${absIdx + 1}`;
        };
        const seatAvatar = (absIdx) => {
            const p = players[absIdx];
            if (p && !p.isAi && p.avatar) return p.avatar;
            return p && !p.isAi ? '🤠' : '🤖';
        };

        if (mNameBottom) mNameBottom.textContent = getPlayerNameAtRelativePos(0);
        if (mNameRight)  mNameRight.textContent  = getPlayerNameAtRelativePos(1);
        if (mNameTop)    mNameTop.textContent    = getPlayerNameAtRelativePos(2);
        if (mNameLeft)   mNameLeft.textContent   = getPlayerNameAtRelativePos(3);
        if (mAvatarBottom) mAvatarBottom.textContent = seatAvatar(mySlot);
        if (mAvatarRight)  mAvatarRight.textContent  = seatAvatar((mySlot + 1) % 4);
        if (mAvatarTop)    mAvatarTop.textContent    = seatAvatar((mySlot + 2) % 4);
        if (mAvatarLeft)   mAvatarLeft.textContent   = seatAvatar((mySlot + 3) % 4);

        // 风向独立徽章 (0=南/我方、1=东/右、2=北/对、3=西/左)
        if (mWindBottom) mWindBottom.textContent = windNames[mySlot];
        if (mWindRight)  mWindRight.textContent  = windNames[(mySlot + 1) % 4];
        if (mWindTop)    mWindTop.textContent    = windNames[(mySlot + 2) % 4];
        if (mWindLeft)   mWindLeft.textContent   = windNames[(mySlot + 3) % 4];

        // 设置 3D 局风罗盘风向标签 (映射到玩家视角：底部为我方风向，右/顶/左依序顺时针排列)
        const windSouth = document.getElementById('windSouth');
        const windEast  = document.getElementById('windEast');
        const windNorth = document.getElementById('windNorth');
        const windWest  = document.getElementById('windWest');

        if (windSouth) windSouth.textContent = windNames[mySlot];
        if (windEast)  windEast.textContent  = windNames[(mySlot + 1) % 4];
        if (windNorth) windNorth.textContent = windNames[(mySlot + 2) % 4];
        if (windWest)  windWest.textContent  = windNames[(mySlot + 3) % 4];

        const dealerIdx = window.mahjongEngine.dealer;
        const relativeDealerPos = (dealerIdx - mySlot + 4) % 4;
        const dealerTags = ['mDealerBottom', 'mDealerRight', 'mDealerTop', 'mDealerLeft'];
        dealerTags.forEach((tagId, idx) => {
            const el = document.getElementById(tagId);
            if (el) el.style.display = (idx === relativeDealerPos) ? 'inline-block' : 'none';
        });

        this.renderMahjongHandTiles();
        this.renderMahjongDiscards();
        this.renderMahjongMelds();
        this.renderMahjongVisualWall();

        this.triggerMahjongDealAnimation(() => {
            const isMyTurn = (window.mahjongEngine.currentTurn === mySlot);
            if (isMyTurn) {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 轮到你起手出牌`);
                UIRenderer.showToast(`🎲 你是起手庄家！优先出牌`);
                this.checkSelfActionsOnTurn();
            } else if (NetworkManager.isHost) {
                // 庄家为 AI 座位时，由房主驱动 AI 起手出牌（广播后非房主客户端同步跟上）
                this.updateMahjongStatusUI(`🀄 4人雀局 · 对方正在烧烤...`);
                UIRenderer.showToast(`🎲 庄家优先起手出牌中...`);
                const currDealer = window.mahjongEngine.currentTurn;
                const dealerPlayer = this.gameState.players[currDealer];
                if (dealerPlayer && dealerPlayer.isAi) {
                    this.triggerAiTurnLoop();
                }
            } else {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 对方正在烧烤...`);
                UIRenderer.showToast(`🎲 庄家优先起手出牌中...`);
            }
        });

        // 实时监听其他玩家在云端的打牌动作与全局牌桌同步
        NetworkManager.onMahjongMove((move) => {
            if (!move) return;
            const senderIsAi = (this.gameState.players && this.gameState.players[move.senderSlot]) ? this.gameState.players[move.senderSlot].isAi : false;
            if (NetworkManager.isHost && senderIsAi) return;
            if (move.senderSlot === mySlot) return;
            if (move.stateData) {
                window.mahjongEngine.importState(move.stateData);
                this.renderMahjongHandTiles();
                this.renderMahjongDiscards();
                this.renderMahjongMelds();

                // 远程玩家胡牌 / 流局：全员同步弹出结算面板
                if (window.mahjongEngine.isGameOver) {
                    // 远程胡牌：播放胜利音效提示
                    if (move.actionType === 'HU' && typeof SoundEngine !== 'undefined' && SoundEngine.playWin) {
                        try { SoundEngine.playWin(); } catch (e) {}
                    }
                    this.showMahjongSettlement(window.mahjongEngine.winner, null);
                    return;
                }

                const relativeSender = (move.senderSlot - mySlot + 4) % 4;
                const seatLabels = ['你', '右家', '对家', '左家'];

                // 远程玩家 吃/碰/杠：播放对应语音音效 + 国风大字报提示 (跳过摸牌音与响应检查)
                if (move.actionType === 'CHOW' || move.actionType === 'PONG' || move.actionType === 'KONG') {
                    // 其他玩家完成了吃碰杠: 清除本端挂起的响应条 (防止残留/误触发)
                    this.clearMahjongPendingResponse();
                    const actText = move.actionType === 'CHOW' ? '吃！' : (move.actionType === 'PONG' ? '碰！' : '杠！');
                    this.showMahjongActionToast(`${seatLabels[relativeSender] || '对方'}${actText}`);
                    return;
                }

                // 远程玩家选择【过】(不响应): 清除本端响应条, 若轮到 AI 由房主驱动继续
                if (move.actionType === 'PASS') {
                    this.clearMahjongPendingResponse();
                    if (NetworkManager.isHost && window.mahjongEngine && !window.mahjongEngine.isGameOver
                        && window.mahjongEngine.currentTurn !== mySlot
                        && this.gameState.players[window.mahjongEngine.currentTurn] && this.gameState.players[window.mahjongEngine.currentTurn].isAi) {
                        this.triggerAiTurnLoop();
                    }
                    return;
                }

                if (move.discardedTile) {
                    this.animateTileThrow(move.discardedTile, relativeSender);
                }
                if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playMahjongTile === 'function') {
                    SoundEngine.playMahjongTile();
                }

                const currTurn = window.mahjongEngine.currentTurn;
                const isMyTurnNow = (currTurn === mySlot);

                // 检查我方 (mySlot) 对远程打出的牌是否有 吃/碰/杠/胡 响应
                if (move.discardedTile && move.actionType !== 'CHOW' && move.actionType !== 'PONG' && move.actionType !== 'KONG' && move.actionType !== 'HU') {
                    const engine = window.mahjongEngine;
                    const isUpperHouse = (move.senderSlot + 1) % 4 === mySlot;
                    const chowOptions = isUpperHouse ? engine.getChowOptions(mySlot, move.discardedTile) : [];
                    const canChow = chowOptions.length > 0;
                    const canPong = engine.checkCanPong(mySlot, move.discardedTile);
                    const canKong = engine.checkCanKong(mySlot, move.discardedTile);

                    // 截胡判定: 多家可胡时按出牌者下家起顺时针就近优先
                    const huInfo = engine.evaluateHuPriority(move.senderSlot, move.discardedTile);
                    const canHu = huInfo.canHu && !huInfo.huBlocked; // 被截则不弹胡
                    if (huInfo.huBlocked) {
                        const seatLabels2 = ['你', '右家', '对家', '左家'];
                        const blockerSeat = huInfo.huWinner >= 0 ? (seatLabels2[(huInfo.huWinner - mySlot + 4) % 4] || '其他玩家') : '其他玩家';
                        UIRenderer.showToast(`🈲 你的胡被${blockerSeat}截胡了！`);
                    }

                    if (canChow || canPong || canKong || canHu) {
                        this.pendingDiscardRes = {
                            discarded: move.discardedTile,
                            fromPlayer: move.senderSlot,
                            canChow,
                            chowOptions,
                            canPong,
                            canKong,
                            canHu,
                            huBlocked: huInfo.huBlocked,
                            huWinner: huInfo.huWinner
                        };
                        this.showHumanResponseActionBar(this.pendingDiscardRes);
                        this.updateMahjongStatusUI(`⚠️ 玩家打出 [${move.discardedTile.name}]：请选择【吃 / 碰 / 杠 / 胡 / 过】`);
                        return;
                    }
                }

                if (isMyTurnNow) {
                    // 轮到我方: 响应判定之后才摸牌 (修正手牌数, 点炮胡/碰杠判定基于 13 张)
                    if (window.mahjongEngine.pendingDraw) {
                        const drawRes = window.mahjongEngine.drawTile(mySlot);
                        if (!drawRes) {
                            this.showMahjongSettlement(-1, null);
                            return;
                        }
                        this.animateTileDraw(mySlot, window.mahjongEngine.lastDrawnTile);
                        this.renderMahjongHandTiles(true);
                    }
                    this.updateMahjongStatusUI('🀄 4人雀局 · 轮到你出牌！');
                    UIRenderer.showToast('🎲 轮到你出牌！');
                    this.checkSelfActionsOnTurn();
                } else {
                    const relativeTurn = (currTurn - mySlot + 4) % 4;
                    const seatLabels = ['你', '右家', '对家', '左家'];
                    this.updateMahjongStatusUI(`🀄 4人雀局 · ${seatLabels[relativeTurn] || '对方'}正在烧烤...`);
                }

                // 如果下一个轮到 AI 出牌且我是房主，由房主机器驱动 AI 做出决定（跳过 AI 广播回声，避免重复驱动）
                const senderIsAi = this.gameState.players[move.senderSlot] ? this.gameState.players[move.senderSlot].isAi : false;
                if (NetworkManager.isHost && !senderIsAi && this.gameState.players[currTurn] && this.gameState.players[currTurn].isAi) {
                    this.triggerAiTurnLoop();
                }
            }
        });

        // 绑定吃/碰/杠/胡/过动作按钮
        this.bindMahjongActionButtons();
    }

    /**
     * 开启正宗 4 人围桌游鲸麻将模式 (单机 AI / 线上)
     */
    startMahjongAiMode() {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee && !AuthEngine.checkAndDeductEntryFee('MAHJONG', true)) {
            return;
        }

        // 切换游戏前清理斗地主残留定时器，防止其 handleTurnTimeout 干扰麻将对局
        this.stopDoudizhuTimers();

        const lobbyScr = document.getElementById('lobbyScreen');
        const waitingScr = document.getElementById('waitingScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');

        if (lobbyScr) { lobbyScr.style.display = 'none'; lobbyScr.classList.remove('active'); }
        if (waitingScr) { waitingScr.style.display = 'none'; waitingScr.classList.remove('active'); }
        if (mahjongScr) { mahjongScr.style.display = 'flex'; mahjongScr.classList.add('active'); }
        this.updateHeaderVisibility();

        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        const nick = NetworkManager.nickname || (AuthEngine.userData && AuthEngine.userData.nickname) || '玩家';
        this.gameState.players = [
            { id: 0, name: nick, isAi: false, isHost: true },
            { id: 1, name: 'AI-1', isAi: true, isHost: false },
            { id: 2, name: 'AI-2', isAi: true, isHost: false },
            { id: 3, name: 'AI-3', isAi: true, isHost: false }
        ];

        // 关闭胡牌结算弹窗 & 吃牌弹窗
        const settlementModal = document.getElementById('mahjongSettlementModal');
        if (settlementModal) settlementModal.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';

        // 初始化 4 人麻将引擎 (我方 Seat 0 / 南)
        this.selectedMahjongTileIndex = -1;
        window.mahjongEngine.reset(true, 0);

        // 设置 4 个座位玩家信息
        const mNameBottom = document.getElementById('mNameBottom');
        if (mNameBottom) mNameBottom.textContent = nick;

        // 设置庄家标识与先手引导
        const dealerIdx = window.mahjongEngine.dealer;
        const dealerNames = ['你 (南风)', '右家 (东风)', '对家 (北风)', '左家 (西风)'];
        const dealerName = dealerNames[dealerIdx];

        const dealerTags = ['mDealerBottom', 'mDealerRight', 'mDealerTop', 'mDealerLeft'];
        dealerTags.forEach((tagId, idx) => {
            const el = document.getElementById(tagId);
            if (el) el.style.display = (idx === dealerIdx) ? 'inline-block' : 'none';
        });

        this.renderMahjongHandTiles();
        this.renderMahjongDiscards();
        this.renderMahjongMelds();
        this.renderMahjongVisualWall();

        this.triggerMahjongDealAnimation(() => {
            if (dealerIdx === 0) {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 随机选定 👑【${dealerName}】庄家先手出牌`);
                UIRenderer.showToast(`🎲 随机选定 👑【${dealerName}】为庄家！优先起手`);
                this.checkSelfActionsOnTurn();
            } else {
                this.updateMahjongStatusUI(`🀄 4人雀局 · 随机选定 👑【${dealerName}】庄家起手出牌中...`);
                UIRenderer.showToast(`🎲 随机选定 👑【${dealerName}】为庄家！由其优先起手`);
                this.triggerAiTurnLoop();
            }
        });

        // 绑定底栏与菜单按键
        const btnBack = document.getElementById('btnMahjongBackLobby');
        if (btnBack) btnBack.onclick = () => this.resetToLobby();

        const btnRematch = document.getElementById('btnMahjongRematch');
        if (btnRematch) btnRematch.onclick = () => this.startMahjongAiMode();

        const btnCloseChow = document.getElementById('btnCloseChowModal');
        if (btnCloseChow) btnCloseChow.onclick = () => {
            if (chowModal) chowModal.style.display = 'none';
        };

        const btnSettleRematch = document.getElementById('btnMahjongSettleRematch');
        if (btnSettleRematch) {
            btnSettleRematch.onclick = () => {
                if (NetworkManager.roomId && !NetworkManager.isAiMode) {
                    btnSettleRematch.disabled = true;
                    btnSettleRematch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (等待全员...)';
                    this.handleSelfAction('RESTART_VOTE', { gameType: 'MAHJONG' });
                    if (NetworkManager.isHost) {
                        this.processRestartVote(0);
                    }
                } else {
                    this.startMahjongAiMode();
                }
            };
        }

        const btnSettleLobby = document.getElementById('btnMahjongSettleLobby');
        if (btnSettleLobby) btnSettleLobby.onclick = () => {
            const mModal = document.getElementById('mahjongSettlementModal');
            if (mModal) mModal.style.display = 'none';
            this.resetToLobby();
        };

        // 绑定吃/碰/杠/胡/过按键
        this.bindMahjongActionButtons();

        // 我方开局自摸/杠牌动作判定
        this.checkSelfActionsOnTurn();
    }

    /**
     * 绑定吃/碰/杠/胡/过动作按钮
     */
    bindMahjongActionButtons() {
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        if (btnChow) btnChow.onclick = () => this.handleMahjongChowClick();
        if (btnPong) btnPong.onclick = () => this.handleMahjongPongClick();
        if (btnKong) btnKong.onclick = () => this.handleMahjongKongClick();

        // 📱 手机端出牌按钮：固定在 ID 信息右侧，选中牌后亮起可点击
        const btnDiscard = document.getElementById('btnMahjongDiscard');
        if (btnDiscard) {
            btnDiscard.onclick = () => {
                const idx = this.selectedMahjongTileIndex;
                if (idx === undefined || idx === null || idx < 0) return;
                this.selectedMahjongTileIndex = -1;
                this.hideMahjongDiscardBar();
                this.handleMahjongTileDiscard(idx);
            };
        }
        if (btnHu) btnHu.onclick = () => this.handleMahjongHuClick();
        if (btnPass) btnPass.onclick = () => this.handleMahjongPassClick();
    }

    /**
     * 播放国风特效大字报 (吃！/碰！/杠！/胡！) 并联动触发高保真语音音效 (chi.mp3, peng.mp3, gang.mp3)
     */
    showMahjongActionToast(text) {
        const toast = document.getElementById('mahjongActionToast');
        const textEl = document.getElementById('mahjongActionToastText');
        if (!toast || !textEl) return;

        textEl.textContent = text;
        toast.style.display = 'block';

        // 联动播放真实声优语音音效
        if (typeof SoundEngine !== 'undefined') {
            if (text.includes('吃') || text.includes('CHOW')) {
                if (typeof SoundEngine.playMahjongChow === 'function') SoundEngine.playMahjongChow();
            } else if (text.includes('碰') || text.includes('PONG')) {
                if (typeof SoundEngine.playMahjongPong === 'function') SoundEngine.playMahjongPong();
            } else if (text.includes('杠') || text.includes('KONG')) {
                if (typeof SoundEngine.playMahjongKong === 'function') SoundEngine.playMahjongKong();
            }
        }

        if (this._actionToastTimer) clearTimeout(this._actionToastTimer);
        this._actionToastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 850);
    }

    /**
     * 生成正宗国粹 3D 浮雕麻将牌面图案 HTML (万、筒/饼、条/索、字/风/箭)
     */
    getMahjongTileFaceHTML(tile) {
        if (!tile) return '';
        const { type, num, name } = tile;

        // 1. 字牌 (红中、发财、白板、东南西北)
        if (type === '字') {
            if (name === '红中') return `<div class="m-face honor red-zhong">中</div>`;
            if (name === '发财') return `<div class="m-face honor green-fa">發</div>`;
            if (name === '白板') return `<div class="m-face honor baiban"><div class="baiban-inner"></div></div>`;
            return `<div class="m-face honor wind">${name.replace('风', '')}</div>`;
        }

        // 2. 万字牌 (1-9万)
        if (type === '万') {
            const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
            return `<div class="m-face wan"><span class="w-num">${cn[num] || num}</span><span class="w-char">萬</span></div>`;
        }

        // 3. 饼/筒牌 (1-9饼)
        if (type === '筒' || type === '饼') {
            if (num === 1) {
                return `<div class="m-face bing bing-1"><div class="rosette"><div class="rosette-inner"></div></div></div>`;
            }
            let dots = '';
            for (let i = 1; i <= num; i++) {
                dots += `<span class="dot d-${i}"></span>`;
            }
            return `<div class="m-face bing bing-${num}">${dots}</div>`;
        }

        // 4. 条/索牌 (1-9条：高清 100% 数学精准矢量 SVG，彻底解决尺寸不一与换行问题)
        if (type === '条' || type === '索') {
            return this.getTiaoTileSVG(num);
        }

        return `<div class="m-face fallback">${name}</div>`;
    }

    /**
     * 🀄 136张国粹 1-9 条/索全量高清 100% 数学几何精准 SVG 矢量生成函数
     * 彻底解决原本 CSS 浮动导致同一索牌在不同区域尺寸不一、中心杆变高变矮或换行的缺陷
     */
    getTiaoTileSVG(num) {
        if (num === 1) {
            return `
                <div class="m-face tiao tiao-1">
                    <img src="picture/yaoji.webp" class="yaoji-img" alt="幺鸡" />
                </div>`;
        }
        if (num === 2) {
            return `
                <div class="m-face tiao tiao-2">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="8.5" y="7.5" width="4.8" height="29" rx="2" fill="#16a34a"/>
                        <rect x="18.7" y="7.5" width="4.8" height="29" rx="2" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 3) {
            return `
                <div class="m-face tiao tiao-3">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4.8" y="8.5" width="4.5" height="27" rx="1.8" fill="#2563eb"/>
                        <rect x="13.75" y="8.5" width="4.5" height="27" rx="1.8" fill="#16a34a"/>
                        <rect x="22.7" y="8.5" width="4.5" height="27" rx="1.8" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 4) {
            return `
                <div class="m-face tiao tiao-4">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6.5" y="4.5" width="4.6" height="16.5" rx="1.6" fill="#16a34a"/>
                        <rect x="20.9" y="4.5" width="4.6" height="16.5" rx="1.6" fill="#dc2626"/>
                        <rect x="6.5" y="23" width="4.6" height="16.5" rx="1.6" fill="#dc2626"/>
                        <rect x="20.9" y="23" width="4.6" height="16.5" rx="1.6" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 5) {
            return `
                <div class="m-face tiao tiao-5">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="5.5" y="4.5" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="22.1" y="4.5" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="13.8" y="14.25" width="4.4" height="15.5" rx="1.5" fill="#dc2626"/>
                        <rect x="5.5" y="24" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                        <rect x="22.1" y="24" width="4.4" height="15.5" rx="1.5" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 6) {
            return `
                <div class="m-face tiao tiao-6">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7.5" y="4" width="4.2" height="11.5" rx="1.4" fill="#16a34a"/>
                        <rect x="20.3" y="4" width="4.2" height="11.5" rx="1.4" fill="#16a34a"/>
                        <rect x="7.5" y="16.25" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="20.3" y="16.25" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="7.5" y="28.5" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                        <rect x="20.3" y="28.5" width="4.2" height="11.5" rx="1.4" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 7) {
            return `
                <div class="m-face tiao tiao-7">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="6" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="13.9" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="21.8" y="4" width="4.2" height="13.5" rx="1.4" fill="#16a34a"/>
                        <rect x="8.5" y="19.5" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="19.3" y="19.5" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="8.5" y="31" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                        <rect x="19.3" y="31" width="4.2" height="10.5" rx="1.4" fill="#dc2626"/>
                    </svg>
                </div>`;
        }
        if (num === 8) {
            return `
                <div class="m-face tiao tiao-8">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="7.5" y="3.5" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="3.5" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="13.3" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="13.3" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="23.1" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="23.1" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="7.5" y="32.9" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                        <rect x="20.3" y="32.9" width="4.2" height="8.8" rx="1.2" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        if (num === 9) {
            return `
                <div class="m-face tiao tiao-9">
                    <svg class="tiao-svg" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4.8" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="13.9" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="23" y="4" width="4.2" height="11" rx="1.2" fill="#2563eb"/>
                        <rect x="4.8" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="13.9" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="23" y="16.5" width="4.2" height="11" rx="1.2" fill="#dc2626"/>
                        <rect x="4.8" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                        <rect x="13.9" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                        <rect x="23" y="29" width="4.2" height="11" rx="1.2" fill="#16a34a"/>
                    </svg>
                </div>`;
        }
        return '';
    }

    /**
     * 渲染我方手牌及另外 3 家盖牌背牌 (Top, Left, Right)
     * @param {boolean} animateSort - 是否播放理牌滑动动画 (FLIP Sliding Sort Animation)
     */
    renderMahjongHandTiles(animateSort = false) {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        // 更新剩余牌墙计数器与视觉牌墙
        const countEl = document.getElementById('mahjongWallCount');
        if (countEl) countEl.textContent = engine.wallCount;
        this.renderMahjongVisualWall();

        // 听牌提示：轮到我方出牌（13或14张手牌）时计算可胡张
        const isMyTurnAndDrawn = (engine.currentTurn === mySlot && (engine.hands[mySlot] || []).length % 3 === 2);
        const tingInfo = (engine.currentTurn === mySlot && !engine.isGameOver) ? this.getMahjongTingInfo() : null;
        this.renderMahjongTingBadge(tingInfo);

        const containerBottom = document.getElementById('mahjongHandTilesContainer');
        if (!containerBottom) return;

        // 1. FLIP 动画前半段：记录我方手牌原有 DOM 坐标 (Left, Top)
        const oldPositions = new Map();
        if (animateSort) {
            const existingCards = containerBottom.querySelectorAll('.mahjong-tile-card');
            existingCards.forEach(card => {
                const tileId = card.dataset.tileId;
                if (tileId) {
                    oldPositions.set(tileId, card.getBoundingClientRect());
                }
            });
        }

        // 2. 渲染我方 (Seat mySlot) 手牌
        containerBottom.innerHTML = '';
        const myHand = engine.hands[mySlot] || [];

        myHand.forEach((tile, index) => {
            const card = document.createElement('div');
            card.className = 'mahjong-tile-card';
            card.dataset.tileId = tile.id || `${tile.type}_${tile.num}_${index}`;
            card.dataset.index = index;

            // 🀄 摸牌位：若轮到我方且有 14 张牌（或吃碰杠后 4/7/10/14 张），最右侧最后一张为摸牌位，离左侧手牌空开间隔
            if (isMyTurnAndDrawn && index === myHand.length - 1) {
                card.classList.add('is-drawn-tile');
            }

            // 🀄 听牌高亮：听牌状态下，能够凑成胡牌的关键搭子金色微光
            if (tingInfo && tingInfo.tingSet && tingInfo.tingSet.has(tile.name)) {
                card.classList.add('ting-key-tile');
            }

            if (this.selectedMahjongTileIndex === index) {
                card.classList.add('selected');
            }
            card.innerHTML = this.getMahjongTileFaceHTML(tile);
            // 记录牌名到 face 上，供碰/杠高亮匹配
            const faceEl = card.querySelector('.m-face');
            if (faceEl) faceEl.dataset.tileName = tile.name;

            // 📱 手机端：滑动选择 + 点击出牌（滑动经过即高亮，点出牌按钮打出）
            const isMobileTouch = ('ontouchstart' in window) || window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
            if (isMobileTouch) {
                // 触摸滑动选择：手指滑到哪张牌就高亮哪张（位移超阈值才拦截，避免干扰轻点选择）
                let touchStartX = 0;
                let touchStartY = 0;
                let swiping = false;
                card.addEventListener('touchstart', (e) => {
                    const t = e.touches[0];
                    if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
                    swiping = false;
                }, { passive: true });

                card.addEventListener('touchmove', (e) => {
                    const touch = e.touches[0];
                    if (!touch) return;
                    // 位移超过 8px 才算滑动（轻点抖动不拦截 click）
                    if (!swiping) {
                        const dx = touch.clientX - touchStartX;
                        const dy = touch.clientY - touchStartY;
                        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                        swiping = true;
                    }
                    e.preventDefault();
                    // 找到手指正下方的牌
                    const el = document.elementFromPoint(touch.clientX, touch.clientY);
                    const target = el ? el.closest('.mahjong-tile-card') : null;
                    if (target && target.dataset.index !== undefined) {
                        const idx = parseInt(target.dataset.index, 10);
                        if (this.selectedMahjongTileIndex !== idx) {
                            // 轻量切换高亮（只改 class，不重建整手牌，保证滑动流畅）
                            this.selectedMahjongTileIndex = idx;
                            containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                                c.classList.toggle('selected', parseInt(c.dataset.index, 10) === idx);
                            });
                            this.showMahjongDiscardBar(idx);
                        }
                    }
                }, { passive: false });

                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (swiping) return; // 刚滑动过，忽略本次点击
                    // 预选支持：无论是否轮到自己回合都允许选中/取消（非回合时按钮不亮，轮到自己时自动点亮）
                    const engine = window.mahjongEngine;
                    if (!engine || engine.isGameOver) return;
                    if (this.selectedMahjongTileIndex === index) {
                        // 再点已选中的牌：取消选中
                        this.selectedMahjongTileIndex = -1;
                        this.hideMahjongDiscardBar();
                        containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                            c.classList.remove('selected');
                        });
                    } else {
                        // 点选/滑动切换到此牌（预选）
                        this.selectedMahjongTileIndex = index;
                        if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                            SoundEngine.playCardFlipSound();
                        }
                        // 轻量高亮：不重建整个手牌，直接切换 selected class
                        containerBottom.querySelectorAll('.mahjong-tile-card').forEach(c => {
                            c.classList.toggle('selected', parseInt(c.dataset.index, 10) === index);
                        });
                        this.showMahjongDiscardBar(index);
                    }
                });
            } else {
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.selectedMahjongTileIndex === index) {
                        // 第 2 次点击：确认打出此牌！
                        this.selectedMahjongTileIndex = -1;
                        this.handleMahjongTileDiscard(index);
                    } else {
                        // 第 1 次点击：高亮凸起选中此牌！
                        this.selectedMahjongTileIndex = index;
                        if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                            SoundEngine.playCardFlipSound();
                        }
                        this.renderMahjongHandTiles();
                    }
                });
            }

            containerBottom.appendChild(card);
        });

        // 3. FLIP 动画后半段：比对新旧坐标并播放理牌滑动动画 (0.28s)
        if (animateSort && oldPositions.size > 0) {
            const newCards = containerBottom.querySelectorAll('.mahjong-tile-card');
            let hasMoved = false;

            newCards.forEach(card => {
                const tileId = card.dataset.tileId;
                const oldRect = oldPositions.get(tileId);
                if (oldRect) {
                    const newRect = card.getBoundingClientRect();
                    const deltaX = oldRect.left - newRect.left;
                    if (Math.abs(deltaX) > 1) {
                        hasMoved = true;
                        card.style.transform = `translateX(${deltaX}px)`;
                        card.style.transition = 'none';

                        requestAnimationFrame(() => {
                            card.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.9, 0.35, 1)';
                            card.style.transform = 'translateX(0)';
                        });
                    }
                }
            });

            if (hasMoved && typeof SoundEngine !== 'undefined' && typeof SoundEngine.playCardFlipSound === 'function') {
                try { SoundEngine.playCardFlipSound(); } catch (e) {}
            }
        }

        // 4. 渲染北家 (Top) 盖牌背牌
        const containerTop = document.getElementById('mahjongTilesTop');
        if (containerTop) {
            const topHand = engine.hands[(mySlot + 2) % 4] || [];
            const countTop = topHand.length;
            const isTopTurn = (engine.currentTurn === (mySlot + 2) % 4 && countTop % 3 === 2);
            let htmlTop = '';
            for (let i = 0; i < countTop; i++) {
                const isDrawn = (isTopTurn && i === countTop - 1) ? 'is-drawn-tile' : '';
                htmlTop += `<div class="standing-tile-top ${isDrawn}"></div>`;
            }
            containerTop.innerHTML = htmlTop;
        }

        // 5. 渲染西家 (Left) 盖牌背牌
        const containerLeft = document.getElementById('mahjongTilesLeft');
        if (containerLeft) {
            const leftHand = engine.hands[(mySlot + 3) % 4] || [];
            const countLeft = leftHand.length;
            const isLeftTurn = (engine.currentTurn === (mySlot + 3) % 4 && countLeft % 3 === 2);
            let htmlLeft = '';
            for (let i = 0; i < countLeft; i++) {
                const isDrawn = (isLeftTurn && i === countLeft - 1) ? 'is-drawn-tile' : '';
                htmlLeft += `<div class="standing-tile-left ${isDrawn}"></div>`;
            }
            containerLeft.innerHTML = htmlLeft;
        }

        // 6. 渲染东家 (Right) 盖牌背牌
        const containerRight = document.getElementById('mahjongTilesRight');
        if (containerRight) {
            const rightHand = engine.hands[(mySlot + 1) % 4] || [];
            const countRight = rightHand.length;
            const isRightTurn = (engine.currentTurn === (mySlot + 1) % 4 && countRight % 3 === 2);
            let htmlRight = '';
            for (let i = 0; i < countRight; i++) {
                const isDrawn = (isRightTurn && i === countRight - 1) ? 'is-drawn-tile' : '';
                htmlRight += `<div class="standing-tile-right ${isDrawn}"></div>`;
            }
            containerRight.innerHTML = htmlRight;
        }
    }

    /**
     * 🀄 渲染剩余张数区域下方的 3D 视觉砌牌墙 (即拿即销动画 Stack)
     */
    renderMahjongVisualWall() {
        const row = document.getElementById('mahjongVisualWallRow');
        if (!row || !window.mahjongEngine) return;

        const count = window.mahjongEngine.wallCount || 0;
        const maxCols = 22;
        const colCount = Math.min(maxCols, Math.max(0, Math.ceil(count / 3.8)));

        let html = '';
        for (let i = 0; i < colCount; i++) {
            const isDouble = (i * 3.8 < count);
            html += `<div class="wall-mini-tile-stack ${isDouble ? 'double-stack' : ''}"></div>`;
        }
        row.innerHTML = html;
    }

    /**
     * 🀄 听牌检测：遍历所有可能的牌张，返回能胡的牌集合
     * @returns {null|{tingSet:Set<string>, tingCount:number, tingTiles:string[]}}
     */
    getMahjongTingInfo() {
        const engine = window.mahjongEngine;
        if (!engine) return null;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const myHand = engine.hands[mySlot] || [];
        // 听牌判断：13 张（打完牌等待摸牌）或 14 张（刚摸牌未打出）均可判断
        const lenMod = myHand.length % 3;
        if (lenMod !== 1 && lenMod !== 2) return null;
        const isFourteen = (lenMod === 2); // 14 张：刚摸牌，需先虚拟打出一张再判断

        // 手牌已有的牌名计数，用于排除已有 4 张的牌
        const handCount = {};
        myHand.forEach(t => { handCount[t.name] = (handCount[t.name] || 0) + 1; });

        const tingSet = new Set();
        const tingTiles = [];
        const types = ['万', '条', '筒'];
        const candidates = [];
        types.forEach(t => { for (let n = 1; n <= 9; n++) candidates.push({ type: t, num: n, name: `${n}${t}`, id: `cand_${t}_${n}` }); });
        const winds = ['东', '南', '西', '北'];
        winds.forEach((w, idx) => candidates.push({ type: '字', num: idx + 1, name: `${w}风`, id: `cand_风_${w}` }));
        const dragons = [{ name: '红中', num: 5 }, { name: '发财', num: 6 }, { name: '白板', num: 7 }];
        dragons.forEach(d => candidates.push({ type: '字', num: d.num, name: d.name, id: `cand_箭_${d.name}` }));

        for (const cand of candidates) {
            // 该牌已在手 4 张，无法再胡
            if ((handCount[cand.name] || 0) >= 4) continue;
            try {
                if (isFourteen) {
                    // 14 张：遍历打出任意一张后，剩下的 13 张 + cand 能否胡
                    const seen = new Set();
                    for (let i = 0; i < myHand.length; i++) {
                        const drop = myHand[i];
                        const dropKey = drop.name + '_' + i;
                        if (seen.has(drop.name)) continue;
                        seen.add(drop.name);
                        const rest = myHand.filter((_, idx) => idx !== i);
                        if (engine.checkCanHu(rest, cand)) {
                            if (!tingSet.has(cand.name)) {
                                tingSet.add(cand.name);
                                tingTiles.push(cand.name);
                            }
                            break;
                        }
                    }
                } else {
                    if (engine.checkCanHu(myHand, cand)) {
                        if (!tingSet.has(cand.name)) {
                            tingSet.add(cand.name);
                            tingTiles.push(cand.name);
                        }
                    }
                }
            } catch (e) { /* 单张检测异常忽略 */ }
        }

        if (tingTiles.length === 0) return null;
        return { tingSet, tingCount: tingTiles.length, tingTiles };
    }

    /**
     * 🀄 渲染听牌徽章（顶部状态胶囊右侧）
     */
    renderMahjongTingBadge(tingInfo) {
        let badge = document.getElementById('mahjongTingBadge');
        if (!tingInfo) {
            if (badge) badge.style.display = 'none';
            return;
        }
        if (!badge) {
            const topBar = document.getElementById('mahjongTopBar');
            if (!topBar) return;
            badge = document.createElement('div');
            badge.id = 'mahjongTingBadge';
            badge.className = 'mahjong-ting-badge';
            topBar.appendChild(badge);
        }
        badge.innerHTML = `<span class="ting-title">🎯 听牌</span><span class="ting-count">${tingInfo.tingCount}张</span><span class="ting-tiles">${tingInfo.tingTiles.join(' ')}</span>`;
        badge.style.display = 'inline-flex';
    }

    /**
     * 🀄 发牌动画中渐进渲染 4 家手牌 (按步数递增: 4 -> 8 -> 12 -> 13/14)
     */
    renderMahjongHandTilesPartial(step) {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const myHand = engine.hands[mySlot] || [];
        const maxTilesToRender = Math.min(myHand.length, step * 4);

        const containerBottom = document.getElementById('mahjongHandTilesContainer');
        if (containerBottom) {
            containerBottom.innerHTML = '';
            for (let index = 0; index < maxTilesToRender; index++) {
                const tile = myHand[index];
                const card = document.createElement('div');
                card.className = 'mahjong-tile-card';
                card.innerHTML = this.getMahjongTileFaceHTML(tile);
                containerBottom.appendChild(card);
            }
        }

        const topHand = engine.hands[(mySlot + 2) % 4] || [];
        const leftHand = engine.hands[(mySlot + 3) % 4] || [];
        const rightHand = engine.hands[(mySlot + 1) % 4] || [];

        const countTop = Math.min(topHand.length, step * 4);
        const countLeft = Math.min(leftHand.length, step * 4);
        const countRight = Math.min(rightHand.length, step * 4);

        const containerTop = document.getElementById('mahjongTilesTop');
        if (containerTop) {
            let html = '';
            for (let i = 0; i < countTop; i++) html += `<div class="standing-tile-top"></div>`;
            containerTop.innerHTML = html;
        }

        const containerLeft = document.getElementById('mahjongTilesLeft');
        if (containerLeft) {
            let html = '';
            for (let i = 0; i < countLeft; i++) html += `<div class="standing-tile-left"></div>`;
            containerLeft.innerHTML = html;
        }

        const containerRight = document.getElementById('mahjongTilesRight');
        if (containerRight) {
            let html = '';
            for (let i = 0; i < countRight; i++) html += `<div class="standing-tile-right"></div>`;
            containerRight.innerHTML = html;
        }

        this.renderMahjongVisualWall();

        // 重渲染后恢复碰/杠高亮（若响应仍未结束）
        if (this.pendingDiscardRes) {
            this.highlightMahjongActionTiles(this.pendingDiscardRes);
        }
    }

    /**
     * 🀄 开局前置洗牌摆牌 + 上下左右分发 4 家手牌动画
     */
    triggerMahjongDealAnimation(onComplete) {
        const overlay = document.getElementById('mahjongDealingOverlay');
        if (!overlay) {
            if (onComplete) onComplete();
            return;
        }

        this.isMahjongDealingAnim = true;

        // 发牌之前所有人手上均无牌 (完全清空)
        this.renderMahjongHandTilesPartial(0);

        overlay.innerHTML = `
            <div class="deal-wall-center-grid" id="dealCenterGrid">
                ${Array(24).fill('<div class="deal-tile-back"></div>').join('')}
            </div>
        `;
        overlay.style.display = 'flex';
        overlay.classList.add('active');

        if (typeof SoundEngine !== 'undefined') {
            if (typeof SoundEngine.playMahjongShuffle === 'function') {
                SoundEngine.playMahjongShuffle();
            } else if (typeof SoundEngine.playCardSort === 'function') {
                SoundEngine.playCardSort();
            }
        }

        const seats = ['bottom', 'right', 'top', 'left'];
        let step = 0;
        const totalRounds = 4;

        const dealTimer = setInterval(() => {
            step++;
            if (step <= totalRounds) {
                // 4 个方向平滑飞牌动画
                seats.forEach((seat) => {
                    const flyingTile = document.createElement('div');
                    flyingTile.className = `flying-deal-tile fly-to-${seat}`;
                    overlay.appendChild(flyingTile);

                    setTimeout(() => {
                        flyingTile.classList.add('arrived');
                        setTimeout(() => flyingTile.remove(), 200);
                    }, 40);
                });

                if (typeof SoundEngine !== 'undefined' && typeof SoundEngine.playMahjongTile === 'function') {
                    SoundEngine.playMahjongTile();
                }

                this.renderMahjongHandTilesPartial(step);
            } else {
                clearInterval(dealTimer);
                setTimeout(() => {
                    overlay.classList.remove('active');
                    setTimeout(() => {
                        overlay.style.display = 'none';
                        this.isMahjongDealingAnim = false;
                        this.renderMahjongHandTiles();
                        this.renderMahjongDiscards();
                        this.renderMahjongMelds();
                        this.renderMahjongVisualWall();
                        if (onComplete) onComplete();
                    }, 250);
                }, 150);
            }
        }, 250);
    }

    /**
     * 渲染 4 方吃碰杠牌堆 (Melds)
     */
    renderMahjongMelds() {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const meldMap = [
            { id: 'meldsBottom', idx: mySlot },
            { id: 'meldsRight',  idx: (mySlot + 1) % 4 },
            { id: 'meldsTop',    idx: (mySlot + 2) % 4 },
            { id: 'meldsLeft',   idx: (mySlot + 3) % 4 }
        ];

        // 手机端：读取当前手牌卡片的实际宽度，让碰/吃/杠牌堆与手牌同尺寸
        let handTileW = null;
        const isMobileView = window.innerWidth <= 768;
        if (isMobileView) {
            const handTile = document.querySelector('.mahjong-tile-card');
            if (handTile) handTileW = Math.round(handTile.getBoundingClientRect().width);
        }

        meldMap.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                const list = engine.melds[item.idx] || [];
                el.innerHTML = list.map(m => {
                    const tilesHtml = m.tiles.map(t => `<div class="meld-tile" ${handTileW ? `style="width:${handTileW}px;height:${Math.round(handTileW * 1.34)}px;"` : ''}>${this.getMahjongTileFaceHTML(t)}</div>`).join('');
                    return `<div class="meld-group">${tilesHtml}</div>`;
                }).join('');
            }
        });
    }

    /**
     * 渲染 4 方弃牌堆（最新打出的牌添加红点高亮）
     */
    renderMahjongDiscards() {
        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const map = [
            { id: 'discardsBottom', idx: mySlot },
            { id: 'discardsRight',  idx: (mySlot + 1) % 4 },
            { id: 'discardsTop',    idx: (mySlot + 2) % 4 },
            { id: 'discardsLeft',   idx: (mySlot + 3) % 4 }
        ];

        const lastTile = engine.lastDiscard ? engine.lastDiscard.tile : null;
        const lastPlayer = engine.lastDiscard ? engine.lastDiscard.playerIdx : null;

        map.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                const list = engine.discards[item.idx] || [];
                el.innerHTML = list.map((t, index) => {
                    const isLatest = (item.idx === lastPlayer && index === list.length - 1);
                    return `<div class="discard-chip ${isLatest ? 'latest-discard' : ''}">${this.getMahjongTileFaceHTML(t)}</div>`;
                }).join('');
            }
        });
    }

    /**
     * 3D 抛掷出牌飞行动画
     */
    animateTileThrow(tile, playerIdx) {
        const table = document.querySelector('.vertical-mahjong-table');
        if (!table) return;

        const animTile = document.createElement('div');
        animTile.className = `throwing-mahjong-tile player-${playerIdx}`;
        animTile.innerHTML = tile ? this.getMahjongTileFaceHTML(tile) : '🀄';

        table.appendChild(animTile);

        setTimeout(() => {
            if (animTile.parentNode) {
                animTile.parentNode.removeChild(animTile);
            }
        }, 450);
    }

    /**
     * 🀄 拟真摸牌飞牌动画 (从剩余牌墙/中心桌台飞入当前出牌玩家手牌区)
     */
    animateTileDraw(playerIdx, tile, onComplete) {
        const table = document.querySelector('.vertical-mahjong-table');
        if (!table) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const relativePos = (playerIdx - mySlot + 4) % 4;

        // 播摸牌声音
        if (typeof SoundEngine !== 'undefined') {
            try {
                if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                else if (typeof SoundEngine.playCardFlipSound === 'function') SoundEngine.playCardFlipSound();
            } catch (e) {}
        }

        // 创建飞行动态抓牌元素
        const animTile = document.createElement('div');
        animTile.className = `drawing-mahjong-tile target-player-${relativePos}`;

        // 我方摸牌显示正面图案，其他玩家显示绿色盖牌背面
        if (relativePos === 0 && tile) {
            animTile.innerHTML = this.getMahjongTileFaceHTML(tile);
            animTile.classList.add('is-face');
        } else {
            animTile.classList.add('is-back');
        }

        table.appendChild(animTile);

        // 动画时长 260ms
        setTimeout(() => {
            if (animTile.parentNode) {
                animTile.parentNode.removeChild(animTile);
            }
            if (typeof onComplete === 'function') onComplete();
        }, 260);
    }

    /**
     * 启动/重置 25 秒麻将倒计时器 (与扑克风格一致，超时自动打出刚摸的牌)
     */
    resetMahjongTurnTimer() {
        if (this._mahjongTimerInterval) {
            clearInterval(this._mahjongTimerInterval);
            this._mahjongTimerInterval = null;
        }

        const timerEl = document.getElementById('mahjongTimer');
        const engine = window.mahjongEngine;
        if (!engine || engine.isGameOver) {
            if (timerEl) {
                timerEl.textContent = '25';
                timerEl.classList.remove('urgent');
            }
            return;
        }

        this._mahjongTimerSeconds = this.pendingDiscardRes ? 10 : 25;
        if (timerEl) {
            timerEl.textContent = String(this._mahjongTimerSeconds);
            timerEl.classList.remove('urgent');
        }

        // 响应浮条倒计时徽标同步
        const actTimerEl = document.getElementById('mahjongActionTimer');
        if (actTimerEl) {
            if (this.pendingDiscardRes) {
                actTimerEl.style.display = 'inline-block';
                actTimerEl.textContent = `⏱ ${this._mahjongTimerSeconds}s`;
                actTimerEl.classList.remove('urgent');
            } else {
                actTimerEl.style.display = 'none';
            }
        }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        this._mahjongTimerInterval = setInterval(() => {
            const mahjongScr = document.getElementById('mahjongGameScreen');
            if (!mahjongScr || mahjongScr.style.display === 'none' || !engine || engine.isGameOver) {
                clearInterval(this._mahjongTimerInterval);
                this._mahjongTimerInterval = null;
                return;
            }

            this._mahjongTimerSeconds--;
            if (timerEl) {
                timerEl.textContent = Math.max(0, this._mahjongTimerSeconds);
                if (this._mahjongTimerSeconds <= 5) timerEl.classList.add('urgent');
                else timerEl.classList.remove('urgent');
            }
            if (actTimerEl) {
                if (this.pendingDiscardRes) {
                    actTimerEl.textContent = `⏱ ${Math.max(0, this._mahjongTimerSeconds)}s`;
                    if (this._mahjongTimerSeconds <= 3) actTimerEl.classList.add('urgent');
                    else actTimerEl.classList.remove('urgent');
                } else {
                    actTimerEl.style.display = 'none';
                }
            }

            if (this._mahjongTimerSeconds <= 0) {
                clearInterval(this._mahjongTimerInterval);
                this._mahjongTimerInterval = null;

                // 超时托管判定
                if (this.pendingDiscardRes) {
                    // 吃碰杠胡响应超时 -> 自动过牌
                    UIRenderer.showToast('⏳ 响应超时，已自动过牌');
                    this.handleMahjongPassClick();
                } else if (engine.currentTurn === mySlot) {
                    // 我方回合打牌超时 -> 自动打出刚摸到的牌
                    const myHand = engine.hands[mySlot] || [];
                    if (myHand.length > 0) {
                        let targetIndex = myHand.length - 1;
                        if (engine.lastDrawnTile) {
                            const drawnIdx = myHand.findIndex(t => t.id === engine.lastDrawnTile.id || (t.type === engine.lastDrawnTile.type && t.num === engine.lastDrawnTile.num));
                            if (drawnIdx !== -1) targetIndex = drawnIdx;
                        }
                        UIRenderer.showToast('⏳ 出牌超时，已自动打出刚摸到的牌！');
                        this.handleMahjongTileDiscard(targetIndex);
                    }
                }
            }
        }, 1000);
    }

    /**
     * 更新 3D 局风罗盘与当前出牌回合指示
     */
    updateMahjongStatusUI(msg) {
        const textEl = document.getElementById('mahjongTurnText');
        if (textEl) textEl.textContent = msg;

        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const relativeTurn = (engine.currentTurn - mySlot + 4) % 4;

        const winds = ['windSouth', 'windEast', 'windNorth', 'windWest'];
        winds.forEach((wId, idx) => {
            const el = document.getElementById(wId);
            if (el) {
                if (relativeTurn === idx) el.classList.add('active');
                else el.classList.remove('active');
            }
        });

        // 回合强调：轮到我方时手牌区金色脉冲边框 + 顶部状态高亮
        const isMyTurn = (engine.currentTurn === mySlot && !engine.isGameOver);
        const handWrap = document.getElementById('mahjongHandTilesContainer');
        const turnStatus = document.getElementById('mahjongTurnStatus');
        if (handWrap) {
            if (isMyTurn) handWrap.classList.add('my-turn-glow');
            else handWrap.classList.remove('my-turn-glow');
        }
        if (turnStatus) {
            if (isMyTurn) turnStatus.classList.add('my-turn-active');
            else turnStatus.classList.remove('my-turn-active');
        }
        // 预选支持：非我方回合不清空选中（玩家可提前选好牌），仅隐藏出牌按钮；
        // 轮到自己时若有预选，自动点亮出牌按钮，可直接出牌
        if (isMyTurn) {
            if (this.selectedMahjongTileIndex >= 0) {
                this.showMahjongDiscardBar(this.selectedMahjongTileIndex);
            }
        } else {
            this.hideMahjongDiscardBar();
        }

        // 每次状态更新重新启动 25 秒倒计时
        this.resetMahjongTurnTimer();
    }

    /**
     * 检查我方在自己回合的自摸或杠牌选项
     */
    checkSelfActionsOnTurn() {
        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn !== mySlot) return;

        const actionBar = document.getElementById('mahjongActionBar');
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        const canSelfHu = engine.checkCanHu(engine.hands[mySlot] || []);
        const selfKongOptions = engine.getSelfKongOptions(mySlot);
        const canSelfKong = selfKongOptions.length > 0;

        if (canSelfHu || canSelfKong) {
            if (btnChow) btnChow.style.display = 'none';
            if (btnPong) btnPong.style.display = 'none';
            if (btnKong) btnKong.style.display = canSelfKong ? 'inline-block' : 'none';
            if (btnHu) btnHu.style.display = canSelfHu ? 'inline-block' : 'none';
            if (btnPass) btnPass.style.display = 'inline-block';
            if (actionBar) actionBar.style.display = 'flex';
        } else {
            if (actionBar) actionBar.style.display = 'none';
        }
    }

    /**
     * 我方打牌与 4 人 AI 顺序轮转
     */
    /**
     * 📱 手机端：选中手牌后点亮出牌按钮（固定在 ID 信息右侧）
     */
    showMahjongDiscardBar(index) {
        const btn = document.getElementById('btnMahjongDiscard');
        const engine = window.mahjongEngine;
        if (!btn) return;
        if (!engine || engine.isGameOver || engine.currentTurn !== (NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0)) {
            this.hideMahjongDiscardBar();
            return;
        }
        const hand = engine.hands[NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0] || [];
        const tile = hand[index];
        btn.classList.add('armed');
        btn.title = tile ? `出牌：${tile.name}` : '出牌';
    }

    /**
     * 📱 手机端：取消选中时熄灭出牌按钮
     */
    hideMahjongDiscardBar() {
        const btn = document.getElementById('btnMahjongDiscard');
        if (btn) {
            btn.classList.remove('armed');
            btn.title = '选中手牌后点击出牌';
        }
    }

    handleMahjongTileDiscard(tileIndex) {
        if (this.isMahjongDealingAnim) return;
        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn !== mySlot) {
            UIRenderer.showToast('⏳ 正在等待其他玩家出牌...');
            return;
        }

        // 隐藏动作条
        const actionBar = document.getElementById('mahjongActionBar');
        if (actionBar) actionBar.style.display = 'none';
        this.hideMahjongDiscardBar();

        const res = engine.discardTile(mySlot, tileIndex);
        if (!res) return;

        if (typeof SoundEngine !== 'undefined') {
            try {
                if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                else if (typeof SoundEngine.playCardPlaySound === 'function') SoundEngine.playCardPlaySound();
            } catch (e) {}
        }

        this.animateTileThrow(res.discarded, 0);
        this.renderMahjongHandTiles(true);
        this.renderMahjongDiscards();

        // 注意: 下家摸牌动画移交至其行动流程 (triggerAiTurnLoop / 轮到我方时) 统一处理,
        // 出牌后不再立即摸牌 (响应判定先于摸牌, 修正手牌数错乱)

        // 广播出牌与最新全量牌桌状态至 Firebase 云端
        if (!NetworkManager.isAiMode && NetworkManager.roomId) {
            NetworkManager.sendMahjongMove(mySlot, tileIndex, res.discarded, engine.exportState());
        }
        this._mahjongLastMoveTs = Date.now();

        if (res.isGameOver) {
            this.showMahjongSettlement(-1, null);
            return;
        }

        const nextTurn = engine.currentTurn;
        const isNextAi = (this.gameState.players && this.gameState.players[nextTurn]) ? this.gameState.players[nextTurn].isAi : (nextTurn !== mySlot);
        const shouldRunAi = NetworkManager.isAiMode || !NetworkManager.roomId || (NetworkManager.isHost && isNextAi);

        if (shouldRunAi) {
            this.triggerAiTurnLoop();
        }
    }

    /**
     * 3 家 AI 依序打牌与响应循环 (AI 智能胡、碰、杠、吃)
     */
    triggerAiTurnLoop() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        if (!mahjongScr || mahjongScr.style.display === 'none') {
            this._mahjongAiBusy = false;
            return;
        }

        const engine = window.mahjongEngine;
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (!engine || engine.isGameOver || engine.currentTurn === mySlot) {
            this._mahjongAiBusy = false;
            return;
        }

        // 防重入守卫：同一时刻只允许一条 AI 链运行
        if (this._mahjongAiBusy) return;
        this._mahjongAiBusy = true;

        const aiIdx = engine.currentTurn;
        const relativePos = (aiIdx - mySlot + 4) % 4;
        const seatLabels = ['你', '右家', '对家', '左家'];
        const aiName = seatLabels[relativePos] || `AI-${aiIdx}`;
        this.updateMahjongStatusUI(`🍖 ${aiName} 正在烧烤...`);

        // 拟真玩家思维延迟 800ms ~ 1500ms
        const thinkDelay = 800 + Math.floor(Math.random() * 700);

        setTimeout(() => {
            // 回合即将执行，释放守卫
            this._mahjongAiBusy = false;
            try {
                // 界面脱离/退回大厅判定：如果在思考延迟期间用户已退出麻将屏，直接丢弃，严禁播音效或继续发牌！
                const scrCheck = document.getElementById('mahjongGameScreen');
                if (!scrCheck || scrCheck.style.display === 'none' || engine.isGameOver || engine.currentTurn === mySlot) return;

                const curIdx = engine.currentTurn;
                const isAiSeatNow = (this.gameState.players && this.gameState.players[curIdx]) ? this.gameState.players[curIdx].isAi : (curIdx !== mySlot);
                if (!isAiSeatNow) return;

                // AI 行动前摸牌 (响应判定之后轮到 AI 才摸; 杠后补摸或庄家首牌已摸则跳过)
                if (engine.pendingDraw) {
                    const drawRes = engine.drawTile(curIdx);
                    if (!drawRes) {
                        // 牌墙摸完 -> 流局平局
                        this.showMahjongSettlement(-1, null);
                        return;
                    }
                    this.animateTileDraw(curIdx, engine.lastDrawnTile);
                    this.renderMahjongHandTiles(true);
                }

                // AI 自摸胡 / 暗杠检查 (摸牌后)
                if (engine.checkCanHu(engine.hands[curIdx])) {
                    engine.isGameOver = true;
                    engine.winner = curIdx;
                    if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                        NetworkManager.sendMahjongMove(curIdx, -1, null, engine.exportState(), 'HU');
                    }
                    this.showMahjongSettlement(curIdx, engine.getHuDetails(curIdx, null, true));
                    return;
                }
                const aiSelfKong = engine.getSelfKongOptions(curIdx);
                if (aiSelfKong.length > 0 && Math.random() < 0.3) {
                    engine.executeSelfKong(curIdx, aiSelfKong[0]);
                    this.renderMahjongHandTiles(true);
                    this.renderMahjongMelds();
                    // 杠后补摸的牌继续检查能否再胡/再杠
                    if (engine.checkCanHu(engine.hands[curIdx])) {
                        engine.isGameOver = true;
                        engine.winner = curIdx;
                        if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                            NetworkManager.sendMahjongMove(curIdx, -1, null, engine.exportState(), 'HU');
                        }
                        this.showMahjongSettlement(curIdx, engine.getHuDetails(curIdx, null, true));
                        return;
                    }
                    const skAgain = engine.getSelfKongOptions(curIdx);
                    if (skAgain.length > 0 && Math.random() < 0.3) {
                        engine.executeSelfKong(curIdx, skAgain[0]);
                        this.renderMahjongHandTiles(true);
                        this.renderMahjongMelds();
                    }
                }

                const aiMoveIdx = engine.getBestAiMove(curIdx);
                const aiRes = engine.discardTile(curIdx, aiMoveIdx);

                // 广播 AI 出牌与最新全量牌桌状态至 Firebase 云端（保证非房主客户端同步）
                if (!NetworkManager.isAiMode && NetworkManager.roomId && aiRes && aiRes.discarded) {
                    NetworkManager.sendMahjongMove(curIdx, aiMoveIdx, aiRes.discarded, engine.exportState());
                }
                this._mahjongLastMoveTs = Date.now();

                if (typeof SoundEngine !== 'undefined') {
                    try {
                        if (typeof SoundEngine.playMahjongTile === 'function') SoundEngine.playMahjongTile();
                        else if (typeof SoundEngine.playCardPlaySound === 'function') SoundEngine.playCardPlaySound();
                    } catch (e) {
                        console.warn('[Mahjong] 音效播放异常(已忽略):', e);
                    }
                }

                if (aiRes && aiRes.discarded) {
                    this.animateTileThrow(aiRes.discarded, curIdx);
                }

                this.renderMahjongHandTiles(true);
                this.renderMahjongDiscards();

                if (aiRes && aiRes.isGameOver) {
                    this.showMahjongSettlement(-1, null);
                    return;
                }

                // 检查我方 (Seat 0) 对 AI 打出的牌是否有 碰/杠/吃/胡 响应 (含截胡判定)
                if (aiRes && (aiRes.canHu || aiRes.canPong || aiRes.canKong || aiRes.canChow)) {
                    if (aiRes.huBlocked) {
                        // 我方被更高优先级玩家截胡: 隐藏胡按钮并提示
                        aiRes.canHu = false;
                        const seatLabels2 = ['你', '右家', '对家', '左家'];
                        const blockerSeat = aiRes.huWinner >= 0 ? (seatLabels2[(aiRes.huWinner - mySlot + 4) % 4] || '其他玩家') : '其他玩家';
                        UIRenderer.showToast(`🈲 你的胡被${blockerSeat}截胡了！`);
                    }
                    this.pendingDiscardRes = aiRes;
                    this.showHumanResponseActionBar(aiRes);
                    this.updateMahjongStatusUI('⚠️ 可响应出牌：请选择【吃 / 碰 / 杠 / 胡 / 过】');
                    // 联机/单机统一：10 秒内未响应则自动过牌，避免响应按钮长时间悬挂（倒计时结束即轮到下家）
                    if (this._mahjongResponseTimer) clearTimeout(this._mahjongResponseTimer);
                    this._mahjongResponseTimer = setTimeout(() => {
                        if (this.pendingDiscardRes) {
                            this.handleMahjongPassClick();
                        }
                    }, 10000);
                    return;
                }

                // 轮到下一家摸牌与打牌 (摸牌由下家行动流程统一处理)
                if (engine.currentTurn !== mySlot) {
                    this.triggerAiTurnLoop();
                } else {
                    // 轮到我方: 摸牌 (若待摸) + 检查自摸/暗杠
                    if (engine.pendingDraw) {
                        const drawRes = engine.drawTile(mySlot);
                        if (!drawRes) {
                            this.showMahjongSettlement(-1, null);
                            return;
                        }
                        this.animateTileDraw(mySlot, engine.lastDrawnTile);
                        this.renderMahjongHandTiles(true);
                    }
                    this.updateMahjongStatusUI('🀄 轮到你出牌');
                    this.checkSelfActionsOnTurn();
                }
            } catch (err) {
                console.error('[Mahjong] AI 回合执行异常，自动恢复轮转:', err);
                // 兜底：渲染/动画/音效等任何一步出错都不能让 AI 链永久卡死
                try {
                    const scrCheck = document.getElementById('mahjongGameScreen');
                    if (!scrCheck || scrCheck.style.display === 'none' || engine.isGameOver) return;
                    if (engine.currentTurn !== mySlot) {
                        this.triggerAiTurnLoop();
                    } else {
                        this.updateMahjongStatusUI('🀄 轮到你出牌');
                        this.checkSelfActionsOnTurn();
                    }
                } catch (e2) {
                    console.error('[Mahjong] AI 回合恢复失败:', e2);
                }
            }
        }, thinkDelay);
    }

    /**
     * 房主 AI 回合看门狗：若 AI 回合因任何原因卡住(异常/竞态)，自动重新驱动，保证对局不死锁
     */
    _checkMahjongAiWatchdog() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        if (!mahjongScr || mahjongScr.style.display === 'none') {
            if (this._mahjongWatchdogId) {
                clearInterval(this._mahjongWatchdogId);
                this._mahjongWatchdogId = null;
            }
            return;
        }

        const engine = window.mahjongEngine;
        if (!engine || engine.isGameOver || engine.currentTurn === 0) return;
        if (!NetworkManager.isHost || NetworkManager.isAiMode || !NetworkManager.roomId) return;
        if (this._mahjongAiBusy) return;

        const p = this.gameState.players[engine.currentTurn];
        const isAiTurn = p ? !!p.isAi : (engine.currentTurn !== 0);
        if (!isAiTurn) return;
        if (Date.now() - (this._mahjongLastMoveTs || 0) < 6000) return;

        console.warn('[Mahjong] 检测到 AI 回合疑似卡住，看门狗自动恢复驱动');
        this.triggerAiTurnLoop();
    }

    /**
     * 展示我方吃碰杠胡响应动作浮条
     */
    showHumanResponseActionBar(res) {
        const actionBar = document.getElementById('mahjongActionBar');
        const btnChow = document.getElementById('btnMahjongChow');
        const btnPong = document.getElementById('btnMahjongPong');
        const btnKong = document.getElementById('btnMahjongKong');
        const btnHu = document.getElementById('btnMahjongHu');
        const btnPass = document.getElementById('btnMahjongPass');

        if (btnChow) btnChow.style.display = res.canChow ? 'inline-block' : 'none';
        if (btnPong) btnPong.style.display = res.canPong ? 'inline-block' : 'none';
        if (btnKong) btnKong.style.display = res.canKong ? 'inline-block' : 'none';
        if (btnHu) btnHu.style.display = res.canHu ? 'inline-block' : 'none';
        if (btnPass) btnPass.style.display = 'inline-block';

        if (actionBar) actionBar.style.display = 'flex';

        // 🀄 碰/杠牌型高亮：高亮手牌中可与桌面弃牌组成碰/杠的搭子（金色脉冲提示）
        this.highlightMahjongActionTiles(res);
    }

    /**
     * 🀄 高亮可碰/可杠的手牌搭子（金色脉冲微光）
     */
    highlightMahjongActionTiles(res) {
        const container = document.getElementById('mahjongHandTilesContainer');
        if (!container || !res) return;

        // 清除旧高亮
        container.querySelectorAll('.mahjong-tile-card').forEach(c => c.classList.remove('action-highlight'));

        if (!res.canPong && !res.canKong) return;
        if (!res.discarded) return;

        const targetName = res.discarded.name;
        container.querySelectorAll('.mahjong-tile-card').forEach(card => {
            const face = card.querySelector('.m-face');
            if (!face) return;
            const tileName = face.dataset.tileName;
            if (tileName === targetName) {
                card.classList.add('action-highlight');
            }
        });
    }

    /**
     * 清除手牌上的碰/杠高亮（响应结束或重新渲染时调用）
     */
    clearMahjongActionHighlight() {
        const container = document.getElementById('mahjongHandTilesContainer');
        if (!container) return;
        container.querySelectorAll('.mahjong-tile-card').forEach(c => c.classList.remove('action-highlight'));
    }

    /**
     * 点击【吃】按钮逻辑
     */
    handleMahjongChowClick() {
        const engine = window.mahjongEngine;
        if (!engine || !this.pendingDiscardRes || !this.pendingDiscardRes.canChow) return;

        const options = this.pendingDiscardRes.chowOptions || [];
        if (options.length === 0) return;

        if (options.length === 1) {
            this.executeChowOption(options[0]);
        } else {
            // 多组吃牌组合，弹出选择框
            const modal = document.getElementById('mahjongChowModal');
            const listEl = document.getElementById('chowOptionsList');
            if (modal && listEl) {
                listEl.innerHTML = '';
                const tile = this.pendingDiscardRes.discarded;

                options.forEach((pair) => {
                    const btn = document.createElement('button');
                    btn.className = 'chow-option-btn';
                    btn.innerHTML = `<span>${pair[0].name}</span> + <span>${pair[1].name}</span> + <span style="color:#fef08a;">[${tile.name}]</span>`;
                    btn.onclick = () => {
                        modal.style.display = 'none';
                        this.executeChowOption(pair);
                    };
                    listEl.appendChild(btn);
                });
                modal.style.display = 'flex';
            }
        }
    }

    executeChowOption(pair) {
        const engine = window.mahjongEngine;
        const res = this.pendingDiscardRes;
        if (!engine || !res) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (engine.executeChow(mySlot, res.discarded, pair)) {
            this.pendingDiscardRes = null;
            this.showMahjongActionToast('吃！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
            this.renderMahjongHandTiles();
            this.renderMahjongMelds();
            const actionBar = document.getElementById('mahjongActionBar');
            if (actionBar) actionBar.style.display = 'none';
            this.updateMahjongStatusUI('🀁 吃牌成功 · 请出牌');

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, res.discarded, engine.exportState(), 'CHOW');
            }
        }
    }

    /**
     * 点击【碰】按钮逻辑
     */
    handleMahjongPongClick() {
        const engine = window.mahjongEngine;
        if (!engine || !this.pendingDiscardRes) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const discarded = this.pendingDiscardRes.discarded;
        if (engine.executePong(mySlot, discarded)) {
            this.pendingDiscardRes = null;
            this.showMahjongActionToast('碰！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
            this.renderMahjongHandTiles();
            this.renderMahjongMelds();
            const actionBar = document.getElementById('mahjongActionBar');
            if (actionBar) actionBar.style.display = 'none';
            this.updateMahjongStatusUI('🀄 碰牌成功 · 请出牌');

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, discarded, engine.exportState(), 'PONG');
            }
        }
    }

    /**
     * 点击【杠】按钮逻辑 (包含明杠、暗杠、补杠)
     */
    handleMahjongKongClick() {
        const engine = window.mahjongEngine;
        if (!engine) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        if (this.pendingDiscardRes) {
            // 明杠
            const discarded = this.pendingDiscardRes.discarded;
            if (engine.executeKong(mySlot, discarded)) {
                this.pendingDiscardRes = null;
                this.showMahjongActionToast('杠！');
                if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
                this.renderMahjongHandTiles();
                this.renderMahjongMelds();
                const actionBar = document.getElementById('mahjongActionBar');
                if (actionBar) actionBar.style.display = 'none';
                this.updateMahjongStatusUI('🀅 杠牌补摸一牌 · 请出牌');

                if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                    NetworkManager.sendMahjongMove(mySlot, -1, discarded, engine.exportState(), 'KONG');
                }
            }
        } else {
            // 暗杠 / 补杠
            const options = engine.getSelfKongOptions(mySlot);
            if (options.length > 0) {
                if (engine.executeSelfKong(mySlot, options[0])) {
                    this.pendingDiscardRes = null;
                    this.showMahjongActionToast(options[0].type === 'ANKONG' ? '暗杠！' : '补杠！');
                    if (typeof SoundEngine !== 'undefined' && SoundEngine.playCardPlaySound) SoundEngine.playCardPlaySound();
                    this.renderMahjongHandTiles();
                    this.renderMahjongMelds();
                    const actionBar = document.getElementById('mahjongActionBar');
                    if (actionBar) actionBar.style.display = 'none';
                    this.updateMahjongStatusUI('🀅 杠牌补摸一牌 · 请出牌');

                    if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                        NetworkManager.sendMahjongMove(mySlot, -1, null, engine.exportState(), 'KONG');
                    }
                }
            }
        }
    }

    /**
     * 点击【胡】按钮逻辑 (点炮胡 / 自摸胡)
     */
    handleMahjongHuClick() {
        const engine = window.mahjongEngine;
        if (!engine) return;
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const isSelfDraw = !this.pendingDiscardRes;
        const extraTile = this.pendingDiscardRes ? this.pendingDiscardRes.discarded : null;

        // 点炮胡时二次校验截胡: 若该弃牌已被更高优先级玩家截胡则禁止胡牌 (防竞态/误触)
        if (this.pendingDiscardRes && this.pendingDiscardRes.huBlocked) {
            UIRenderer.showToast('🈲 你的胡已被截胡，无法胡牌！');
            return;
        }

        if (engine.checkCanHu(engine.hands[mySlot] || [], extraTile)) {
            const huDetails = engine.getHuDetails(mySlot, extraTile, isSelfDraw);
            this.showMahjongActionToast('胡！');
            if (typeof SoundEngine !== 'undefined' && SoundEngine.playWin) {
                SoundEngine.playWin();
            }
            engine.isGameOver = true;
            engine.winner = mySlot;
            this.showMahjongSettlement(mySlot, huDetails);

            if (!NetworkManager.isAiMode && NetworkManager.roomId) {
                NetworkManager.sendMahjongMove(mySlot, -1, extraTile, engine.exportState(), 'HU');
            }
        }
    }

    /**
     * 清除本端挂起的吃碰杠胡响应 (响应条/计时器/弹窗/高亮)
     */
    clearMahjongPendingResponse() {
        if (this._mahjongResponseTimer) { clearTimeout(this._mahjongResponseTimer); this._mahjongResponseTimer = null; }
        this.pendingDiscardRes = null;
        const actionBar = document.getElementById('mahjongActionBar');
        if (actionBar) actionBar.style.display = 'none';
        const actTimerEl = document.getElementById('mahjongActionTimer');
        if (actTimerEl) actTimerEl.style.display = 'none';
        const chowModal = document.getElementById('mahjongChowModal');
        if (chowModal) chowModal.style.display = 'none';
        this.clearMahjongActionHighlight();
    }

    /**
     * 点击【过】按钮逻辑
     */
    handleMahjongPassClick() {
        this.clearMahjongPendingResponse();

        const engine = window.mahjongEngine;
        if (!engine) return;

        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;

        // 轮到自己出牌时点过 (无响应场景) 无需额外动作
        if (engine.currentTurn === mySlot) {
            this.updateMahjongStatusUI('🀄 轮到你出牌');
            return;
        }

        // 联机客户端: 广播 PASS 通知房主继续驱动 AI (避免双端各自驱动导致状态分叉)
        if (!NetworkManager.isAiMode && NetworkManager.roomId && !NetworkManager.isHost) {
            NetworkManager.sendMahjongMove(mySlot, -1, null, engine.exportState(), 'PASS');
            return;
        }

        // 房主 / 单机 AI: 直接驱动 AI 轮转
        this.triggerAiTurnLoop();
    }

    /**
     * 展示麻将奢华结算面板
     */
    showMahjongSettlement(winnerIdx, huDetails) {
        const mySlot = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
        const modal = document.getElementById('mahjongSettlementModal');
        const iconEl = document.getElementById('mahjongWinIcon');
        const titleEl = document.getElementById('mahjongWinTitle');
        const subTitleEl = document.getElementById('mahjongWinSubtitle');
        const fanBadgeEl = document.getElementById('mahjongFanBadge');
        const fanListEl = document.getElementById('mahjongFanList');

        if (!modal) return;

        if (winnerIdx === -1) {
            // 流局平局
            if (iconEl) iconEl.textContent = '🤝';
            if (titleEl) titleEl.textContent = '流局平局';
            if (subTitleEl) subTitleEl.textContent = '牌墙已摸完，无家胡牌';
            if (fanBadgeEl) fanBadgeEl.textContent = '平局 0番';
            if (fanListEl) fanListEl.textContent = '· 荒庄流局';
        } else if (winnerIdx === mySlot) {
            // 我方大胜！
            if (iconEl) iconEl.textContent = '🏆';
            if (titleEl) titleEl.textContent = '胡牌大吉';
            if (subTitleEl) subTitleEl.textContent = '我方玩家 喜胡牌局！';
            const details = huDetails || { fanName: '平胡 1番', details: ['平胡 (1番)'] };
            if (fanBadgeEl) fanBadgeEl.textContent = details.fanName;
            if (fanListEl) fanListEl.innerHTML = details.details.map(d => `<span>· ${d}</span>`).join('<br>');
        } else {
            // 其他 AI 胡牌
            const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
            const winnerP = seatPlayers[winnerIdx];
            const winnerName = winnerP ? (winnerP.isAi ? `🤖 ${winnerP.name}` : winnerP.name) : `玩家${winnerIdx + 1}`;
            if (iconEl) iconEl.textContent = '🀄';
            if (titleEl) titleEl.textContent = '对局结束';
            if (subTitleEl) subTitleEl.textContent = `${winnerName} 抢先胡牌！`;
            if (fanBadgeEl) fanBadgeEl.textContent = '推倒胡';
            if (fanListEl) fanListEl.textContent = '· 对方胡牌';
        }

        // 💰 结算麻将【知因币】与动态渲染 4 席位知因币战报 (方案一: 线性番数乘率 + 放炮包赔)
        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
        const ratio = isPve ? 0.25 : 1.0;
        const fanCount = (huDetails && huDetails.fanCount) ? huDetails.fanCount : 1;
        const baseAmount = 100 * fanCount;
        const winAmount = Math.ceil(baseAmount * ratio);

        const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
        const windNames = ['东', '南', '西', '北'];

        // 判定放炮者与自摸
        const engine = window.mahjongEngine;
        const isSelfDraw = !engine || !engine.lastDiscard || engine.lastDiscard.playerIdx === winnerIdx;
        const discarderIdx = (!isSelfDraw && engine && engine.lastDiscard) ? engine.lastDiscard.playerIdx : -1;

        // 计算 4 家精准损益
        const coinDiffs = [0, 0, 0, 0];
        if (winnerIdx !== -1) {
            coinDiffs[winnerIdx] = winAmount;
            if (isSelfDraw || discarderIdx === -1) {
                // 自摸：其余 3 家平摊 (三家分包)
                const perPlayerLoss = Math.ceil(winAmount / 3);
                for (let i = 0; i < 4; i++) {
                    if (i !== winnerIdx) {
                        coinDiffs[i] = -perPlayerLoss;
                    }
                }
            } else {
                // 放炮：放炮者一人承担全额 (放炮包赔)！另外 2 家 0 损益
                coinDiffs[discarderIdx] = -winAmount;
            }
        }

        // 动态渲染 4 家知因币结算战报
        for (let i = 0; i < 4; i++) {
            const rowEl = document.getElementById(`scoreRow${i}`);
            if (rowEl) {
                const relIdx = (mySlot + i) % 4;
                const p = seatPlayers[relIdx];
                const pName = p ? (p.isAi ? `🤖 ${p.name}` : p.name) : `玩家${relIdx + 1}`;
                const wTag = `(${windNames[relIdx]}风)`;
                const diff = coinDiffs[relIdx] || 0;

                if (winnerIdx === -1) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff" style="color:#94a3b8;">0 知因币</span>`;
                } else if (relIdx === winnerIdx) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff positive">+${diff} 知因币</span>`;
                } else if (relIdx === discarderIdx && !isSelfDraw) {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag} <b style="color:#f87171;font-size:0.7rem;">(放炮包赔)</b></span><span class="p-diff negative">${diff} 知因币</span>`;
                } else {
                    rowEl.innerHTML = `<span class="p-label">${pName} ${wTag}</span><span class="p-diff ${diff < 0 ? 'negative' : ''}" style="${diff === 0 ? 'color:#94a3b8;' : ''}">${diff} 知因币</span>`;
                }
            }
        }

        if (typeof AuthEngine !== 'undefined') {
            const myDiff = coinDiffs[mySlot] || 0;
            if (AuthEngine.updateCoins && winnerIdx !== -1 && myDiff !== 0) {
                const reasonStr = (winnerIdx === mySlot) 
                    ? (isPve ? `麻将切磋胡牌 (+${myDiff}币)` : `麻将大胜 (${fanCount}番 +${myDiff}币)`)
                    : (isPve ? `麻将切磋失利 (${myDiff}币)` : `麻将对局 (${myDiff}币)`);
                AuthEngine.updateCoins(myDiff, reasonStr);
            }

            // ⭐ 结算麻将【经验值】
            if (AuthEngine.addExp) {
                const isWin = (winnerIdx === mySlot);
                const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                AuthEngine.addExp(expVal, isPve ? '麻将切磋 (PVE)' : '麻将对局 (PVP)');
            }
        }

        const btnSettle = document.getElementById('btnMahjongSettleRematch');
        if (btnSettle) {
            btnSettle.disabled = false;
            btnSettle.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 再来一局';
            btnSettle.onclick = () => {
                if (NetworkManager.roomId && !NetworkManager.isAiMode) {
                    btnSettle.disabled = true;
                    btnSettle.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (等待全员...)';
                    this.handleSelfAction('RESTART_VOTE', { gameType: 'MAHJONG' });
                    if (NetworkManager.isHost) {
                        this.processRestartVote(0);
                    }
                } else {
                    modal.style.display = 'none';
                    this.startMahjongAiMode();
                }
            };
        }

        const btnLobby = document.getElementById('btnMahjongSettleLobby');
        if (btnLobby) {
            btnLobby.onclick = () => {
                modal.style.display = 'none';
                this.resetToLobby();
            };
        }

        if (NetworkManager.roomId && !NetworkManager.isAiMode) {
            NetworkManager.onMahjongRematchStatus((status) => {
                if (status && status.readyCount !== undefined) {
                    if (btnSettle) {
                        btnSettle.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (${status.readyCount}/${status.total || 4} 就绪)`;
                    }
                    UIRenderer.showToast(`⌛ 麻将对局就绪进度：${status.readyCount}/4`);
                }
            });
        }

        modal.style.display = 'flex';
    }

    /**
     * 刷新并渲染云端公共房间大厅列表
     */
    refreshPublicRoomsList(gameType = 'DOUDIZHU') {
        const container = document.getElementById('publicRoomsListContainer');
        if (!container) return;

        const isMahjong = gameType === 'MAHJONG';
        const isGomoku  = gameType === 'GOMOKU';
        const isGo      = gameType === 'GO';
        const isXiangqi = gameType === 'XIANGQI';
        const totalSeats = isMahjong ? 4 : ((isGomoku || isGo || isXiangqi) ? 2 : 3);
        const gameName   = isMahjong ? '游鲸麻将' : (isGomoku ? '五子棋' : (isGo ? '围棋' : (isXiangqi ? '象棋' : '斗地主')));

        const modalTitle = document.querySelector('#publicRoomsModal .ct-title');
        if (modalTitle) {
            modalTitle.innerHTML = isMahjong ?
                '<i class="fa-solid fa-square-full" style="color:#34d399;"></i> 在线游鲸麻将大厅' :
                (isGomoku ?
                '<i class="fa-solid fa-chess-board" style="color:#34d399;"></i> 在线五子棋对局大厅' :
                (isGo ?
                '<i class="fa-solid fa-circle" style="color:#e2e8f0;"></i> 在线围棋对局大厅' :
                (isXiangqi ?
                '<i class="fa-solid fa-chess-knight" style="color:#fecaca;"></i> 在线象棋对局大厅' :
                '<i class="fa-solid fa-list-check" style="color:#e2a820;"></i> 在线房间大厅')));
        }

        container.innerHTML = `<div style="text-align:center;color:${isMahjong || isGomoku || isGo || isXiangqi ? '#34d399' : '#94a3b8'};padding:25px;font-size:0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> 正在拉取${gameName}在线房间...</div>`;

        NetworkManager.fetchPublicRooms((rooms) => {
            container.innerHTML = '';

            if (!rooms || rooms.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;color:#94a3b8;padding:36px 10px;font-size:0.88rem;">
                        <i class="fa-solid fa-ghost" style="font-size:2rem;margin-bottom:10px;color:#a07840;display:block;"></i>
                        <div>当前暂无活跃 ${gameName} 公开房间</div>
                        <div style="font-size:0.75rem;margin-top:6px;color:#64748b;">快去点击【创建${gameName}对局】建立第一个房间吧！</div>
                    </div>
                `;
                return;
            }

            rooms.forEach(room => {
                const rId = room.roomId;
                const phase = (room.gameState && room.gameState.phase) ? room.gameState.phase : 'WAITING';
                const lobby = room.lobbyData || { players: [] };
                const rawP = lobby.players;
                const players = Array.isArray(rawP) ? rawP : (rawP ? Object.values(rawP) : []);

                let phaseText = '🟢 等待开局';
                let phaseClass = 'waiting';
                if (phase === 'BIDDING') { phaseText = isMahjong ? '🟡 摸牌起手' : '🟡 抢地主中'; phaseClass = 'bidding'; }
                if (phase === 'PLAYING') { phaseText = isMahjong ? '🀄 雀局进行中' : (isGomoku ? '♟️ 棋局进行中' : (isGo ? '⚫⚪ 棋局进行中' : (isXiangqi ? '♞ 棋局进行中' : '🔴 打牌进行中'))); phaseClass = 'playing'; }
                if (phase === 'GAMEOVER') { phaseText = '🎉 对局刚结束'; phaseClass = 'waiting'; }

                // 计算真人数量与 AI 数量
                const humanPlayers = players.filter(p => p && !p.isAi && p.name);
                const aiCount = totalSeats - humanPlayers.length;

                // 渲染玩家列表标签
                let playersHtml = players.map((p, idx) => {
                    if (!p) return '<span class="pr-player-pill ai">🤖 机器人</span>';
                    if (p.isAi) return `<span class="pr-player-pill ai">🤖 AI</span>`;
                    return `<span class="pr-player-pill human"><i class="fa-solid fa-user"></i> ${p.name}${idx === 0 ? ' (房主)' : ''}</span>`;
                }).join('');

                const item = document.createElement('div');
                item.className = 'public-room-item';
                item.innerHTML = `
                    <div class="pr-left">
                        <div class="pr-room-header">
                            <span class="pr-room-id"># ${rId}</span>
                            <span class="pr-phase-tag ${phaseClass}">${phaseText}</span>
                        </div>
                        <div class="pr-players">
                            ${playersHtml}
                        </div>
                    </div>
                    <button class="btn-join-public-room" data-join-room-id="${rId}">
                        ${aiCount > 0 ? `<i class="fa-solid fa-user-plus"></i> 替换 AI 加入` : `<i class="fa-solid fa-right-to-bracket"></i> 进入房间`}
                    </button>
                `;
                container.appendChild(item);
            });
        }, gameType);
    }

    /**
     * 点击一键复制房间号
     */
    copyRoomId() {
        const roomDisp = document.getElementById('waitingRoomIdDisplay');
        const roomId = roomDisp ? roomDisp.textContent.trim() : '';
        if (roomId && roomId !== '------') {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(roomId);
            } else {
                const t = document.createElement('textarea');
                t.value = roomId;
                document.body.appendChild(t);
                t.select();
                document.execCommand('copy');
                document.body.removeChild(t);
            }
            UIRenderer.showToast(`✅ 已复制房间号：${roomId}`);
        }
    }

    /**
     * 根据当前游戏动态拉取并展示【规则与牌型/番型说明】弹窗
     */
    openRulesModal() {
        const modal = document.getElementById('cardTypeModal');
        if (!modal) return;

        const mahjongScr = document.getElementById('mahjongGameScreen');
        const isMahjong = (this.activeGameType === 'MAHJONG') || (mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none')) || document.body.classList.contains('theme-mahjong');

        const modalTitle = modal.querySelector('.ct-title');
        const modalBody  = modal.querySelector('.ct-body');

        if (isMahjong) {
            if (modalTitle) {
                modalTitle.innerHTML = '<i class="fa-solid fa-square-full" style="color:#34d399;"></i> 国粹麻将规则 & 番型速查';
            }
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="ct-section" style="border-color:rgba(52,211,153,0.3);">
                        <div class="ct-section-title" style="color:#34d399;">🀄 基础胡牌与动作说明</div>
                        <div class="ct-row">
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#34d399;font-size:0.85rem;font-weight:800;">推倒胡 (3n+2)</div>
                                <div class="ct-desc">满足 4 组顺子/刻子 + 1 对将牌即可胡牌 (1番)</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#34d399;font-size:0.85rem;font-weight:800;">吃 / 碰 / 杠 / 过</div>
                                <div class="ct-desc">可吃上家牌组顺子，可碰/杠任意家相同牌组刻子</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section" style="border-color:rgba(245,158,11,0.3);">
                        <div class="ct-section-title" style="color:#fbbf24;">🔥 高番型特色大胡</div>
                        <div class="ct-row">
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#fbbf24;font-size:0.85rem;font-weight:800;">七对子 (4番)</div>
                                <div class="ct-desc">手牌 14 张全由 7 个相同对子组成，无需顺子</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#fbbf24;font-size:0.85rem;font-weight:800;">清一色 (4番)</div>
                                <div class="ct-desc">整副牌全由同一种花色(全万/全筒/全条)组成</div>
                            </div>
                            <div class="ct-item" style="min-width:110px;">
                                <div class="ct-name" style="color:#ef4444;font-size:0.85rem;font-weight:800;">清十八 (6番)</div>
                                <div class="ct-desc">吃碰杠 4 组同花色刻子/杠子 + 单张将牌</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section" style="border-color:rgba(255,255,255,0.1);">
                        <div class="ct-section-title" style="color:#60a5fa;">💡 摸牌与结算提示</div>
                        <div class="ct-row">
                            <div class="ct-item" style="width:100%;">
                                <div class="ct-desc" style="color:#cbd5e1;line-height:1.6;font-size:0.78rem;">
                                    • 自摸胡额外加番，放炮胡由放炮者单赔。<br>
                                    • 暗杠与明杠可在结算时获得额外杠分收益！
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } else {
            if (modalTitle) {
                modalTitle.innerHTML = '<i class="fa-solid fa-book-open" style="color:#ffd700;"></i> 斗地主牌型速查';
            }
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="ct-section">
                        <div class="ct-section-title">🔥 特殊牌型（无敌）</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card joker-big">大王</span><span class="ct-card joker-small">小王</span></div>
                                <div class="ct-name">火箭</div>
                                <div class="ct-desc">大小王合一，天下无敌</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">A</span><span class="ct-card">A</span><span class="ct-card">A</span><span class="ct-card">A</span></div>
                                <div class="ct-name">炸弹</div>
                                <div class="ct-desc">4张相同点数，可压任意普通牌型</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section">
                        <div class="ct-section-title">🃏 基础牌型</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">K</span></div>
                                <div class="ct-name">单张</div>
                                <div class="ct-desc">任意一张牌</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">8</span><span class="ct-card">8</span></div>
                                <div class="ct-name">对子</div>
                                <div class="ct-desc">2张相同点数</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">J</span><span class="ct-card">J</span><span class="ct-card">J</span></div>
                                <div class="ct-name">三张</div>
                                <div class="ct-desc">3张相同点数</div>
                            </div>
                        </div>
                    </div>

                    <div class="ct-section">
                        <div class="ct-section-title">🚀 三带系列</div>
                        <div class="ct-row">
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card red">5</span></div>
                                <div class="ct-name">三带一</div>
                                <div class="ct-desc">三张 + 任意1单张</div>
                            </div>
                            <div class="ct-item">
                                <div class="ct-cards"><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card">Q</span><span class="ct-card red">7</span><span class="ct-card red">7</span></div>
                                <div class="ct-name">三带二</div>
                                <div class="ct-desc">三张 + 1个对子</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        modal.style.display = 'flex';
    }

    /**
     * 根据当前界面 (大厅 / 游戏房) 动态切换顶部 app-header 可见性及品牌标题名称
     */
    updateHeaderVisibility() {
        const appHeader = document.querySelector('.app-header');
        const lobbyScr = document.getElementById('lobbyScreen');
        const mahjongScr = document.getElementById('mahjongGameScreen');
        const gomokuScr = document.getElementById('gomokuGameScreen');
        const goScr = document.getElementById('goGameScreen');

        const menuBtnHelp = document.getElementById('menuBtnCardHelp');
        const menuBtnLeave = document.getElementById('menuBtnLeaveRoom');
        const brandTitle = document.getElementById('appHeaderBrandTitle');

        const isMahjongScreen = mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none');
        const isGomokuScreen  = gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none');
        const isGoScreen      = goScr && (goScr.classList.contains('active') || goScr.style.display !== 'none');
        const isLobbyScreen   = lobbyScr && (lobbyScr.classList.contains('active') || lobbyScr.style.display !== 'none');

        // 动态更换 Header 左上角游戏品牌标题 (游鲸围棋 <-> 游鲸五子棋 <-> 游鲸斗地主 <-> 游鲸麻将 <-> 游鲸象棋)
        if (brandTitle) {
            if (isGoScreen || (isLobbyScreen && this.activeGameType === 'GO')) {
                brandTitle.textContent = '游鲸围棋';
            } else if (isMahjongScreen || (isLobbyScreen && this.activeGameType === 'MAHJONG')) {
                brandTitle.textContent = '游鲸麻将';
            } else if (isGomokuScreen || (isLobbyScreen && this.activeGameType === 'GOMOKU')) {
                brandTitle.textContent = '游鲸五子棋';
            } else if (isLobbyScreen && this.activeGameType === 'XIANGQI') {
                brandTitle.textContent = '游鲸象棋';
            } else {
                brandTitle.textContent = '游鲸斗地主';
            }
        }

        // 围棋/五子棋界面或大厅时隐藏“牌型说明”
        if (menuBtnHelp) {
            menuBtnHelp.style.display = (isGomokuScreen || isGoScreen || (isLobbyScreen && (this.activeGameType === 'GOMOKU' || this.activeGameType === 'GO' || this.activeGameType === 'XIANGQI'))) ? 'none' : 'flex';
        }

        // 非主界面时在右上角下拉菜单中显示“退出/离开房间”按钮
        if (menuBtnLeave) {
            menuBtnLeave.style.display = isLobbyScreen ? 'none' : 'flex';
        }

        if (!appHeader) return;

        if (isLobbyScreen) {
            appHeader.style.display = 'none';
            appHeader.classList.add('in-lobby');
            if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndShowPendingLevelUp) {
                AuthEngine.checkAndShowPendingLevelUp();
            }
        } else {
            appHeader.style.display = 'flex';
            appHeader.classList.remove('in-lobby');
        }

        // 动态在顶部 Nav 栏显示不显眼的房间号与一键邀请按钮（支持斗地主、麻将、五子棋在线局）
        const roomInfoBar = document.getElementById('roomInfoBar');
        const displayRoomId = document.getElementById('displayRoomId');
        const currentRoomId = NetworkManager.roomId || (this.gameState ? this.gameState.roomId : '');

        if (roomInfoBar) {
            if (!isLobbyScreen && currentRoomId && !NetworkManager.isAiMode) {
                if (displayRoomId) displayRoomId.textContent = currentRoomId;
                roomInfoBar.style.display = 'inline-flex';
            } else {
                roomInfoBar.style.display = 'none';
            }
        }
    }

    /**
     * 进入等待界面 (Host视角)
     */
    setupWaitingScreen(roomId) {
        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'flex';
        document.getElementById('waitingScreen').classList.add('active');
        this.updateHeaderVisibility();

        const btnGoHomeTop = document.getElementById('btnGoHomeTop');
        if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';

        // 生成真实访问 URL
        let origin = window.location.origin;
        if (!origin || origin === 'null') origin = window.location.protocol + '//' + window.location.host;

        const shareUrl = `${origin}${window.location.pathname}?room=${roomId}`;
        const inviteInput = document.getElementById('inviteUrlInput');
        if (inviteInput) inviteInput.value = shareUrl;

        const displayRoom = document.getElementById('displayRoomId');
        if (displayRoom) displayRoom.textContent = roomId;
        // 等待屏内的房间号块单独展示 (ID 读取选第一个)
        const waitingRoomDisp = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp) waitingRoomDisp.textContent = roomId;

        const roomInfoBar = document.getElementById('roomInfoBar');
        if (roomInfoBar) roomInfoBar.style.display = 'none'; // 房间等待界面隐去顶部 NAV 栏重复的房间号

        const menuLeaveBtn = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn) menuLeaveBtn.style.display = 'flex';

        // 生成二维码
        const qrContainer = document.getElementById('qrcode');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            if (window.QRCode) {
                new QRCode(qrContainer, {
                    text: shareUrl,
                    width: 100,
                    height: 100
                });
            }
        }

        // 初始化房主 slot0
        const nick = NetworkManager.nickname || '房主';
        const currentAvatar = (typeof AuthEngine !== 'undefined' && AuthEngine.userData) ? (AuthEngine.userData.avatar || '🤠') : '🤠';
        this.gameState.players[0].name = nick;
        this.gameState.players[0].avatar = currentAvatar;
        this.gameState.players[0].isAi = false;

        const slotName0 = document.getElementById('slotName0');
        const slotAvatar0 = document.getElementById('slotAvatar0');
        if (slotName0) slotName0.textContent = `${nick} (房主)`;
        if (slotAvatar0) slotAvatar0.textContent = currentAvatar;

        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');
        const btnStart = document.getElementById('btnStartGame');
        const btnAi = document.getElementById('btnStartWithAi');

        const currentType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (currentType === 'MAHJONG');
        const isGomoku  = (currentType === 'GOMOKU');
        const isGo      = (currentType === 'GO');

        if (isMahjong) {
            NetworkManager.gameType = 'MAHJONG';
            this.activeGameType = 'MAHJONG';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4 (差人自动补AI)</span>';
            }
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';

            this._fillSlotWithAi(1);
            this._fillSlotWithAi(2);
            this._fillSlotWithAi(3);
            const slotName1 = document.getElementById('slotName1');
            const slotName2 = document.getElementById('slotName2');
            const slotName3 = document.getElementById('slotName3');
            if (slotName1) slotName1.textContent = 'AI 雀圣 1';
            if (slotName2) slotName2.textContent = 'AI 雀圣 2';
            if (slotName3) slotName3.textContent = 'AI 雀圣 3';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启 4 人麻将对局';
            }
            if (btnAi) btnAi.style.display = 'none';
        } else if (isXiangqi) {
            NetworkManager.gameType = 'XIANGQI';
            this.activeGameType = 'XIANGQI';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 象棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启象棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else if (isGo) {
            NetworkManager.gameType = 'GO';
            this.activeGameType = 'GO';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 围棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启围棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else if (isGomoku) {
            NetworkManager.gameType = 'GOMOKU';
            this.activeGameType = 'GOMOKU';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            }
            if (slot2) slot2.style.display = 'none'; // 五子棋仅需 1 名对手
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            const slotName1 = document.getElementById('slotName1');
            if (slotName1) slotName1.textContent = 'AI 棋圣';

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 开启五子棋对局';
            }
            if (btnAi) {
                btnAi.style.display = 'none'; // 保持界面简洁，无需额外 AI 按键
            }
        } else {
            NetworkManager.gameType = 'DOUDIZHU';
            this.activeGameType = 'DOUDIZHU';
            if (connectedCount) {
                connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
            }
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';

            this._fillSlotWithAi(1);
            this._fillSlotWithAi(2);

            if (btnStart) {
                btnStart.style.display = 'block';
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> START';
            }
            if (btnAi) {
                btnAi.style.display = 'none';
            }
        }

        this.broadcastLobbyState();

        // 激活房主保活机制
        this._activateHostKeepAlive();
    }

    /**
     * 房主保活：Screen Wake Lock + 静音 Web Audio 防后台挂起
     */
    _activateHostKeepAlive() {
        // 1. Screen Wake Lock API（阻止手机熄屏）
        this._requestWakeLock();
        // 2. 静音 Web Audio 振荡器保活
        this._startAudioKeepAlive();

        // 移除旧的房主前台警告
        const oldWarn = document.getElementById('hostStayWarning');
        if (oldWarn) oldWarn.remove();
    }

    async _requestWakeLock() {
        if ('wakeLock' in navigator && navigator.wakeLock) {
            try {
                this._wakeLockObj = await navigator.wakeLock.request('screen');
            } catch (err) {
                console.log('[WakeLock] 屏幕常亮申请被忽略:', err);
            }
        }
    }

    _startAudioKeepAlive() {
        try {
            if (!this._audioKeepAliveCtx) {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtxClass) return;
                this._audioKeepAliveCtx = new AudioCtxClass();
                const osc = this._audioKeepAliveCtx.createOscillator();
                const gain = this._audioKeepAliveCtx.createGain();
                gain.gain.value = 0.0001; // 静音保活
                osc.connect(gain);
                gain.connect(this._audioKeepAliveCtx.destination);
                osc.start();
            }
        } catch (e) {
            console.log('[AudioKeepAlive] 静音保活忽略:', e);
        }
    }

    /**
     * 退出房间时停止所有保活机制（Screen Wake Lock + 静音 Audio）
     */
    _stopKeepAlive() {
        // 释放 Screen Wake Lock
        if (this._wakeLockObj) {
            try { this._wakeLockObj.release(); } catch (e) {}
            this._wakeLockObj = null;
        }
        // 关闭静音 Audio 振荡器
        if (this._audioKeepAliveCtx) {
            try { this._audioKeepAliveCtx.close(); } catch (e) {}
            this._audioKeepAliveCtx = null;
        }
    }

    /**
     * 将指定 slot 标记为 AI 机器人，并更新 UI
     */
    _fillSlotWithAi(slotIndex) {
        const aiName = `AI-${slotIndex}`;
        if (!this.gameState.players[slotIndex]) {
            this.gameState.players[slotIndex] = { id: slotIndex, name: aiName, hand: [], isAi: true, isHost: false, role: 'FARMER', avatar: '🤖' };
        } else {
            this.gameState.players[slotIndex].name = aiName;
            this.gameState.players[slotIndex].avatar = '🤖';
            this.gameState.players[slotIndex].isAi = true;
        }

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const avatarEl = document.getElementById(`slotAvatar${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = aiName;
        if (avatarEl) avatarEl.textContent = '🤖';
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status-pill');
            if (statusEl) {
                statusEl.textContent = '⚙️ 备选 AI';
                statusEl.classList.remove('ready');
            }
        }
    }

    /**
     * 客户端加入房间视图更新
     */
    enterRoomAsClient(roomId) {
        const lobbyScr  = document.getElementById('lobbyScreen');
        const waitScr   = document.getElementById('waitingScreen');
        const dispRoom  = document.getElementById('displayRoomId');
        const roomBar   = document.getElementById('roomInfoBar');
        const btnStart  = document.getElementById('btnStartGame');
        const btnAiBtn  = document.getElementById('btnStartWithAi');
        const btnGoHome = document.getElementById('btnGoHomeTop');

        if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
        if (waitScr)  { waitScr.style.display = 'flex'; waitScr.classList.add('active'); }
        this.updateHeaderVisibility();
        if (dispRoom) dispRoom.textContent = roomId;
        const waitingRoomDisp2 = document.getElementById('waitingRoomIdDisplay');
        if (waitingRoomDisp2) waitingRoomDisp2.textContent = roomId;
        if (roomBar)  roomBar.style.display = 'none'; // 房间等待界面隐去顶部 NAV 栏重复的房间号
        if (btnStart) btnStart.style.display = 'none';
        if (btnAiBtn) btnAiBtn.style.display = 'none';
        if (btnGoHome) btnGoHome.style.display = 'inline-flex';
        const menuLeaveBtn2 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn2) menuLeaveBtn2.style.display = 'flex';

        // 根据 gameType 动态呈现或隐去槽位 (五子棋 2 人、斗地主 3 人、麻将 4 人)
        const gameType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (gameType === 'MAHJONG');
        const isGomoku  = (gameType === 'GOMOKU');
        const isGo      = (gameType === 'GO');
        const isXiangqi = (gameType === 'XIANGQI');
        const connectedCount = document.getElementById('connectedCount');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isMahjong) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/4</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';
        } else if (isXiangqi) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isGo) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isGomoku) {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/2</span>';
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else {
            if (connectedCount) connectedCount.parentElement.innerHTML = '<span>成员就位: <b id="connectedCount" style="color:#ffd700;">1</b>/3</span>';
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';
        }

        // 客户端监听房主开启象棋对局信号
        NetworkManager.onXiangqiStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsRed = (data && data.hostIsRed !== undefined) ? data.hostIsRed : true;
                this.startXiangqiOnlineGame(roomId, false, hostIsRed);
            }
        });

        // 客户端监听房主开启围棋 / 五子棋 / 麻将对局信号，全员同步进入游戏！
        NetworkManager.onGoStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsBlack = (data && data.hostIsBlack !== undefined) ? data.hostIsBlack : true;
                this.startGoOnlineGame(roomId, false, hostIsBlack);
            }
        });

        NetworkManager.onGomokuStart((data) => {
            if (!NetworkManager.isHost) {
                const hostIsBlack = (data && data.hostIsBlack !== undefined) ? data.hostIsBlack : true;
                this.startGomokuOnlineGame(roomId, false, hostIsBlack);
            }
        });

        NetworkManager.onMahjongStart(() => {
            if (!NetworkManager.isHost) {
                this.startMahjongOnlineGame(roomId, false);
            }
        });

        UIRenderer.showToast('已进入房间，等待房主开始游戏...');
    }

    /**
     * 当有新玩家加入 (Host处理) — 替换最早的一个 AI 占位符
     */
    onPlayerJoined(slotIndex, nickname, avatarEmoji) {
        if (!NetworkManager.isHost) return;

        const name = nickname || `玩家 ${slotIndex + 1}`;
        const avatar = avatarEmoji || '🤠';
        this.gameState.players[slotIndex].name = name;
        this.gameState.players[slotIndex].avatar = avatar;
        this.gameState.players[slotIndex].isAi = false;

        const nameEl = document.getElementById(`slotName${slotIndex}`);
        const avatarEl = document.getElementById(`slotAvatar${slotIndex}`);
        const slotEl = document.getElementById(`slot${slotIndex}`);
        if (nameEl) nameEl.textContent = name;
        if (avatarEl) avatarEl.textContent = avatar;
        if (slotEl) {
            const statusEl = slotEl.querySelector('.slot-status-pill');
            if (statusEl) {
                statusEl.textContent = '✅ 已就绪';
                statusEl.classList.add('ready');
            }
        }

        const humanCount = this.gameState.players.filter(p => !p.isAi).length;
        const countEl = document.getElementById('connectedCount');
        if (countEl) countEl.textContent = humanCount;

        if (humanCount === 3) {
            UIRenderer.showToast('🎉 全员就位，可以开始游戏了！');
        }

        this.broadcastLobbyState();
    }

    /**
     * 房主广播组局大厅玩家状态
     */
    broadcastLobbyState() {
        if (!NetworkManager.isHost) return;
        const lobbyData = {
            players: this.gameState.players.map(p => ({
                name: p.name,
                avatar: p.avatar || (p.isAi ? '🤖' : '🤠'),
                isAi: p.isAi,
                isHost: p.isHost
            }))
        };
        NetworkManager.broadcastLobbySync(lobbyData);
    }

    /**
     * 客户端接收并渲染房间大厅玩家列表
     */
    onReceiveLobbySync(lobbyData) {
        if (!lobbyData || !lobbyData.players) return;
        // 缓存最新大厅玩家列表，供麻将牌桌座位昵称/风向显示使用
        this.latestLobbyPlayers = lobbyData.players || null;

        // 房主接收到大厅列表更新时，精准同步 gameState.players 中的 isAi/name/avatar 标志
        if (NetworkManager.isHost && this.gameState && this.gameState.players) {
            lobbyData.players.forEach((p, i) => {
                if (this.gameState.players[i] && p) {
                    this.gameState.players[i].name = p.name || this.gameState.players[i].name;
                    this.gameState.players[i].avatar = p.avatar || this.gameState.players[i].avatar;
                    this.gameState.players[i].isAi = !!p.isAi;
                }
            });
        }

        const myIndex = NetworkManager.myPlayerIndex;

        const gameType = NetworkManager.gameType || this.activeGameType || 'DOUDIZHU';
        const isMahjong = (gameType === 'MAHJONG');
        const isGomoku  = (gameType === 'GOMOKU');
        const isGo      = (gameType === 'GO');
        const slot2 = document.getElementById('slot2');
        const slot3 = document.getElementById('slot3');

        if (isGomoku || isGo) {
            if (slot2) slot2.style.display = 'none';
            if (slot3) slot3.style.display = 'none';
        } else if (isMahjong) {
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'flex';
        } else {
            if (slot2) slot2.style.display = 'flex';
            if (slot3) slot3.style.display = 'none';
        }

        let humanCount = 0;
        lobbyData.players.forEach((p, i) => {
            const slotEl   = document.getElementById(`slot${i}`);
            const nameEl   = document.getElementById(`slotName${i}`);
            const avatarEl = document.getElementById(`slotAvatar${i}`);
            if (!slotEl || !nameEl) return;

            const statusEl = slotEl.querySelector('.slot-status-pill');

            if (p.isAi) {
                nameEl.textContent = `🤖 ${p.name}`;
                if (avatarEl) avatarEl.textContent = '🤖';
                if (statusEl) {
                    statusEl.textContent = '⚙️ 备选 AI';
                    statusEl.classList.remove('ready');
                }
            } else if (p.name) {
                humanCount++;
                let displayName = p.name;
                if (i === 0) displayName += ' (房主)';
                if (i === myIndex && i !== 0) displayName += ' (你)';
                nameEl.textContent = displayName;
                if (avatarEl) avatarEl.textContent = p.avatar || '🤠';
                if (statusEl) {
                    statusEl.textContent = '✅ 已就绪';
                    statusEl.classList.add('ready');
                }
            }
        });

        const ccEl = document.getElementById('connectedCount');
        if (ccEl) ccEl.textContent = humanCount;
    }

    /**
     * 复制分享链接
     */
    copyInviteUrl() {
        const input = document.getElementById('inviteUrlInput');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value).then(() => {
                UIRenderer.showToast('邀请链接已复制！快速发给微信/QQ好友吧！');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                UIRenderer.showToast('链接已复制到剪贴板');
            });
        }
    }

    /**
     * 补齐机器人并开始
     */
    fillAiAndStart() {
        for (let i = 1; i <= 2; i++) {
            if (!this.gameState.players[i].name || this.gameState.players[i].name.includes('等待')) {
                this.gameState.players[i].name = `AI-${i}`;
                this.gameState.players[i].isAi = true;
            }
        }
        this.startNewRound();
    }

    /**
     * 启动单机练习模式 (对战 2 个 AI 机器人)
     */
    startAiGame(nickname) {
        NetworkManager.isAiMode = true;
        NetworkManager.isHost = true;
        NetworkManager.myPlayerIndex = 0;

        // 进入斗地主前同样清理麻将后台定时器，防止麻将音效残留
        this.stopMahjongGame();

        this.gameState.players[0] = { id: 0, name: nickname, hand: [], isAi: false, isHost: true, role: 'FARMER', passedBid: false };
        this.gameState.players[1] = { id: 1, name: 'AI-1', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };
        this.gameState.players[2] = { id: 2, name: 'AI-2', hand: [], isAi: true, isHost: false, role: 'FARMER', passedBid: false };

        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.startNewRound();
    }

    /**
     * 重新回到初始大厅 (安全退房、清除URL邀请参数、切回主页屏幕)
     */
    resetToLobby() {
        const mahjongScr = document.getElementById('mahjongGameScreen');
        const gomokuScr  = document.getElementById('gomokuGameScreen');
        const goScr      = document.getElementById('goGameScreen');
        const isMahjongExit = (this.activeGameType === 'MAHJONG') || (mahjongScr && (mahjongScr.classList.contains('active') || mahjongScr.style.display !== 'none'));
        const isGomokuExit  = (this.activeGameType === 'GOMOKU') || (gomokuScr && (gomokuScr.classList.contains('active') || gomokuScr.style.display !== 'none'));
        const isGoExit      = (this.activeGameType === 'GO') || (goScr && (goScr.classList.contains('active') || goScr.style.display !== 'none'));
        const isXiangqiExit = (this.activeGameType === 'XIANGQI');

        this._stopKeepAlive();
        if (this._mahjongWatchdogId) { clearInterval(this._mahjongWatchdogId); this._mahjongWatchdogId = null; }
        NetworkManager.clearSession();

        // 1. 如果在房间中，清除云端对应的槽位或房间
        if (NetworkManager.roomId && NetworkManager.db) {
            const rId = NetworkManager.roomId;
            const myIdx = NetworkManager.myPlayerIndex;
            try {
                if (NetworkManager.isHost && !NetworkManager.isAiMode) {
                    // 如果房主主动退出，物理注销移除整个房间
                    NetworkManager.db.ref('rooms/' + rId).remove().catch(() => {});
                } else if (myIdx > 0 && !NetworkManager.isAiMode) {
                    // 如果客户端主动退出，将其槽位重置为 AI 候补
                    NetworkManager.db.ref(`rooms/${rId}/lobbyData/players/${myIdx}`).set({
                        name: `AI-${myIdx}`,
                        isAi: true,
                        isHost: false
                    }).catch(() => {});
                }
            } catch (e) {}
        }

        // 2. 清除云端网络监听
        NetworkManager._removeAllListeners();
        NetworkManager.roomId = null;
        NetworkManager.isHost = false;
        NetworkManager.isAiMode = false;

        // 3. 关键修复：清除浏览器 URL 地址栏里的 ?room=XXXXXX 邀请参数
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 4. 界面瞬间平滑切回大厅 Screen (彻底隐藏麻将/五子棋/斗地主对局屏与结算弹窗)
        const waitingScreen   = document.getElementById('waitingScreen');
        const gameTable       = document.getElementById('gameTable');
        const gameOverModal   = document.getElementById('gameOverModal');
        const mahjongSettle   = document.getElementById('mahjongSettlementModal');
        const lobbyScreen     = document.getElementById('lobbyScreen');
        const roomInfoBar     = document.getElementById('roomInfoBar');
        const btnLeaveRoom    = document.getElementById('btnLeaveRoom');
        const btnGoHomeTop    = document.getElementById('btnGoHomeTop');

        if (waitingScreen) { waitingScreen.style.display = 'none'; waitingScreen.classList.remove('active'); }
        if (gameTable)     { gameTable.style.display = 'none'; gameTable.classList.remove('active'); }
        if (gameOverModal) gameOverModal.style.display = 'none';
        if (gomokuScr)     { gomokuScr.style.display = 'none'; gomokuScr.classList.remove('active'); }
        if (goScr)         { goScr.style.display = 'none'; goScr.classList.remove('active'); }
        if (mahjongScr)    { mahjongScr.style.display = 'none'; mahjongScr.classList.remove('active'); }
        if (mahjongSettle) { mahjongSettle.style.display = 'none'; mahjongSettle.classList.remove('active'); }
        if (roomInfoBar)   roomInfoBar.style.display = 'none';
        if (btnLeaveRoom)  btnLeaveRoom.style.display = 'none';
        if (btnGoHomeTop)  btnGoHomeTop.style.display = 'none';
        const menuLeaveBtn3 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn3) menuLeaveBtn3.style.display = 'none';

        if (lobbyScreen) {
            lobbyScreen.style.display = 'flex';
            lobbyScreen.classList.add('active');
        }

        // 如果是从麻将/五子棋/围棋退出的，退回主页时自动切为对应的主厅 Tab
        if (isMahjongExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('MAHJONG');
        } else if (isGoExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('GO');
        } else if (isGomokuExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('GOMOKU');
        } else if (isXiangqiExit && typeof this.switchGameLobby === 'function') {
            this.switchGameLobby('XIANGQI');
        }

        this.updateHeaderVisibility();

        // 恢复大厅基础按钮可见性
        const createBtn = document.getElementById('btnCreateRoom');
        const aiBtn     = document.getElementById('btnPlayAi');
        const divider   = document.querySelector('.divider');
        const banner    = document.getElementById('quickJoinBanner');
        if (createBtn) createBtn.style.display = 'flex';
        if (aiBtn)     aiBtn.style.display = 'flex';
        if (divider)   divider.style.display = 'flex';
        if (banner)    banner.style.display = 'none';

        UIRenderer.showToast('已成功退出并安全返回主页大厅');
    }

    /**
     * 开始新一局 (洗牌、发牌、全员就位加载完毕后展开 3秒倒计时 + 动态进度条)
     */
    startNewRound() {
        if (typeof AuthEngine !== 'undefined' && AuthEngine.checkAndDeductEntryFee) {
            const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
            AuthEngine.checkAndDeductEntryFee('DOUDIZHU', isPve);
        }

        document.getElementById('waitingScreen').style.display = 'none';
        document.getElementById('gameOverModal').style.display = 'none';
        document.getElementById('gameTable').style.display = 'grid';
        this.updateHeaderVisibility();
        const _btnLeave = document.getElementById('btnLeaveRoom');
        if (_btnLeave) _btnLeave.style.display = 'inline-flex';
        const menuLeaveBtn4 = document.getElementById('menuBtnLeaveRoom');
        if (menuLeaveBtn4) menuLeaveBtn4.style.display = 'flex';

        // Bug 修复：清除上一局残留的回合倒计时 interval，防止上局 timer 继续触发 handleTurnTimeout
        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }

        // Bug 修复：清除 AI 调度守卫 key，防止新局 AI 无法调度
        this._aiScheduleKey = null;

        // 彻底重置界面 DOM & 选牌状态 & 气泡 & 残余展示牌
        UIRenderer.resetGameTableUI();

        // 1. 生成局次唯一卡牌洗牌
        this.roundCounter = (this.roundCounter || 0) + 1;
        const deck = DouDizhuRules.shuffle(DouDizhuRules.createDeck(this.roundCounter));

        // 2. 发牌: 3人各 17 张原始混乱手牌，留 3 张底牌 (开局手牌保持乱序，点击理牌后进行排序)
        const p0Hand = deck.slice(0, 17);
        const p1Hand = deck.slice(17, 34);
        const p2Hand = deck.slice(34, 51);
        const bottom = deck.slice(51, 54);

        // 3. 构造重置 GameState (保持玩家 ID/昵称/isAi/isHost)
        this.gameState.phase = 'BIDDING';
        this.gameState.players[0].hand = p0Hand;
        this.gameState.players[1].hand = p1Hand;
        this.gameState.players[2].hand = p2Hand;

        this.gameState.players.forEach(p => {
            p.role = 'FARMER';
            p.passedBid = false;
        });

        this.gameState.bottomCards = bottom;
        this.gameState.currentTurn = 0;
        this.gameState.landlordIndex = -1;
        this.gameState.highestBid = 0;
        this.gameState.highestBidder = -1;
        this.gameState.bidsCount = 0;
        this.gameState.lastPlay = null;
        this.gameState.recentPlays = {
            0: { cards: [], isLatest: false },
            1: { cards: [], isLatest: false },
            2: { cards: [], isLatest: false }
        };
        this.gameState.multiplier = 1;
        this.gameState.winnerIndex = -1;
        this.gameState.readyPlayers = [false, false, false];

        this._hasPlayedSortSoundThisRound = false;

        // 先标记开局倒计时状态与统一绝对起始时间，再广播，确保 3 人联机倒计时 100% 同步
        this.gameState.openingStartTime = Date.now();
        this.gameState.isOpeningCountdown = true;

        // 房主初始化完毕，立即同步全量状态给其他客户端，让大家切入打牌界面
        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(this.gameState);
        }

        // 触发本地 3 秒全员就位加载倒计时与动态进度条
        this.startOpeningCountdown();
    }

    /**
     * 确认人齐加载完毕后的 3 秒开局倒计时与动态进度条
     */
    startOpeningCountdown() {
        const overlay = document.getElementById('startCountdownOverlay');
        const numEl = document.getElementById('startCountdownNum');
        const lightRed = document.getElementById('trafficLightRed');
        const lightYellow = document.getElementById('trafficLightYellow');
        const lightGreen = document.getElementById('trafficLightGreen');

        if (overlay) overlay.style.display = 'flex';

        this._isCountingDownLocally = true;
        this.updateControlButtons(NetworkManager.myPlayerIndex);

        const totalDuration = 3000; // 3.0 秒
        // 关键修复：全员统一以云端绝对时间戳为基准计算，消灭网络延迟造成的倒计时不同步
        const startTime = (this.gameState && this.gameState.openingStartTime) ? this.gameState.openingStartTime : Date.now();
        const step = 50;

        let lastPlayedSec = -1;
        const updateLights = (sec) => {
            if (lightRed) lightRed.classList.toggle('active', sec === 3 || sec === 0);
            if (lightYellow) lightYellow.classList.toggle('active', sec === 2 || sec === 0);
            if (lightGreen) lightGreen.classList.toggle('active', sec === 1 || sec === 0);

            if (sec !== lastPlayedSec) {
                lastPlayedSec = sec;
                if (typeof SoundEngine !== 'undefined') {
                    if (sec === 3 || sec === 2 || sec === 1) {
                        SoundEngine.playCountdownBeep(sec);
                    } else if (sec === 0) {
                        SoundEngine.playCountdownGo();
                    }
                }
            }

            if (numEl) {
                if (sec === 3) {
                    numEl.textContent = '3';
                    numEl.className = 'start-number num-red';
                } else if (sec === 2) {
                    numEl.textContent = '2';
                    numEl.className = 'start-number num-yellow';
                } else if (sec === 1) {
                    numEl.textContent = '1';
                    numEl.className = 'start-number num-green';
                } else {
                    numEl.textContent = '抢！';
                    numEl.className = 'start-number num-go';
                }
            }
        };

        const initialElapsed = Date.now() - startTime;
        const initialSecs = Math.max(0, Math.ceil((totalDuration - initialElapsed) / 1000));
        updateLights(initialSecs);

        clearInterval(this._startCountdownTimer);
        this._startCountdownTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;

            const remainingSecs = Math.max(0, Math.ceil((totalDuration - elapsed) / 1000));
            updateLights(remainingSecs);

            if (elapsed >= totalDuration) {
                clearInterval(this._startCountdownTimer);
                this._isCountingDownLocally = false;
                this.gameState.isOpeningCountdown = false;
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    if (NetworkManager.isHost) {
                        NetworkManager.broadcastState(this.gameState);
                        UIRenderer.showToast('🔥 3秒到！叫地主开始！');
                        SoundEngine.playBid();

                        // Bug 修复：无论轮到玩家还是 AI，都必须启动回合倒计时。
                        // 否则轮到玩家（currentTurn=0）时 triggerAiBidIfNeeded 会因 isAi=false
                        // 直接 return，导致回合倒计时从未启动，玩家不操作则游戏永久卡死。
                        this.startTurnTimer();

                        this.triggerAiBidIfNeeded();
                    }
                    this.updateControlButtons(NetworkManager.myPlayerIndex);
                }, 200);
            }
        }, step);
    }

    /**
     * AI 单机/补齐模式下的顺时针轮流叫牌智能决策
     */
    triggerAiBidIfNeeded() {
        if (!NetworkManager.isHost || this.gameState.phase !== 'BIDDING') return;

        const turn = this.gameState.currentTurn;
        const player = this.gameState.players[turn];
        if (!player || !player.isAi || player.passedBid) return;

        if (this._aiBidTimer) clearTimeout(this._aiBidTimer);

        const delay = 800 + Math.random() * 800; // 0.8s ~ 1.6s 优雅思考延时
        this._aiBidTimer = setTimeout(() => {
            if (this.gameState.phase !== 'BIDDING' || this.gameState.currentTurn !== turn) return;

            const highestBid = this.gameState.highestBid || 0;
            let choice = 0; // 0 = PASS
            const rand = Math.random();

            if (highestBid === 0) {
                // 还没人叫分时：AI 适当竞叫
                if (rand < 0.12) choice = 3;
                else if (rand < 0.30) choice = 2;
                else if (rand < 0.52) choice = 1;
                else choice = 0; // 48% PASS
            } else if (highestBid === 1) {
                // 已有人叫 1 分：AI 大概率不抢，给玩家机会
                if (rand < 0.12) choice = 3;
                else if (rand < 0.25) choice = 2;
                else choice = 0; // 75% PASS
            } else if (highestBid === 2) {
                // 已有人叫 2 分：AI 只有小概率叫 3 分
                if (rand < 0.15) choice = 3;
                else choice = 0; // 85% PASS
            }

            if (choice > highestBid) {
                this.processBid(turn, choice);
            } else {
                this.processBid(turn, 'PASS');
            }
        }, delay);
    }

    /**
     * 收到服务端/全网同步状态时的 UI 刷新入口
     */
    onReceiveStateUpdate(state) {
        if (!state) return;
        this.gameState = state;

        try {
            const myIndex = (NetworkManager.myPlayerIndex !== null && NetworkManager.myPlayerIndex !== undefined) ? NetworkManager.myPlayerIndex : 0;
            const rel = UIRenderer.getRelativePlayerIndices(myIndex);

            const pSelf = (this.gameState.players && this.gameState.players[rel.self]) ? this.gameState.players[rel.self] : { name: '玩家 1', hand: [], isAi: false };
            const pLeft = (this.gameState.players && this.gameState.players[rel.left]) ? this.gameState.players[rel.left] : { name: '玩家 2', hand: [], isAi: false };
            const pRight = (this.gameState.players && this.gameState.players[rel.right]) ? this.gameState.players[rel.right] : { name: '玩家 3', hand: [], isAi: false };

            // 如果游戏已经开始（叫牌/打牌阶段），确保手机客户端也自动切入牌桌界面！
            if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
                const lobbyScr = document.getElementById('lobbyScreen');
                if (lobbyScr) { lobbyScr.classList.remove('active'); lobbyScr.style.display = 'none'; }
                const waitScr = document.getElementById('waitingScreen');
                if (waitScr) waitScr.style.display = 'none';
                const gameOverM = document.getElementById('gameOverModal');
                if (gameOverM) gameOverM.style.display = 'none';
                const gameTab = document.getElementById('gameTable');
                if (gameTab) gameTab.style.display = 'grid';

                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox && this.gameState.phase !== 'GAMEOVER') {
                    victoryBox.style.display = 'none';
                    delete victoryBox.dataset.minimized;
                }

                // 重新开局切入 BIDDING 阶段时，客户端强制重置上局残牌与选中状态
                if (this.gameState.phase === 'BIDDING' && this._lastPhase !== 'BIDDING') {
                    UIRenderer.resetGameTableUI();
                }

                const btnLeave = document.getElementById('btnLeaveRoom');
                if (btnLeave) btnLeave.style.display = 'inline-flex';
                const btnGoHomeTop = document.getElementById('btnGoHomeTop');
                if (btnGoHomeTop) btnGoHomeTop.style.display = 'inline-flex';
                const menuLeave = document.getElementById('menuBtnLeaveRoom');
                if (menuLeave) menuLeave.style.display = 'flex';
            }
            this._lastPhase = this.gameState.phase;

            // 客户端如果收到开局倒计时状态且本地未在倒数，则触发本地视觉倒计时
            if (this.gameState.isOpeningCountdown && !this._isCountingDownLocally) {
                this.startOpeningCountdown();
            }

            // 1. 顶部底牌与倍数
            const isBottomRevealed = this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER';
            UIRenderer.renderBottomCards(this.gameState.bottomCards || [], isBottomRevealed);
            const multEl = document.getElementById('gameMultiplier');
            if (multEl) multEl.textContent = `x${this.gameState.multiplier || 1}`;

            // 2. 玩家面板信息 (头像/名字/剩余手牌)
            const nameSelfEl = document.getElementById('nameSelf');
            if (nameSelfEl) nameSelfEl.textContent = pSelf.name || '你';
            const nameLeftEl = document.getElementById('nameLeft');
            if (nameLeftEl) nameLeftEl.textContent = pLeft.name || '左家';
            const nameRightEl = document.getElementById('nameRight');
            if (nameRightEl) nameRightEl.textContent = pRight.name || '右家';

            const renderSeatAvatar = (avatarBoxId, avatarEmoji, isAi) => {
                const box = document.getElementById(avatarBoxId);
                if (!box) return;
                if (isAi) {
                    box.innerHTML = '<i class="fa-solid fa-robot" style="color:#60a5fa;"></i>';
                } else {
                    const emoji = avatarEmoji || '🤠';
                    box.innerHTML = `<span style="font-size:1.35rem;line-height:1;">${emoji}</span>`;
                }
            };

            renderSeatAvatar('avatarSelf', pSelf.avatar || (AuthEngine.userData ? AuthEngine.userData.avatar : '🤠'), pSelf.isAi);
            renderSeatAvatar('avatarLeft', pLeft.avatar, pLeft.isAi);
            renderSeatAvatar('avatarRight', pRight.avatar, pRight.isAi);

            const cardLeftBox = document.getElementById('cardCountLeft');
            if (cardLeftBox) {
                const cnt = cardLeftBox.querySelector('.count');
                if (cnt) cnt.textContent = pLeft.hand ? pLeft.hand.length : 0;
            }
            const cardRightBox = document.getElementById('cardCountRight');
            if (cardRightBox) {
                const cnt = cardRightBox.querySelector('.count');
                if (cnt) cnt.textContent = pRight.hand ? pRight.hand.length : 0;
            }

            // 3. 身份徽章标识 (抢地主结束后，在每个人ID左侧高亮放置【👑 地主】或【🌾 农民】徽章)
            const isBiddingDone = (this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER');
            const landlordIdx = this.gameState.landlordIndex;

            const updateRoleBadge = (badgeId, playerIdx) => {
                const el = document.getElementById(badgeId);
                if (!el) return;
                if (isBiddingDone && landlordIdx !== undefined && landlordIdx !== -1) {
                    el.style.display = 'inline-flex';
                    const isLandlord = (playerIdx === landlordIdx);
                    el.className = `role-identity-badge ${isLandlord ? 'landlord' : 'farmer'}`;
                    el.textContent = isLandlord ? '资本家' : '牛马';
                } else {
                    el.style.display = 'none';
                }
            };

            updateRoleBadge('roleBadgeSelf', rel.self);
            updateRoleBadge('roleBadgeLeft', rel.left);
            updateRoleBadge('roleBadgeRight', rel.right);

            // 玩家编号：严格按出牌顺序 1(资本家)、2(资本家下家)、3(资本家上家) 标注
            const updatePlayerNums = () => {
                const badges = {
                    self:  document.getElementById('numBadgeSelf'),
                    left:  document.getElementById('numBadgeLeft'),
                    right: document.getElementById('numBadgeRight'),
                };
                if (!isBiddingDone || landlordIdx === undefined || landlordIdx === -1) {
                    Object.values(badges).forEach(b => { if (b) b.style.display = 'none'; });
                    return;
                }

                const setNum = (badgeId, absIdx) => {
                    const el = document.getElementById(badgeId);
                    if (!el) return;
                    const turnOrder = ((absIdx - landlordIdx + 3) % 3) + 1;
                    el.textContent = turnOrder;
                    el.style.display = 'inline-flex';
                };

                setNum('numBadgeSelf',  rel.self);
                setNum('numBadgeLeft',  rel.left);
                setNum('numBadgeRight', rel.right);
            };
            updatePlayerNums();

            // 4. 叫完资本家进入打牌阶段时，自动触发全员理牌与理牌音效
            if (this.gameState.phase === 'PLAYING' && !this._hasPlayedSortSoundThisRound) {
                this._hasPlayedSortSoundThisRound = true;
                SoundEngine.playCardSort();
            }

            const myHand = pSelf.hand || [];
            UIRenderer.renderSelfHand(myHand);

            const btnSort = document.getElementById('btnSortCards');
            if (btnSort) {
                const isHandSorted = myHand.length > 0 && myHand.every((c, i) => i === 0 || c.rank <= myHand[i - 1].rank);
                if (isHandSorted || this.gameState.phase === 'PLAYING' || this.gameState.phase === 'GAMEOVER') {
                    btnSort.style.display = 'none';
                } else {
                    btnSort.style.display = 'inline-flex';
                }
            }

            // 5. 渲染桌面打出的牌 / 结算明牌展示
            if (this.gameState.phase === 'GAMEOVER') {
                const bWrap = document.getElementById('bottomCardsWrapper');
                if (bWrap) bWrap.style.display = 'none';

                // 全员 (不论房主还是客户端) 自动触发战绩结算 (每个账号每盘仅结算1次)
                if (!this._hasSettledThisRound) {
                    this._hasSettledThisRound = true;
                    if (typeof AuthEngine !== 'undefined' && AuthEngine.userData) {
                        const winnerIdx = this.gameState.winnerIndex;
                        const winnerRole = (this.gameState.players && this.gameState.players[winnerIdx]) ? this.gameState.players[winnerIdx].role : 'FARMER';
                        const myRole = (this.gameState.players && this.gameState.players[myIndex]) ? this.gameState.players[myIndex].role : 'FARMER';
                        const isWin = (winnerIdx === myIndex) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                        AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);
                    }
                }

                if (this.turnTimerInterval) {
                    clearInterval(this.turnTimerInterval);
                    this.turnTimerInterval = null;
                }

                // 房主主导：确保 AI 机器人自动标记就绪 (仅对真正的 AI 生效)
                if (NetworkManager.isHost && this.gameState.players) {
                    if (!this.gameState.readyPlayers) this.gameState.readyPlayers = [false, false, false];
                    this.gameState.players.forEach((p, idx) => {
                        if (p && p.isAi) this.gameState.readyPlayers[idx] = true;
                    });
                }

                const victoryBox = document.getElementById('victoryBannerBox');
                if (victoryBox) {
                    victoryBox.style.display = 'flex';
                    const winnerIdx = this.gameState.winnerIndex;
                    const winner = (this.gameState.players && winnerIdx !== undefined && winnerIdx >= 0) ? this.gameState.players[winnerIdx] : null;
                    const isLandlordWin = (winner && winner.role === 'LANDLORD');

                    let titleText = isLandlordWin ? '资本家胜利！' : '牛马胜利！';
                    let winnerDesc = '';
                    if (isLandlordWin) {
                        winnerDesc = `资本家【${winner ? winner.name : '地主'}】独占鳌头`;
                    } else {
                        const farmers = (this.gameState.players || [])
                            .filter(p => p && p.role === 'FARMER')
                            .map(p => p.name || '农民')
                            .join(' & ');
                        winnerDesc = `牛马【${farmers || '农民们'}】联手翻盘`;
                    }

                    const readyPlayers = this.gameState.readyPlayers || [false, false, false];
                    const readyCount = readyPlayers.filter(Boolean).length;
                    const hasSelfVoted = !!readyPlayers[myIndex];
                    const isMinimized = victoryBox.dataset.minimized === 'true';

                    if (isMinimized) {
                        victoryBox.innerHTML = `
                            <div class="victory-mini-badge" id="btnExpandVictory">
                                <span>🏆 胜负 (已就绪 ${readyCount}/3)</span>
                                <i class="fa-solid fa-expand"></i>
                            </div>
                        `;
                    } else {
                        victoryBox.innerHTML = `
                            <div class="victory-content-wrap">
                                <button class="victory-close-btn" id="btnCloseVictoryBanner" title="收起胜负榜 (方便看牌)">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                                <div class="victory-main-title">${titleText}</div>
                                <div class="victory-sub-desc">${winnerDesc}</div>
                                
                                <div class="restart-vote-box">
                                    <div class="restart-vote-count">准备开局 <span class="vote-num ${readyCount > 0 ? 'active' : ''}">${readyCount}/3</span></div>
                                    <button class="btn-action primary btn-restart-round ${hasSelfVoted ? 'voted' : ''}" id="btnRestartGame" ${hasSelfVoted ? 'disabled' : ''}>
                                        <i class="fa-solid ${hasSelfVoted ? 'fa-check' : 'fa-rotate-right'}"></i> ${hasSelfVoted ? '已就绪' : '再来一局'}
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                }

                // 结算时明牌公开展示全场剩余手牌 (自动折到第二排、第三排)
                UIRenderer.renderOpenHand('playedSelf', pSelf.hand || []);
                UIRenderer.renderOpenHand('playedLeft', pLeft.hand || []);
                UIRenderer.renderOpenHand('playedRight', pRight.hand || []);
            } else {
                const bWrap = document.getElementById('bottomCardsWrapper');
                if (bWrap) bWrap.style.display = 'flex';
                const vBox = document.getElementById('victoryBannerBox');
                if (vBox) {
                    vBox.style.display = 'none';
                    delete vBox.dataset.minimized;
                }

                const recent = this.gameState.recentPlays || {};
                const getPlayData = (slotIdx) => {
                    if (!recent) return null;
                    const p = recent[slotIdx] || recent[String(slotIdx)];
                    if (!p || !p.cards || p.cards.length === 0) return null;
                    return p;
                };

                const selfPlay = getPlayData(rel.self);
                const leftPlay = getPlayData(rel.left);
                const rightPlay = getPlayData(rel.right);

                UIRenderer.renderPlayedCards('playedSelf', selfPlay ? selfPlay.cards : [], selfPlay ? selfPlay.isLatest : false);
                UIRenderer.renderPlayedCards('playedLeft', leftPlay ? leftPlay.cards : [], leftPlay ? leftPlay.isLatest : false);
                UIRenderer.renderPlayedCards('playedRight', rightPlay ? rightPlay.cards : [], rightPlay ? rightPlay.isLatest : false);

                this._hasSettledThisRound = false;
            }

            // 6. 思考出牌/叫地主文本提示与头像高亮
            const currentTurnIdx = this.gameState.currentTurn;
            const currentTurnPlayer = (this.gameState.players && currentTurnIdx !== undefined) ? this.gameState.players[currentTurnIdx] : null;
            const promptContainer = document.getElementById('thinkingStatusPrompt');
            const promptTextEl = document.getElementById('thinkingStatusText');

            if (this.gameState.phase === 'BIDDING' || this.gameState.phase === 'PLAYING') {
                if (promptContainer && promptTextEl && currentTurnPlayer) {
                    promptContainer.style.display = 'inline-flex';
                    const pName = (currentTurnIdx === myIndex) ? '你' : currentTurnPlayer.name;
                    const actionDesc = (this.gameState.phase === 'BIDDING') ? '叫地主中...' : '思考出牌中...';
                    promptTextEl.textContent = `轮到 【${pName}】 ${actionDesc}`;
                }
            } else {
                if (promptContainer) promptContainer.style.display = 'none';
            }

            // 7. 交互控制按钮面板
            this.updateControlButtons(myIndex);

            // 7. 倒计时指示 (对局结束时隐藏倒计时)
            if (this.gameState.phase === 'GAMEOVER') {
                UIRenderer.updateTurnIndicator(-1, myIndex);
            } else {
                UIRenderer.updateTurnIndicator(
                    this.gameState.currentTurn,
                    myIndex,
                    this.gameState.timerSeconds !== undefined ? this.gameState.timerSeconds : 25,
                    this.gameState.turnStartTime
                );
            }

            // 8. 处理 AI 或当前回合的自动触发 (如果是房主)
            if (NetworkManager.isHost && this.gameState.phase !== 'GAMEOVER') {
                this.checkAiTurn();
            }

            // 9. 结算处理
            if (this.gameState.phase === 'GAMEOVER') {
                this.showGameOverModal();
            }
        } catch (err) {
            console.error('[GameEngine] onReceiveStateUpdate 状态刷新异常 (已容错防护):', err);
        }
    }

    /**
     * 更新操作按钮显示 (抢手速叫地主/不叫/出牌)
     */
    updateControlButtons(myIndex) {
        const controlsBar = document.getElementById('controlsBar');
        const biddingControls = document.getElementById('biddingControls');
        const reBidControls = document.getElementById('reBidControls');
        const playControls = document.getElementById('playControls');

        if (this.gameState.phase === 'GAMEOVER' || this.gameState.phase === 'WAITING') {
            controlsBar.style.display = 'none';
            return;
        }

        controlsBar.style.display = 'block';

        if (this.gameState.phase === 'BIDDING') {
            biddingControls.style.display = 'flex';
            reBidControls.style.display = 'none';
            playControls.style.display = 'none';

            const myPlayer = this.gameState.players[myIndex];
            const isOpeningCountdown = !!this.gameState.isOpeningCountdown || !!this._isCountingDownLocally;
            // 抢地主模式：只要自己还没退出且不在开局倒计时，就可以抢（任何时候都能点）
            const hasPassed = myPlayer && myPlayer.passedBid;

            const passBtn = document.getElementById('btnBidPass');
            const b1Btn = document.getElementById('btnBid1');
            const b2Btn = document.getElementById('btnBid2');
            const b3Btn = document.getElementById('btnBid3');
            const landlordBtn = document.getElementById('btnBidLandlord');

            const isDisabled = isOpeningCountdown || hasPassed;

            [passBtn, b1Btn, b2Btn, b3Btn, landlordBtn].forEach(b => {
                if (b) {
                    b.disabled = isDisabled;
                    if (isDisabled) b.classList.add('disabled');
                    else b.classList.remove('disabled');
                }
            });
        } else if (this.gameState.phase === 'PLAYING') {
            biddingControls.style.display = 'none';
            reBidControls.style.display = 'none';
            playControls.style.display = 'flex';

            const isAiMode = NetworkManager.isAiMode;
            const hintBtn = document.getElementById('btnHint');
            if (hintBtn) hintBtn.style.display = isAiMode ? 'inline-flex' : 'none';

            const isFreePlay = !this.gameState.lastPlay || this.gameState.lastPlay.playerIndex === myIndex;
            const passBtn = document.getElementById('btnPass');
            passBtn.style.display = isFreePlay ? 'none' : 'inline-block';

            const playBtn = document.getElementById('btnPlayCard');
            const isMyTurn = (this.gameState.currentTurn === myIndex);

            if (!isMyTurn) {
                // 不在自己回合，出牌阶段按钮全盘置灰
                passBtn.disabled = true;
                passBtn.classList.add('disabled');
                playBtn.disabled = true;
                playBtn.classList.add('disabled');
                if (hintBtn) {
                    hintBtn.disabled = true;
                    hintBtn.classList.add('disabled');
                }
            } else {
                // 轮到自己回合
                passBtn.disabled = false;
                passBtn.classList.remove('disabled');
                if (hintBtn) {
                    hintBtn.disabled = false;
                    hintBtn.classList.remove('disabled');
                }
                UIRenderer.updatePlayButtonState();
            }
        }
    }

    /**
     * 响应玩家（自己或远程客户端）的点击动作
     */
    handleSelfAction(actionType, payload) {
        NetworkManager.sendActionToHost(actionType, payload);
    }

    /**
     * 房主引擎处理动作分发
     */
    handlePlayerAction(playerIndex, actionType, payload) {
        if (!NetworkManager.isHost) return;

        if (actionType === 'BID') {
            this.processBid(playerIndex, payload);
        } else if (actionType === 'PLAY') {
            this.processPlay(playerIndex, payload);
        } else if (actionType === 'CHAT_PHRASE') {
            this.processChatPhrase(playerIndex, payload.text);
            NetworkManager.broadcastChatPhrase(playerIndex, payload.text);
        } else if (actionType === 'RESTART_VOTE') {
            this.processRestartVote(playerIndex);
        }
    }

    /**
     * 处理【再来一局】准备就绪投票
     */
    processRestartVote(playerIndex) {
        if (this.activeGameType === 'MAHJONG' || (window.mahjongEngine && window.mahjongEngine.isGameOver)) {
            if (!this.mahjongReadyPlayers) this.mahjongReadyPlayers = [false, false, false, false];
            this.mahjongReadyPlayers[playerIndex] = true;

            const seatPlayers = this.latestLobbyPlayers || this.gameState.players || [];
            for (let i = 0; i < 4; i++) {
                if (!seatPlayers[i] || seatPlayers[i].isAi) {
                    this.mahjongReadyPlayers[i] = true;
                }
            }

            const readyCount = this.mahjongReadyPlayers.filter(Boolean).length;
            const statusPayload = {
                readyPlayers: this.mahjongReadyPlayers,
                readyCount: readyCount,
                total: 4
            };

            NetworkManager.sendMahjongRematchStatus(statusPayload);

            const btnSettle = document.getElementById('btnMahjongSettleRematch');
            if (btnSettle) {
                btnSettle.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 准备中 (${readyCount}/4 就绪)`;
            }
            UIRenderer.showToast(`⌛ 麻将重开准备中：${readyCount}/4 席位就绪`);

            if (readyCount >= 4) {
                setTimeout(() => {
                    this.mahjongReadyPlayers = [false, false, false, false];
                    this.startMahjongOnlineGame(NetworkManager.roomId, true);
                }, 400);
            }
            return;
        }

        if (this.gameState.phase !== 'GAMEOVER') return;
        if (!this.gameState.readyPlayers) {
            this.gameState.readyPlayers = [false, false, false];
        }

        this.gameState.readyPlayers[playerIndex] = true;

        // 房主处理时，确保 AI 机器人自动设为准备就绪
        this.gameState.players.forEach((p, idx) => {
            if (p.isAi) this.gameState.readyPlayers[idx] = true;
        });

        const readyCount = this.gameState.readyPlayers.filter(Boolean).length;
        NetworkManager.broadcastState(this.gameState);

        // 当 3 位玩家（包含 AI）全员就位 (3/3)，自动重新发牌开局！
        if (readyCount >= 3) {
            setTimeout(() => {
                this.startNewRound();
            }, 300);
        }
    }

    /**
     * 处理抢地主逻辑（纯抢地主模式：谁先叫分谁就立即成为地主，不分顺序，叫了不能被抢）
     */
    processBid(playerIndex, action) {
        if (this.gameState.phase !== 'BIDDING') return;

        // 开局 3 秒倒计时锁判定
        if (this.gameState.isOpeningCountdown) {
            this.gameState.isOpeningCountdown = false;
        }

        const player = this.gameState.players[playerIndex];
        if (!player) return;

        const isClaimAction = (action === 'CLAIM' || action === 1 || action === 2 || action === 3);
        // 纯抢地主模式修复：超时自动“不叫”仅是托管，不应剥夺玩家主动叫地主权利。
        // 若玩家因超时被标记 passedBid，此时点击叫地主应优先生效（点击优先于超时托管）。
        if (isClaimAction && player.passedBid) {
            player.passedBid = false;
        } else if (player.passedBid) {
            return; // 已退出的玩家不能再操作
        }

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        if (action === 'CLAIM' || action === 1 || action === 2 || action === 3) {
            // ✅ 抢地主：任何人叫任意分数（1/2/3），立即锁定为地主，其他人不再有机会抢
            const bidVal = (typeof action === 'number') ? action : 3;
            SoundEngine.playBid();
            this.gameState.highestBid = bidVal;
            this.gameState.highestBidder = playerIndex;
            this.gameState.multiplier = bidVal;
            UIRenderer.showBubble(bubbleTarget, bidVal === 3 ? '👑 3分(地主)' : `👑 ${bidVal}分`);
            UIRenderer.showToast(`👑 ${player.name} 抢到地主！(${bidVal} 分)`);
            // 立即确定地主，结束叫地主阶段
            this.finalizeLandlord(playerIndex);
            return;

        } else if (action === 'PASS' || action === 0) {
            // 玩家点击【不叫/不抢】，退出本局叫地主
            player.passedBid = true;
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '不抢');
            UIRenderer.showToast(`${player.name} 放弃抢地主`);

            // 统计剩下还没退出的玩家
            const activeBidders = this.gameState.players.filter(p => !p.passedBid);

            if (activeBidders.length === 0) {
                // 全员都放弃了 → 重新发牌
                UIRenderer.showToast('全员放弃，重新发牌！');
                setTimeout(() => this.startNewRound(), 1500);
            } else if (activeBidders.length === 1) {
                // 只剩一人 → 自动成为地主（1分）
                const lastPlayerIdx = this.gameState.players.findIndex(p => !p.passedBid);
                SoundEngine.playBid();
                UIRenderer.showToast(`🌾 ${this.gameState.players[lastPlayerIdx].name} 无人竞争，自动成为地主！`);
                if (!this.gameState.highestBid || this.gameState.highestBid < 1) {
                    this.gameState.highestBid = 1;
                    this.gameState.multiplier = 1;
                }
                setTimeout(() => this.finalizeLandlord(lastPlayerIdx), 800);
            } else {
                // 仍有多人未放弃：更新 currentTurn 并继续等待（AI 会自动触发）
                const nextTurn = this._nextActiveBidder(playerIndex);
                this.gameState.currentTurn = nextTurn !== -1 ? nextTurn : playerIndex;
                this.startTurnTimer();
            }

            // 广播最新状态
            if (NetworkManager.isHost) {
                NetworkManager.broadcastState(this.gameState);
                this.triggerAiBidIfNeeded();
            }
        }
    }

    /**
     * 从 fromPlayerIndex 开始（不包含自身），找下一个还没退出叫地主的玩家索引
     * 如果所有人都退出了返回 -1
     */
    _nextActiveBidder(fromPlayerIndex) {
        for (let i = 1; i <= 3; i++) {
            const idx = (fromPlayerIndex + i) % 3;
            if (this.gameState.players[idx] && !this.gameState.players[idx].passedBid) return idx;
        }
        return -1;
    }

    /**
     * 确定地主身份并把底牌分发给地主
     */
    finalizeLandlord(landlordIdx) {
        // 防重机制：防止网络延迟或定时器导致重复触发领底牌产生 5张Q/重复卡牌 bug！
        if (this.gameState.phase === 'PLAYING' || landlordIdx === undefined || landlordIdx < 0 || landlordIdx > 2) return;

        this.gameState.landlordIndex = landlordIdx;
        this.gameState.phase = 'PLAYING';
        this.gameState.currentTurn = landlordIdx;
        this.gameState.multiplier = Math.max(1, this.gameState.highestBid || 1);
        this.gameState.lastPlay = null;
        this.gameState.recentPlays = {
            0: { cards: [], isLatest: false },
            1: { cards: [], isLatest: false },
            2: { cards: [], isLatest: false }
        };

        // 清理叫地主阶段或上一局残留界面，确保地主首出时 100% 渲染显现
        UIRenderer.resetGameTableUI();

        // 赋予角色并自动为全场玩家整理手牌
        this.gameState.players.forEach((p, idx) => {
            p.role = idx === landlordIdx ? 'LANDLORD' : 'FARMER';
            p.hand = DouDizhuRules.sortCards(p.hand);
        });

        // 3 张底牌给地主 (严格过滤已有 card.id 保证防重)
        const currentHandIds = new Set(this.gameState.players[landlordIdx].hand.map(c => c.id));
        const newBottomCards = (this.gameState.bottomCards || []).filter(c => !currentHandIds.has(c.id));
        const landlordHand = [...this.gameState.players[landlordIdx].hand, ...newBottomCards];
        this.gameState.players[landlordIdx].hand = DouDizhuRules.sortCards(landlordHand);

        UIRenderer.showToast(`${this.gameState.players[landlordIdx].name} 成为地主！得 3 张底牌`);
        SoundEngine.playCardSort();
        this.startTurnTimer();

        // 全量同步最新地主身份、20张地主手牌与 PLAYING 阶段状态至云端/所有客户端
        if (NetworkManager.isHost) {
            NetworkManager.broadcastState(this.gameState);
        }
    }

    /**
     * 处理出牌逻辑
     */
    processPlay(playerIndex, cards) {
        if (this.gameState.phase !== 'PLAYING') return;

        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (playerIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (playerIndex === rel.right) bubbleTarget = 'bubbleRight';

        const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === playerIndex;

        if (!cards || cards.length === 0) {
            // 选择过 / 不出
            SoundEngine.playPass();
            UIRenderer.showBubble(bubbleTarget, '要不起');
        } else {
            // 校验是否符合斗地主出牌规则 (传入 playerIndex 确保赢牌后属于自由首出)
            const canPlay = DouDizhuRules.canBeat(cards, this.gameState.lastPlay, playerIndex);
            if (!canPlay) {
                if (playerIndex === NetworkManager.myPlayerIndex) {
                    UIRenderer.showToast('不符合出牌规则或压不住桌上的牌！');
                }
                return;
            }

            // 如果是自由首出（开启新一轮叫/打牌），清空上一轮大家打出的残牌！
            if (isFreePlay || !this.gameState.recentPlays) {
                this.gameState.recentPlays = {
                    0: { cards: [], isLatest: false },
                    1: { cards: [], isLatest: false },
                    2: { cards: [], isLatest: false }
                };
            }

            // 规则合规！从玩家手牌中扣除
            const playedIds = new Set(cards.map(c => c.id));
            this.gameState.players[playerIndex].hand = this.gameState.players[playerIndex].hand.filter(c => !playedIds.has(c.id));

            this.gameState.lastPlay = { playerIndex, cards };

            // 取消之前玩家出牌的 isLatest 金光高亮标记
            for (let i = 0; i < 3; i++) {
                if (this.gameState.recentPlays[i]) {
                    this.gameState.recentPlays[i].isLatest = false;
                } else {
                    this.gameState.recentPlays[i] = { cards: [], isLatest: false };
                }
            }

            // 记录当前玩家打出的牌
            this.gameState.recentPlays[playerIndex] = {
                cards: cards,
                isLatest: true
            };

            // 检查炸弹 / 火箭翻倍
            const analysis = DouDizhuRules.analyzeCards(cards);
            if (analysis.type === CardType.BOMB || analysis.type === CardType.ROCKET) {
                this.gameState.multiplier *= 2;
                SoundEngine.playBomb();
                UIRenderer.showToast(analysis.type === CardType.ROCKET ? '🚀 王炸！倍数 x2' : '💣 炸弹！倍数 x2');
            } else {
                SoundEngine.playCardPlay();
            }

            // 检查胜利条件！
            if (this.gameState.players[playerIndex].hand.length === 0) {
                this.gameState.phase = 'GAMEOVER';
                this.gameState.winnerIndex = playerIndex;
                this.gameState.readyPlayers = [false, false, false];
                NetworkManager.broadcastState(this.gameState);

                // 战绩结算与天梯积分更新
                if (typeof AuthEngine !== 'undefined') {
                    const myIdx = NetworkManager.myPlayerIndex !== null ? NetworkManager.myPlayerIndex : 0;
                    const winnerRole = this.gameState.players[playerIndex].role;
                    const myRole = (this.gameState.players[myIdx]) ? this.gameState.players[myIdx].role : 'FARMER';
                    const isWin = (playerIndex === myIdx) || (winnerRole === 'FARMER' && myRole === 'FARMER');
                    AuthEngine.updateStats(isWin, myRole, 0, this.gameState.multiplier || 1);

                    // 💰 结算斗地主【知因币】 (带 PVE 25% 比例和零分保底)
                    if (AuthEngine.updateCoins) {
                        const isPve = NetworkManager.isAiMode || !NetworkManager.roomId;
                        const ratio = isPve ? 0.25 : 1.0;
                        const baseScore = 50 * (this.gameState.multiplier || 1);
                        if (isWin) {
                            const winAmount = Math.ceil((myRole === 'LANDLORD' ? baseScore * 2 : baseScore) * ratio);
                            AuthEngine.updateCoins(winAmount, isPve ? '斗地主切磋胜 (PVE)' : '斗地主胜 (PVP)');
                        } else {
                            const loseAmount = -Math.ceil((myRole === 'LANDLORD' ? baseScore * 2 : baseScore) * ratio);
                            AuthEngine.updateCoins(loseAmount, isPve ? '斗地主切磋负 (PVE)' : '斗地主负 (PVP)');
                        }

                        // ⭐ 结算斗地主【经验值】
                        if (AuthEngine.addExp) {
                            const expVal = isWin ? (isPve ? 40 : 150) : (isPve ? 15 : 50);
                            AuthEngine.addExp(expVal, isPve ? '斗地主切磋 (PVE)' : '斗地主对局 (PVP)');
                        }
                    }
                }
                return;
            }
        }

        // 轮到下一位
        this.gameState.currentTurn = (playerIndex + 1) % 3;
        this.startTurnTimer();
    }

    /**
     * 启动/刷新真实 1 秒级实时倒计时 (Host节点主导)
     */
    startTurnTimer() {
        if (!NetworkManager.isHost) return;

        if (this.turnTimerInterval) {
            clearInterval(this.turnTimerInterval);
            this.turnTimerInterval = null;
        }

        this.gameState.timerSeconds = 25;
        this.gameState.turnStartTime = Date.now();
        NetworkManager.broadcastState(this.gameState);

        this.turnTimerInterval = setInterval(() => {
            if (this.gameState.phase !== 'BIDDING' && this.gameState.phase !== 'PLAYING') {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                return;
            }

            const elapsedSecs = Math.floor((Date.now() - (this.gameState.turnStartTime || Date.now())) / 1000);
            this.gameState.timerSeconds = Math.max(0, 25 - elapsedSecs);

            if (this.gameState.timerSeconds <= 0) {
                clearInterval(this.turnTimerInterval);
                this.turnTimerInterval = null;
                this.handleTurnTimeout();
            }
        }, 1000);
    }

    /**
     * 倒计时超时自动处理逻辑 (根据斗地主标准规则)
     */
    handleTurnTimeout() {
        if (!NetworkManager.isHost) return;
        const turn = this.gameState.currentTurn;

        if (this.gameState.phase === 'BIDDING') {
            // 叫地主阶段超时：默认【不叫 / 不抢】
            UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认不叫`);
            this.processBid(turn, 0);
        } else if (this.gameState.phase === 'PLAYING') {
            const isFreePlay = !this.gameState.lastPlay || !this.gameState.lastPlay.cards || this.gameState.lastPlay.cards.length === 0 || this.gameState.lastPlay.playerIndex === turn;

            if (isFreePlay) {
                // 出牌阶段 - 自由首出超时：默认打出手牌中点数最小的单张
                // Bug修复：不能直接取 hand[hand.length-1]（依赖排序假设），改用遍历找最小 rank
                const hand = this.gameState.players[turn].hand;
                if (hand && hand.length > 0) {
                    const smallestCard = hand.reduce((min, c) => c.rank < min.rank ? c : min, hand[0]);
                    UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，自动出最小单牌`);
                    this.processPlay(turn, [smallestCard]);
                } else {
                    this.processPlay(turn, []);
                }
            } else {
                // 出牌阶段 - 跟牌压牌超时：默认【要不起 / 过 (PASS)】
                UIRenderer.showToast(`${this.gameState.players[turn].name} 思考超时，默认选择过`);
                this.processPlay(turn, []);
            }
        }
    }

    /**
     * 手牌整理排序并播放理牌音效
     */
    sortSelfHand() {
        const myIndex = NetworkManager.myPlayerIndex;
        if (this.gameState.players[myIndex]) {
            this.gameState.players[myIndex].hand = DouDizhuRules.sortCards(this.gameState.players[myIndex].hand);
            UIRenderer.renderSelfHand(this.gameState.players[myIndex].hand);
            SoundEngine.playCardSort();
            const btnSort = document.getElementById('btnSortCards');
            if (btnSort) btnSort.style.display = 'none';
        }
    }

    /**
     * 主动发送经典快捷短语 (全网 P2P 气泡同步)
     */
    sendChatPhrase(text) {
        const myIndex = NetworkManager.myPlayerIndex;
        // 本地立即展示气泡
        this.processChatPhrase(myIndex, text);

        // 网络同步给其他所有联机玩家
        if (NetworkManager.isHost) {
            NetworkManager.broadcastChatPhrase(myIndex, text);
        } else {
            NetworkManager.sendActionToHost('CHAT_PHRASE', { text: text });
        }
    }

    /**
     * 在指定玩家头像上方展示对话气泡
     */
    processChatPhrase(senderIndex, text) {
        const rel = UIRenderer.getRelativePlayerIndices(NetworkManager.myPlayerIndex);
        let bubbleTarget = 'bubbleSelf';
        if (senderIndex === rel.left) bubbleTarget = 'bubbleLeft';
        if (senderIndex === rel.right) bubbleTarget = 'bubbleRight';

        UIRenderer.showBubble(bubbleTarget, text, 3800);
        SoundEngine.playCardSelect();
    }

    /**
     * 智能提示按钮点击
     */
    triggerSmartHint() {
        const myIndex = NetworkManager.myPlayerIndex;
        const myHand = this.gameState.players[myIndex].hand;
        const lastPlay = (this.gameState.lastPlay && this.gameState.lastPlay.playerIndex !== myIndex) ? this.gameState.lastPlay : null;

        const hintCards = DouDizhuRules.findSmartHint(myHand, lastPlay);
        if (hintCards.length > 0) {
            UIRenderer.setSelectedCards(hintCards);
        } else {
            UIRenderer.showToast('没有能压过上家的牌');
        }
    }

    /**
     * 主动点击出牌按钮
     */
    triggerPlayCard() {
        const myIndex = NetworkManager.myPlayerIndex;
        const selected = UIRenderer.getSelectedCards(this.gameState.players[myIndex].hand);
        if (selected.length === 0) {
            UIRenderer.showToast('请先选择要出的牌');
            return;
        }

        this.handleSelfAction('PLAY', selected);
    }

    /**
     * 检查当前回合是否为机器人，是则自动出牌（完整策略 AI）
     */
    checkAiTurn() {
        const turnIdx = this.gameState.currentTurn;
        const currentPlayer = this.gameState.players[turnIdx];
        if (!currentPlayer || !currentPlayer.isAi) return;

        // ====== 防重复调度守卫 ======
        // onReceiveStateUpdate 每次收到广播都会调用 checkAiTurn，但同一个回合
        // 只能调度一次 AI 定时器，否则 AI 会出两次牌。
        // 用 "turn索引_阶段" 作为 key，同一 key 已挂起时直接返回。
        const scheduleKey = `${turnIdx}_${this.gameState.phase}`;
        if (this._aiScheduleKey === scheduleKey) return;
        this._aiScheduleKey = scheduleKey;

        // 模拟真实思考延迟：1.0~2.4秒
        const thinkMs = 1000 + Math.random() * 1400;
        setTimeout(() => {
            // 清除守卫，允许下一个回合正常调度
            this._aiScheduleKey = null;

            // 验证：如果回合或阶段已经变更（例如其他玩家已出牌），直接丢弃
            if (this.gameState.currentTurn !== turnIdx) return;
            if (this.gameState.phase === 'GAMEOVER' || this.gameState.phase === 'WAITING') return;

            // Bug 修复：BIDDING 阶段由 scheduleAiBids() 专属处理（速度叫牌），
            // checkAiTurn 不应重复处理，否则 AI 会在叫牌阶段出两次
            if (this.gameState.phase === 'BIDDING') return;

            if (this.gameState.phase === 'PLAYING') {
                const aiCards = this._getAiPlayDecision(turnIdx);
                this.processPlay(turnIdx, aiCards);
                // processPlay → startTurnTimer → broadcastState，已自动广播，不再重复广播
            }
        }, thinkMs);
    }

    /**
     * 评估手牌强度 (0~100分)：用于 AI 决策是否抢地主
     */
    _evaluateHandStrength(hand) {
        if (!hand || hand.length === 0) return 0;
        let score = 0;

        // 大王/小王
        hand.forEach(c => {
            if (c.rank === 17) score += 18;      // 大王
            else if (c.rank === 16) score += 14; // 小王
            else if (c.rank === 15) score += 8;  // 2
            else if (c.rank === 14) score += 5;  // A
            else if (c.rank === 13) score += 3;  // K
        });

        // 炸弹
        const groups = DouDizhuRules.groupCardsByRank(hand);
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 4) score += 22;     // 炸弹大加分
            else if (cards.length === 3) score += 5; // 三条
            else if (cards.length === 2) score += 2; // 对子
        }

        // 双王炸
        const jokers = hand.filter(c => c.rank >= 16);
        if (jokers.length === 2) score += 10; // 已经在单王算了，补偿连王额外加成

        return Math.min(100, score);
    }

    /**
     * AI 出牌决策核心（带角色策略 + 回合顺序感知）
     * @returns {Array} 要出的牌，空数组=过/要不起
     */
    _getAiPlayDecision(aiIdx) {
        const player = this.gameState.players[aiIdx];
        const hand = player.hand;
        const role = player.role; // 'LANDLORD' or 'FARMER'
        const lastPlay = this.gameState.lastPlay;

        // 判断是否是自由出牌（无上家牌 / 上家就是自己）
        const isFreePlay = !lastPlay || !lastPlay.cards || lastPlay.cards.length === 0
            || lastPlay.playerIndex === aiIdx;

        if (isFreePlay) {
            return this._aiFreePlaStrategy(aiIdx, hand, role);
        }

        // 判断上家是否是队友农民
        const lastPlayer = this.gameState.players[lastPlay.playerIndex];
        const lastIsTeammate = (role === 'FARMER' && lastPlayer && lastPlayer.role === 'FARMER');

        if (lastIsTeammate) {
            // 关键：利用回合顺序判断地主是否已出过牌（已过了）
            // lastPlay.playerIndex 出牌后：posFirst = 第一个接手的人，posSecond = 第二个
            // 若 AI 是 posFirst (+1)：地主(+2)还没出，可能压队友 → 需考虑护牌
            // 若 AI 是 posSecond (+2)：地主(+1)已出过且过了 → 队友本轮稳赢，直接过
            const posFirst = (lastPlay.playerIndex + 1) % 3;
            const landlordComesAfterAI = (aiIdx === posFirst);
            return this._aiFarmerCoverDecision(aiIdx, hand, lastPlay, landlordComesAfterAI);
        }

        // 上家是地主：跟牌/压牌策略
        return this._aiFollowStrategy(aiIdx, hand, role, lastPlay);
    }

    /**
     * 农民 AI 看队友出牌后的接牌决策
     * landlordComesAfterAI = true 表示地主还没出牌（可能压队友），需要决定是否帮队友护牌
     * landlordComesAfterAI = false 表示地主已经过了，队友本轮稳赢，直接过
     */
    _aiFarmerCoverDecision(aiIdx, hand, lastPlay, landlordComesAfterAI) {
        const landlordIdx = this.gameState.landlordIndex;
        const landlordCardCount = (this.gameState.players[landlordIdx] && this.gameState.players[landlordIdx].hand)
            ? this.gameState.players[landlordIdx].hand.length : 20;
        const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
        const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

        // 地主已经过了，队友本轮稳赢，直接过
        if (!landlordComesAfterAI) return [];

        // 地主还没出牌，分析队友出的牌强弱
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const teammateTopRank = lastPlay.cards.reduce((max, c) => Math.max(max, c.rank), 0);

        // 队友出的牌已经是强牌（2/王/炸弹/火箭），地主大概率压不住，直接过
        const isAlreadyStrong = (
            (prev.type === 1 && teammateTopRank >= 15) || // 单2或王
            (prev.type === 2 && teammateTopRank >= 15) || // 对2
            prev.type === 13 || // 炸弹
            prev.type === 14    // 火箭
        );
        if (isAlreadyStrong) return [];

        // 队友出的是弱牌，地主可能压 → 尝试用便宜牌盖住，让地主无牌可压
        const safeBeat = this._findSafeBeat(hand, lastPlay, prev);

        // 队友只剩1~2张，更积极地接牌护住队友
        if (teammateCards <= 2 && safeBeat.length > 0) return safeBeat;

        // 正常情况：只用廉价牌接（不用2/王/炸弹），不值得接就过
        if (safeBeat.length > 0) {
            const isExpensive = safeBeat.some(c => c.rank >= 15); // 用到了2或王才算贵
            if (!isExpensive) return safeBeat;
        }

        // 没有便宜接法，让队友的牌先顶着，过
        return [];
    }

    /**
     * 寻找"便宜"压过上家的牌（不用炸弹、优先不用2/王）
     */
    _findSafeBeat(hand, lastPlay, prev) {
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大
        const groups = DouDizhuRules.groupCardsByRank(hand);

        if (prev.type === 1) { // 单张：找最小能压的非大牌
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 15) return [c]; // 优先不用2/王
            }
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 16) return [c]; // 退而求次用A/K
            }
        } else if (prev.type === 2) { // 对子
            const sorted = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 15) return cards.slice(0, 2);
            }
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 16) return cards.slice(0, 2);
            }
        } else if (prev.type === 3) { // 三张
            const sorted = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
            for (const [rank, cards] of sorted) {
                if (rank > prev.mainRank && cards.length >= 3 && rank < 15) return cards.slice(0, 3);
            }
        } else {
            // 顺子/连对/飞机等，用 findSmartHint 找最小压法，排除炸弹
            const hint = DouDizhuRules.findSmartHint(hand, lastPlay);
            if (hint.length > 0) {
                const analysis = DouDizhuRules.analyzeCards(hint);
                if (analysis.type !== 13 && analysis.type !== 14) return hint;
            }
        }
        return [];
    }

    /**
     * AI 自由出牌策略
     */
    _aiFreePlaStrategy(aiIdx, hand, role) {
        const groups = DouDizhuRules.groupCardsByRank(hand);
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大

        // 统计牌型分布
        const singles = [];
        const pairs = [];
        const triples = [];
        const bombs = [];
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 1) singles.push({ rank, cards });
            else if (cards.length === 2) pairs.push({ rank, cards });
            else if (cards.length === 3) triples.push({ rank, cards });
            else if (cards.length === 4) bombs.push({ rank, cards });
        }
        singles.sort((a, b) => a.rank - b.rank);
        pairs.sort((a, b) => a.rank - b.rank);
        triples.sort((a, b) => a.rank - b.rank);
        bombs.sort((a, b) => a.rank - b.rank);

        const landlordIdx = this.gameState.landlordIndex;
        const landlord = this.gameState.players[landlordIdx];
        const landlordCardCount = landlord ? landlord.hand.length : 20;

        // 判断是否需要紧急追牌（对方剩余牌很少）
        const isEmergency = landlordCardCount <= 3;

        // 1. 地主策略：优先出顺子/组合拆散，快速清牌
        if (role === 'LANDLORD') {
            // 优先出三带类
            if (triples.length > 0) {
                const t = triples[0];
                // 三带一
                if (singles.length > 0) {
                    const kicker = singles[0].cards[0];
                    if (kicker.rank !== t.rank) return [...t.cards, kicker];
                }
                // 三带二
                if (pairs.length > 0) {
                    const kicker = pairs[0];
                    if (kicker.rank !== t.rank) return [...t.cards, ...kicker.cards];
                }
                return t.cards;
            }

            // 优先出顺子
            const straight = this._findBestStraight(sortedHand, null, false);
            if (straight.length > 0) return straight;

            // 出对子（最小对子）
            if (pairs.length > 0) return pairs[0].cards;

            // 出单张（最小单张）
            if (singles.length > 0) return [singles[0].cards[0]];

            // 如果只剩炸弹，出炸弹
            if (bombs.length > 0) return bombs[0].cards;

            // 出手牌最小的一张
            return sortedHand.length > 0 ? [sortedHand[0]] : [];
        }

        // 2. 农民策略：帮助队友，阻止地主
        // 找队友（另一位农民）
        const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
        const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

        // 如果队友快要出完了，尽量出大牌、顺子，为队友铺路
        if (teammateCards <= 3 || isEmergency) {
            // 出炸弹拦截地主
            if (bombs.length > 0 && landlordCardCount <= 5) {
                return bombs[0].cards;
            }
            // 出大对子/单张
            const bigSingle = [...singles].reverse().find(s => s.rank >= 14);
            if (bigSingle) return [bigSingle.cards[0]];
        }

        // 农民正常策略：先出最小的单张/对子消耗手牌，留大牌压地主
        // 优先出对子（最小）
        if (pairs.length > 0) return pairs[0].cards;

        // 出单张
        if (singles.length > 0) return [singles[0].cards[0]];

        // 出三条
        if (triples.length > 0) return triples[0].cards;

        // 只剩炸弹，出最小炸弹
        if (bombs.length > 0) return bombs[0].cards;

        return sortedHand.length > 0 ? [sortedHand[0]] : [];
    }

    /**
     * AI 跟牌/压牌策略
     */
    _aiFollowStrategy(aiIdx, hand, role, lastPlay) {
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const sortedHand = DouDizhuRules.sortCards(hand, true); // 从小到大
        const groups = DouDizhuRules.groupCardsByRank(hand);

        const landlordIdx = this.gameState.landlordIndex;
        const landlordCardCount = this.gameState.players[landlordIdx] ? this.gameState.players[landlordIdx].hand.length : 20;

        // 此函数只在上家是地主时被调用（农民队友出牌情况已由 _aiFarmerCoverDecision 处理）
        const lastIsLandlord = this.gameState.players[lastPlay.playerIndex].role === 'LANDLORD';

        // 地主快出完时，农民必须全力压
        const mustBeat = lastIsLandlord && landlordCardCount <= 3;

        const bombs = [];
        const jokers = sortedHand.filter(c => c.rank >= 16);
        for (const [rank, cards] of groups.entries()) {
            if (cards.length === 4) bombs.push({ rank, cards });
        }
        bombs.sort((a, b) => a.rank - b.rank);

        // 找最小能压过的牌
        const hintCards = DouDizhuRules.findSmartHint(hand, lastPlay);

        // 如果能找到对应牌型
        if (hintCards.length > 0 && DouDizhuRules.analyzeCards(hintCards).type !== 0) {
            const hint = DouDizhuRules.analyzeCards(hintCards);

            // 如果提示的是炸弹/火箭
            if (hint.type === 14 || hint.type === 13) {
                // 只在紧急时用炸弹/火箭（地主剩1~4张，或农民队友快出完）
                const teammates = this.gameState.players.filter((p, i) => p.role === 'FARMER' && i !== aiIdx);
                const teammateCards = teammates.length > 0 ? teammates[0].hand.length : 20;

                if (mustBeat || landlordCardCount <= 4 || teammateCards <= 2) {
                    return hintCards; // 关键时刻出炸弹
                }
                // 其他情况憋住炸弹，看能否用普通牌压
                // 重新找普通牌能压的
                const nonBombHint = this._findNonBombBeat(hand, lastPlay);
                if (nonBombHint.length > 0) return nonBombHint;
                // 实在没有，选择过
                if (!mustBeat) return [];
                return hintCards; // 必须压，只能出炸弹
            }

            // 有普通能压的牌，直接压（此处上家必为地主）
            return hintCards;
        }

        // 找不到匹配牌型，尝试炸弹
        if (bombs.length > 0 && (mustBeat || landlordCardCount <= 3)) {
            return bombs[0].cards;
        }
        if (jokers.length === 2 && (mustBeat || landlordCardCount <= 2)) {
            return jokers;
        }

        // 过/要不起
        return [];
    }

    /**
     * 找能压过上家的非炸弹牌
     */
    _findNonBombBeat(hand, lastPlay) {
        const prev = DouDizhuRules.analyzeCards(lastPlay.cards);
        const sortedHand = DouDizhuRules.sortCards(hand, true);
        const groups = DouDizhuRules.groupCardsByRank(hand);

        if (prev.type === 1) { // 单张
            for (const c of sortedHand) {
                if (c.rank > prev.mainRank && c.rank < 16) return [c];
            }
        } else if (prev.type === 2) { // 对子
            for (const [rank, cards] of groups.entries()) {
                if (rank > prev.mainRank && cards.length >= 2 && rank < 16) {
                    return cards.slice(0, 2);
                }
            }
        } else if (prev.type === 3) { // 三张
            for (const [rank, cards] of groups.entries()) {
                if (rank > prev.mainRank && cards.length >= 3) {
                    return cards.slice(0, 3);
                }
            }
        }
        return [];
    }

    /**
     * 寻找最优顺子（自由出牌时）
     */
    _findBestStraight(sortedHand, minRank, mustBeat) {
        const groups = DouDizhuRules.groupCardsByRank(sortedHand);
        // 尝试找5张以上顺子
        for (let len = 8; len >= 5; len--) {
            for (let startRank = 3; startRank <= 10; startRank++) {
                const straight = [];
                for (let r = startRank; r < startRank + len; r++) {
                    const g = groups.get(r);
                    if (g && g.length >= 1) straight.push(g[0]);
                    else break;
                }
                if (straight.length === len) return straight;
            }
        }
        return [];
    }

    /**
     * 展示结算弹窗
     */
    showGameOverModal() {
        // 去除重型弹窗遮罩，直接在主桌面上进行优雅总结
        const modal = document.getElementById('gameOverModal');
        if (modal) modal.style.display = 'none';

        const winner = this.gameState.players[this.gameState.winnerIndex];
        const isLandlordWin = (winner && winner.role === 'LANDLORD');

        const myIndex = NetworkManager.myPlayerIndex;
        const myRole = this.gameState.players[myIndex].role;
        const iWon = (isLandlordWin && myRole === 'LANDLORD') || (!isLandlordWin && myRole === 'FARMER');

        if (iWon) SoundEngine.playWin();
    }
}

// 挂载引擎单例
window.GameEngine = new GameEngineController();
document.addEventListener('DOMContentLoaded', () => {
    window.GameEngine.init();
});

