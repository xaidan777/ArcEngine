// voice-manager.test.mjs — Comprehensive unit tests for VoiceManager polyphony management.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceManager, VoicePriority } from '../js/audio/VoiceManager.js';
import { loadScripts } from './browser-scripts.mjs';

test('VoicePriority: constants match requirements and hierarchy', () => {
    assert.strictEqual(VoicePriority.CRITICAL, 3);
    assert.strictEqual(VoicePriority.HIGH, 2);
    assert.strictEqual(VoicePriority.NORMAL, 1);
    assert.strictEqual(VoicePriority.LOW, 0);

    // Verify ordering
    assert.ok(VoicePriority.CRITICAL > VoicePriority.HIGH);
    assert.ok(VoicePriority.HIGH > VoicePriority.NORMAL);
    assert.ok(VoicePriority.NORMAL > VoicePriority.LOW);

    // Also accessible as static member on VoiceManager
    assert.strictEqual(VoiceManager.VoicePriority, VoicePriority);
});

test('VoiceManager: configuration and default maxVoices', () => {
    const vmDefault = new VoiceManager();
    assert.strictEqual(vmDefault.maxVoices, 24);
    assert.strictEqual(vmDefault.getActiveCount(), 0);

    const vmCustomNum = new VoiceManager(8);
    assert.strictEqual(vmCustomNum.maxVoices, 8);

    const vmCustomObj = new VoiceManager({ maxVoices: 16 });
    assert.strictEqual(vmCustomObj.maxVoices, 16);

    const stats = vmDefault.getStats();
    assert.deepStrictEqual(stats, {
        activeVoices: 0,
        maxVoices: 24,
        stolenCount: 0,
        droppedCount: 0,
        totalAllocated: 0
    });
});

test('VoiceManager: allocates voices within capacity', () => {
    const vm = new VoiceManager(5);

    const v1 = vm.allocateVoice('player_footstep');
    assert.ok(v1);
    assert.strictEqual(v1.id, 'player_footstep');
    assert.strictEqual(v1.priority, VoicePriority.NORMAL);
    assert.ok(v1.token !== undefined);
    assert.strictEqual(typeof v1.timestamp, 'number');
    assert.strictEqual(vm.getActiveCount(), 1);

    const v2 = vm.allocateVoice('player_weapon', VoicePriority.CRITICAL);
    assert.ok(v2);
    assert.strictEqual(v2.id, 'player_weapon');
    assert.strictEqual(v2.priority, VoicePriority.CRITICAL);
    assert.notStrictEqual(v1.token, v2.token);
    assert.strictEqual(vm.getActiveCount(), 2);

    const stats = vm.getStats();
    assert.strictEqual(stats.activeVoices, 2);
    assert.strictEqual(stats.stolenCount, 0);
    assert.strictEqual(stats.droppedCount, 0);
});

test('VoiceManager: releases voices and frees slots', () => {
    const vm = new VoiceManager(3);

    const v1 = vm.allocateVoice('sound_1');
    const v2 = vm.allocateVoice('sound_2');
    assert.strictEqual(vm.getActiveCount(), 2);

    // Release via token object
    const released1 = vm.releaseVoice(v1);
    assert.strictEqual(released1, true);
    assert.strictEqual(vm.getActiveCount(), 1);

    // Release again (idempotent / already released)
    assert.strictEqual(vm.releaseVoice(v1), false);
    assert.strictEqual(vm.getActiveCount(), 1);

    // Release via token id
    const released2 = vm.releaseVoice(v2.token);
    assert.strictEqual(released2, true);
    assert.strictEqual(vm.getActiveCount(), 0);

    // Releasing invalid or null token returns false
    assert.strictEqual(vm.releaseVoice(null), false);
    assert.strictEqual(vm.releaseVoice(undefined), false);
    assert.strictEqual(vm.releaseVoice('nonexistent_token'), false);
});

test('VoiceManager: steals lowest priority voice when at capacity', () => {
    const vm = new VoiceManager(3);

    const stolenEvents = [];
    const onSteal = (id) => (info) => {
        stolenEvents.push({ id, fadeOutTime: info.fadeOutTime });
    };

    // Fill capacity with Low, Normal, High
    const vLow = vm.allocateVoice('wind_gust', VoicePriority.LOW, onSteal('wind_gust'));
    const vNormal = vm.allocateVoice('footstep', VoicePriority.NORMAL, onSteal('footstep'));
    const vHigh = vm.allocateVoice('enemy_shot', VoicePriority.HIGH, onSteal('enemy_shot'));

    assert.strictEqual(vm.getActiveCount(), 3);
    assert.strictEqual(stolenEvents.length, 0);

    // Allocate critical voice -> should steal LOW priority voice (wind_gust)
    const vCrit = vm.allocateVoice('player_shot', VoicePriority.CRITICAL, onSteal('player_shot'));
    assert.ok(vCrit);
    assert.strictEqual(vm.getActiveCount(), 3);

    // Check callback was invoked with fadeOutTime: 0.015
    assert.strictEqual(stolenEvents.length, 1);
    assert.strictEqual(stolenEvents[0].id, 'wind_gust');
    assert.strictEqual(stolenEvents[0].fadeOutTime, 0.015);

    // Check vLow is no longer active
    assert.strictEqual(vm.hasVoice(vLow), false);
    assert.strictEqual(vm.hasVoice(vNormal), true);
    assert.strictEqual(vm.hasVoice(vHigh), true);
    assert.strictEqual(vm.hasVoice(vCrit), true);

    const stats = vm.getStats();
    assert.strictEqual(stats.stolenCount, 1);
    assert.strictEqual(stats.droppedCount, 0);
});

