// servers.mjs — custom RVC behavior servers that drive the real Roomba.
import { RvcRunModeServer } from '@matter/main/behaviors/rvc-run-mode';
import { RvcOperationalStateServer } from '@matter/main/behaviors/rvc-operational-state';
import { RvcCleanModeServer } from '@matter/main/behaviors/rvc-clean-mode';
import { IdentifyServer } from '@matter/main/behaviors/identify';
import { RvcOperationalState } from '@matter/types/clusters/rvc-operational-state';
import { OperationalState } from '@matter/types/clusters/operational-state';
import { ModeBase } from '@matter/types/clusters/mode-base';
import { RUN_MODE_CLEAN, RUN_MODE_IDLE, cleanModeToPasses } from './mapping.mjs';
import { getRoomba } from './shared.mjs';

// Identify ("Locate" in Apple Home): play the robot's locate sound.
export class RoombaIdentifyServer extends IdentifyServer {
  initialize() {
    super.initialize();
    this.reactTo(this.events.startIdentifying, this.#onIdentify);
  }
  #onIdentify() {
    const roomba = getRoomba();
    if (roomba) roomba.locate().catch((e) => console.log('identify/locate error: ' + e.message));
  }
}

// RvcCleanMode: selecting a mode changes the robot's cleaning-passes preference.
export class RoombaCleanModeServer extends RvcCleanModeServer {
  changeToMode({ newMode }) {
    const result = super.changeToMode({ newMode }); // validates + updates currentMode
    if (result.status !== ModeBase.ModeChangeStatus.Success) return result;
    const roomba = getRoomba();
    if (roomba) {
      roomba.setPasses(cleanModeToPasses(newMode)).catch((e) => console.log('cleanMode error: ' + e.message));
    }
    return result;
  }
}

const OpState = RvcOperationalState.OperationalState;
const Err = OperationalState.ErrorState;
const ok = () => ({ commandResponseState: { errorStateId: Err.NoError } });
const fail = (id) => ({ commandResponseState: { errorStateId: id } });

// RvcRunMode: selecting the Cleaning-tagged mode starts a mission; Idle sends it home.
export class RoombaRunModeServer extends RvcRunModeServer {
  changeToMode({ newMode }) {
    const result = super.changeToMode({ newMode }); // validates + updates currentMode
    if (result.status !== ModeBase.ModeChangeStatus.Success) return result;

    const roomba = getRoomba();
    if (roomba) {
      if (newMode === RUN_MODE_CLEAN) {
        roomba.start().catch((e) => console.log('runMode start error: ' + e.message));
      } else if (newMode === RUN_MODE_IDLE) {
        roomba.dock().catch((e) => console.log('runMode dock error: ' + e.message));
      }
    }
    return result;
  }
}

// RvcOperationalState: the three RVC commands Apple Home drives.
//
// These ACK immediately (optimistic state update) and dispatch the robot command
// in the background, so Siri/Home never wait on the Roomba's MQTT round-trip. The
// real state syncs back a moment later via pushState and corrects it if needed.
export class RoombaOperationalStateServer extends RvcOperationalStateServer {
  pause() {
    this.state.operationalState = OpState.Paused;
    const roomba = getRoomba();
    if (roomba) roomba.pause().catch((e) => console.log('pause error: ' + e.message));
    return ok();
  }

  resume() {
    this.state.operationalState = OpState.Running;
    const roomba = getRoomba();
    if (roomba) roomba.start().catch((e) => console.log('resume error: ' + e.message));
    return ok();
  }

  goHome() {
    this.state.operationalState = OpState.SeekingCharger;
    const roomba = getRoomba();
    if (roomba) roomba.dock().catch((e) => console.log('goHome error: ' + e.message));
    return ok();
  }
}
