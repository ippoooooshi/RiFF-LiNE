// UT: view-modes.md §3.2・§4.2・§5.3、B16 — ZoomController（モードごとに独立したズーム保持）
//
// 検証観点:
//  - モード別の既定ズーム／注入値のクランプ
//  - setZoom：現在モードのみ更新・[MIN,MAX] クランプ・host へスケール適用・onZoomChange 通知
//  - モード間でズーム値が独立（B16）
//  - zoomIn / zoomOut のステップとクランプ
//  - reapplyForCurrentMode（モード切替後の再適用、view-modes.md §5.1）

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingViewModeRenderHost } from '../testing/viewModeFakes';
import type { RenderViewMode } from '../rendering';

import {
  DEFAULT_ZOOM_PERCENT_BY_MODE,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
  ZoomController,
} from './ZoomController';

let host: RecordingViewModeRenderHost;
let mode: RenderViewMode;
const getMode = (): RenderViewMode => mode;

beforeEach(() => {
  host = new RecordingViewModeRenderHost();
  mode = 'focus';
});

describe('ZoomController constructor', () => {
  it('ZoomController_NoInjection_UsesPerModeDefaults', () => {
    const zoom = new ZoomController(host, getMode);
    expect(zoom.zoomPercentOf('focus')).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.focus);
    expect(zoom.zoomPercentOf('scroll')).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.scroll);
    expect(zoom.zoomPercentOf('score')).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.score);
  });

  it('ZoomController_PartialInjection_OverridesOnlyGivenModes', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { scroll: 75 } });
    expect(zoom.zoomPercentOf('scroll')).toBe(75);
    expect(zoom.zoomPercentOf('focus')).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.focus);
  });

  it('ZoomController_InjectedValueOutOfRange_Clamped', () => {
    const zoom = new ZoomController(host, getMode, {
      initialZoomPercentByMode: { focus: 9999, score: 1 },
    });
    expect(zoom.zoomPercentOf('focus')).toBe(MAX_ZOOM_PERCENT);
    expect(zoom.zoomPercentOf('score')).toBe(MIN_ZOOM_PERCENT);
  });

  it('ZoomController_Constructor_DoesNotApplyToHost', () => {
    new ZoomController(host, getMode);
    expect(host.zoomCalls).toHaveLength(0);
  });
});

describe('ZoomController.zoomPercent (current mode)', () => {
  it('zoomPercent_TracksCurrentMode', () => {
    const zoom = new ZoomController(host, getMode);
    expect(zoom.zoomPercent).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.focus);
    mode = 'score';
    expect(zoom.zoomPercent).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.score);
  });
});

describe('ZoomController.setZoom', () => {
  it('setZoom_ValidPercent_StoresAppliesScaleAndNotifies', () => {
    const onZoomChange = vi.fn();
    const zoom = new ZoomController(host, getMode, { onZoomChange });

    zoom.setZoom(150);

    expect(zoom.zoomPercentOf('focus')).toBe(150);
    expect(host.lastZoom).toBe(1.5); // percent / 100
    expect(onZoomChange).toHaveBeenCalledWith(150, 'focus');
  });

  it('setZoom_AboveMax_ClampedToMax', () => {
    const zoom = new ZoomController(host, getMode);
    zoom.setZoom(10_000);
    expect(zoom.zoomPercent).toBe(MAX_ZOOM_PERCENT);
    expect(host.lastZoom).toBe(MAX_ZOOM_PERCENT / 100);
  });

  it('setZoom_BelowMin_ClampedToMin', () => {
    const zoom = new ZoomController(host, getMode);
    zoom.setZoom(1);
    expect(zoom.zoomPercent).toBe(MIN_ZOOM_PERCENT);
  });

  it('setZoom_NonFinite_FallsBackToMin', () => {
    const zoom = new ZoomController(host, getMode);
    zoom.setZoom(Number.NaN);
    expect(zoom.zoomPercent).toBe(MIN_ZOOM_PERCENT);
  });

  it('setZoom_Fractional_RoundedToInteger', () => {
    const zoom = new ZoomController(host, getMode);
    zoom.setZoom(123.7);
    expect(zoom.zoomPercent).toBe(124);
  });

  it('setZoom_OnlyAffectsCurrentMode_B16Independence', () => {
    const zoom = new ZoomController(host, getMode);
    zoom.setZoom(200); // focus
    mode = 'scroll';
    zoom.setZoom(50); // scroll

    expect(zoom.zoomPercentOf('focus')).toBe(200);
    expect(zoom.zoomPercentOf('scroll')).toBe(50);
    expect(zoom.zoomPercentOf('score')).toBe(DEFAULT_ZOOM_PERCENT_BY_MODE.score);
  });
});

describe('ZoomController.zoomIn / zoomOut', () => {
  it('zoomIn_IncreasesCurrentModeByStep', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { focus: 100 } });
    zoom.zoomIn();
    expect(zoom.zoomPercent).toBe(100 + ZOOM_STEP_PERCENT);
  });

  it('zoomOut_DecreasesCurrentModeByStep', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { focus: 100 } });
    zoom.zoomOut();
    expect(zoom.zoomPercent).toBe(100 - ZOOM_STEP_PERCENT);
  });

  it('zoomIn_AtMax_StaysClamped', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { focus: MAX_ZOOM_PERCENT } });
    zoom.zoomIn();
    expect(zoom.zoomPercent).toBe(MAX_ZOOM_PERCENT);
  });

  it('zoomOut_AtMin_StaysClamped', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { focus: MIN_ZOOM_PERCENT } });
    zoom.zoomOut();
    expect(zoom.zoomPercent).toBe(MIN_ZOOM_PERCENT);
  });
});

describe('ZoomController.reapplyForCurrentMode', () => {
  it('reapplyForCurrentMode_PushesStoredZoomForNewModeAndNotifies', () => {
    const onZoomChange = vi.fn();
    const zoom = new ZoomController(host, getMode, {
      initialZoomPercentByMode: { focus: 180, score: 90 },
      onZoomChange,
    });
    // モード切替を模す
    mode = 'score';
    zoom.reapplyForCurrentMode();

    expect(host.lastZoom).toBe(0.9);
    expect(onZoomChange).toHaveBeenCalledWith(90, 'score');
  });

  it('reapplyForCurrentMode_DoesNotMutateStoredValue', () => {
    const zoom = new ZoomController(host, getMode, { initialZoomPercentByMode: { focus: 175 } });
    zoom.reapplyForCurrentMode();
    expect(zoom.zoomPercentOf('focus')).toBe(175);
  });
});
