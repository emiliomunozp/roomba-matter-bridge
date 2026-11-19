// index.mjs — Matter "Robotic Vacuum Cleaner" device backed by a local Roomba 960.
//
// Exposes the robot to Apple Home (iOS 18.4+) as a native vacuum with the proper
// start / pause / return-to-dock UI and live status, translating every action to
// the Roomba local API via dorita980.
import { readFileSync } from 'node:fs';
import { Endpoint, ServerNode, VendorId } from '@matter/main';
import { RoboticVacuumCleanerDevice } from '@matter/main/devices/robotic-vacuum-cleaner';
import { PowerSourceServer } from '@matter/main/behaviors/power-source';
import { RvcOperationalState } from '@matter/types/clusters/rvc-operational-state';
import { PowerSource } from '@matter/types/clusters/power-source';
import { RoombaController } from './roomba.js';
import { setRoomba } from './shared.mjs';
import {
  RoombaRunModeServer,
  RoombaOperationalStateServer,
  RoombaIdentifyServer,
  RoombaCleanModeServer,
} from './servers.mjs';
import {
  supportedRunModes,
  supportedCleanModes,
  operationalStateList,
  toMatterState,
  toCurrentRunMode,
  toBattery,
  passesToCleanMode,
  RUN_MODE_IDLE,
  CLEAN_MODE_AUTO,
} from './mapping.mjs';

const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// --- Roomba backend -------------------------------------------------------
const roomba = new RoombaController({
  blid: cfg.blid,
  password: cfg.password,
  host: cfg.host,
  log,
});
setRoomba(roomba);

// --- Matter server node ---------------------------------------------------
const server = await ServerNode.create({
  id: 'roomba-960',
  productDescription: {
    name: cfg.name || 'Roomba 960',
    deviceType: RoboticVacuumCleanerDevice.deviceType,
  },
  commissioning: {
    passcode: cfg.passcode || 20202021,
    discriminator: cfg.discriminator || 3840,
  },
  network: { port: cfg.port || 5540 },
  basicInformation: {
    vendorName: 'Roomba Bridge',
    vendorId: VendorId(cfg.vendorId || 0xfff1),
    productName: cfg.name || 'Roomba 960',
    productId: cfg.productId || 0x9601,
    serialNumber: cfg.serial || 'roomba-960',
    uniqueId: cfg.serial || 'roomba-960',
    hardwareVersion: 960,
    hardwareVersionString: '960',
    softwareVersion: 1,
    softwareVersionString: cfg.sw || '2.4.17-138',
    nodeLabel: cfg.name || 'Roomba',
  },
});

// The RoboticVacuumCleaner device type requires the RvcOperationalState
// OperationCompletion event to be supported; enable it on our server subclass.
const OperationalStateServer = RoombaOperationalStateServer.enable({
  events: { operationCompletion: true },
});

// Battery power source (gives Apple Home the battery indicator + charging state).
const BatteryPowerSourceServer = PowerSourceServer.with('Battery', 'Rechargeable');

const vacuum = new Endpoint(
  RoboticVacuumCleanerDevice.with(
    RoombaRunModeServer,
    OperationalStateServer,
    RoombaIdentifyServer,
    RoombaCleanModeServer,
    BatteryPowerSourceServer,
  ),
  {
    id: 'vacuum',
    rvcRunMode: {
      supportedModes: supportedRunModes,
      currentMode: RUN_MODE_IDLE,
    },
    rvcCleanMode: {
      supportedModes: supportedCleanModes,
      currentMode: CLEAN_MODE_AUTO,
    },
    rvcOperationalState: {
      operationalStateList,
      operationalState: RvcOperationalState.OperationalState.Docked,
      operationalError: { errorStateId: 0 },
      phaseList: null,
      currentPhase: null,
    },
    powerSource: {
      status: PowerSource.PowerSourceStatus.Active,
      order: 0,
      description: 'Battery',
      batChargeLevel: PowerSource.BatChargeLevel.Ok,
      batReplacementNeeded: false,
      batReplaceability: PowerSource.BatReplaceability.NotReplaceable,
      batPresent: true,
      // Never expose null: Apple caches "unknown" and hides the battery indicator.
      // Seed a sane value; the real level overwrites it within ~1s of connecting.
      batPercentRemaining: 200,
      batChargeState: PowerSource.BatChargeState.IsCharging,
      batFunctionalWhileCharging: false,
      endpointList: [],
    },
  },
);

await server.add(vacuum);

// Explicitly associate the battery with the vacuum endpoint. Per the Matter
// spec an empty EndpointList is valid for a whole-node battery, but Apple Home's
// robotic-vacuum card appears to only track/refresh the battery when the
// PowerSource's EndpointList names the application endpoint it powers.
try {
  await vacuum.set({ powerSource: { endpointList: [vacuum.number] } });
  log('powerSource.endpointList set to [' + vacuum.number + ']');
} catch (e) {
  log('could not set powerSource.endpointList: ' + e.message);
}

// --- Keep Matter attributes in sync with the real robot -------------------
let lastJson = '';
async function pushState(st) {
  if (!st.connected) return;
  const { operationalState, operationalError } = toMatterState(st);
  const currentMode = toCurrentRunMode(st);
  const cleanMode = passesToCleanMode(st.passes);
  const bat = toBattery(st);
  const snapshot = JSON.stringify({ operationalState, operationalError, currentMode, cleanMode, bat });
  if (snapshot === lastJson) return;
  lastJson = snapshot;

  const powerSource = {
    batChargeState: bat.batChargeState,
    batChargeLevel: bat.batChargeLevel,
  };
  if (bat.batPercentRemaining != null) powerSource.batPercentRemaining = bat.batPercentRemaining;

  try {
    await vacuum.set({
      rvcOperationalState: { operationalState, operationalError },
      rvcRunMode: { currentMode },
      rvcCleanMode: { currentMode: cleanMode },
      powerSource,
    });
    log(`matter<-roomba  state=${operationalState} err=${operationalError.errorStateId} run=${currentMode} clean=${cleanMode} bat=${st.batPct}`);
  } catch (e) {
    log('pushState error: ' + e.message);
  }
}
roomba.on('update', (st) => { pushState(st).catch(() => {}); });

// --- Start -----------------------------------------------------------------
await server.start();

const pc = server.state.commissioning?.pairingCodes;
log('Matter Robotic Vacuum Cleaner started.');
if (pc) {
  log('Manual pairing code: ' + pc.manualPairingCode);
  log('QR pairing code:     ' + pc.qrPairingCode);
} else {
  log('Commissioning info not yet available (check log for pairing code).');
}

process.on('SIGINT', async () => { try { await server.close(); } catch (_) {} roomba.destroy(); process.exit(0); });
process.on('SIGTERM', async () => { try { await server.close(); } catch (_) {} roomba.destroy(); process.exit(0); });