test('VoiceManager: steals older voice when priorities are identical', () => {
    const vm = new VoiceManager(2);

    const stolenOrder = [];
    const v1 = vm.allocateVoice('footstep_1', VoicePriority.NORMAL, (info) => {
        stolenOrder.push({ id: 'footstep_1', info });
    });
    const v2 = vm.allocateVoice('footstep_2', VoicePriority.NORMAL, (info) => {
        stolenOrder.push({ id: 'footstep_2', info });
    });

    assert.strictEqual(vm.getActiveCount(), 2);
    assert.strictEqual(stolenOrder.length, 0);

    // Incoming voice is also NORMAL priority. Both active voices are NORMAL.
    // v1 is older than v2, so v1 should be stolen.
    const v3 = vm.allocateVoice('footstep_3', VoicePriority.NORMAL);
    assert.ok(v3);

    assert.strictEqual(stolenOrder.length, 1);
    assert.strictEqual(stolenOrder[0].id, 'footstep_1');
    assert.strictEqual(stolenOrder[0].info.fadeOutTime, 0.015);

    assert.strictEqual(vm.hasVoice(v1), false);
    assert.strictEqual(vm.hasVoice(v2), true);
    assert.strictEqual(vm.hasVoice(v3), true);
});

test('VoiceManager: drops voice when no stealable voice exists at capacity', () => {
    const vm = new VoiceManager(2);

    // Fill capacity with CRITICAL voices
    const v1 = vm.allocateVoice('rocket_explosion', VoicePriority.CRITICAL);
    const v2 = vm.allocateVoice('boss_slam', VoicePriority.CRITICAL);

    assert.strictEqual(vm.getActiveCount(), 2);

    // Request a LOW priority sound: should be rejected/dropped
    const vLow = vm.allocateVoice('distant_creak', VoicePriority.LOW);
    assert.strictEqual(vLow, null);

    // Request a HIGH priority sound: still lower than CRITICAL, so dropped
    const vHigh = vm.allocateVoice('enemy_alarm', VoicePriority.HIGH);
    assert.strictEqual(vHigh, null);

    const stats = vm.getStats();
    assert.strictEqual(stats.activeVoices, 2);
    assert.strictEqual(stats.stolenCount, 0);
    assert.strictEqual(stats.droppedCount, 2);

    // Both original critical voices remain intact
    assert.strictEqual(vm.hasVoice(v1), true);
    assert.strictEqual(vm.hasVoice(v2), true);
});

test('VoiceManager: clear() releases all voices', () => {
    const vm = new VoiceManager(5);

    const v1 = vm.allocateVoice('v1', VoicePriority.LOW);
    const v2 = vm.allocateVoice('v2', VoicePriority.HIGH);
    const v3 = vm.allocateVoice('v3', VoicePriority.CRITICAL);

    assert.strictEqual(vm.getActiveCount(), 3);
    assert.strictEqual(vm.getStats().activeVoices, 3);

    vm.clear();

    assert.strictEqual(vm.getActiveCount(), 0);
    assert.strictEqual(vm.getStats().activeVoices, 0);
    assert.strictEqual(vm.hasVoice(v1), false);
    assert.strictEqual(vm.hasVoice(v2), false);
    assert.strictEqual(vm.hasVoice(v3), false);

    // Can allocate up to maxVoices again
    const v4 = vm.allocateVoice('v4', VoicePriority.NORMAL);
    assert.ok(v4);
    assert.strictEqual(vm.getActiveCount(), 1);
});

test('VoiceManager: zero maxVoices drops all requests gracefully', () => {
    const vmZero = new VoiceManager(0);
    assert.strictEqual(vmZero.getActiveCount(), 0);

    const v = vmZero.allocateVoice('sound', VoicePriority.CRITICAL);
    assert.strictEqual(v, null);
    assert.strictEqual(vmZero.getStats().droppedCount, 1);
    assert.strictEqual(vmZero.getActiveCount(), 0);
});

test('VoiceManager: browser-scripts integration (window and global exposure)', () => {
    const { ctx } = loadScripts(['js/audio/VoiceManager.js']);

    assert.ok(ctx.VoiceManager, 'VoiceManager should be present in context');
    assert.ok(ctx.VoicePriority, 'VoicePriority should be present in context');
    assert.ok(ctx.window.VoiceManager, 'window.VoiceManager should be set');
    assert.ok(ctx.window.VoicePriority, 'window.VoicePriority should be set');

    const vm = new ctx.VoiceManager(4);
    const voice = vm.allocateVoice('bullet_whiz', ctx.VoicePriority.NORMAL);
    assert.ok(voice);
    assert.strictEqual(vm.getActiveCount(), 1);
    assert.strictEqual(voice.priority, 1);
});
