// ============================================================================
//  ArcEventBus + ArcStateMachine — Unit Tests
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ArcEventBus, ArcEventBusCore } = require('../js/engine/ArcEventBus.js');
const {
    ArcStateMachine, ArcStateMachineCore, Blackboard,
    BTStatus, BTSequence, BTSelector, BTAction, BTCondition, BTInverter,
    createAIPreset
} = require('../js/engine/ArcStateMachine.js');

// ============================================================================
//  ArcEventBus Tests
// ============================================================================

test('ArcEventBus: on/emit basic subscription and dispatch', () => {
    const bus = new ArcEventBusCore();
    let received = null;

    bus.on('test.event', (data) => { received = data; });
    const count = bus.emit('test.event', { value: 42 });

    assert.equal(count, 1);
    assert.deepEqual(received, { value: 42 });
    assert.equal(bus.listenerCount('test.event'), 1);
});

test('ArcEventBus: once listener fires exactly once', () => {
    const bus = new ArcEventBusCore();
    let callCount = 0;

    bus.once('single', () => { callCount++; });
    bus.emit('single');
    bus.emit('single');
    bus.emit('single');

    assert.equal(callCount, 1);
    assert.equal(bus.listenerCount('single'), 0);
});

test('ArcEventBus: priority ordering — higher priority executes first', () => {
    const bus = new ArcEventBusCore();
    const order = [];

    bus.on('ordered', () => order.push('low'), { priority: 0 });
    bus.on('ordered', () => order.push('high'), { priority: 10 });
    bus.on('ordered', () => order.push('mid'), { priority: 5 });

    bus.emit('ordered');

    assert.deepEqual(order, ['high', 'mid', 'low']);
});

test('ArcEventBus: wildcard subscription matches namespaced events', () => {
    const bus = new ArcEventBusCore();
    const received = [];

    bus.on('combat.*', (data) => { received.push(data); });
    bus.emit('combat.hit', 'hit');
    bus.emit('combat.miss', 'miss');
    bus.emit('player.move', 'move'); // Should NOT match

    assert.equal(received.length, 2);
    assert.deepEqual(received, ['hit', 'miss']);
});

test('ArcEventBus: global wildcard * catches everything', () => {
    const bus = new ArcEventBusCore();
    let count = 0;

    bus.on('*', () => count++);
    bus.emit('anything');
    bus.emit('something.else');

    assert.equal(count, 2);
});

test('ArcEventBus: off removes specific handler', () => {
    const bus = new ArcEventBusCore();
    let count = 0;
    const handler = () => count++;

    bus.on('removable', handler);
    bus.emit('removable');
    assert.equal(count, 1);

    const removed = bus.off('removable', handler);
    assert.equal(removed, true);

    bus.emit('removable');
    assert.equal(count, 1); // Not called again
});

test('ArcEventBus: unsubscribe via returned handle', () => {
    const bus = new ArcEventBusCore();
    let count = 0;

    const sub = bus.on('handle.test', () => count++);
    bus.emit('handle.test');
    assert.equal(count, 1);

    sub.unsubscribe();
    bus.emit('handle.test');
    assert.equal(count, 1);
});

test('ArcEventBus: enqueue and flush deferred events', () => {
    const bus = new ArcEventBusCore();
    let received = [];

    bus.on('deferred', (d) => received.push(d));

    bus.enqueue('deferred', 'a');
    bus.enqueue('deferred', 'b');
    assert.equal(received.length, 0); // Not yet dispatched

    const flushed = bus.flush();
    assert.equal(flushed, 2);
    assert.deepEqual(received, ['a', 'b']);
});

test('ArcEventBus: event history records last N events', () => {
    const bus = new ArcEventBusCore({ maxHistory: 5 });

    for (let i = 0; i < 10; i++) {
        bus.emit('history.test', i);
    }

    const history = bus.getHistory();
    assert.equal(history.length, 5);
    assert.equal(history[0].data, 5); // Oldest retained
    assert.equal(history[4].data, 9); // Most recent
});

test('ArcEventBus: channels provide isolated buses', () => {
    const bus = new ArcEventBusCore();
    let mainCount = 0, uiCount = 0;

    bus.on('click', () => mainCount++);
    bus.channel('ui').on('click', () => uiCount++);

    bus.emit('click');
    bus.channel('ui').emit('click');

    assert.equal(mainCount, 1);
    assert.equal(uiCount, 1);
});

test('ArcEventBus: clear removes all listeners', () => {
    const bus = new ArcEventBusCore();
    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.on('c', () => {});

    assert.equal(bus.listenerCount(), 3);
    const removed = bus.clear();
    assert.equal(removed, 3);
    assert.equal(bus.listenerCount(), 0);
});

