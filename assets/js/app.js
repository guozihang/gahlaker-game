import { GAMES, FILTERS } from './games.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE_FAVORITES = 'gahlaker-arcade:favorites:v1';
const STORAGE_RECENT = 'gahlaker-arcade:recent:v1';
const RECENT_WINDOW = 1000 * 60 * 60 * 24 * 14;
const PLAYER_TITLE_SUFFIX = 'Gahlaker Arcade';

const gameById = new Map(GAMES.map((game) => [game.id, game]));
const lobby = $('#lobby-view');
const player = $('#player-view');
const playerStage = $('#player-stage');
const playerTitle = $('#player-title');
const playerIndex = $('#player-index');
const playerDot = $('#player-dot');
const playerBack = $('#player-back');
const playerOpen = $('#player-open');
const playerInfo = $('#player-info');
const playerRestart = $('#player-restart');
const playerFullscreen = $('#player-fullscreen');
const loader = $('#game-loader');
const loaderBackdrop = $('#loader-backdrop');
const loaderTitle = $('#loader-title');
const loaderControls = $('#loader-controls');
const loaderHint = $('#loader-hint');
const grid = $('#game-grid');
const filtersEl = $('#filters');
const searchEl = $('#search');
const resultCount = $('#result-count');
const clearFilters = $('#clear-filters');
const emptyState = $('#empty-state');
const emptyReset = $('#empty-reset');
const gameCount = $('#game-count');
const playerTotal = $('#player-total');
const header = $('#site-header');
const dialog = $('#game-dialog');
const dialogCover = $('#dialog-cover');
const dialogNumber = $('#dialog-number');
const dialogTitle = $('#dialog-title');
const dialogSub = $('#dialog-sub');
const dialogDescription = $('#dialog-description');
const dialogControls = $('#dialog-controls');
const dialogTags = $('#dialog-tags');
const dialogUrl = $('#dialog-url');
const dialogPlay = $('#dialog-play');
const dialogFav = $('#dialog-fav');
const dialogFavLabel = $('#dialog-fav-label');
const toastEl = $('#toast');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

const state = {
  query: '',
  filter: '全部',
  favorites: loadFavorites(),
  recent: loadRecent(),
  current: null,
  iframe: null,
  loadToken: 0,
  loadTimer: null,
  loaded: false,
  scrollY: 0,
  toastTimer: null,
  closing: false,
};

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage 可能被隐私模式禁用，功能降级即可 */
  }
}

function loadFavorites() {
  const raw = readStore(STORAGE_FAVORITES, []);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((id) => gameById.has(id)));
}

function loadRecent() {
  const raw = readStore(STORAGE_RECENT, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, at: 0 };
      if (entry && typeof entry.id === 'string') {
        return { id: entry.id, at: Number(entry.at) || 0 };
      }
      return null;
    })
    .filter((entry) => entry && gameById.has(entry.id))
    .slice(0, 8);
}

function recordRecent(id) {
  const now = Date.now();
  state.recent = [{ id, at: now }, ...state.recent.filter((entry) => entry.id !== id)].slice(0, 8);
  writeStore(STORAGE_RECENT, state.recent);
}

function isRecent(id) {
  const entry = state.recent.find((item) => item.id === id);
  return Boolean(entry && Date.now() - entry.at < RECENT_WINDOW);
}

/* ------------------------------------------------------------------ */
/* utilities                                                           */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function setCounts() {
  gameCount.textContent = String(GAMES.length);
  playerTotal.textContent = String(GAMES.length);
}

function toast(html, duration = 2400) {
  toastEl.innerHTML = html;
  toastEl.classList.add('is-visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('is-visible');
  }, duration);
}

function touchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/* ------------------------------------------------------------------ */
/* lobby rendering                                                     */
/* ------------------------------------------------------------------ */

