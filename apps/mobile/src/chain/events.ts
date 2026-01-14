type Listener<T> = (payload: T) => void;

export class EventBus<T> {
  private listeners = new Set<Listener<T>>();

  subscribe(fn: Listener<T>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn); // unsubscribe
  }

  emit(payload: T) {
    this.listeners.forEach((fn) => fn(payload));
  }
}