test('ArcEventBus: getStats returns diagnostics', () => {
    const bus = new ArcEventBusCore();
    bus.on('x', () => {});
    bus.on('y', () => {});
    bus.emit('x');
    bus.emit('y');
    bus.emit('z');

    const stats = bus.getStats();
    assert.equal(stats.totalListeners, 2);
    assert.equal(stats.totalEmitted, 3);
    assert.ok(stats.eventNames.includes('x'));
    assert.ok(stats.eventNames.includes('y'));
});

test('ArcEventBus: error in handler does not crash other handlers', () => {
    const bus = new ArcEventBusCore();
    let secondCalled = false;

    bus.on('error.test', () => { throw new Error('boom'); });
    bus.on('error.test', () => { secondCalled = true; });

    // Should not throw
    const count = bus.emit('error.test');
    assert.equal(count, 2);
    assert.equal(secondCalled, true);
});

// ============================================================================
//  ArcStateMachine Tests
// ============================================================================

test('ArcStateMachine: basic state lifecycle (onEnter, onUpdate, onExit)', () => {
    const sm = new ArcStateMachineCore();
    const log = [];

    sm.addState('idle', {
        onEnter: () => log.push('idle:enter'),
        onUpdate: (m, dt) => log.push(`idle:update:${dt}`),
        onExit: () => log.push('idle:exit')
    });
    sm.addState('walk', {
        onEnter: () => log.push('walk:enter'),
        onUpdate: (m, dt) => log.push(`walk:update:${dt}`)
    });

    sm.setState('idle');
    assert.equal(sm.currentState, 'idle');
    assert.deepEqual(log, ['idle:enter']);

    sm.update(0.016);
    assert.deepEqual(log, ['idle:enter', 'idle:update:0.016']);

    sm.setState('walk');
    assert.equal(sm.currentState, 'walk');
    assert.ok(log.includes('idle:exit'));
    assert.ok(log.includes('walk:enter'));
});

test('ArcStateMachine: conditional transitions with guards', () => {
    const sm = new ArcStateMachineCore();

    sm.addState('patrol', {});
    sm.addState('chase', {});
    sm.blackboard.set('enemyNear', false);

    sm.addTransition('patrol', 'chase', (m) => m.blackboard.get('enemyNear'));
    sm.setState('patrol');

    sm.update(0.016);
    assert.equal(sm.currentState, 'patrol'); // Guard not met

    sm.blackboard.set('enemyNear', true);
    sm.update(0.016);
    assert.equal(sm.currentState, 'chase'); // Guard met, transitioned
});

test('ArcStateMachine: timeInState tracks elapsed time', () => {
    const sm = new ArcStateMachineCore();
    sm.addState('idle', {});
    sm.setState('idle');

    sm.update(0.1);
    sm.update(0.2);

    assert.ok(Math.abs(sm.timeInState - 0.3) < 0.001);
});

test('ArcStateMachine: transition history and getHistory', () => {
    const sm = new ArcStateMachineCore();
    sm.addState('a', {});
    sm.addState('b', {});
    sm.addState('c', {});

    sm.setState('a');
    sm.setState('b');
    sm.setState('c');

    const history = sm.getHistory();
    assert.equal(history.length, 2); // a→b, b→c
    assert.equal(history[0].from, 'a');
    assert.equal(history[0].to, 'b');
    assert.equal(history[1].from, 'b');
    assert.equal(history[1].to, 'c');
});

test('ArcStateMachine: serialization toJSON/fromJSON', () => {
    const sm = new ArcStateMachineCore({ id: 'test_sm' });
    sm.addState('patrol', {});
    sm.addState('attack', {});
    sm.blackboard.set('hp', 80);
    sm.blackboard.set('ammo', 30);
    sm.setState('patrol');
    sm.update(1.5);

    const json = sm.toJSON();
    assert.equal(json.id, 'test_sm');
    assert.equal(json.currentState, 'patrol');
    assert.equal(json.blackboard.hp, 80);

    const sm2 = new ArcStateMachineCore();
    sm2.addState('patrol', {});
    sm2.addState('attack', {});
    sm2.fromJSON(json);

    assert.equal(sm2.currentState, 'patrol');
    assert.equal(sm2.blackboard.get('hp'), 80);
    assert.equal(sm2.blackboard.get('ammo'), 30);
});

test('ArcStateMachine: getDebugInfo for ArcInspector', () => {
    const sm = new ArcStateMachineCore({ id: 'debug_test' });
    sm.addState('idle', {});
    sm.addState('chase', {});
    sm.setState('idle');

    const info = sm.getDebugInfo();
    assert.equal(info.id, 'debug_test');
    assert.equal(info.currentState, 'idle');
    assert.deepEqual(info.states, ['idle', 'chase']);
});

test('ArcStateMachine: dispose cleans up all state', () => {
    const sm = new ArcStateMachineCore();
    sm.addState('a', {});
    sm.setState('a');
    sm.blackboard.set('test', 123);

    sm.dispose();

    assert.equal(sm.active, false);
    assert.equal(sm.currentState, null);
    assert.equal(sm.getStates().length, 0);
});

