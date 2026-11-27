// GNOME Shell mínimo: só o que Gnomelet, personagens e Projectile tocam.
export const calls = [];   // registro de chamadas de movimento nos atores

class FakeActor {
    constructor(props = {}) {
        Object.assign(this, { x: 0, y: 0, opacity: 255, scale_x: 1, scale_y: 1, rotation_angle_z: 0, _parent: null, _children: [] }, props);
        return new Proxy(this, { get: (t, k) => (k in t || typeof k !== 'string') ? t[k] : () => undefined });
    }
    set_position(x, y) { this.x = x; this.y = y; calls.push(['set_position', x, y, this._easing ? 'ease' : 'snap']); }
    get_position() { return [this.x, this.y]; }
    save_easing_state() { this._easing = true; }
    restore_easing_state() { this._easing = false; }
    set_easing_duration(ms) { this._duration = ms; }
    set_easing_mode() {}
    remove_all_transitions() { calls.push(['remove_all_transitions']); }
    get_parent() { return this._parent; }
    add_child(c) { c._parent = this; this._children.push(c); }
    remove_child(c) { c._parent = null; this._children = this._children.filter(o => o !== c); }
    destroy() {}
}

const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
export const layoutManager = {
    monitors: [monitor], primaryMonitor: monitor, _backgroundGroup: new FakeActor(),
    uiGroup: new FakeActor(),
    addChrome(a) { this.uiGroup.add_child(a); }, removeChrome(a) { this.uiGroup.remove_child(a); },
};
export const makeDraggable = () => ({ connect: () => 1, disconnect() {} });
export const DragMotionResult = { MOVE_DROP: 0 };

class GObjectBase { constructor(...a) { this._init(...a); } _init() {} }
const stub = {
    registerClass: (c) => c, Object: GObjectBase,
    Icon: class extends FakeActor {}, Widget: class extends FakeActor {},
    ThemeContext: { get_for_stage: () => ({ scale_factor: 1 }) },
    BinLayout: class {}, Actor: FakeActor,
    AnimationMode: { LINEAR: 1 }, WindowType: { NORMAL: 0 },
};
export default stub;

globalThis.global = {
    stage: { width: 1920, height: 1080 },
    display: { focus_window: null },
    window_group: new FakeActor(),
    get_pointer: () => [0, 0, 0],
};
