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
        toast.textContent = msg;
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

        const cardIdsStr = (cards || []).map(c => c.id).join(',');
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

        // 清空三大出牌展示区
        ['playedSelf', 'playedLeft', 'playedRight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '';
                el.className = 'played-cards-area';
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
