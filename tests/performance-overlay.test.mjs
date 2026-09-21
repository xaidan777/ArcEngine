import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArcPerformanceOverlay, ArcPerformanceOverlayCore } from '../js/engine/ArcPerformanceOverlay.js';
import { loadScripts } from './browser-scripts.mjs';

test('ArcPerformanceOverlay: exports class and singleton instance', () => {
    assert.ok(ArcPerformanceOverlay, 'ArcPerformanceOverlay instance exists');
    assert.ok(ArcPerformanceOverlayCore, 'ArcPerformanceOverlayCore class exists');
    assert.equal(typeof ArcPerformanceOverlay.init, 'function');
    assert.equal(typeof ArcPerformanceOverlay.update, 'function');
    assert.equal(typeof ArcPerformanceOverlay.toggle, 'function');
    assert.equal(typeof ArcPerformanceOverlay.getTelemetry, 'function');
});

test('ArcPerformanceOverlay: headless initialization and telemetry metrics', () => {
    const overlay = new ArcPerformanceOverlayCore();
    overlay.init(null, null, { autoShow: false });

    assert.equal(overlay.initialized, true);
    assert.equal(overlay.isVisible(), false);

    // Toggle
    overlay.toggle();
    assert.equal(overlay.isVisible(), true);

    // Simulate several frame updates
    overlay.update(0.016, true);
    overlay.update(0.016, true);
    overlay.update(0.017, true);

    const telemetry = overlay.getTelemetry();
    assert.ok(telemetry.fps > 0, 'FPS is calculated');
    assert.ok(telemetry.frameTimeMs > 0, 'Frame time is calculated');
    assert.ok(telemetry.onePercentLow > 0, '1% low is calculated');
    assert.equal(typeof telemetry.gpuBackend, 'string');
    assert.equal(typeof telemetry.gpuDriver, 'string');
    assert.equal(typeof telemetry.dlssMode, 'string');
    assert.equal(typeof telemetry.rtxStatus, 'string');
    assert.equal(typeof telemetry.threadsCount, 'number');

    overlay.hide();
    assert.equal(overlay.isVisible(), false);
    overlay.dispose();
});

test('ArcPerformanceOverlay: simulated browser environment with DOM', () => {
    // Create DOM mocks
    const createdElements = [];
    const eventListeners = {};

    const mockDocument = {
        createElement(tag) {
            const el = {
                tagName: tag.toUpperCase(),
                id: '',
                className: '',
                style: {},
                innerHTML: '',
                textContent: '',
                parentNode: null,
                onclick: null,
                appendChild(child) {
                    child.parentNode = el;
                    return child;
                },
                removeChild(child) {
                    child.parentNode = null;
                    return child;
                },
                closest(selector) {
                    return null;
                }
            };
            createdElements.push(el);
            return el;
        },
        getElementById(id) {
            return createdElements.find(e => e.id === id) || null;
        },
        head: {
            appendChild(el) { return el; }
        },
        body: {
            appendChild(el) { return el; }
        },
        activeElement: null
    };

    const mockWindow = {
        addEventListener(event, handler) {
            eventListeners[event] = handler;
        },
        removeEventListener(event, handler) {
            delete eventListeners[event];
        },
        location: {
            search: '?directPlay=1&fps=1'
        }
    };

    const globals = {
        document: mockDocument,
        window: mockWindow,
        performance: { now: () => 1000 }
    };

    const { ctx } = loadScripts(['js/engine/ArcPerformanceOverlay.js'], globals);
    assert.ok(ctx.ArcPerformanceOverlay, 'Mounted on window');

    const overlay = new ctx.ArcPerformanceOverlayCore();
    overlay.init(null, null);

    // Because location.search has fps=1, autoShow should be active
    assert.equal(overlay.isVisible(), true);
    assert.ok(overlay.container, 'Container element created');
    assert.ok(overlay.container.innerHTML.includes('FPS'), 'Displays FPS markup');

    // Test expanding/collapsing
    overlay.isExpanded = true;
    overlay.update(0.016, true);
    assert.ok(overlay.container.innerHTML.includes('ARC DIAGNOSTICS'), 'Displays full diagnostics card');

    // Test keyboard handler simulation
    assert.ok(eventListeners.keydown, 'Keydown listener bound');
    eventListeners.keydown({ code: 'F3', preventDefault: () => {} });
    assert.equal(overlay.isVisible(), false, 'F3 toggles visibility off');

    eventListeners.keydown({ code: 'Backquote', preventDefault: () => {} });
    assert.equal(overlay.isVisible(), true, 'Backquote toggles visibility on');

    overlay.dispose();
    assert.equal(overlay.container, null);
});
