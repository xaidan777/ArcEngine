// OnlineLobby.js — desktop main-menu client for the authoritative ArcEngine server.
// Authentication, friends, party state and matchmaking are all read from RaidClient;
// the menu never fabricates server state or sends player identity in request bodies.
class OnlineLobby {
    constructor(url) {
        const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
        this.url = url || (typeof globalThis.ARC_SERVER_URL === 'string'
            ? globalThis.ARC_SERVER_URL
            : `http://${host || '127.0.0.1'}:8787`);
        this.client = typeof RaidClient !== 'undefined' ? new RaidClient(this.url) : null;
        this.menu = null;
        this.game = null;
        this.root = null;
        this.screen = 'HUB';
        this.healthState = null;
        this.friendsState = null;
        this.partyState = null;
        this.matchState = null;
        this.busy = false;
        this.error = '';
        this.notice = '';
        this._pollTimer = null;
        this._onMatched = null;
        this._matchNotified = '';
        this.authMode = 'login';
        this.checking = true;
        this._refreshing = false;
        this._renderKey = '';
        this.restoreFailed = false;
        this.socialTab = 'friends';
        this.addFriendOpen = false;
    }

    init(menu, game) {
        this.menu = menu;
        this.game = game;
        const isDirect = Boolean(
            menu?.isDirectPlay ||
            (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string' && (
                window.location.search.includes('directPlay') ||
                window.location.search.includes('raid=1') ||
                window.location.search.includes('testLevel')
            ))
        );
        if (isDirect) {
            return this;
        }
        const root = document.createElement('section');
        root.id = 'arc-online-lobby';
        root.className = 'arc-online-lobby';
        root.setAttribute('aria-label', 'Сетевой центр');
        root.addEventListener('click', event => this.onClick(event));
        root.addEventListener('submit', event => this.onSubmit(event));
        document.body.appendChild(root);
        this.root = root;
        document.body.classList.add('arc-auth-locked');
        this.syncAccess();
        this.render();
        this.bootstrap();
        return this;
    }

    dispose() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
        if (this.root) this.root.remove();
        this.root = null;
        document.body.classList.remove('arc-auth-locked');
    }

    get authenticated() { return !!this.client?.token && !!this.client?.account; }
    get queued() { return !!this.matchState?.position; }
    get matched() { return this.matchState?.raid || null; }

    async bootstrap() {
        if (!this.client) return;
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
        this.checking = true;
        this.restoreFailed = false;
        this.syncAccess();
        this.render();
        try {
            this.healthState = await this.client.health();
            const token = typeof Store !== 'undefined' ? Store.get('arcengine.online.token') : '';
            if (token) {
                try { await this.client.restore(token); }
                catch (error) {
                    if (error.message !== 'session') throw error;
                    if (typeof Store !== 'undefined') Store.remove('arcengine.online.token');
                }
            }
            if (this.authenticated) await this.refresh(true);
        } catch {
            this.error = 'Сервер недоступен';
            this.healthState = null;
            this.restoreFailed = !!(typeof Store !== 'undefined' && Store.get('arcengine.online.token'));
        } finally {
            this.checking = false;
        }
        this.syncAccess();
        this.render();
        this._pollTimer = setInterval(() => this.refresh(false), 2500);
    }

    setScreen(screen) {
        this.screen = screen;
        this.syncAccess();
    }

    syncAccess() {
        const locked = this.checking || !this.authenticated;
        document.body.classList.toggle('arc-auth-locked', locked);
        if (!this.root) return;
        this.root.dataset.mode = locked ? 'gate' : 'social';
        this.root.hidden = locked ? false : this.screen !== 'SOCIAL';
        if (typeof UI !== 'undefined' && UI.root) UI.root.inert = locked;
    }

    async refresh(showBusy = false) {
        if (!this.client || this.busy || this._refreshing) return;
        this._refreshing = true;
        if (showBusy) { this.busy = true; this.render(); }
        try {
            if (!this.authenticated && this.restoreFailed) {
                return;
            } else if (!this.authenticated) {
                this.healthState = await this.client.health();
            } else {
                const [health, friends, party, match, account, inv, prog] = await Promise.all([
                    this.client.health(), this.client.friends(), this.client.party(), this.client.matchStatus(), this.client.refreshAccount(), this.client.inventory(), this.client.progression()
                ]);
                this.healthState = health;
                this.friendsState = friends;
                this.partyState = party;
                if (prog && typeof ProgressionSystem !== 'undefined') {
                    ProgressionSystem.updateFromServer(prog);
                }
                if (inv && this.menu) {
                    if (Array.isArray(inv.stash)) this.menu.stash = inv.stash;
                    if (inv.loadout) {
                        this.menu.loadout = inv.loadout;
                        if (Array.isArray(inv.loadout.backpack)) this.menu.backpack = inv.loadout.backpack;
                    }
                    if (inv.credits !== undefined) {
                        if (!this.menu.profile) this.menu.profile = {};
                        this.menu.profile.credits = inv.credits;
                    }
                    if (inv.arcCores !== undefined) {
                        if (!this.menu.profile) this.menu.profile = {};
                        this.menu.profile.arcCores = inv.arcCores;
                    }
                }
                if (prog && this.menu) {
                    this.menu.progression = prog;
                    if (this.menu.profile) {
                        if (prog.level !== undefined) this.menu.profile.level = prog.level;
                        if (prog.xp !== undefined) this.menu.profile.xp = prog.xp;
                        if (prog.skillPoints !== undefined) this.menu.profile.skillPoints = prog.skillPoints;
                        if (prog.skills) this.menu.profile.skills = prog.skills;
                        if (prog.stationLevels) this.menu.profile.stationLevels = prog.stationLevels;
                        if (prog.vendorTrust) this.menu.profile.vendorTrust = prog.vendorTrust;
                        if (prog.contracts) this.menu.profile.contracts = prog.contracts;
                    }
                }
                if (!party.party && !match.position && !match.raid) {
                    await this.client.ensureParty();
                    this.partyState = await this.client.party();
                }
                this.matchState = match;
                const raidId = match?.raid?.id || '';
                if (raidId && raidId !== this._matchNotified) {
                    this._matchNotified = raidId;
                    this.notice = 'Матч найден. Отряд готов к высадке.';
                    const callback = this._onMatched;
                    this._onMatched = null;
                    if (callback) callback(match.raid);
                }
            }
            this.error = '';
        } catch (error) {
            const code = String(error?.message || error);
            if (code === 'session') await this.clearSession(false);
            else this.error = this.messageFor(code);
        } finally {
            this._refreshing = false;
            this.busy = false;
            this.syncAccess();
            this.render();
            this.menu?.refreshPresentation?.();
        }
    }

    async authenticate(mode, name, password) {
        if (!this.client || this.busy) return;
        this.busy = true; this.error = ''; this.notice = ''; this.render();
        try {
            if (mode === 'register') await this.client.register(name, password);
            else await this.client.login(name, password);
            if (typeof Store !== 'undefined') Store.set('arcengine.online.token', this.client.token);
            this.notice = mode === 'register' ? 'Оператор зарегистрирован' : 'Сессия восстановлена';
            this.busy = false;
            await this.refresh(false);
        } catch (error) {
            this.error = this.messageFor(String(error?.message || error));
        } finally {
            this.busy = false;
            this.render();
        }
    }

    async clearSession(disconnect = true) {
        if (disconnect && this.client?.token) {
            try { await this.client.disconnect(); } catch { /* session may already be gone */ }
        }
        if (this.client) { this.client.token = ''; this.client.account = null; this.client.id = ''; }
        if (typeof Store !== 'undefined') Store.remove('arcengine.online.token');
        this.friendsState = this.partyState = this.matchState = null;
        this._onMatched = null;
        this._matchNotified = '';
        this.authMode = 'login';
        this.menu?.setScreen('HUB');
        this.notice = 'Вы вышли из сетевой сессии';
        this.syncAccess();
        this.render();
        this.menu?.refreshPresentation?.();
    }

    async queueForRaid(onMatched = null) {
        if (!this.authenticated) throw new Error('session');
        this._onMatched = onMatched;
        this.busy = true; this.error = ''; this.notice = 'Подключение к очереди…'; this.render();
        try {
            const status = await this.client.matchStatus();
            if (!status.position && !status.raid) await this.client.queue();
            this.busy = false;
            await this.refresh(false);
        } catch (error) {
            this._onMatched = null;
            this.error = this.messageFor(String(error?.message || error));
        } finally {
            this.busy = false;
            this.render();
        }
    }

    async cancelQueue() {
        if (!this.authenticated || this.busy) return;
        this.busy = true; this.render();
        try {
            await this.client.cancelQueue();
            this.matchState = await this.client.matchStatus();
            this._onMatched = null;
            this.notice = 'Поиск рейда отменён';
            this.error = '';
        } catch (error) { this.error = this.messageFor(String(error?.message || error)); }
        finally { this.busy = false; this.render(); }
    }

    async action(fn, success = '') {
        if (this.busy) return;
        this.busy = true; this.error = ''; this.render();
        try { await fn(); this.notice = success; this.busy = false; await this.refresh(false); }
        catch (error) { this.error = this.messageFor(String(error?.message || error)); }
        finally { this.busy = false; this.render(); }
    }

    onSubmit(event) {
        const form = event.target.closest('form');
        if (!form) return;
        event.preventDefault();
        if (form.dataset.form === 'auth') {
            const data = new FormData(form);
            this.authenticate(form.dataset.mode || 'login', String(data.get('name') || ''), String(data.get('password') || ''));
        } else if (form.dataset.form === 'friend') {
            const name = String(new FormData(form).get('name') || '');
            this.action(() => this.client.addFriend(name), 'Запрос дружбы отправлен');
        } else if (form.dataset.form === 'invite') {
            const name = String(new FormData(form).get('name') || '');
            this.action(() => this.client.inviteToParty(name), 'Приглашение в отряд отправлено');
        }
    }

    onClick(event) {
        const button = event.target.closest('button[data-action]');
        if (!button || button.disabled) return;
        const action = button.dataset.action;
        if (action === 'auth-mode') {
            this.authMode = button.dataset.mode || 'login';
            this.render();
        } else if (action === 'retry') {
            this.error = '';
            this.bootstrap();
        } else if (action === 'logout') this.clearSession(true);
        else if (action === 'refresh') this.refresh(true);
        else if (action === 'friend-accept') this.action(() => this.client.acceptFriend(button.dataset.name), 'Запрос принят');
        else if (action === 'friend-decline') this.action(() => this.client.declineFriend(button.dataset.name));
        else if (action === 'party-create') this.action(() => this.client.createParty(), 'Отряд создан');
        else if (action === 'party-leave') this.action(() => this.client.leaveParty(), 'Вы покинули отряд');
        else if (action === 'party-accept') this.action(() => this.client.acceptPartyInvite(button.dataset.id), 'Вы вступили в отряд');
        else if (action === 'party-decline') this.action(() => this.client.declinePartyInvite(button.dataset.id), 'Приглашение отклонено');
        else if (action === 'party-promote') this.action(() => this.client.promotePartyLeader(button.dataset.name), 'Командование отрядом передано');
        else if (action === 'party-kick') this.action(() => this.client.kickFromParty(button.dataset.name), 'Боец исключён из отряда');
        else if (action === 'party-ready') this.action(() => this.client.setPartyReady(button.dataset.ready === 'true'), button.dataset.ready === 'true' ? 'Вы подтвердили готовность к рейду' : 'Готовность к рейду отменена');
        else if (action === 'invite-friend') this.action(async () => {
            if (!this.partyState?.party) await this.client.createParty();
            await this.client.inviteToParty(button.dataset.name);
        }, 'Приглашение отправлено');
        else if (action === 'social-close') this.menu?.setScreen('HUB');
        else if (action === 'social-tab') { this.socialTab = button.dataset.tab; this.render(); }
        else if (action === 'add-friend-toggle') { this.addFriendOpen = !this.addFriendOpen; this.render(); }
        else if (action === 'queue') this.queueForRaid();
        else if (action === 'queue-cancel') this.cancelQueue();
        else if (action === 'enter-raid') this.menu?.launchRaid?.(this.matched);
    }

    messageFor(code) {
        return ({
            'invalid-name': 'Имя: 3–20 латинских букв, цифр, _ или -',
            'invalid-password': 'Пароль должен содержать от 6 символов',
            'name-taken': 'Это имя уже занято',
            'bad-credentials': 'Неверное имя или пароль',
            'no-such-player': 'Оператор не найден',
            'already-friends': 'Оператор уже в списке друзей',
            'no-request': 'Запрос уже недействителен',
            'no-party': 'Сначала создайте отряд',
            'not-leader': 'Действие доступно только командиру отряда',
            'party-full': 'Отряд заполнен',
            'already-in-party': 'Оператор уже состоит в отряде',
            'already-queued': 'Вы уже в очереди',
            'not-queued': 'Очередь уже отменена',
            'members-not-ready': 'Не все бойцы отряда готовы к высадке',
            'party-queued': 'Отряд уже находится в поиске игры',
            'cannot-kick-self': 'Нельзя исключить самого себя',
            'not-a-member': 'Оператор не состоит в отряде',
            'session': 'Сетевая сессия завершена',
            'network-error': 'Ошибка сетевого соединения',
            'Failed to fetch': 'Сервер недоступен',
        })[code] || code.replaceAll('-', ' ');
    }

    escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
    }

    render() {
        if (!this.root) return;
        // querySelectorAll types as Element, so narrow INSIDE the callback: a JSDoc tag on the
        // parameter does not retype the array, and selectionStart/End only exist on inputs.
        const fields = [...this.root.querySelectorAll('form input')].map(el => {
            const input = /** @type {HTMLInputElement} */ (el);
            return {
                form: input.closest('form').dataset.form, name: input.name, value: input.value,
                focused: input === document.activeElement, start: input.selectionStart, end: input.selectionEnd
            };
        });
        const scroll = this.root.querySelector('.arc-social-columns')?.scrollTop || 0;
        this.renderContent();
        for (const field of fields) {
            const input = /** @type {HTMLInputElement | null} */ (this.root.querySelector(`form[data-form="${field.form}"] input[name="${field.name}"]`));
            if (!input) continue;
            input.value = field.value;
            if (field.focused) {
                input.focus({ preventScroll: true });
                input.setSelectionRange(field.start, field.end);
            }
        }
        const columns = this.root.querySelector('.arc-social-columns');
        if (columns) columns.scrollTop = scroll;
    }

    renderContent() {
        if (!this.root) return;
        const key = JSON.stringify([this.socialTab, this.addFriendOpen, this.checking, this.restoreFailed, this.authenticated, this.authMode, this.busy, this.error, this.notice, this.healthState?.ok, this.friendsState, this.partyState, this.matchState], (key, value) => key === 'lastSeen' ? undefined : value);
        if (key === this._renderKey) return;
        this._renderKey = key;
        if (this.checking) {
            this.root.innerHTML = '<div class="arc-auth-stage"><div class="arc-auth-kicker">BLACKWATER PROTOCOL</div><h1>ПОДКЛЮЧЕНИЕ</h1><p class="arc-online-auth-copy">Восстанавливаем сессию оператора…</p><div class="arc-session-progress"></div></div>';
            return;
        }
        if (this.restoreFailed) {
            this.root.innerHTML = '<div class="arc-auth-stage"><div class="arc-auth-kicker">BLACKWATER PROTOCOL</div><h1>НЕТ СОЕДИНЕНИЯ</h1><p class="arc-online-auth-copy">Сессия сохранена. Восстановите соединение с сервером, чтобы вернуться в лобби.</p><button data-action="retry" class="primary arc-auth-submit">ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ</button></div>';
            return;
        }
        const oldForm = this.root.querySelector('[data-form="auth"]');
        const activeInput = /** @type {HTMLInputElement | null} */ (oldForm?.contains(document.activeElement) ? document.activeElement : null);
        const draft = oldForm ? Object.fromEntries([...oldForm.querySelectorAll('input')].map(input => [input.name, input.value])) : {};
        const focusName = activeInput?.name || '';
        const cursor = activeInput && typeof activeInput.selectionStart === 'number' ? activeInput.selectionStart : null;
        const online = !!this.healthState?.ok;
        const statusClass = this.checking ? 'checking' : online ? 'online' : 'offline';
        const statusText = this.checking ? 'ПРОВЕРКА КАНАЛА…' : online
            ? `СЕРВЕР ONLINE · ${this.healthState.queue?.players || 0} В ОЧЕРЕДИ`
            : 'СЕРВЕР OFFLINE';
        if (!this.authenticated) {
            this.root.innerHTML = `
                <div class="arc-auth-identity"><b>B/W</b><span>BLACKWATER<br>PROTOCOL</span></div>
                <div class="arc-auth-stage">
                    <div class="arc-auth-kicker">БЕЗОПАСНЫЙ СЕТЕВОЙ ДОСТУП</div>
                    <h1>${this.authMode === 'register' ? 'СОЗДАТЬ ОПЕРАТОРА' : 'ВХОД В СИСТЕМУ'}</h1>
                    <p class="arc-online-auth-copy">${this.authMode === 'register'
                        ? 'Зарегистрируйте позывной. Профиль, отряд и матчи будут закреплены за серверной учётной записью.'
                        : 'Авторизуйтесь, чтобы получить доступ к лобби, отряду, друзьям и сетевым рейдам.'}</p>
                    <div class="arc-auth-tabs" role="tablist">
                        <button type="button" data-action="auth-mode" data-mode="login" aria-selected="${this.authMode === 'login'}">ВХОД</button>
                        <button type="button" data-action="auth-mode" data-mode="register" aria-selected="${this.authMode === 'register'}">РЕГИСТРАЦИЯ</button>
                    </div>
                    <form class="arc-online-auth" data-form="auth" data-mode="${this.authMode}">
                        <label>ПОЗЫВНОЙ<input name="name" autocomplete="username" minlength="3" maxlength="20" spellcheck="false" required></label>
                        <label>ПАРОЛЬ<input name="password" type="password" autocomplete="${this.authMode === 'register' ? 'new-password' : 'current-password'}" minlength="6" required></label>
                        <button type="submit" class="primary arc-auth-submit" ${this.busy || !online ? 'disabled' : ''}>${this.authMode === 'register' ? 'СОЗДАТЬ ПРОФИЛЬ  →' : 'ВОЙТИ В ЛОББИ  →'}</button>
                    </form>
                    ${!online && !this.checking ? '<button type="button" data-action="retry" class="arc-auth-retry">ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ</button>' : ''}
                    ${this.messageMarkup()}
                    <div class="arc-auth-server"><i class="${statusClass}"></i><span>${statusText}</span></div>
                </div>
                <aside class="arc-auth-brief"><span>СЕТЕВАЯ ДИРЕКТИВА 06</span><b>ОДИН ПРОФИЛЬ.<br>ОДИН ОТРЯД.<br>ОДИН ШАНС.</b><p>Состояние группы и подбор рейда подтверждаются сервером.</p></aside>`;
            const newForm = this.root.querySelector('[data-form="auth"]');
            for (const input of newForm?.querySelectorAll('input') || []) {
                if (Object.prototype.hasOwnProperty.call(draft, input.name)) input.value = draft[input.name];
            }
            if (focusName) {
                const input = /** @type {HTMLInputElement | null} */ (newForm?.querySelector(`[name="${focusName}"]`));
                if (input) {
                    input.focus({ preventScroll: true });
                    if (cursor !== null) input.setSelectionRange(cursor, cursor);
                }
            }
            return;
        }

        const account = this.client.account;
        const party = this.partyState?.party;
        const friends = this.friendsState?.friends || [];
        const incoming = this.friendsState?.requests?.incoming || [];
        const invites = this.partyState?.invites || [];
        const match = this.matchState;
        const members = party?.members || [{ name: account.name, leader: true, ready: true }];
        const isLeader = party ? party.leaderId === account.id : true;
        const myMember = members.find(m => m.name === account.name) || { leader: isLeader, ready: true };
        const myReady = isLeader ? true : !!myMember.ready;
        const queueText = match?.raid ? `МАТЧ НАЙДЕН · ${match.raid.players}/8`
            : match?.position ? `ПОИСК · ПОЗИЦИЯ ${match.position.position}` : 'ГОТОВ К ПОИСКУ';
        this.root.innerHTML = `
            <header class="arc-social-header"><div><span class="arc-auth-kicker">СОЦИАЛЬНЫЙ ЦЕНТР</span><h1>ДРУЗЬЯ И ОТРЯД</h1><p>${this.escape(account.name)} · ${queueText}</p></div><button data-action="social-close">НАЗАД В ЛОББИ</button></header>
            <div class="arc-social-columns">
            <section class="arc-online-block">
                <div class="arc-online-block-title">
                    <span>ОТРЯД ${members.length}/4</span>
                    ${members.length > 1 ? '<button data-action="party-leave" class="arc-squad-leave-btn">ПОКИНУТЬ</button>' : ''}
                </div>
                <div class="arc-online-squad-status-bar">
                    ${members.length === 1
                        ? '<span class="arc-squad-summary solo">Одиночный режим · Пригласите друзей из списка справа</span>'
                        : (party?.allReady
                            ? '<span class="arc-squad-summary all-ready">✔ Все бойцы готовы к рейду</span>'
                            : '<span class="arc-squad-summary waiting">⏳ Ожидание готовности всех бойцов…</span>')}
                </div>
                <div class="arc-online-members">
                    ${members.map(member => {
                        const isSelf = member.name === account.name;
                        const isMemberLeader = !!member.leader;
                        const ready = isMemberLeader ? true : !!member.ready;
                        return `
                        <div class="arc-squad-member-card ${isMemberLeader ? 'is-leader' : ''} ${ready ? 'is-ready' : 'not-ready'}">
                            <div class="arc-squad-member-info">
                                <span class="arc-squad-member-role">${isMemberLeader ? '👑' : '◇'}</span>
                                <strong class="arc-squad-member-name">${this.escape(member.name)}${isSelf ? ' <small>(ВЫ)</small>' : ''}</strong>
                                <span class="arc-squad-member-badge ${isMemberLeader ? 'leader' : ready ? 'ready' : 'not-ready'}">
                                    ${isMemberLeader ? 'КОМАНДИР' : ready ? 'ГОТОВ' : 'НЕ ГОТОВ'}
                                </span>
                            </div>
                            <div class="arc-squad-member-actions">
                                ${isLeader && !isMemberLeader ? `
                                    <button data-action="party-promote" data-name="${this.escape(member.name)}" class="arc-member-action-btn promote" title="Передать командование отрядом" ${this.queued || this.busy ? 'disabled' : ''}>👑 СДЕЛАТЬ КОМАНДИРОМ</button>
                                    <button data-action="party-kick" data-name="${this.escape(member.name)}" class="arc-member-action-btn kick" title="Исключить из отряда" ${this.queued || this.busy ? 'disabled' : ''}>✕</button>
                                ` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                ${!isLeader && members.length > 1 ? `
                    <div class="arc-squad-ready-action">
                        <button data-action="party-ready" data-ready="${!myReady}" class="arc-ready-toggle-btn ${myReady ? 'is-ready' : ''}" ${this.queued || this.busy ? 'disabled' : ''}>
                            ${myReady ? '✔ ВЫ ГОТОВЫ (НАЖМИТЕ ДЛЯ ОТМЕНЫ)' : '⏳ ПОДТВЕРДИТЬ ГОТОВНОСТЬ'}
                        </button>
                    </div>
                ` : ''}
                <h2>ПРИГЛАШЕНИЯ</h2>
                ${invites.length ? invites.map(invite => `<div class="arc-online-request"><span>${this.escape(invite.fromName)} зовёт в отряд</span><button data-action="party-accept" data-id="${this.escape(invite.id)}">ПРИНЯТЬ</button><button data-action="party-decline" data-id="${this.escape(invite.id)}">ОТКЛОНИТЬ</button></div>`).join('') : '<p class="arc-social-empty">Новых приглашений нет</p>'}
            </section>
            <section class="arc-online-block">
                <nav class="arc-social-tabs"><button data-action="social-tab" data-tab="friends" aria-pressed="${this.socialTab === 'friends'}">ДРУЗЬЯ · ${friends.length}</button><button data-action="social-tab" data-tab="requests" aria-pressed="${this.socialTab === 'requests'}">ЗАПРОСЫ · ${incoming.length}</button><button data-action="add-friend-toggle" class="primary">ДОБАВИТЬ ДРУГА</button></nav>
                ${this.addFriendOpen ? '<form data-form="friend" class="arc-online-inline"><input name="name" aria-label="Позывной нового друга" placeholder="Позывной нового друга" required><button>ОТПРАВИТЬ ЗАПРОС</button></form>' : ''}
                <div class="arc-online-friends" ${this.socialTab !== 'friends' ? 'hidden' : ''}>${friends.length ? [...friends].sort((a,b) => Number(b.online)-Number(a.online) || a.name.localeCompare(b.name)).map(friend => {
                    const inParty = members.some(member => member.name === friend.name);
                    return `<div class="arc-friend-row"><div class="arc-friend-avatar">${this.escape(friend.name.slice(0,1).toUpperCase())}</div><div class="arc-friend-info"><strong>${this.escape(friend.name)}</strong><small class="${friend.online ? 'is-online' : ''}">${inParty ? 'В ВАШЕМ ОТРЯДЕ' : friend.online ? '● В СЕТИ' : '○ НЕ В СЕТИ'}</small></div><button data-action="invite-friend" data-name="${this.escape(friend.name)}" ${inParty || !friend.online || this.busy || (party && party.leaderId !== account.id) || this.queued ? 'disabled' : ''}>${inParty ? 'В ОТРЯДЕ' : 'ПРИГЛАСИТЬ'}</button></div>`;
                }).join('') : '<p class="arc-social-empty">Список друзей пока пуст.</p>'}</div>
                <div ${this.socialTab !== 'requests' ? 'hidden' : ''}>
                ${!incoming.length ? '<p class="arc-social-empty">Входящих запросов нет</p>' : ''}
                ${incoming.map(req => `<div class="arc-online-request"><span>${this.escape(req.name)}</span><button data-action="friend-accept" data-name="${this.escape(req.name)}">ПРИНЯТЬ</button><button data-action="friend-decline" data-name="${this.escape(req.name)}">×</button></div>`).join('')}
                ${(this.friendsState?.requests?.outgoing || []).map(req => `<p class="arc-social-empty">${this.escape(req.name)} · запрос отправлен</p>`).join('')}
                </div>
            </section>
            </div>
            <footer class="arc-social-footer"><div role="status">${this.messageMarkup()}</div><button data-action="logout">ВЫЙТИ ИЗ АККАУНТА</button></footer>`;
    }

    messageMarkup() {
        if (this.error) return `<div class="arc-online-message error">${this.escape(this.error)}</div>`;
        if (this.notice) return `<div class="arc-online-message">${this.escape(this.notice)}</div>`;
        if (this.busy) return '<div class="arc-online-message">СИНХРОНИЗАЦИЯ…</div>';
        return '';
    }

    async allocateSkill(branch, skillId) {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.allocateSkill(branch, skillId);
            if (res && res.ok && res.progression) {
                if (typeof ProgressionSystem !== 'undefined') ProgressionSystem.updateFromServer(res.progression);
                if (this.menu) {
                    this.menu.progression = res.progression;
                    if (this.menu.profile) {
                        this.menu.profile.skillPoints = res.progression.skillPoints;
                        this.menu.profile.skills = res.progression.skills;
                    }
                    this.menu.refreshUI();
                }
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async respecSkills() {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.respecSkills();
            if (res && res.ok && res.progression) {
                if (typeof ProgressionSystem !== 'undefined') ProgressionSystem.updateFromServer(res.progression);
                if (this.menu) {
                    this.menu.progression = res.progression;
                    if (this.menu.profile) {
                        if (res.progression.credits !== undefined) this.menu.profile.credits = res.progression.credits;
                        this.menu.profile.skillPoints = res.progression.skillPoints;
                        this.menu.profile.skills = res.progression.skills;
                    }
                    this.menu.refreshUI();
                }
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async acceptContract(contractId) {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.acceptContract(contractId);
            if (res && res.ok && res.contracts) {
                if (typeof ProgressionSystem !== 'undefined') ProgressionSystem.state.contracts = res.contracts;
                if (this.menu) {
                    if (this.menu.progression) this.menu.progression.contracts = res.contracts;
                    this.menu.refreshUI();
                }
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async claimContract(contractId) {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.claimContract(contractId);
            if (res && res.ok) {
                await this.refresh(false);
                if (this.menu) this.menu.refreshUI();
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async upgradeWorkshopStation(stationId) {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.upgradeWorkshopStation(stationId);
            if (res && res.ok) {
                await this.refresh(false);
                if (this.menu) this.menu.refreshUI();
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async craftItem(recipeId) {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.craftItem(recipeId);
            if (res && res.ok) {
                await this.refresh(false);
                if (this.menu) this.menu.refreshUI();
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async claimFreeKit() {
        if (!this.client || !this.authenticated) return { ok: false, error: 'not-authenticated' };
        try {
            const res = await this.client.claimFreeKit();
            if (res && res.ok) {
                await this.refresh(false);
                if (this.menu) this.menu.refreshUI();
            }
            return res;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }
}

if (typeof window !== 'undefined') window.OnlineLobby = OnlineLobby;
if (typeof module !== 'undefined' && module.exports) module.exports = OnlineLobby;
