// mapping.mjs — translate Roomba telemetry <-> Matter RVC enums.
import { RvcOperationalState } from '@matter/types/clusters/rvc-operational-state';
import { RvcRunMode } from '@matter/types/clusters/rvc-run-mode';
import { RvcCleanMode } from '@matter/types/clusters/rvc-clean-mode';
import { PowerSource } from '@matter/types/clusters/power-source';
import { Phase } from './roomba.js';

const S = RvcOperationalState.OperationalState;
const E = RvcOperationalState.ErrorState;

// RvcRunMode supported modes. Must contain exactly one Idle-tagged and one
// Cleaning-tagged mode (validated by matter.js on startup).
export const RUN_MODE_IDLE = 0;
export const RUN_MODE_CLEAN = 1;
export const supportedRunModes = [
  { label: 'Idle', mode: RUN_MODE_IDLE, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
  { label: 'Clean', mode: RUN_MODE_CLEAN, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }] },
];

// RvcCleanMode supported modes = cleaning passes. Each must carry a Vacuum (or Mop)
// tag. These map to the Roomba's noAutoPasses / twoPass preference.
export const CLEAN_MODE_AUTO = 0;
export const CLEAN_MODE_ONE = 1;
export const CLEAN_MODE_TWO = 2;
export const supportedCleanModes = [
  {
    label: 'Automatico',
    mode: CLEAN_MODE_AUTO,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Auto }],
  },
  {
    label: 'Una pasada',
    mode: CLEAN_MODE_ONE,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.Quick }],
  },
  {
    label: 'Dos pasadas',
    mode: CLEAN_MODE_TWO,
    modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }, { value: RvcCleanMode.ModeTag.DeepClean }],
  },
];

// Matter clean mode <-> Roomba passes string.
export function cleanModeToPasses(mode) {
  if (mode === CLEAN_MODE_ONE) return 'one';
  if (mode === CLEAN_MODE_TWO) return 'two';
  return 'auto';
}
export function passesToCleanMode(passes) {
  if (passes === 'one') return CLEAN_MODE_ONE;
  if (passes === 'two') return CLEAN_MODE_TWO;
  return CLEAN_MODE_AUTO;
}

// Full set of operational states we may report (must include an Error entry).
export const operationalStateList = [
  { operationalStateId: S.Stopped },
  { operationalStateId: S.Running },
  { operationalStateId: S.Paused },
  { operationalStateId: S.Error },
  { operationalStateId: S.SeekingCharger },
  { operationalStateId: S.Charging },
  { operationalStateId: S.Docked },
];

// Roomba cleanMissionStatus.error code -> RVC ErrorState.
// Codes per iRobot 900-series; grouped to the closest Matter semantic.
function roombaErrorToRvc(code) {
  switch (code) {
    case 0:
      return E.NoError;
    case 1: // Roomba stuck, move to a new location
    case 5: // side wheel
    case 7: // side wheel
    case 10: // left/right wheel
    case 11:
    case 13:
    case 14:
    case 15:
    case 16: // moved while starting / bumped
      return E.Stuck;
    case 2: // main brushes stuck
      return E.BrushJammed;
    case 6: // cliff sensors
    case 8: // vacuum/motor
    case 17: // navigation problem
      return E.NavigationSensorObscured;
    case 9: // bumper stuck
      return E.WheelsJammed;
    case 18: // docking issue
      return E.FailedToFindChargingDock;
    default:
      return E.UnableToCompleteOperation;
  }
}

// Build the { operationalState, operationalError } pair matter.js should hold.
export function toMatterState(st) {
  // Genuine fault reported by the robot.
  if (st.error) {
    return { operationalState: S.Error, operationalError: { errorStateId: roombaErrorToRvc(st.error) } };
  }
  // Bin full while NOT docked -> surface as an actionable error (Apple shows it).
  // Docked with a full bin is left as Charging/Docked so the card isn't stuck in error.
  if (st.binFull && !st.docked) {
    return { operationalState: S.Error, operationalError: { errorStateId: E.DustBinFull } };
  }

  let operationalState;
  switch (st.phase) {
    case Phase.RUN:
      operationalState = S.Running;
      break;
    case Phase.STOP:
      operationalState = S.Paused;
      break;
    case Phase.RETURN_MID:
    case Phase.RETURN_USER:
    case Phase.RETURN_POST:
      operationalState = S.SeekingCharger;
      break;
    case Phase.EVAC:
      operationalState = S.EmptyingDustBin;
      break;
    case Phase.CHARGE:
      operationalState = st.batPct != null && st.batPct >= 100 ? S.Docked : S.Charging;
      break;
    default:
      operationalState = S.Docked;
  }
  return { operationalState, operationalError: { errorStateId: E.NoError } };
}

// Which run mode should show as "current" given the robot phase.
export function toCurrentRunMode(st) {
  return st.running ? RUN_MODE_CLEAN : RUN_MODE_IDLE;
}

// Map Roomba battery telemetry -> Matter PowerSource attributes.
// batPercentRemaining is in half-percent units (0..200); null when unknown.
export function toBattery(st) {
  const pct = st.batPct;
  const batPercentRemaining = pct == null ? null : Math.max(0, Math.min(200, Math.round(pct * 2)));

  let batChargeState;
  if (st.charging && pct != null && pct >= 100) batChargeState = PowerSource.BatChargeState.IsAtFullCharge;
  else if (st.charging) batChargeState = PowerSource.BatChargeState.IsCharging;
  else batChargeState = PowerSource.BatChargeState.IsNotCharging;

  let batChargeLevel = PowerSource.BatChargeLevel.Ok;
  if (pct != null) {
    if (pct <= 10) batChargeLevel = PowerSource.BatChargeLevel.Critical;
    else if (pct <= 20) batChargeLevel = PowerSource.BatChargeLevel.Warning;
  }

  return { batPercentRemaining, batChargeState, batChargeLevel };
}
