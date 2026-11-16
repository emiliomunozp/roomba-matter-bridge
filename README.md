# Roomba Matter Bridge

Expose an **iRobot Roomba 900-series** (tested on a **Roomba 960**, firmware `2.4.17-138`)
to **Apple Home** — and any Matter controller — as a **native Matter Robotic Vacuum
Cleaner**, not as a fake switch or fan.

Apple added support for Matter robot vacuums in **iOS 18.4**, so the robot shows up with
the proper vacuum card: **Clean / Pause / Return to dock**, live status, battery and a
**Locate** (sound) button. Everything is driven **locally** over the Roomba's own API via
[`dorita980`](https://github.com/koalazak/dorita980) — no cloud, no account.

## Is my Roomba "native" now?

**No — and it doesn't need to be.** This is a small **Matter device that runs on a
Raspberry Pi** (or any always-on Linux box) and *translates* between Matter and the
Roomba's local API. The robot's firmware is untouched. To Apple Home it looks and behaves
like a real Matter vacuum; the "brain" that speaks Matter lives on the Pi. If the Pi is
off, the accessory goes unresponsive. True native Matter would have to ship inside the
robot's firmware, which only iRobot can do.

## How it works

```
Apple Home  ──Matter──▶  this bridge (Node.js on the Pi)  ──local API / MQTT──▶  Roomba 960
 (RVC card)              matter.js RVC device  +  dorita980            (port 8883, LAN only)
```

- **matter.js** (`@matter/main`) implements the Matter **Robotic Vacuum Cleaner** device
  type (0x74), with the `RvcRunMode`, `RvcOperationalState`, `Identify` and `PowerSource`
  clusters.
- **dorita980** talks to the robot's local MQTT interface (the same one the official app
  uses) to start/pause/dock, read mission status + battery, and play the locate sound.
- Matter commands are mapped to robot actions, and robot telemetry is pushed back into
  the Matter attributes so the Home card stays live.

| Apple Home action | Matter | Roomba |
|---|---|---|
| Clean | `RvcRunMode.changeToMode` → Cleaning | `clean()` / `resume()` |
| Pause | `RvcOperationalState.pause` | `pause()` |
| Return to dock | `RvcOperationalState.goHome` | `dock()` |
| Locate (sound) | `Identify` | `find()` |
| Cleaning mode | `RvcCleanMode` → Auto / One pass / Two passes | `setCleaningPasses*()` |
| Status / battery | `RvcOperationalState` / `PowerSource` | `cleanMissionStatus`, `batPct` |

## Requirements

- An always-on Linux host on the **same LAN** as the robot (a Raspberry Pi is plenty).
- **Node.js 20+**.
- An **Apple Home hub** (Apple TV / HomePod) on **iOS 18.4+** for the native vacuum card.
- The robot's **local credentials** (BLID + password) — see below.

> ⚠️ The Roomba 900-series accepts **only one local client at a time** on port 8883. If you
> also run Homebridge's `homebridge-roomba2` (or Home Assistant's roomba integration),
> disable the robot there, or they will fight over the connection.

## Install

```bash
git clone https://github.com/<you>/roomba-matter-bridge.git
cd roomba-matter-bridge
npm install
```

### 1. Get the robot's local credentials

With the robot **on its dock and awake**, press and hold **HOME** for ~2s until it plays a
tone and the Wi-Fi light flashes, then run:

```bash
npx get-roomba-password <robot-ip>
```

(`get-roomba-password` ships with `dorita980`.) Note the **BLID** (username) and
**password**.

### 2. Configure

```bash
cp config.example.json config.json
chmod 600 config.json          # it holds the password
# edit config.json: host, blid, password, serial
```

### 3. Run

```bash
npm start
```

It prints a **manual pairing code** and a **QR code**. Then add it in the Home app:
**+ → Add Accessory → More options… → pick "Roomba" / enter the code**. Apple will warn it
is an *uncertified accessory* — tap **Add Anyway** (expected for a DIY Matter device).

### 4. Run it as a service (systemd)

```bash
sudo cp systemd/roomba-matter.service /etc/systemd/system/
# edit User= / WorkingDirectory= in the unit to match your setup
sudo systemctl daemon-reload
sudo systemctl enable --now roomba-matter
journalctl -u roomba-matter -f
```

## Configuration (`config.json`)

| Key | Meaning |
|---|---|
| `host` | Robot IP on your LAN |
| `blid` | Robot BLID (username) from step 1 |
| `password` | Robot local password from step 1 |
| `serial` | Robot serial (shown in Home) |
| `name` | Accessory name |
| `port` | Matter operational UDP port (default 5540) |
| `passcode` / `discriminator` | Matter commissioning values (change if you run several) |

## Status mapping

Robot `cleanMissionStatus.phase` → Matter `RvcOperationalState`:

| Roomba phase | Matter state |
|---|---|
| `run` | Running |
| `stop` | Paused |
| `hmMidMsn` / `hmUsrDock` / `hmPostMsn` | SeekingCharger |
| `charge` | Charging / Docked |
| error / stuck / bin full (off dock) | Error (+ specific `ErrorState`) |

## Roadmap

- **ServiceArea** — per-room cleaning for mapped robots.
- **PowerSource** refinements and a dedicated endpoint if a controller needs it.

Scheduling is intentionally left to Apple Home automations rather than the robot.

## Files

| File | Role |
|---|---|
| `index.mjs` | Entry point: builds the Matter node + endpoint, wires state sync |
| `roomba.js` | `dorita980` controller: connection, auto-reconnect, commands, state |
| `servers.mjs` | Custom RVC behavior servers (run mode, operational state, clean mode, identify) |
| `mapping.mjs` | Roomba ⇄ Matter enum/state translation |
| `shared.mjs` | Singleton bridge from command handlers to the controller |
| `systemd/roomba-matter.service` | systemd unit |

## Credits

- [matter.js](https://github.com/project-chip/matter.js) — Matter protocol in TypeScript.
- [dorita980](https://github.com/koalazak/dorita980) — Roomba local/cloud API.

## License

MIT
