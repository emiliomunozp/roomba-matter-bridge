// roomba.js — Local-API controller for an iRobot Roomba 900-series using dorita980.
// Maintains a persistent connection with auto-reconnect (the robot drops its socket
// when it sleeps), caches state, and exposes a small, clean command surface that the
// Matter device layer maps onto the RVC clusters.
import dorita980 from 'dorita980';
import { EventEmitter } from 'node:events';

// Roomba cleanMissionStatus.phase values we care about:
//   'charge'      -> docked & charging / idle on dock
//   'run'         -> actively cleaning
//   'stop'        -> stopped/paused somewhere on the floor
//   'hmMidMsn'    -> returning to dock mid-mission (to recharge)
//   'hmUsrDock'   -> returning to dock because the user asked
//   'hmPostMsn'   -> returning to dock after finishing
//   'evac'        -> emptying bin (Clean Base models; not the 960)
export const Phase = {
  CHARGE: 'charge',
  RUN: 'run',
  STOP: 'stop',
  RETURN_MID: 'hmMidMsn',
  RETURN_USER: 'hmUsrDock',
  RETURN_POST: 'hmPostMsn',
  EVAC: 'evac',
};

export class RoombaController extends EventEmitter {
  constructor({ blid, password, host, log = console.log }) {
    super();
    this.blid = blid;
    this.password = password;
    this.host = host;
    this.log = log;

    this.state = {
      connected: false,
      batPct: null,       // 0..100
      charging: false,
      phase: null,        // one of Phase.*
      binFull: false,
      docked: false,
      running: false,
      returning: false,
      paused: false,
      error: null,        // robot error code (0 = none)
    };

    this._robot = null;
    this._reconnectTimer = null;
    this._reconnectDelay = 5000;
    this._destroyed = false;
    this._connect();
  }

  _connect() {
    if (this._destroyed) return;
    this._clearReconnect();
    try {
      this._robot = new dorita980.Local(this.blid, this.password, this.host);
    } catch (e) {
      this.log('roomba: construct failed: ' + e.message);
      return this._scheduleReconnect();
    }

    this._robot.on('connect', () => {
      this.state.connected = true;
      this._reconnectDelay = 5000;
      this.log('roomba: connected');
      this.emit('update', this.state);
    });
    this._robot.on('close', () => {
      if (this.state.connected) this.log('roomba: connection closed');
      this.state.connected = false;
      this.emit('update', this.state);
      this._scheduleReconnect();
    });
    this._robot.on('offline', () => {
      this.state.connected = false;
      this.emit('update', this.state);
    });
    this._robot.on('state', (data) => this._onState(data));
    this._robot.on('error', (e) => {
      this.log('roomba: error ' + (e && e.message ? e.message : e));
      this._scheduleReconnect();
    });
  }

  _onState(data) {
    if (!data) return;
    if (typeof data.batPct === 'number') this.state.batPct = data.batPct;
    if (data.bin && typeof data.bin.full === 'boolean') this.state.binFull = data.bin.full;

    const cms = data.cleanMissionStatus;
    if (cms) {
      if (cms.phase) this.state.phase = cms.phase;
      if (typeof cms.error === 'number') this.state.error = cms.error;
    }

    // Derive high-level flags from phase + charging telemetry.
    const phase = this.state.phase;
    this.state.charging = phase === Phase.CHARGE;
    this.state.docked = phase === Phase.CHARGE;
    this.state.running = phase === Phase.RUN;
    this.state.returning =
      phase === Phase.RETURN_MID || phase === Phase.RETURN_USER || phase === Phase.RETURN_POST;
    this.state.paused = phase === Phase.STOP;

    this.emit('update', this.state);
  }

  _scheduleReconnect() {
    if (this._destroyed || this._reconnectTimer) return;
    try {
      if (this._robot) this._robot.end();
    } catch (_) {}
    this._robot = null;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 60000);
    this.log(`roomba: reconnecting in ${Math.round(delay / 1000)}s`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _ready() {
    return this._robot && this.state.connected;
  }

  // --- Commands (all best-effort; the robot echoes real state back via 'state') ---

  async start() {
    if (!this._ready()) throw new Error('roomba not connected');
    // If paused mid-floor, resume; otherwise start a fresh mission.
    if (this.state.paused) return this._robot.resume();
    return this._robot.clean();
  }

  async pause() {
    if (!this._ready()) throw new Error('roomba not connected');
    return this._robot.pause();
  }

  async dock() {
    if (!this._ready()) throw new Error('roomba not connected');
    // The 900-series needs to be paused/stopped before it will accept "dock".
    if (this.state.running) {
      try {
        await this._robot.pause();
        await new Promise((r) => setTimeout(r, 1500));
      } catch (_) {}
    }
    return this._robot.dock();
  }

  async stop() {
    if (!this._ready()) throw new Error('roomba not connected');
    return this._robot.stop();
  }

  // Make the robot play its locate sound (maps the Matter Identify command).
  async locate() {
    if (!this._ready()) throw new Error('roomba not connected');
    return this._robot.find();
  }

  destroy() {
    this._destroyed = true;
    this._clearReconnect();
    try {
      if (this._robot) this._robot.end();
    } catch (_) {}
  }
}
