// src/utils/eventBus.js
// Bus central de eventos ligero para actualizacion automatica de vistas sin recargas manuales

class SimpleEventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
      if (this.listeners.get(event).size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit(event, payload) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try {
          cb(payload);
        } catch (e) {
          console.log('[EventBus] Error in listener for ' + event + ':', e);
        }
      });
    }
  }

  removeAll(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

export const eventBus = new SimpleEventBus();

export const EVENTS = {
  CLIENT_CREATED: 'CLIENT_CREATED',
  PAYMENT_REGISTERED: 'PAYMENT_REGISTERED',
  MOVEMENT_CHANGED: 'MOVEMENT_CHANGED',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
};
