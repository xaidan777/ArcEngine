// console-pane.js — the Console: findings from every editor panel in ONE list.
//
// WHY aggregating matters: a scene has a linter (Debug3D / the Model panel), a clip validator and
// a rig validator, and each produces findings in the same shape. Three separate lists would mean a
// designer checks three places to answer "is anything wrong?". Here each source publishes its
// findings under a key and the pane merges them, so the badge counts the truth for the whole
// editor.
//
// It is a SINK, not a source: a panel owns its findings and calls `setFindings(key, list)`. The
// pane never recomputes anything, so it can never disagree with the panel that produced it.

/** @satisfies {Record<string, any>} */
const ConsolePane = {
    ROOT_ID: 'console-list',
    BADGE_ID: 'console-badge',
    /** Findings per source: key -> array of { level, code, target, time, message }. */
    sources: new Map(),
    /** Free-form log lines pushed with `log(level, text)`. */
    logLines: [],
    /** Cap, so a long editing session cannot grow the DOM without limit. */
    MAX_LINES: 300,

    init() {
        if (typeof document === 'undefined') return false;
        this.host = document.getElementById(this.ROOT_ID);
        const clear = document.getElementById('btn-console-clear');
        if (clear) clear.addEventListener('click', () => this.clear());
        this.render();
        return !!this.host;
    },

    /** Publish one source's findings, replacing whatever it published before. */
    setFindings(key, findings) {
        if (!key) return;
        const list = Array.isArray(findings) ? findings : [];
        if (list.length) this.sources.set(key, list);
        else this.sources.delete(key);
        this.render();
    },

    /** A one-off message that is not a document finding. */
    log(level, text) {
        this.logLines.push({ level: level || 'info', text: String(text) });
        if (this.logLines.length > this.MAX_LINES) this.logLines.shift();
        this.render();
    },

    clear() {
        this.sources.clear();
        this.logLines.length = 0;
        this.render();
    },

    /** Every finding, errors first then warnings then notes, with its source named. */
    all() {
        const out = [];
        for (const [key, list] of this.sources) {
            for (const finding of list) out.push(Object.assign({ source: key }, finding));
        }
        const rank = { error: 0, warn: 1, info: 2 };
        // Sorting by severity means the thing to fix is always at the top, however many sources
        // reported it.
        return out.sort((a, b) => (rank[a.level] || 3) - (rank[b.level] || 3));
    },

    /** Counts by severity, for the badge. */
    summary() {
        const out = { error: 0, warn: 0, info: 0 };
        for (const finding of this.all()) if (out[finding.level] != null) out[finding.level]++;
        return out;
    },

    render() {
        if (!this.host) return;
        this.host.innerHTML = '';
        const findings = this.all();
        for (const finding of findings) {
            const line = document.createElement('div');
            line.className = 'console-row ' + finding.level;
            // Text, never markup: a node or bone name is untrusted input.
            line.textContent = '[' + finding.source + '] ' + (finding.target ? finding.target + ': ' : '') + finding.message;
            this.host.appendChild(line);
        }
        for (const entry of this.logLines) {
            const line = document.createElement('div');
            line.className = 'console-row ' + entry.level;
            line.textContent = entry.text;
            this.host.appendChild(line);
        }
        if (!findings.length && !this.logLines.length) {
            const line = document.createElement('div');
            line.className = 'console-row info';
            line.textContent = 'Чисто. Нет замечаний / Clean. No findings.';
            this.host.appendChild(line);
        }
        const badge = document.getElementById(this.BADGE_ID);
        if (badge) {
            const counts = this.summary();
            const total = counts.error + counts.warn + counts.info;
            badge.textContent = total ? (counts.error + ' errors · ' + counts.warn + ' warnings · ' + counts.info + ' notes') : '';
            badge.classList.toggle('has-errors', counts.error > 0);
            badge.classList.toggle('has-warnings', counts.error === 0 && counts.warn > 0);
        }
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = ConsolePane;
if (typeof window !== 'undefined') /** @type {any} */ (window).ConsolePane = ConsolePane;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).ConsolePane = ConsolePane;