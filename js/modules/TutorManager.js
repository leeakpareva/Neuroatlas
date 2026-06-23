/**
 * TutorManager - Front-end for the AI tutor.
 *
 * Talks to the local /api/chat proxy (which holds the API key server-side).
 * Sends conversation history + live context (selected region, scenario) so the
 * tutor can teach about exactly what the user is looking at.
 */

export class TutorManager {
    constructor(els, getContext) {
        this.log = els.log;
        this.input = els.input;
        this.send = els.send;
        this.status = els.status;
        this.getContext = getContext;
        this.history = [];
        this.online = false;

        this.send.addEventListener('click', () => this._submit());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
        });
        this._checkHealth();
    }

    async _checkHealth() {
        try {
            const h = await fetch('/api/health').then(r => r.json());
            this.online = !!h.ai;
            this.status.textContent = this.online ? `online · ${h.model}` : 'offline · add API key';
            this.status.className = 'tutor-status ' + (this.online ? 'on' : 'off');
            if (!this.online) {
                this._add('assistant', 'NAVADA AI Doc is offline — add an API key to enable it.');
            } else {
                this._add('assistant', 'NAVADA AI Doc here. Click a part or pick a state, then ask me anything.');
            }
        } catch {
            this.status.textContent = 'offline';
        }
    }

    _add(role, text) {
        const el = document.createElement('div');
        el.className = 'msg ' + role;
        el.textContent = text;
        this.log.appendChild(el);
        this.log.scrollTop = this.log.scrollHeight;
        return el;
    }

    async _submit() {
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = '';
        this._add('user', text);
        this.history.push({ role: 'user', content: text });

        const thinking = this._add('assistant', '…');
        this.send.disabled = true;
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: this.history, context: this.getContext() }),
            }).then(r => r.json());
            thinking.textContent = res.reply || '(no response)';
            if (!res.error) this.history.push({ role: 'assistant', content: res.reply });
        } catch (e) {
            thinking.textContent = 'Connection error: ' + e.message;
        } finally {
            this.send.disabled = false;
            this.log.scrollTop = this.log.scrollHeight;
        }
    }
}
