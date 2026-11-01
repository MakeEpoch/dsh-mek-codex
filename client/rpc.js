import { ENDPOINT } from '../shared/identity.js';

export function createClient(connection) {
  return {
    async call(method, payload = {}, signal) {
      const wire = await connection.rpc.call('/api', ENDPOINT, { method, payload }, signal);
      const response = wire?.result ?? wire;
      if (!response?.ok) {
        const error = new Error(response?.error?.message || 'Codex 面板请求失败');
        error.code = response?.error?.code;
        throw error;
      }
      return response.value;
    },
    health(signal) {
      return this.call('health', {}, signal);
    },
    restart() {
      return this.call('restart', {});
    },
    releaseAll() {
      return this.call('release.all', {});
    },
    list(params, signal) {
      return this.call('list', params, signal);
    },
    turns(params, signal) {
      return this.call('turns', params, signal);
    },
    read(params, signal) {
      return this.call('read', params, signal);
    },
    filePreview(params, signal) { return this.call('file.preview', params, signal); },
    fileUrl(params) {
      const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
      return `/api/${ENDPOINT}/file?${query}`;
    },
    sync(params, signal) {
      return this.call('sync', params, signal);
    },
    models() {
      return this.call('models', {});
    },
    settings(params) {
      return this.call('settings', params);
    },
    resume(params) {
      return this.call('resume', params);
    },
    release(params) {
      return this.call('release', params);
    },
    send(params) {
      return this.call('send', params);
    },
    steer(params) {
      return this.call('steer', params);
    },
    interrupt(params) {
      return this.call('interrupt', params);
    },
    queueAdd(params) {
      return this.call('queue.add', params);
    },
    queueList(params) {
      return this.call('queue.list', params);
    },
    events(params, signal) {
      return this.call('events', params, signal);
    },
    reconcile(params) { return this.call('reconcile', params); },
    presence(params) {
      return this.call('presence', params);
    },
    decide(params) {
      return this.call('approval.decide', params);
    },
    upload(params) {
      return this.call('upload.image', params);
    },
    start(params) {
      return this.call('start', params);
    },
    rename(params) {
      return this.call('rename', params);
    },
    archive(params) {
      return this.call('archive', params);
    },
    unarchive(params) {
      return this.call('unarchive', params);
    },
    remove(params) {
      return this.call('remove', params);
    },
  };
}
