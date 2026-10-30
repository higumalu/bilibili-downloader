// One native process per active video isolates cancellation and FFmpeg state.
export class DownloadQueue {
  constructor({ storage, launch, id = () => crypto.randomUUID() }) {
    this.storage = storage;
    this.launch = launch;
    this.id = id;
    this.jobs = [];
    this.active = new Map();
    this.concurrency = 2;
    this.choosing = false;
    this.chain = Promise.resolve();
  }
  transaction(action) {
    const result = this.chain.then(action);
    this.chain = result.catch(() => {});
    return result;
  }
  async init() {
    const saved = await this.storage.get(['queue', 'queueConcurrency', 'lastDownload', 'state']);
    this.jobs = Array.isArray(saved.queue) ? saved.queue : [];
    this.concurrency = [1, 2, 3].includes(saved.queueConcurrency) ? saved.queueConcurrency : 2;
    if (!Array.isArray(saved.queue) && saved.lastDownload) {
      this.jobs.push({ ...saved.lastDownload, ...(saved.state || {}), id: this.id(),
        type: saved.state?.type === 'done' ? 'done' : 'interrupted', createdAt: Date.now() });
    }
    for (const job of this.jobs) if (['queued', 'progress'].includes(job.type)) {
      Object.assign(job, { type: 'interrupted', messageKey: 'interrupted' });
    }
    await this.persist();
  }
  persist() { return this.storage.set({ queue: this.jobs, queueConcurrency: this.concurrency }); }
  pending() { return this.jobs.some(job => ['queued', 'progress'].includes(job.type)); }
  error(key) { return Object.assign(new Error(key), { errorKey: key }); }
  duplicate(job) {
    return this.jobs.some(other => other.id !== job.id && other.url === job.url && ['queued', 'progress'].includes(other.type));
  }
  async add(input) {
    if (this.choosing) throw this.error('errorChoosing');
    if (this.duplicate(input)) throw this.error('errorDuplicate');
    if (this.jobs.length >= 100) {
      const index = this.jobs.findIndex(job => ['done', 'error', 'cancelled'].includes(job.type));
      if (index < 0) throw this.error('errorQueueFull');
      this.jobs.splice(index, 1);
    }
    this.jobs.push({ ...input, id: this.id(), type: 'queued', messageKey: 'queued', percent: 0, createdAt: Date.now() });
    await this.pump();
  }
  async pump() {
    let job;
    while (!this.choosing && this.active.size < this.concurrency && (job = this.jobs.find(item => item.type === 'queued'
      && !this.jobs.some(other => this.active.has(other.id) && other.url === item.url)))) {
      const current = job;
      const entry = { port: null, cancelled: false, finished: false };
      this.active.set(current.id, entry);
      Object.assign(current, { type: 'progress', stage: 'extracting', messageKey: 'extracting', percent: 0 });
      Promise.resolve().then(() => this.launch(current, entry)).catch(error => this.transaction(async () => {
        if (this.active.get(current.id) === entry) await this.update(current.id, { type: 'error', messageKey: error.errorKey || 'errorHelper' });
      }));
    }
    await this.persist();
  }
  async update(id, message) {
    const job = this.jobs.find(item => item.id === id);
    if (!job || !this.active.has(id)) return;
    // Keep task identity and URL local to the queue; native data cannot replace them.
    const { type, title, percent, messageKey, args, stage, path, speedMB, etaSeconds } = message;
    Object.assign(job, { type, percent, messageKey, args, stage, speedMB, etaSeconds, updatedAt: Date.now() });
    if (title) job.title = title;
    if (path) job.path = path;
    if (['done', 'error', 'cancelled'].includes(type)) {
      const entry = this.active.get(id);
      this.active.delete(id);
      entry.finished = true;
      entry.port?.disconnect();
      const { history = [] } = await this.storage.get('history');
      await this.storage.set({ history: [{ type, title: job.title, path: job.path, timestamp: Date.now() }, ...history].slice(0, 20) });
    }
    await this.pump();
  }
  async cancel(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw this.error('errorNoRetry');
    const entry = this.active.get(id);
    if (entry) {
      entry.cancelled = true;
      entry.port?.postMessage({ command: 'cancel' });
    } else if (job.type === 'queued') {
      Object.assign(job, { type: 'cancelled', messageKey: 'cancelled' });
      await this.persist();
    }
  }
  async retry(id, language) {
    if (this.choosing) throw this.error('errorChoosing');
    const job = this.jobs.find(item => item.id === id);
    if (!job || !['error', 'cancelled', 'interrupted'].includes(job.type)) throw this.error('errorNoRetry');
    if (this.duplicate(job)) throw this.error('errorDuplicate');
    Object.assign(job, { type: 'queued', messageKey: 'queued', percent: 0, language });
    this.jobs = [...this.jobs.filter(other => other.id !== id), job];
    await this.pump();
  }
  async resume(language) {
    if (this.choosing) throw this.error('errorChoosing');
    for (const job of this.jobs) if (job.type === 'interrupted' && !this.duplicate(job)) {
      Object.assign(job, { type: 'queued', messageKey: 'queued', language });
    }
    await this.pump();
  }
  async clearFinished() {
    this.jobs = this.jobs.filter(job => !['done', 'error', 'cancelled'].includes(job.type));
    await this.persist();
  }
}
