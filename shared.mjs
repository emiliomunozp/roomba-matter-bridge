// shared.mjs — singleton bridge so RVC command handlers can reach the live
// RoombaController instance created in index.mjs.
let roomba = null;
export function setRoomba(r) { roomba = r; }
export function getRoomba() { return roomba; }