// ============================================================================
//  Blackboard Tests
// ============================================================================

test('Blackboard: get/set/has/delete operations', () => {
    const bb = new Blackboard();
    bb.set('hp', 100).set('name', 'robot');

    assert.equal(bb.get('hp'), 100);
    assert.equal(bb.get('name'), 'robot');
    assert.equal(bb.has('hp'), true);
    assert.equal(bb.get('missing'), null);
    assert.equal(bb.get('missing', 'default'), 'default');

    bb.delete('hp');
    assert.equal(bb.has('hp'), false);
});

test('Blackboard: toJSON/fromJSON serialization', () => {
    const bb = new Blackboard();
    bb.set('x', 10).set('y', 20);

    const json = bb.toJSON();
    assert.deepEqual(json, { x: 10, y: 20 });

    const bb2 = new Blackboard();
    bb2.fromJSON(json);
    assert.equal(bb2.get('x'), 10);
    assert.equal(bb2.get('y'), 20);
});

// ============================================================================
//  Behaviour Tree Tests
// ============================================================================

test('BTSequence: succeeds when all children succeed', () => {
    const bb = new Blackboard();
    const log = [];

    const seq = new BTSequence('test', [
        new BTAction('a', () => { log.push('a'); return BTStatus.SUCCESS; }),
        new BTAction('b', () => { log.push('b'); return BTStatus.SUCCESS; }),
        new BTAction('c', () => { log.push('c'); return BTStatus.SUCCESS; })
    ]);

    assert.equal(seq.tick(bb, 0.016), BTStatus.SUCCESS);
    assert.deepEqual(log, ['a', 'b', 'c']);
});

test('BTSequence: fails on first child failure', () => {
    const bb = new Blackboard();
    const log = [];

    const seq = new BTSequence('test', [
        new BTAction('a', () => { log.push('a'); return BTStatus.SUCCESS; }),
        new BTAction('b', () => { log.push('b'); return BTStatus.FAILURE; }),
        new BTAction('c', () => { log.push('c'); return BTStatus.SUCCESS; })
    ]);

    assert.equal(seq.tick(bb, 0.016), BTStatus.FAILURE);
    assert.deepEqual(log, ['a', 'b']); // 'c' never reached
});

test('BTSelector: succeeds on first child success', () => {
    const bb = new Blackboard();

    const sel = new BTSelector('test', [
        new BTAction('fail', () => BTStatus.FAILURE),
        new BTAction('pass', () => BTStatus.SUCCESS),
        new BTAction('skip', () => BTStatus.SUCCESS)
    ]);

    assert.equal(sel.tick(bb, 0.016), BTStatus.SUCCESS);
});

test('BTCondition: returns success/failure based on predicate', () => {
    const bb = new Blackboard();
    bb.set('hasAmmo', true);

    const cond = new BTCondition('check_ammo', (b) => b.get('hasAmmo'));
    assert.equal(cond.tick(bb, 0), BTStatus.SUCCESS);

    bb.set('hasAmmo', false);
    assert.equal(cond.tick(bb, 0), BTStatus.FAILURE);
});

test('BTInverter: inverts child result', () => {
    const bb = new Blackboard();

    const inv = new BTInverter(new BTAction('always_ok', () => BTStatus.SUCCESS));
    assert.equal(inv.tick(bb, 0), BTStatus.FAILURE);

    const inv2 = new BTInverter(new BTAction('always_fail', () => BTStatus.FAILURE));
    assert.equal(inv2.tick(bb, 0), BTStatus.SUCCESS);
});

test('createAIPreset: patrol creates a working FSM', () => {
    const sm = createAIPreset('patrol', {
        waypoints: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}],
        detectRange: 200
    });

    assert.equal(sm.currentState, 'patrol');
    assert.ok(sm.getStates().includes('patrol'));
    assert.ok(sm.getStates().includes('alert'));
    assert.ok(sm.getStates().includes('chase'));

    // Simulate enemy detection
    sm.blackboard.set('targetDist', 150);
    sm.update(0.016);
    assert.equal(sm.currentState, 'alert');
});

test('createAIPreset: guard transitions to engage on close proximity', () => {
    const sm = createAIPreset('guard', {
        detectRange: 150,
        attackRange: 50
    });

    assert.equal(sm.currentState, 'guard');

    // Enemy enters detection range
    sm.blackboard.set('targetDist', 100);
    sm.update(0.016);
    assert.equal(sm.currentState, 'alert');

    // Enemy enters attack range
    sm.blackboard.set('targetDist', 30);
    sm.update(0.016);
    assert.equal(sm.currentState, 'engage');

    // Enemy retreats
    sm.blackboard.set('targetDist', 300);
    sm.update(0.016);
    assert.equal(sm.currentState, 'guard');
});