function renderFilters() {
  const allCount = GAMES.length;
  const buttons = [
    `<button class="filter" type="button" data-filter="全部" aria-pressed="${state.filter === '全部'}">全部<span class="filter-count">${allCount}</span></button>`,
    ...FILTERS.map((filter) => {
      const count = GAMES.filter((game) => game.tags.includes(filter)).length;
      return `<button class="filter" type="button" data-filter="${escapeHtml(filter)}" aria-pressed="${state.filter === filter}">${escapeHtml(filter)}<span class="filter-count">${count}</span></button>`;
    }),
    `<button class="filter filter-fav" type="button" data-filter="收藏" aria-pressed="${state.filter === '收藏'}">
      <svg class="icon" aria-hidden="true" style="width:11px;height:11px"><use href="#i-star"/></svg>
      收藏<span class="filter-count" data-fav-count>${state.favorites.size}</span>
    </button>`,
  ];
  filtersEl.innerHTML = buttons.join('');
}

function updateFilterState() {
  $$('.filter', filtersEl).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
  });
}

function updateFavoriteCount() {
  const count = filtersEl.querySelector('[data-fav-count]');
  if (count) count.textContent = String(state.favorites.size);
}

function getVisibleGames() {
  const query = state.query.trim().toLowerCase();
  return GAMES.filter((game) => {
    if (state.filter === '收藏') {
      if (!state.favorites.has(game.id)) return false;
    } else if (state.filter !== '全部' && !game.tags.includes(state.filter)) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      game.title,
      game.subtitle,
      game.blurb,
      game.description,
      game.device,
      game.status,
      ...game.tags,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function cardMarkup(game, visibleIndex) {
  const originalIndex = GAMES.findIndex((item) => item.id === game.id) + 1;
  const favorite = state.favorites.has(game.id);
  const recent = isRecent(game.id);
  const tags = game.tags.slice(0, 2).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  const status = game.status === 'prototype' ? '<span class="cover-status">原型</span>' : '';
  const sub = game.subtitle || game.title;

  return `
    <article class="game-card" data-id="${escapeHtml(game.id)}" style="--i:${visibleIndex}">
      <a class="card-main" href="#/game/${encodeURIComponent(game.id)}" aria-label="开始玩《${escapeHtml(game.title)}》">
        <div class="cover" data-initial="${escapeHtml(game.title.slice(0, 1))}">
          <img src="${escapeHtml(game.cover)}" alt="《${escapeHtml(game.title)}》游戏封面" width="800" height="600" loading="${visibleIndex < 4 ? 'eager' : 'lazy'}" decoding="async">
          <span class="cover-index">${String(originalIndex).padStart(2, '0')}</span>
          ${status}
          <span class="play-badge" aria-hidden="true"><svg class="icon"><use href="#i-arrow-up-right"/></svg></span>
        </div>
        <div class="card-body">
          <p class="card-overline">${escapeHtml(sub)}</p>
          <h3 class="card-title">${escapeHtml(game.title)}${recent ? '<span class="recent-dot" title="最近玩过" aria-label="最近玩过"></span>' : ''}</h3>
          <p class="card-blurb">${escapeHtml(game.blurb)}</p>
          <div class="card-meta">${tags}<span>${escapeHtml(game.device)}</span></div>
        </div>
      </a>
      <button class="fav" type="button" data-fav="${escapeHtml(game.id)}" aria-pressed="${favorite}" aria-label="${favorite ? '取消收藏' : '收藏'}《${escapeHtml(game.title)}》">
        <svg class="icon" aria-hidden="true"><use href="#i-star"/></svg>
      </button>
    </article>`;
}

function renderGames() {
  const games = getVisibleGames();
  grid.innerHTML = games.map(cardMarkup).join('');
  grid.hidden = games.length === 0;
  emptyState.hidden = games.length !== 0;

  if (state.filter === '收藏' && games.length === 0 && state.favorites.size === 0) {
    emptyState.querySelector('h3').textContent = '收藏夹还是空的';
    emptyState.querySelector('p').textContent = '在喜欢的游戏封面上点一下星星，下次就能更快找到它。';
  } else {
    emptyState.querySelector('h3').textContent = '没有找到这款游戏';
    emptyState.querySelector('p').textContent = '换个关键词，或者把所有筛选都关掉再看看。';
  }

  const hasQuery = Boolean(state.query.trim());
  const hasFilter = state.filter !== '全部';
  clearFilters.hidden = !hasQuery && !hasFilter;

  if (hasQuery || hasFilter) {
    const parts = [];
    if (hasFilter) parts.push(state.filter);
    if (hasQuery) parts.push(`“${state.query.trim()}”`);
    resultCount.textContent = `找到 ${games.length} 款游戏 · ${parts.join(' / ')}`;
  } else {
    resultCount.textContent = `共 ${GAMES.length} 款游戏`;
  }
}

function resetFilters({ focusSearch = false } = {}) {
  state.query = '';
  state.filter = '全部';
  searchEl.value = '';
  updateFilterState();
  renderGames();
  if (focusSearch) searchEl.focus();
}

/* ------------------------------------------------------------------ */
/* favorites                                                           */
/* ------------------------------------------------------------------ */

function updateFavoriteUI(id) {
  const favorite = state.favorites.has(id);
  const game = gameById.get(id);
  $$(`[data-fav="${CSS.escape(id)}"]`).forEach((button) => {
    button.setAttribute('aria-pressed', String(favorite));
    if (game) {
      button.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}《${game.title}》`);
    }
  });
  updateFavoriteCount();
  if (state.current?.id === id) {
    syncDialogFavorite();
  }
}

function toggleFavorite(id) {
  const game = gameById.get(id);
  if (!game) return;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  writeStore(STORAGE_FAVORITES, [...state.favorites]);
  updateFavoriteUI(id);
  toast(`${state.favorites.has(id) ? '已收藏' : '已取消收藏'} <strong>${escapeHtml(game.title)}</strong>`);

  if (state.filter === '收藏') {
    renderGames();
    if (!state.favorites.has(id)) {
      filtersEl.querySelector('[data-filter="收藏"]')?.focus();
    }
  }
}

/* ------------------------------------------------------------------ */
/* player                                                              */
/* ------------------------------------------------------------------ */

function cacheBustedUrl(url) {
  try {
    const target = new URL(url);
    target.searchParams.set('arcade_restart', String(Date.now()));
    return target.href;
  } catch {
    return url;
  }
}

function setLoader(game) {
  loaderBackdrop.style.backgroundImage = `url("${new URL(game.cover, document.baseURI).href}")`;
  loaderTitle.textContent = game.title;
  loaderControls.textContent = game.controls;
  const keyboardOnly = game.device.includes('键');
  const touch = touchDevice();
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const hints = [];
  if (keyboardOnly && touch) hints.push('这个游戏需要键盘，建议在电脑上打开。');
  if (touch && portrait) hints.push('手机建议横屏游玩。');
  hints.push('第一次加载可能需要几秒钟。');
  loaderHint.innerHTML = hints.join('<br>');
  loader.classList.remove('is-hidden');
}

function updatePlayerChrome(game) {
  const index = GAMES.findIndex((item) => item.id === game.id) + 1;
  playerTitle.textContent = game.title;
  playerIndex.textContent = String(index).padStart(2, '0');
  playerDot.style.background = game.accent;
  playerDot.style.boxShadow = `0 0 16px ${game.accent}`;
  player.style.setProperty('--game-accent', game.accent);
  playerOpen.href = game.url;
  playerOpen.setAttribute('aria-label', `在新标签页打开《${game.title}》`);
  document.title = `${game.title} · ${PLAYER_TITLE_SUFFIX}`;
  if (themeColorMeta) themeColorMeta.content = '#08090b';
}

function openGame(id) {
  const game = gameById.get(id);
  if (!game) return;
  if (state.current?.id === game.id && state.iframe) return;

  const wasPlaying = Boolean(state.current);
  if (!wasPlaying) {
    state.scrollY = window.scrollY;
  }

  if (dialog.open) dialog.close();
  destroyIframe();

  state.current = game;
  updatePlayerChrome(game);
  setLoader(game);
  recordRecent(id);

  lobby.hidden = true;
  player.hidden = false;
  document.body.classList.add('is-playing');
  document.documentElement.style.overflow = 'hidden';

  if (!wasPlaying) {
    window.scrollTo(0, 0);
    playerBack.focus({ preventScroll: true });
  }

  loadIframe(game, false);
  renderGames();
}

function loadIframe(game, restart) {
  destroyIframe();

  const token = ++state.loadToken;
  state.loaded = false;
  const iframe = document.createElement('iframe');
  iframe.title = `${game.title} 游戏画面`;
  iframe.allow = 'fullscreen; autoplay; gamepad; accelerometer; gyroscope';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'no-referrer';
  iframe.src = restart ? cacheBustedUrl(game.url) : game.url;

  iframe.addEventListener('load', () => {
    if (token !== state.loadToken) return;
    state.loaded = true;
    window.clearTimeout(state.loadTimer);
    state.loadTimer = null;
    window.setTimeout(() => {
      if (token !== state.loadToken) return;
      loader.classList.add('is-hidden');
      if (!dialog.open && state.iframe === iframe) {
        iframe.focus();
      }
      if (game.device.includes('键') && touchDevice()) {
        toast('这个游戏需要键盘，建议在电脑上打开', 3600);
      }
    }, 240);
  });

  state.iframe = iframe;
  playerStage.appendChild(iframe);
  setLoader(game);

  window.clearTimeout(state.loadTimer);
  state.loadTimer = window.setTimeout(() => {
    if (token !== state.loadToken || state.loaded) return;
    loaderHint.innerHTML = `加载时间有点长。可以 <a href="${escapeHtml(game.url)}" target="_blank" rel="noopener">在新标签打开</a>，或者再等一会儿。`;
  }, 18000);
}

function destroyIframe() {
  state.loadToken += 1;
  state.loaded = false;
  window.clearTimeout(state.loadTimer);
  state.loadTimer = null;
  if (state.iframe) {
    try {
      state.iframe.src = 'about:blank';
    } catch {
      /* ignore */
    }
    state.iframe.remove();
    state.iframe = null;
  }
  loader.classList.add('is-hidden');
}

function closeGame({ skipHistory = false } = {}) {
  if (!state.current) return;
  const lastGame = state.current;
  state.current = null;
  state.closing = true;

  if (dialog.open) dialog.close();
  destroyIframe();
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }

  player.hidden = true;
  lobby.hidden = false;
  document.body.classList.remove('is-playing');
  document.documentElement.style.overflow = '';
  document.title = `Gahlaker Arcade · 小游戏厅`;
  if (themeColorMeta) themeColorMeta.content = '#f2eee3';
  syncFullscreenButton();

  if (!skipHistory) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  window.scrollTo(0, state.scrollY);
  renderGames();

  window.setTimeout(() => {
    const card = grid.querySelector(`.game-card[data-id="${CSS.escape(lastGame.id)}"] .card-main`);
    if (card && !card.closest('[hidden]')) {
      card.focus({ preventScroll: true });
    } else {
      searchEl.focus({ preventScroll: true });
    }
    state.closing = false;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }, 0);
}

function restartGame() {
  if (!state.current) return;
  const game = state.current;
  toast(`重新开始 <strong>${escapeHtml(game.title)}</strong>`);
  loadIframe(game, true);
  if (document.fullscreenElement) {
    playerFullscreen.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/* info dialog                                                         */
/* ------------------------------------------------------------------ */

function syncDialogFavorite() {
  const game = state.current;
  if (!game) return;
  const favorite = state.favorites.has(game.id);
  dialogFav.setAttribute('aria-pressed', String(favorite));
  dialogFavLabel.textContent = favorite ? '已收藏' : '收藏';
}

function openInfo() {
  const game = state.current;
  if (!game) return;

  const index = GAMES.findIndex((item) => item.id === game.id) + 1;
  dialogCover.src = game.cover;
  dialogCover.alt = `《${game.title}》游戏封面`;
  dialogNumber.textContent = String(index).padStart(2, '0');
  dialogTitle.textContent = game.title;
  dialogSub.textContent = game.subtitle;
  dialogDescription.textContent = game.description;
  dialogControls.textContent = game.controls;
  dialogTags.textContent = game.tags.join(' / ');
  dialogUrl.textContent = game.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  dialogUrl.href = game.url;
  syncDialogFavorite();

  if (state.iframe) {
    state.iframe.inert = true;
    state.iframe.setAttribute('inert', '');
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeInfo() {
  if (dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
    restoreGameFocus();
  }
}

function restoreGameFocus() {
  if (!state.current || player.hidden) return;
  const iframe = state.iframe;
  if (!iframe) return;
  iframe.inert = false;
  iframe.removeAttribute('inert');
  window.setTimeout(() => {
    if (state.iframe === iframe && !dialog.open) iframe.focus();
  }, 0);
}

/* ------------------------------------------------------------------ */
/* fullscreen                                                          */
/* ------------------------------------------------------------------ */

function syncFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  const use = playerFullscreen.querySelector('use');
  const label = playerFullscreen.querySelector('span');
  if (use) use.setAttribute('href', active ? '#i-collapse' : '#i-expand');
  if (label) label.textContent = active ? '退出全屏' : '全屏';
  playerFullscreen.setAttribute('aria-label', active ? '退出全屏' : '全屏');
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    screen.orientation?.unlock?.();
    document.exitFullscreen?.().catch(() => {});
    return;
  }
  if (!player.requestFullscreen) {
    toast('当前浏览器不支持全屏');
    return;
  }
  player.requestFullscreen().then(() => {
    if (touchDevice() && screen.orientation?.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  }).catch(() => {
    toast('全屏失败，请使用浏览器菜单');
  });
}

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */

function gameIdFromHash() {
  const match = location.hash.match(/^#\/game\/([a-z0-9-]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function route() {
  const id = gameIdFromHash();
  if (!id) {
    if (state.current) closeGame();
    return;
  }
  if (!gameById.has(id)) {
    toast('没有找到这款游戏');
    history.replaceState(null, '', location.pathname + location.search);
    if (state.current) closeGame({ skipHistory: true });
    return;
  }
  openGame(id);
}

function randomGame() {
  const visible = getVisibleGames();
  let pool = visible.length ? visible : GAMES;
  if (pool.length > 1 && state.current) {
    pool = pool.filter((game) => game.id !== state.current.id);
  }
  if (!pool.length) {
    toast('这个筛选下还没有游戏');
    return;
  }
  const game = pool[Math.floor(Math.random() * pool.length)];
  state.openedFromApp = true;
  if (location.hash === `#/game/${game.id}`) {
    if (state.current) restartGame();
    else openGame(game.id);
    return;
  }
  location.hash = `#/game/${encodeURIComponent(game.id)}`;
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  filtersEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    updateFilterState();
    renderGames();
  });

  grid.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-fav]');
    if (!favoriteButton) return;
    event.preventDefault();
    toggleFavorite(favoriteButton.dataset.fav);
  });

  grid.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) {
      event.target.closest('.cover')?.classList.add('cover-fallback');
    }
  }, true);

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value;
    renderGames();
  });

  searchEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (searchEl.value) {
      state.query = '';
      searchEl.value = '';
      renderGames();
      event.preventDefault();
    } else {
      searchEl.blur();
    }
  });

  const reset = () => resetFilters({ focusSearch: false });
  clearFilters.addEventListener('click', reset);
  emptyReset.addEventListener('click', reset);

  document.addEventListener('click', (event) => {
    const randomButton = event.target.closest('[data-random]');
    if (!randomButton) return;
    event.preventDefault();
    randomGame();
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (state.current || dialog.open) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      searchEl.focus();
    }
  });

  playerBack.addEventListener('click', () => closeGame());
  playerRestart.addEventListener('click', restartGame);
  playerInfo.addEventListener('click', openInfo);
  playerFullscreen.addEventListener('click', toggleFullscreen);

  dialog.addEventListener('close', () => {
    if (state.current) {
      restoreGameFocus();
    } else {
      if (state.iframe) {
        state.iframe.inert = false;
        state.iframe.removeAttribute('inert');
      }
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialogPlay.addEventListener('click', () => {
    closeInfo();
  });

  dialogFav.addEventListener('click', () => {
    if (state.current) toggleFavorite(state.current.id);
  });

  document.addEventListener('fullscreenchange', syncFullscreenButton);

  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }, { passive: true });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  setCounts();
  renderFilters();
  renderGames();
  bindEvents();

  if (!document.fullscreenEnabled) {
    playerFullscreen.hidden = true;
  }
  syncFullscreenButton();
  header.classList.toggle('is-scrolled', window.scrollY > 8);
  route();
}

boot();
