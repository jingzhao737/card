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
    createDeck() {
        const deck = [];
        let id = 1;

        // 3 到 2 (Rank: 3..15)
        for (let rank = 3; rank <= 15; rank++) {
            for (const suit of this.SUITS) {
                deck.push({
                    id: id++,
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
            id: id++,
            rank: 16,
            suit: 'joker',
            suitSymbol: '🃏',
            isRed: false,
            name: '小王',
            isJoker: true
        });
        deck.push({
            id: id++,
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

