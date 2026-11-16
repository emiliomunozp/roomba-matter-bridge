// servers.mjs — custom RVC behavior servers that drive the real Roomba.
import { RvcRunModeServer } from '@matter/main/behaviors/rvc-run-mode';
import { RvcOperationalStateServer } from '@matter/main/behaviors/rvc-operational-state';
import { IdentifyServer } from '@matter/main/behaviors/identify';
import { RvcOperationalState } from '@matter/types/clusters/rvc-operational-state';
import { OperationalState } from '@matter/types/clusters/operational-state';
import { ModeBase } from '@matter/types/clusters/mode-base';
import { RUN_MODE_CLEAN, RUN_MODE_IDLE } from './mapping.mjs';
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
export class RoombaOperationalStateServer extends RvcOperationalStateServer {
  async pause() {
    const roomba = getRoomba();
    try {
      if (roomba) await roomba.pause();
      this.state.operationalState = OpState.Paused;
      return ok();
    } catch (e) {
      console.log('pause error: ' + e.message);
      return fail(Err.CommandInvalidInState);
    }
  }

  async resume() {
    const roomba = getRoomba();
    try {
      if (roomba) await roomba.start();
      this.state.operationalState = OpState.Running;
      return ok();
    } catch (e) {
      console.log('resume error: ' + e.message);
      return fail(Err.UnableToStartOrResume);
    }
  }

  async goHome() {
    const roomba = getRoomba();
    try {
      if (roomba) await roomba.dock();
      this.state.operationalState = OpState.SeekingCharger;
      return ok();
    } catch (e) {
      console.log('goHome error: ' + e.message);
      return fail(Err.UnableToCompleteOperation);
    }
  }
}
